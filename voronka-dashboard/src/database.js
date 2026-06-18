const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require("./auth");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "funnel-dashboard.sqlite");
const roles = new Set(["owner", "project", "admin", "viewer"]);

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "0").replace(/\s+/g, "").replace(",", "."));
}

function estimateContentCount(items) {
  const text = String(items || "").trim();
  if (!text) return 1;
  return Math.max(
    1,
    text
      .split(/\s*(?:,|;|\/|\n|\s+и\s+)\s*/i)
      .map((item) => item.trim())
      .filter(Boolean).length,
  );
}

function todayIso() {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function yesterdayIso() {
  const date = new Date(`${todayIso()}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function launchStatus(launch) {
  return launch.webinar_date < todayIso() ? "archived" : "active";
}

function openDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'project', 'admin', 'viewer')),
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS launches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      product_id INTEGER REFERENCES products(id),
      stream_id INTEGER REFERENCES streams(id),
      webinar_date TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      registration_goal INTEGER NOT NULL DEFAULT 0,
      visitor_goal INTEGER NOT NULL DEFAULT 0,
      baseline_registrations INTEGER NOT NULL DEFAULT 0,
      current_registrations INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      launch_id INTEGER NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
      report_date TEXT NOT NULL,
      launch_day INTEGER NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      site_visitors INTEGER NOT NULL DEFAULT 0,
      registrations INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(launch_id, report_date)
    );

    CREATE TABLE IF NOT EXISTS landing_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      launch_id INTEGER NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      segment TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(launch_id, name)
    );

    CREATE TABLE IF NOT EXISTS landing_page_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
      landing_page_id INTEGER NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
      visitors INTEGER NOT NULL DEFAULT 0,
      registrations INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(report_id, landing_page_id)
    );

    CREATE TABLE IF NOT EXISTS report_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '',
      content_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(report_id, channel)
    );

    CREATE TABLE IF NOT EXISTS webinar_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      launch_id INTEGER NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
      registration_plan INTEGER NOT NULL DEFAULT 0,
      registrations INTEGER NOT NULL DEFAULT 0,
      unique_registration_plan INTEGER NOT NULL DEFAULT 0,
      unique_registrations INTEGER NOT NULL DEFAULT 0,
      visitor_plan INTEGER NOT NULL DEFAULT 0,
      visitors INTEGER NOT NULL DEFAULT 0,
      qualified_leads INTEGER NOT NULL DEFAULT 0,
      unique_participants INTEGER NOT NULL DEFAULT 0,
      peak_participants INTEGER NOT NULL DEFAULT 0,
      over_30m_participants INTEGER NOT NULL DEFAULT 0,
      consultation_request_plan INTEGER NOT NULL DEFAULT 0,
      consultation_requests INTEGER NOT NULL DEFAULT 0,
      order_plan INTEGER NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      unpaid_orders INTEGER NOT NULL DEFAULT 0,
      prepay_clicks INTEGER NOT NULL DEFAULT 0,
      lead_plan INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      paid_consultation_plan INTEGER NOT NULL DEFAULT 0,
      paid_consultations INTEGER NOT NULL DEFAULT 0,
      paid_order_plan INTEGER NOT NULL DEFAULT 0,
      paid_orders INTEGER NOT NULL DEFAULT 0,
      paid_lead_plan INTEGER NOT NULL DEFAULT 0,
      paid_leads INTEGER NOT NULL DEFAULT 0,
      total_payment_plan INTEGER NOT NULL DEFAULT 0,
      total_payments INTEGER NOT NULL DEFAULT 0,
      average_check_plan INTEGER NOT NULL DEFAULT 0,
      average_check INTEGER NOT NULL DEFAULT 0,
      total_order_amount_plan INTEGER NOT NULL DEFAULT 0,
      total_order_amount INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(launch_id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  ensureLaunchColumns(db);
  ensureReportChannelColumns(db);
  ensureWebinarResultColumns(db);
}

function ensureLaunchColumns(db) {
  const columns = db.prepare("PRAGMA table_info(launches)").all().map((column) => column.name);
  if (!columns.includes("product_id")) {
    db.exec("ALTER TABLE launches ADD COLUMN product_id INTEGER REFERENCES products(id)");
  }
  if (!columns.includes("stream_id")) {
    db.exec("ALTER TABLE launches ADD COLUMN stream_id INTEGER REFERENCES streams(id)");
  }
  if (!columns.includes("baseline_registrations")) {
    db.exec("ALTER TABLE launches ADD COLUMN baseline_registrations INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("visitor_goal")) {
    db.exec("ALTER TABLE launches ADD COLUMN visitor_goal INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE launches SET visitor_goal = registration_goal * 2 WHERE visitor_goal = 0 AND registration_goal > 0");
  }
  if (!columns.includes("current_registrations")) {
    db.exec("ALTER TABLE launches ADD COLUMN current_registrations INTEGER NOT NULL DEFAULT 0");
  }
}

function ensureReportChannelColumns(db) {
  const columns = db.prepare("PRAGMA table_info(report_channels)").all().map((column) => column.name);
  if (!columns.includes("content_count")) {
    db.exec("ALTER TABLE report_channels ADD COLUMN content_count INTEGER NOT NULL DEFAULT 0");
  }
}

function ensureWebinarResultColumns(db) {
  const columns = db.prepare("PRAGMA table_info(webinar_results)").all().map((column) => column.name);
  const additions = [
    ["registration_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["registrations", "INTEGER NOT NULL DEFAULT 0"],
    ["unique_registration_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["unique_registrations", "INTEGER NOT NULL DEFAULT 0"],
    ["visitor_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["visitors", "INTEGER NOT NULL DEFAULT 0"],
    ["consultation_request_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["order_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["lead_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["leads", "INTEGER NOT NULL DEFAULT 0"],
    ["paid_consultation_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["paid_consultations", "INTEGER NOT NULL DEFAULT 0"],
    ["paid_order_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["paid_orders", "INTEGER NOT NULL DEFAULT 0"],
    ["paid_lead_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["paid_leads", "INTEGER NOT NULL DEFAULT 0"],
    ["total_payment_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["total_payments", "INTEGER NOT NULL DEFAULT 0"],
    ["average_check_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["average_check", "INTEGER NOT NULL DEFAULT 0"],
    ["total_order_amount_plan", "INTEGER NOT NULL DEFAULT 0"],
    ["total_order_amount", "INTEGER NOT NULL DEFAULT 0"],
  ];
  additions.forEach(([name, definition]) => {
    if (!columns.includes(name)) db.exec(`ALTER TABLE webinar_results ADD COLUMN ${name} ${definition}`);
  });
}

function seedUser(db, envPrefix, fallback) {
  const login = process.env[`${envPrefix}_LOGIN`] || fallback.login;
  const password = process.env[`${envPrefix}_PASSWORD`] || fallback.password;
  const name = process.env[`${envPrefix}_NAME`] || fallback.name;
  if (db.prepare("SELECT id FROM users WHERE login = ?").get(login)) return;
  const { salt, hash } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (login, name, role, password_hash, salt, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(login, name, fallback.role, hash, salt, nowIso(), nowIso());
}

function seed(db) {
  seedUser(db, "OWNER", { login: "owner", password: "owner-change-me", name: "Андрей", role: "owner" });
  seedUser(db, "ADMIN", { login: "admin", password: "admin-change-me", name: "Администратор", role: "admin" });
  seedUser(db, "PROJECT", { login: "project", password: "project-change-me", name: "Проджект", role: "project" });
  seedUser(db, "VIEWER", { login: "viewer", password: "viewer-change-me", name: "Команда", role: "viewer" });

  const productId = ensureReference(db, "products", "Mini MBA", null);
  const streamId = ensureReference(db, "streams", "Поток 1", null);

  let launch = db.prepare("SELECT id FROM launches ORDER BY id ASC LIMIT 1").get();
  if (!launch) {
    const result = db.prepare(`
      INSERT INTO launches (
        title, product_id, stream_id, webinar_date, start_date, end_date, registration_goal, visitor_goal, baseline_registrations,
        current_registrations, status, created_at, updated_at
      )
      VALUES ('Воркшоп 17.06', ?, ?, '2026-06-17', '2026-06-08', '2026-06-17', 900, 1800, 155, 505, 'active', ?, ?)
    `).run(productId, streamId, nowIso(), nowIso());
    launch = { id: Number(result.lastInsertRowid) };
  } else {
    const current = db.prepare("SELECT baseline_registrations, current_registrations, product_id, stream_id, registration_goal, visitor_goal FROM launches WHERE id = ?").get(launch.id);
    if (!current.baseline_registrations && !current.current_registrations) {
      db.prepare("UPDATE launches SET baseline_registrations = 155, current_registrations = 505, updated_at = ? WHERE id = ?").run(nowIso(), launch.id);
    }
    if (!current.product_id || !current.stream_id) {
      db.prepare("UPDATE launches SET product_id = ?, stream_id = ?, updated_at = ? WHERE id = ?").run(productId, streamId, nowIso(), launch.id);
    }
    if (!current.visitor_goal && current.registration_goal) {
      db.prepare("UPDATE launches SET visitor_goal = ?, updated_at = ? WHERE id = ?").run(current.registration_goal * 2, nowIso(), launch.id);
    }
  }
  ensureDefaultLandingPages(db, launch.id);

  const reports = [
    ["2026-06-11", 4, 166, 151, 62, { Instagram: "закреп, карусель, сторис, Reels", Telegram: "пост и закреп", Email: "", "ТГ бот": "", "VK-бот": "", "Сейл-бот": "" }],
    ["2026-06-12", 5, 196, 187, 89, { Instagram: "закреп, карусель, сторис, Reels", Telegram: "пост, закреп и сторис", Email: "", "ТГ бот": "", "VK-бот": "", VK: "", YouTube: "", Rutube: "" }],
    ["2026-06-13", 6, 154, 143, 87, { Instagram: "закреп, карусель, сторис, Reels", Telegram: "пост, закреп и сторис", VK: "", YouTube: "", Dzen: "" }],
    ["2026-06-14", 7, 152, 147, 63, { Instagram: "закреп, карусель, сторис, Reels", Telegram: "пост, закреп и сторис", Email: "", "ТГ бот": "", "VK-бот": "", VK: "", YouTube: "", Rutube: "", Dzen: "" }],
  ];
  for (const [date, day, visits, siteVisitors, registrations, channels] of reports) {
    if (db.prepare("SELECT id FROM daily_reports WHERE launch_id = ? AND report_date = ?").get(launch.id, date)) continue;
    const result = db.prepare(`
      INSERT INTO daily_reports (
        launch_id, report_date, launch_day, visits, site_visitors, registrations, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)
    `).run(launch.id, date, day, visits, siteVisitors, registrations, nowIso(), nowIso());
    const reportId = Number(result.lastInsertRowid);
    const landingPageId = ensureLandingPage(db, launch.id, "Посадочная 1", "Первый сегмент / канал");
    const landingDetail = db.prepare("SELECT id FROM landing_page_reports WHERE report_id = ? AND landing_page_id = ?").get(reportId, landingPageId);
    if (!landingDetail) {
      db.prepare(`
        INSERT INTO landing_page_reports (report_id, landing_page_id, visitors, registrations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(reportId, landingPageId, siteVisitors || visits, registrations, nowIso(), nowIso());
    }
    for (const [channel, items] of Object.entries(channels)) {
      db.prepare("INSERT INTO report_channels (report_id, channel, items, content_count, created_at) VALUES (?, ?, ?, ?, ?)").run(
        reportId,
        channel,
        items,
        estimateContentCount(items),
        nowIso(),
      );
    }
  }
  seedWebinarResult(db, launch.id);
}

function seedWebinarResult(db, launchId) {
  const existing = db.prepare("SELECT id FROM webinar_results WHERE launch_id = ?").get(launchId);
  if (existing) {
    db.prepare(`
      UPDATE webinar_results
      SET registration_plan = CASE WHEN registration_plan = 0 THEN 1200 ELSE registration_plan END,
        registrations = CASE WHEN registrations = 0 THEN 773 ELSE registrations END,
        unique_registration_plan = CASE WHEN unique_registration_plan = 0 THEN 840 ELSE unique_registration_plan END,
        unique_registrations = CASE WHEN unique_registrations = 0 THEN 643 ELSE unique_registrations END,
        visitor_plan = CASE WHEN visitor_plan = 0 THEN 600 ELSE visitor_plan END,
        visitors = CASE WHEN visitors = 0 THEN 567 ELSE visitors END,
        consultation_request_plan = CASE WHEN consultation_request_plan = 0 THEN 60 ELSE consultation_request_plan END,
        order_plan = CASE WHEN order_plan = 0 THEN 30 ELSE order_plan END,
        lead_plan = CASE WHEN lead_plan = 0 THEN 360 ELSE lead_plan END,
        leads = CASE WHEN leads = 0 THEN 217 ELSE leads END,
        paid_consultation_plan = CASE WHEN paid_consultation_plan = 0 THEN 12 ELSE paid_consultation_plan END,
        paid_order_plan = CASE WHEN paid_order_plan = 0 THEN 12 ELSE paid_order_plan END,
        paid_orders = CASE WHEN paid_orders = 0 THEN 1 ELSE paid_orders END,
        paid_lead_plan = CASE WHEN paid_lead_plan = 0 THEN 18 ELSE paid_lead_plan END,
        paid_leads = CASE WHEN paid_leads = 0 THEN 1 ELSE paid_leads END,
        total_payment_plan = CASE WHEN total_payment_plan = 0 THEN 42 ELSE total_payment_plan END,
        total_payments = CASE WHEN total_payments = 0 THEN 1 ELSE total_payments END,
        average_check_plan = CASE WHEN average_check_plan = 0 THEN 170000 ELSE average_check_plan END,
        average_check = CASE WHEN average_check = 0 THEN 235000 ELSE average_check END,
        total_order_amount_plan = CASE WHEN total_order_amount_plan = 0 THEN 7140000 ELSE total_order_amount_plan END,
        total_order_amount = CASE WHEN total_order_amount = 0 THEN 705000 ELSE total_order_amount END,
        updated_at = ?
      WHERE launch_id = ?
    `).run(nowIso(), launchId);
    return;
  }
  db.prepare(`
    INSERT INTO webinar_results (
      launch_id, registration_plan, registrations, unique_registration_plan, unique_registrations, visitor_plan, visitors,
      qualified_leads, unique_participants, peak_participants, over_30m_participants,
      consultation_request_plan, consultation_requests, order_plan, orders, unpaid_orders, prepay_clicks,
      lead_plan, leads, paid_consultation_plan, paid_consultations, paid_order_plan, paid_orders,
      paid_lead_plan, paid_leads, total_payment_plan, total_payments, average_check_plan, average_check,
      total_order_amount_plan, total_order_amount, created_at, updated_at
    )
    VALUES (?, 1200, 773, 840, 643, 600, 567, 639, 627, 210, 217, 60, 12, 30, 3, 3, 17, 360, 217, 12, 0, 12, 1, 18, 1, 42, 1, 170000, 235000, 7140000, 705000, ?, ?)
  `).run(launchId, nowIso(), nowIso());
}

function ensureLandingPage(db, launchId, name, segment = "") {
  const pageName = String(name || "").trim();
  if (!pageName) throw Object.assign(new Error("Название посадочной страницы не заполнено"), { statusCode: 400 });
  const existing = db.prepare("SELECT id FROM landing_pages WHERE launch_id = ? AND name = ?").get(launchId, pageName);
  if (existing) {
    db.prepare("UPDATE landing_pages SET segment = ?, active = 1, updated_at = ? WHERE id = ?").run(String(segment || ""), nowIso(), existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO landing_pages (launch_id, name, segment, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(launchId, pageName, String(segment || ""), nowIso(), nowIso());
  return Number(result.lastInsertRowid);
}

function ensureDefaultLandingPages(db, launchId) {
  const pages = db.prepare("SELECT id, name FROM landing_pages WHERE launch_id = ? AND active = 1 ORDER BY id").all(launchId);
  if (!pages.length) {
    ensureLandingPage(db, launchId, "Посадочная 1", "Первый сегмент / канал");
    ensureLandingPage(db, launchId, "Посадочная 2", "Второй сегмент / канал");
    return;
  }
  if (pages.length === 1 && pages[0].name === "Основная посадочная") {
    db.prepare("UPDATE landing_pages SET name = 'Посадочная 1', segment = 'Первый сегмент / канал', updated_at = ? WHERE id = ?").run(nowIso(), pages[0].id);
    ensureLandingPage(db, launchId, "Посадочная 2", "Второй сегмент / канал");
  }
}

function syncLandingPages(db, launchId, pages = []) {
  const normalized = pages
    .map((page) => ({
      id: Number(page.id || 0),
      name: String(page.name || "").trim(),
      segment: String(page.segment || "").trim(),
    }))
    .filter((page) => page.name);
  if (!normalized.length) normalized.push({ id: 0, name: "Посадочная 1", segment: "Первый сегмент / канал" });

  const activeIds = [];
  for (const page of normalized) {
    if (page.id) {
      const existing = db.prepare("SELECT id FROM landing_pages WHERE id = ? AND launch_id = ?").get(page.id, launchId);
      if (existing) {
        db.prepare("UPDATE landing_pages SET name = ?, segment = ?, active = 1, updated_at = ? WHERE id = ?").run(page.name, page.segment, nowIso(), page.id);
        activeIds.push(page.id);
        continue;
      }
    }
    activeIds.push(ensureLandingPage(db, launchId, page.name, page.segment));
  }
  if (activeIds.length) {
    const placeholders = activeIds.map(() => "?").join(",");
    db.prepare(`UPDATE landing_pages SET active = 0, updated_at = ? WHERE launch_id = ? AND id NOT IN (${placeholders})`).run(nowIso(), launchId, ...activeIds);
  }
  return activeIds;
}

function ensureReference(db, table, name, actorId) {
  const value = String(name || "").trim();
  if (!value) throw Object.assign(new Error("Название справочника не заполнено"), { statusCode: 400 });
  const existing = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(value);
  if (existing) return existing.id;
  const result = db.prepare(`INSERT INTO ${table} (name, active, created_by, created_at) VALUES (?, 1, ?, ?)`).run(value, actorId || null, nowIso());
  return Number(result.lastInsertRowid);
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, login: user.login, name: user.name, role: user.role, active: Boolean(user.active) };
}

function getUserByLogin(db, login) {
  return db.prepare("SELECT * FROM users WHERE login = ? AND active = 1").get(login);
}

function getUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(id);
}

function listUsers(db) {
  return db.prepare("SELECT id, login, name, role, active, created_at, updated_at FROM users WHERE active = 1 ORDER BY role, name").all();
}

function createUser(db, actorId, input) {
  if (!roles.has(input.role)) throw Object.assign(new Error("Недопустимая роль"), { statusCode: 400 });
  if (!input.login || !input.password || !input.name) throw Object.assign(new Error("Заполните логин, имя и пароль"), { statusCode: 400 });
  const login = input.login.trim();
  const duplicate = db.prepare("SELECT id, name, active FROM users WHERE login = ?").get(login);
  if (duplicate?.active) throw Object.assign(new Error(`Логин ${login} уже занят пользователем ${duplicate.name}`), { statusCode: 400 });
  const { salt, hash } = hashPassword(input.password);
  if (duplicate) {
    db.prepare("UPDATE users SET name = ?, role = ?, password_hash = ?, salt = ?, active = 1, updated_at = ? WHERE id = ?").run(
      input.name.trim(),
      input.role,
      hash,
      salt,
      nowIso(),
      duplicate.id,
    );
    log(db, actorId, "restore", "user", String(duplicate.id), { login, role: input.role });
    return duplicate.id;
  }
  const result = db.prepare(`
    INSERT INTO users (login, name, role, password_hash, salt, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(login, input.name.trim(), input.role, hash, salt, nowIso(), nowIso());
  log(db, actorId, "create", "user", String(result.lastInsertRowid), { login, role: input.role });
  return result.lastInsertRowid;
}

function updateUser(db, actorId, id, input) {
  if (!roles.has(input.role)) throw Object.assign(new Error("Недопустимая роль"), { statusCode: 400 });
  if (!input.login || !input.name) throw Object.assign(new Error("Заполните логин и имя"), { statusCode: 400 });
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!existing) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });
  const login = input.login.trim();
  const duplicate = db.prepare("SELECT id, name, active FROM users WHERE login = ? AND id != ?").get(login, id);
  if (duplicate?.active) throw Object.assign(new Error(`Логин ${login} уже занят пользователем ${duplicate.name}`), { statusCode: 400 });
  if (duplicate && !duplicate.active) throw Object.assign(new Error(`Логин ${login} уже использовался удаленным пользователем.`), { statusCode: 400 });
  const active = input.active === false || input.active === "false" ? 0 : 1;
  if (input.password) {
    const { salt, hash } = hashPassword(input.password);
    db.prepare("UPDATE users SET login = ?, name = ?, role = ?, password_hash = ?, salt = ?, active = ?, updated_at = ? WHERE id = ?").run(
      login,
      input.name.trim(),
      input.role,
      hash,
      salt,
      active,
      nowIso(),
      id,
    );
  } else {
    db.prepare("UPDATE users SET login = ?, name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?").run(
      login,
      input.name.trim(),
      input.role,
      active,
      nowIso(),
      id,
    );
  }
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  log(db, actorId, "update", "user", String(id), { login, role: input.role, active: Boolean(active) });
}

function disableUser(db, actorId, id) {
  db.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").run(nowIso(), id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  log(db, actorId, "disable", "user", String(id), {});
}

function createSession(db, tokenHash, userId, expiresAt) {
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, userId, expiresAt, nowIso());
}

function getSessionUser(db, tokenHash) {
  const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return getUserById(db, session.user_id);
}

function deleteSession(db, tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

function listReferences(db) {
  return {
    products: db.prepare("SELECT id, name FROM products WHERE active = 1 ORDER BY name").all(),
    streams: db.prepare("SELECT id, name FROM streams WHERE active = 1 ORDER BY name").all(),
  };
}

function addReference(db, actorId, input) {
  const type = String(input.type || "").trim();
  if (!["products", "streams"].includes(type)) throw Object.assign(new Error("Недопустимый тип справочника"), { statusCode: 400 });
  const value = String(input.name || "").trim();
  if (!value) throw Object.assign(new Error("Название справочника не заполнено"), { statusCode: 400 });
  const existing = db.prepare(`SELECT id FROM ${type} WHERE name = ? AND active = 1`).get(value);
  if (existing) return { id: existing.id, created: false, name: value };
  const id = ensureReference(db, type, value, actorId);
  log(db, actorId, "create", type, String(id), input);
  return { id, created: true, name: value };
}

function launchSelectSql() {
  return `
    SELECT l.*, p.name AS product_name, s.name AS stream_name
    FROM launches l
    LEFT JOIN products p ON p.id = l.product_id
    LEFT JOIN streams s ON s.id = l.stream_id
  `;
}

function normalizeLaunch(launch) {
  if (!launch) return null;
  return { ...launch, computed_status: launchStatus(launch) };
}

function getLaunch(db, id) {
  const launch = db.prepare(`${launchSelectSql()} WHERE l.id = ?`).get(id);
  return normalizeLaunch(launch);
}

function listLaunches(db) {
  return db.prepare(`${launchSelectSql()} ORDER BY l.webinar_date DESC, l.id DESC`).all().map(normalizeLaunch);
}

function listActiveLaunches(db) {
  return listLaunches(db).filter((launch) => launch.computed_status === "active");
}

function listArchivedLaunches(db) {
  return listLaunches(db).filter((launch) => launch.computed_status === "archived");
}

function pickLaunch(db, id) {
  if (id) return getLaunch(db, id);
  return listActiveLaunches(db)[0] || listArchivedLaunches(db)[0] || null;
}

function upsertLaunch(db, actorId, input) {
  const id = Number(input.id || 0);
  const payload = {
    title: String(input.title || "").trim(),
    product_id: toNumber(input.product_id),
    stream_id: toNumber(input.stream_id),
    webinar_date: input.webinar_date,
    start_date: input.start_date,
    end_date: input.end_date,
    registration_goal: toNumber(input.registration_goal),
    visitor_goal: toNumber(input.visitor_goal),
    baseline_registrations: toNumber(input.baseline_registrations || 0),
    current_registrations: toNumber(input.current_registrations || 0),
  };
  if (!payload.title || !payload.product_id || !payload.stream_id || !payload.webinar_date || !payload.start_date || !payload.end_date) {
    throw Object.assign(new Error("Заполните название, продукт, поток, даты и цель регистраций"), { statusCode: 400 });
  }
  if (id) {
    const existing = getLaunch(db, id);
    if (!existing) throw Object.assign(new Error("Запуск не найден"), { statusCode: 404 });
    if (existing.computed_status === "archived") throw Object.assign(new Error("Архивный вебинар закрыт для изменений"), { statusCode: 403 });
    db.prepare(`
      UPDATE launches
      SET title = ?, product_id = ?, stream_id = ?, webinar_date = ?, start_date = ?, end_date = ?, registration_goal = ?, visitor_goal = ?,
        baseline_registrations = ?, current_registrations = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.title,
      payload.product_id,
      payload.stream_id,
      payload.webinar_date,
      payload.start_date,
      payload.end_date,
      payload.registration_goal,
      payload.visitor_goal,
      payload.baseline_registrations,
      payload.current_registrations,
      actorId,
      nowIso(),
      id,
    );
    log(db, actorId, "update", "launch", String(id), payload);
    syncLandingPages(db, id, input.landing_pages || []);
    return id;
  }
  const result = db.prepare(`
    INSERT INTO launches (
      title, product_id, stream_id, webinar_date, start_date, end_date, registration_goal, visitor_goal, baseline_registrations,
      current_registrations, status, updated_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    payload.title,
    payload.product_id,
    payload.stream_id,
    payload.webinar_date,
    payload.start_date,
    payload.end_date,
    payload.registration_goal,
    payload.visitor_goal,
    payload.baseline_registrations,
    payload.current_registrations,
    actorId,
    nowIso(),
    nowIso(),
  );
  log(db, actorId, "create", "launch", String(result.lastInsertRowid), payload);
  const launchId = Number(result.lastInsertRowid);
  syncLandingPages(db, launchId, input.landing_pages || []);
  return launchId;
}

function upsertReport(db, actorId, input) {
  const launchId = Number(input.launch_id);
  if (!launchId || !input.report_date) throw Object.assign(new Error("Не указан запуск или дата отчета"), { statusCode: 400 });
  const launch = getLaunch(db, launchId);
  if (!launch) throw Object.assign(new Error("Запуск не найден"), { statusCode: 404 });
  if (launch.computed_status === "archived") throw Object.assign(new Error("Архивный вебинар закрыт для изменений"), { statusCode: 403 });
  const launchDay =
    toNumber(input.launch_day) ||
    Math.max(1, Math.ceil((new Date(`${input.report_date}T00:00:00`) - new Date(`${launch.start_date}T00:00:00`)) / 86400000) + 1);
  const landingInput = Array.isArray(input.landing_pages) ? input.landing_pages : [];
  const landingTotals = landingInput.reduce(
    (acc, page) => {
      acc.visitors += toNumber(page.visitors);
      acc.registrations += toNumber(page.registrations);
      return acc;
    },
    { visitors: 0, registrations: 0 },
  );
  const legacyVisitors = landingInput.length ? landingTotals.visitors : toNumber(input.site_visitors || input.visits);
  const legacyRegistrations = landingInput.length ? landingTotals.registrations : toNumber(input.registrations);

  const result = db.prepare(`
    INSERT INTO daily_reports (
      launch_id, report_date, launch_day, visits, site_visitors, registrations, notes, updated_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(launch_id, report_date) DO UPDATE SET
      launch_day = excluded.launch_day,
      visits = excluded.visits,
      site_visitors = excluded.site_visitors,
      registrations = excluded.registrations,
      notes = excluded.notes,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    launchId,
    input.report_date,
    launchDay,
    legacyVisitors,
    legacyVisitors,
    legacyRegistrations,
    String(input.notes || ""),
    actorId,
    nowIso(),
    nowIso(),
  );
  const report = db.prepare("SELECT id FROM daily_reports WHERE launch_id = ? AND report_date = ?").get(launchId, input.report_date);
  if (landingInput.length) {
    db.prepare("DELETE FROM landing_page_reports WHERE report_id = ?").run(report.id);
    for (const page of landingInput) {
      const landingPageId = Number(page.id || page.landing_page_id || 0);
      if (!landingPageId) continue;
      db.prepare(`
        INSERT INTO landing_page_reports (report_id, landing_page_id, visitors, registrations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(report_id, landing_page_id) DO UPDATE SET
          visitors = excluded.visitors,
          registrations = excluded.registrations,
          updated_at = excluded.updated_at
      `).run(report.id, landingPageId, toNumber(page.visitors), toNumber(page.registrations), nowIso(), nowIso());
    }
  } else {
    const defaultLandingPageId = ensureLandingPage(db, launchId, "Посадочная 1", "Первый сегмент / канал");
    db.prepare(`
      INSERT INTO landing_page_reports (report_id, landing_page_id, visitors, registrations, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_id, landing_page_id) DO UPDATE SET
        visitors = excluded.visitors,
        registrations = excluded.registrations,
        updated_at = excluded.updated_at
    `).run(report.id, defaultLandingPageId, legacyVisitors, legacyRegistrations, nowIso(), nowIso());
  }
  db.prepare("DELETE FROM report_channels WHERE report_id = ?").run(report.id);
  for (const item of input.channels || []) {
    const channel = String(item.channel || "").trim();
    if (!channel) continue;
    const items = String(item.items || "");
    const contentCount = Math.max(0, toNumber(item.content_count ?? item.count ?? estimateContentCount(items)) || 0);
    db.prepare("INSERT INTO report_channels (report_id, channel, items, content_count, created_at) VALUES (?, ?, ?, ?, ?)").run(
      report.id,
      channel,
      items,
      contentCount,
      nowIso(),
    );
  }
  log(db, actorId, "upsert", "daily_report", String(report.id || result.lastInsertRowid), input);
}

function listReports(db, launchId) {
  const reports = db.prepare("SELECT * FROM daily_reports WHERE launch_id = ? ORDER BY report_date ASC").all(launchId);
  const channelStmt = db.prepare("SELECT channel, items, content_count FROM report_channels WHERE report_id = ? ORDER BY channel");
  const landingStmt = db.prepare(`
    SELECT lpr.landing_page_id AS id, lp.name, lp.segment, lpr.visitors, lpr.registrations
    FROM landing_page_reports lpr
    JOIN landing_pages lp ON lp.id = lpr.landing_page_id
    WHERE lpr.report_id = ?
    ORDER BY lp.id
  `);
  return reports.map((report) => {
    let landingPages = landingStmt.all(report.id);
    if (!landingPages.length) {
      ensureDefaultLandingPages(db, launchId);
      const defaultLandingPage = db.prepare("SELECT id, name, segment FROM landing_pages WHERE launch_id = ? AND active = 1 ORDER BY id LIMIT 1").get(launchId);
      landingPages = [
        {
          id: defaultLandingPage.id,
          name: defaultLandingPage.name,
          segment: defaultLandingPage.segment,
          visitors: report.site_visitors || report.visits,
          registrations: report.registrations,
        },
      ];
    }
    const visitors = landingPages.reduce((sum, page) => sum + page.visitors, 0);
    const registrations = landingPages.reduce((sum, page) => sum + page.registrations, 0);
    return {
      ...report,
      visits: visitors,
      site_visitors: visitors,
      registrations,
      landing_pages: landingPages.map((page) => ({ ...page, conversion: page.visitors ? page.registrations / page.visitors : 0 })),
      channels: channelStmt.all(report.id).map((item) => ({
        ...item,
        content_count: Number(item.content_count || 0) || estimateContentCount(item.items),
      })),
    };
  });
}

function listLandingPages(db, launchId) {
  const pages = db.prepare("SELECT id, name, segment, active FROM landing_pages WHERE launch_id = ? AND active = 1 ORDER BY id").all(launchId);
  if (pages.length) return pages;
  ensureDefaultLandingPages(db, launchId);
  return db.prepare("SELECT id, name, segment, active FROM landing_pages WHERE launch_id = ? AND active = 1 ORDER BY id").all(launchId);
}

function getWebinarResult(db, launchId) {
  return (
    db
      .prepare(
        `SELECT registration_plan, registrations, unique_registration_plan, unique_registrations, visitor_plan, visitors,
          qualified_leads, unique_participants, peak_participants, over_30m_participants,
          consultation_request_plan, consultation_requests, order_plan, orders, unpaid_orders, prepay_clicks,
          lead_plan, leads, paid_consultation_plan, paid_consultations, paid_order_plan, paid_orders,
          paid_lead_plan, paid_leads, total_payment_plan, total_payments, average_check_plan, average_check,
          total_order_amount_plan, total_order_amount
         FROM webinar_results WHERE launch_id = ?`,
      )
      .get(launchId) || {
      registration_plan: 0,
      registrations: 0,
      unique_registration_plan: 0,
      unique_registrations: 0,
      visitor_plan: 0,
      visitors: 0,
      qualified_leads: 0,
      unique_participants: 0,
      peak_participants: 0,
      over_30m_participants: 0,
      consultation_request_plan: 0,
      consultation_requests: 0,
      order_plan: 0,
      orders: 0,
      unpaid_orders: 0,
      prepay_clicks: 0,
      lead_plan: 0,
      leads: 0,
      paid_consultation_plan: 0,
      paid_consultations: 0,
      paid_order_plan: 0,
      paid_orders: 0,
      paid_lead_plan: 0,
      paid_leads: 0,
      total_payment_plan: 0,
      total_payments: 0,
      average_check_plan: 0,
      average_check: 0,
      total_order_amount_plan: 0,
      total_order_amount: 0,
    }
  );
}

function upsertWebinarResult(db, actorId, input) {
  const launchId = Number(input.launch_id);
  if (!launchId) throw Object.assign(new Error("Не указан запуск"), { statusCode: 400 });
  const launch = getLaunch(db, launchId);
  if (!launch) throw Object.assign(new Error("Запуск не найден"), { statusCode: 404 });
  const payload = {
    registration_plan: toNumber(input.registration_plan),
    registrations: toNumber(input.registrations),
    unique_registration_plan: toNumber(input.unique_registration_plan),
    unique_registrations: toNumber(input.unique_registrations),
    visitor_plan: toNumber(input.visitor_plan),
    visitors: toNumber(input.visitors),
    qualified_leads: toNumber(input.qualified_leads),
    unique_participants: toNumber(input.unique_participants),
    peak_participants: toNumber(input.peak_participants),
    over_30m_participants: toNumber(input.over_30m_participants),
    consultation_request_plan: toNumber(input.consultation_request_plan),
    consultation_requests: toNumber(input.consultation_requests),
    order_plan: toNumber(input.order_plan),
    orders: toNumber(input.orders),
    unpaid_orders: toNumber(input.unpaid_orders),
    prepay_clicks: toNumber(input.prepay_clicks),
    lead_plan: toNumber(input.lead_plan),
    leads: toNumber(input.leads),
    paid_consultation_plan: toNumber(input.paid_consultation_plan),
    paid_consultations: toNumber(input.paid_consultations),
    paid_order_plan: toNumber(input.paid_order_plan),
    paid_orders: toNumber(input.paid_orders),
    paid_lead_plan: toNumber(input.paid_lead_plan),
    paid_leads: toNumber(input.paid_leads),
    total_payment_plan: toNumber(input.total_payment_plan),
    total_payments: toNumber(input.total_payments),
    average_check_plan: toNumber(input.average_check_plan),
    average_check: toNumber(input.average_check),
    total_order_amount_plan: toNumber(input.total_order_amount_plan),
    total_order_amount: toNumber(input.total_order_amount),
  };
  db.prepare(`
    INSERT INTO webinar_results (
      launch_id, registration_plan, registrations, unique_registration_plan, unique_registrations, visitor_plan, visitors,
      qualified_leads, unique_participants, peak_participants, over_30m_participants,
      consultation_request_plan, consultation_requests, order_plan, orders, unpaid_orders, prepay_clicks,
      lead_plan, leads, paid_consultation_plan, paid_consultations, paid_order_plan, paid_orders,
      paid_lead_plan, paid_leads, total_payment_plan, total_payments, average_check_plan, average_check,
      total_order_amount_plan, total_order_amount, updated_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(launch_id) DO UPDATE SET
      registration_plan = excluded.registration_plan,
      registrations = excluded.registrations,
      unique_registration_plan = excluded.unique_registration_plan,
      unique_registrations = excluded.unique_registrations,
      visitor_plan = excluded.visitor_plan,
      visitors = excluded.visitors,
      qualified_leads = excluded.qualified_leads,
      unique_participants = excluded.unique_participants,
      peak_participants = excluded.peak_participants,
      over_30m_participants = excluded.over_30m_participants,
      consultation_request_plan = excluded.consultation_request_plan,
      consultation_requests = excluded.consultation_requests,
      order_plan = excluded.order_plan,
      orders = excluded.orders,
      unpaid_orders = excluded.unpaid_orders,
      prepay_clicks = excluded.prepay_clicks,
      lead_plan = excluded.lead_plan,
      leads = excluded.leads,
      paid_consultation_plan = excluded.paid_consultation_plan,
      paid_consultations = excluded.paid_consultations,
      paid_order_plan = excluded.paid_order_plan,
      paid_orders = excluded.paid_orders,
      paid_lead_plan = excluded.paid_lead_plan,
      paid_leads = excluded.paid_leads,
      total_payment_plan = excluded.total_payment_plan,
      total_payments = excluded.total_payments,
      average_check_plan = excluded.average_check_plan,
      average_check = excluded.average_check,
      total_order_amount_plan = excluded.total_order_amount_plan,
      total_order_amount = excluded.total_order_amount,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    launchId,
    payload.registration_plan,
    payload.registrations,
    payload.unique_registration_plan,
    payload.unique_registrations,
    payload.visitor_plan,
    payload.visitors,
    payload.qualified_leads,
    payload.unique_participants,
    payload.peak_participants,
    payload.over_30m_participants,
    payload.consultation_request_plan,
    payload.consultation_requests,
    payload.order_plan,
    payload.orders,
    payload.unpaid_orders,
    payload.prepay_clicks,
    payload.lead_plan,
    payload.leads,
    payload.paid_consultation_plan,
    payload.paid_consultations,
    payload.paid_order_plan,
    payload.paid_orders,
    payload.paid_lead_plan,
    payload.paid_leads,
    payload.total_payment_plan,
    payload.total_payments,
    payload.average_check_plan,
    payload.average_check,
    payload.total_order_amount_plan,
    payload.total_order_amount,
    actorId,
    nowIso(),
    nowIso(),
  );
  log(db, actorId, "upsert", "webinar_result", String(launchId), payload);
}

function enrichWebinarResult(rawResult, registrations) {
  const result = { ...rawResult, registrations: Number(rawResult.registrations || registrations || 0) };
  if (!result.visitors && result.unique_participants) result.visitors = result.unique_participants;
  if (!result.leads && result.over_30m_participants) result.leads = result.over_30m_participants;
  result.conversion_registration_to_request = result.registrations ? result.consultation_requests / result.registrations : 0;
  result.conversion_registration_to_visitor = result.registrations ? result.visitors / result.registrations : 0;
  result.conversion_participant_to_request = result.visitors ? result.consultation_requests / result.visitors : 0;
  result.conversion_registration_to_order = result.registrations ? result.orders / result.registrations : 0;
  result.conversion_visitor_to_order = result.visitors ? result.orders / result.visitors : 0;
  result.conversion_visitor_to_lead = result.visitors ? result.leads / result.visitors : 0;
  result.conversion_request_to_order = result.consultation_requests ? result.orders / result.consultation_requests : 0;
  result.conversion_request_to_payment = result.consultation_requests ? result.paid_consultations / result.consultation_requests : 0;
  result.conversion_order_to_payment = result.orders ? result.paid_orders / result.orders : 0;
  result.conversion_lead_to_payment = result.leads ? result.paid_leads / result.leads : 0;
  result.has_data = Object.entries(rawResult).some(([key, value]) => key !== "registrations" && Number(value || 0) > 0);
  return result;
}

function inclusiveDays(fromDate, toDate) {
  return Math.max(1, Math.ceil((new Date(`${toDate}T00:00:00`) - new Date(`${fromDate}T00:00:00`)) / 86400000) + 1);
}

function dailyPlanSnapshot(goal, collectedBefore, reportDate, endDate, fact) {
  const plan = Math.ceil(Math.max(0, Number(goal || 0) - Number(collectedBefore || 0)) / inclusiveDays(reportDate, endDate));
  const delta = Number(fact || 0) - plan;
  return {
    plan,
    delta,
    delta_percent: plan ? delta / plan : 0,
    has_plan: plan > 0,
  };
}

function attachDailyPlans(launch, reports, targetDate, fallback = null) {
  let registrationsBefore = Number(launch.baseline_registrations || 0);
  let visitorsBefore = 0;
  let targetPlan = null;
  const plannedReports = reports.map((report) => {
    const daily_plan = {
      registrations: dailyPlanSnapshot(launch.registration_goal, registrationsBefore, report.report_date, launch.end_date, report.registrations),
      visitors: dailyPlanSnapshot(launch.visitor_goal, visitorsBefore, report.report_date, launch.end_date, report.site_visitors),
    };
    const withPlan = { ...report, daily_plan };
    if (report.report_date === targetDate) targetPlan = daily_plan;
    registrationsBefore += Number(report.registrations || 0);
    visitorsBefore += Number(report.site_visitors || 0);
    return withPlan;
  });
  if (!targetPlan) {
    const reportsBeforeTarget = reports.filter((report) => report.report_date < targetDate);
    const fallbackRegistrationsBefore =
      Number(launch.baseline_registrations || 0) + reportsBeforeTarget.reduce((sum, report) => sum + Number(report.registrations || 0), 0);
    const fallbackVisitorsBefore = reportsBeforeTarget.reduce((sum, report) => sum + Number(report.site_visitors || 0), 0);
    targetPlan = {
      registrations: dailyPlanSnapshot(launch.registration_goal, fallbackRegistrationsBefore, targetDate, launch.end_date, fallback?.registrations || 0),
      visitors: dailyPlanSnapshot(launch.visitor_goal, fallbackVisitorsBefore, targetDate, launch.end_date, fallback?.site_visitors || fallback?.visits || 0),
    };
  }
  return { reports: plannedReports, targetPlan };
}

function pickDailySnapshot(launch, reports) {
  const archived = launch.computed_status === "archived";
  if (!archived) {
    return {
      mode: "yesterday",
      targetDate: yesterdayIso(),
      report: reports.find((report) => report.report_date === yesterdayIso()) || null,
    };
  }
  const finalReport =
    reports.find((report) => report.report_date === launch.webinar_date) ||
    [...reports].reverse().find((report) => report.report_date <= launch.webinar_date) ||
    null;
  return {
    mode: "final",
    targetDate: finalReport?.report_date || launch.webinar_date,
    report: finalReport,
  };
}

function summarize(db, launchId) {
  const launch = pickLaunch(db, launchId);
  if (!launch) return null;
  const rawReports = listReports(db, launch.id);
  const landingPages = listLandingPages(db, launch.id);
  const dailySnapshot = pickDailySnapshot(launch, rawReports);
  const archived = launch.computed_status === "archived";
  const { reports, targetPlan: yesterdayPlan } = attachDailyPlans(launch, rawReports, dailySnapshot.targetDate);
  const detailedTotals = reports.reduce(
    (acc, report) => {
      acc.visits += report.visits;
      acc.site_visitors += report.site_visitors;
      acc.registrations += report.registrations;
      acc.last_date = report.report_date;
      return acc;
    },
    { visits: 0, site_visitors: 0, registrations: 0, last_date: null },
  );
  const periodRegistrations = launch.baseline_registrations + detailedTotals.registrations;
  const totals = {
    ...detailedTotals,
    detailed_registrations: detailedTotals.registrations,
    registrations: periodRegistrations,
    period_registrations: periodRegistrations,
  };
  const webinarResult = enrichWebinarResult(getWebinarResult(db, launch.id), totals.registrations);
  const yesterdayReport = reports.find((report) => report.report_date === dailySnapshot.report?.report_date) || null;
  const yesterday = archived
    ? {
        mode: "final",
        report_date: launch.webinar_date,
        launch_day: inclusiveDays(launch.start_date, launch.webinar_date),
        visits: detailedTotals.site_visitors,
        site_visitors: detailedTotals.site_visitors,
        registrations: totals.registrations,
        conversion: detailedTotals.site_visitors ? totals.detailed_registrations / detailedTotals.site_visitors : 0,
        landing_pages: [],
        daily_plan: null,
        has_data: reports.length > 0,
      }
    : yesterdayReport
      ? {
          ...yesterdayReport,
          mode: dailySnapshot.mode,
          conversion: yesterdayReport.site_visitors ? yesterdayReport.registrations / yesterdayReport.site_visitors : 0,
          landing_pages: yesterdayReport.landing_pages,
          daily_plan: yesterdayReport.daily_plan,
          has_data: true,
        }
      : {
          mode: dailySnapshot.mode,
          report_date: dailySnapshot.targetDate,
          launch_day: Math.max(1, Math.ceil((new Date(`${dailySnapshot.targetDate}T00:00:00`) - new Date(`${launch.start_date}T00:00:00`)) / 86400000) + 1),
          visits: 0,
          site_visitors: 0,
          registrations: 0,
          conversion: 0,
          landing_pages: landingPages.map((page) => ({ ...page, visitors: 0, registrations: 0, conversion: 0 })),
          daily_plan: yesterdayPlan,
          has_data: false,
        };
  const landingTotals = landingPages.map((page) => {
    const totalsByPage = reports.reduce(
      (acc, report) => {
        const detail = report.landing_pages.find((item) => Number(item.id) === Number(page.id));
        if (detail) {
          acc.visitors += detail.visitors;
          acc.registrations += detail.registrations;
        }
        return acc;
      },
      { visitors: 0, registrations: 0 },
    );
    return {
      ...page,
      visitors: totalsByPage.visitors,
      registrations: totalsByPage.registrations,
      conversion: totalsByPage.visitors ? totalsByPage.registrations / totalsByPage.visitors : 0,
    };
  });
  const daysTotal = Math.max(1, Math.ceil((new Date(`${launch.end_date}T00:00:00`) - new Date(`${launch.start_date}T00:00:00`)) / 86400000) + 1);
  const daysElapsed = Math.max(1, reports.length ? Math.max(...reports.map((report) => report.launch_day)) : 1);
  const pacePerDay = totals.registrations / daysElapsed;
  const forecast = Math.round(pacePerDay * daysTotal);
  const goalDelta = forecast - launch.registration_goal;
  const requiredPerDay = Math.max(0, Math.ceil((launch.registration_goal - totals.registrations) / Math.max(1, daysTotal - daysElapsed)));
  const channels = {};
  for (const report of reports) {
    for (const item of report.channels) {
      channels[item.channel] ||= { channel: item.channel, days: 0, content_count: 0, items: [] };
      channels[item.channel].days += 1;
      channels[item.channel].content_count += Number(item.content_count || 0);
      if (item.items) channels[item.channel].items.push(item.items);
    }
  }
  const contentTotals = Object.values(channels).sort((a, b) => b.content_count - a.content_count || a.channel.localeCompare(b.channel));
  const contentYesterday = yesterdayReport
    ? yesterdayReport.channels
        .map((item) => ({
          channel: item.channel,
          items: item.items,
          content_count: Number(item.content_count || 0),
        }))
        .sort((a, b) => b.content_count - a.content_count || a.channel.localeCompare(b.channel))
    : [];
  const risks = [];
  if (goalDelta < 0) risks.push(`Прогноз ниже цели на ${Math.abs(goalDelta)} регистраций.`);
  if (totals.site_visitors && totals.detailed_registrations / totals.site_visitors < 0.35) {
    risks.push("Конверсия посадочной страницы ниже 35%, нужно проверить страницу и оффер.");
  }
  if (requiredPerDay > Math.max(1, pacePerDay * 1.35)) risks.push("Нужен резкий рост дневных регистраций, текущего темпа недостаточно.");
  if (!risks.length) risks.push("Критичных рисков по текущему темпу нет.");
  return {
    launch,
    landing_pages: landingPages,
    landing_totals: landingTotals,
    reports,
    yesterday,
    totals,
    webinar_result: webinarResult,
    conversion: totals.site_visitors ? totals.detailed_registrations / totals.site_visitors : 0,
    visit_to_site_rate: totals.visits ? totals.site_visitors / totals.visits : 0,
    progress: launch.registration_goal ? totals.registrations / launch.registration_goal : 0,
    forecast,
    goal_delta: goalDelta,
    required_per_day: requiredPerDay,
    pace_per_day: Math.round(pacePerDay),
    days_elapsed: daysElapsed,
    days_total: daysTotal,
    content_yesterday: contentYesterday,
    content_totals: contentTotals,
    channels: contentTotals,
    risks,
  };
}

function log(db, userId, action, entity, entityId, payload) {
  db.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    userId || null,
    action,
    entity,
    entityId,
    JSON.stringify(payload || {}),
    nowIso(),
  );
}

module.exports = {
  createSession,
  createUser,
  deleteSession,
  disableUser,
  getSessionUser,
  getUserByLogin,
  listUsers,
  listReferences,
  listLaunches,
  listActiveLaunches,
  listArchivedLaunches,
  addReference,
  openDatabase,
  publicUser,
  summarize,
  updateUser,
  upsertLaunch,
  upsertReport,
  upsertWebinarResult,
};
