const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require("./auth");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "finance-dashboard.sqlite");

const roles = new Set(["owner", "accountant", "admin", "viewer"]);

function nowIso() {
  return new Date().toISOString();
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function toNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "0").replace(/\s+/g, ""));
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
      role TEXT NOT NULL CHECK(role IN ('owner', 'accountant', 'admin')),
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

    CREATE TABLE IF NOT EXISTS plans (
      month TEXT PRIMARY KEY,
      client_income_plan INTEGER NOT NULL DEFAULT 0,
      deposit_income_plan INTEGER NOT NULL DEFAULT 0,
      expense_plan INTEGER NOT NULL DEFAULT 0,
      net_cash_flow_plan INTEGER NOT NULL DEFAULT 0,
      cash_balance_plan INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_date TEXT NOT NULL UNIQUE,
      bank TEXT NOT NULL,
      client_income INTEGER NOT NULL DEFAULT 0,
      deposit_income INTEGER NOT NULL DEFAULT 0,
      expense INTEGER NOT NULL DEFAULT 0,
      cash_balance INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed',
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reference_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key TEXT NOT NULL,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(group_key, name)
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
  ensureViewerRoleAllowed(db);
}

function ensureViewerRoleAllowed(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!table?.sql || table.sql.includes("'viewer'")) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'accountant', 'admin', 'viewer')),
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO users_new (
      id, login, name, role, password_hash, salt, active, created_at, updated_at
    )
    SELECT id, login, name, role, password_hash, salt, active, created_at, updated_at
    FROM users;

    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;

    PRAGMA foreign_keys = ON;
  `);
}

function seedUser(db, envPrefix, fallback) {
  const login = process.env[`${envPrefix}_LOGIN`] || fallback.login;
  const password = process.env[`${envPrefix}_PASSWORD`] || fallback.password;
  const name = process.env[`${envPrefix}_NAME`] || fallback.name;
  const role = fallback.role;
  const existing = db.prepare("SELECT id FROM users WHERE login = ?").get(login);
  if (existing) return;

  const { salt, hash } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (login, name, role, password_hash, salt, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(login, name, role, hash, salt, nowIso(), nowIso());
}

function seed(db) {
  seedUser(db, "OWNER", {
    login: "owner",
    password: "owner-change-me",
    name: "Андрей",
    role: "owner",
  });
  seedUser(db, "ADMIN", {
    login: "admin",
    password: "admin-change-me",
    name: "Администратор",
    role: "admin",
  });
  seedUser(db, "ACCOUNTANT", {
    login: "accountant",
    password: "accountant-change-me",
    name: "Бухгалтер",
    role: "accountant",
  });

  const month = currentMonth();
  const plan = db.prepare("SELECT month FROM plans WHERE month = ?").get(month);
  if (!plan) {
    db.prepare(`
      INSERT INTO plans (
        month, client_income_plan, deposit_income_plan, expense_plan,
        net_cash_flow_plan, cash_balance_plan, updated_at
      )
      VALUES (?, 8500000, 0, 6500000, 2300000, 0, ?)
    `).run(month, nowIso());
  }

  const entry = db.prepare("SELECT id FROM daily_entries WHERE report_date = ?").get("2026-06-09");
  if (!entry) {
    db.prepare(`
      INSERT INTO daily_entries (
        report_date, bank, client_income, deposit_income, expense,
        cash_balance, comment, status, created_at, updated_at
      )
      VALUES ('2026-06-09', 'ТБанк', 2744093, 103332, 4120599, 28602750, 'Стартовые данные из примера', 'confirmed', ?, ?)
    `).run(nowIso(), nowIso());
  }

  const bank = db.prepare("SELECT id FROM reference_items WHERE group_key = 'banks' AND name = 'ТБанк'").get();
  if (!bank) {
    db.prepare("INSERT INTO reference_items (group_key, name, active, created_at) VALUES ('banks', 'ТБанк', 1, ?)").run(nowIso());
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
  };
}

function getUserByLogin(db, login) {
  return db.prepare("SELECT * FROM users WHERE login = ? AND active = 1").get(login);
}

function getUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(id);
}

function listUsers(db) {
  return db.prepare("SELECT id, login, name, role, active, created_at, updated_at FROM users ORDER BY role, name").all();
}

function createUser(db, actorId, input) {
  if (!roles.has(input.role)) throw Object.assign(new Error("Недопустимая роль"), { statusCode: 400 });
  if (!input.login || !input.password || !input.name) {
    throw Object.assign(new Error("Заполните логин, имя и пароль"), { statusCode: 400 });
  }
  const login = input.login.trim();
  const duplicate = db.prepare("SELECT id FROM users WHERE login = ?").get(login);
  if (duplicate) throw Object.assign(new Error("Такой логин уже занят"), { statusCode: 400 });
  const { salt, hash } = hashPassword(input.password);
  const result = db.prepare(`
    INSERT INTO users (login, name, role, password_hash, salt, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(login, input.name.trim(), input.role, hash, salt, nowIso(), nowIso());
  log(db, actorId, "create", "user", String(result.lastInsertRowid), { login, role: input.role });
  return result.lastInsertRowid;
}

function updateUser(db, actorId, id, input) {
  if (!roles.has(input.role)) throw Object.assign(new Error("Недопустимая роль"), { statusCode: 400 });
  if (!input.login || !input.name) {
    throw Object.assign(new Error("Заполните логин и имя"), { statusCode: 400 });
  }
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!existing) throw Object.assign(new Error("Пользователь не найден"), { statusCode: 404 });

  const login = input.login.trim();
  const name = input.name.trim();
  const active = input.active === false || input.active === "false" ? 0 : 1;
  const duplicate = db.prepare("SELECT id FROM users WHERE login = ? AND id != ?").get(login, id);
  if (duplicate) throw Object.assign(new Error("Такой логин уже занят"), { statusCode: 400 });

  if (input.password) {
    const { salt, hash } = hashPassword(input.password);
    db.prepare(`
      UPDATE users
      SET login = ?, name = ?, role = ?, password_hash = ?, salt = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(login, name, input.role, hash, salt, active, nowIso(), id);
    if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  } else {
    db.prepare(`
      UPDATE users
      SET login = ?, name = ?, role = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(login, name, input.role, active, nowIso(), id);
    if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  }

  log(db, actorId, "update", "user", String(id), { login, role: input.role, active: Boolean(active), password_changed: Boolean(input.password) });
}

function disableUser(db, actorId, id) {
  db.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").run(nowIso(), id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  log(db, actorId, "disable", "user", String(id), {});
}

function createSession(db, tokenHash, userId, expiresAt) {
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    tokenHash,
    userId,
    expiresAt,
    nowIso(),
  );
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

function getPlan(db, month) {
  return db.prepare("SELECT * FROM plans WHERE month = ?").get(month);
}

function upsertPlan(db, actorId, input) {
  db.prepare(`
    INSERT INTO plans (
      month, client_income_plan, deposit_income_plan, expense_plan,
      net_cash_flow_plan, cash_balance_plan, updated_by, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET
      client_income_plan = excluded.client_income_plan,
      deposit_income_plan = excluded.deposit_income_plan,
      expense_plan = excluded.expense_plan,
      net_cash_flow_plan = excluded.net_cash_flow_plan,
      cash_balance_plan = excluded.cash_balance_plan,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    input.month,
    toNumber(input.client_income_plan),
    toNumber(input.deposit_income_plan || 0),
    toNumber(input.expense_plan),
    toNumber(input.net_cash_flow_plan),
    toNumber(input.cash_balance_plan || 0),
    actorId,
    nowIso(),
  );
  log(db, actorId, "upsert", "plan", input.month, input);
}

function upsertEntry(db, actorId, input) {
  db.prepare(`
    INSERT INTO daily_entries (
      report_date, bank, client_income, deposit_income, expense,
      cash_balance, comment, status, updated_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_date) DO UPDATE SET
      bank = excluded.bank,
      client_income = excluded.client_income,
      deposit_income = excluded.deposit_income,
      expense = excluded.expense,
      cash_balance = excluded.cash_balance,
      comment = excluded.comment,
      status = excluded.status,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    input.report_date,
    input.bank || "",
    toNumber(input.client_income),
    toNumber(input.deposit_income || 0),
    toNumber(input.expense),
    toNumber(input.cash_balance),
    input.comment || "",
    input.status || "confirmed",
    actorId,
    nowIso(),
    nowIso(),
  );
  log(db, actorId, "upsert", "daily_entry", input.report_date, input);
}

function listEntries(db, month) {
  return db.prepare(`
    SELECT * FROM daily_entries
    WHERE substr(report_date, 1, 7) = ?
    ORDER BY report_date ASC
  `).all(month);
}

function listReferences(db) {
  return db.prepare("SELECT * FROM reference_items WHERE active = 1 ORDER BY group_key, name").all();
}

function addReference(db, actorId, input) {
  const name = String(input.name || "").trim();
  const group = String(input.group_key || "banks").trim();
  if (!name) throw Object.assign(new Error("Название справочника не заполнено"), { statusCode: 400 });
  const result = db.prepare(`
    INSERT OR IGNORE INTO reference_items (group_key, name, active, created_by, created_at)
    VALUES (?, ?, 1, ?, ?)
  `).run(group, name, actorId, nowIso());
  log(db, actorId, "create", "reference", `${group}:${name}`, input);
  return result.lastInsertRowid;
}

function summarize(db, month) {
  const plan = getPlan(db, month) || {
    month,
    client_income_plan: 0,
    deposit_income_plan: 0,
    expense_plan: 0,
    net_cash_flow_plan: 0,
    cash_balance_plan: 0,
  };
  const entries = listEntries(db, month);
  const totals = entries.reduce(
    (acc, item) => {
      acc.client_income += item.client_income;
      acc.deposit_income += item.deposit_income;
      acc.expense += item.expense;
      acc.cash_balance = item.cash_balance;
      acc.last_date = item.report_date;
      acc.bank = item.bank;
      return acc;
    },
    { client_income: 0, deposit_income: 0, expense: 0, cash_balance: 0, last_date: null, bank: "" },
  );
  const totalIncome = totals.client_income + totals.deposit_income;
  const netCashFlow = totalIncome - totals.expense;
  const planIncome = plan.client_income_plan;
  const date = totals.last_date ? new Date(`${totals.last_date}T00:00:00`) : new Date(`${month}-01T00:00:00`);
  const dayOfMonth = Math.max(1, date.getDate());
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const incomeForecast = Math.round((totalIncome / dayOfMonth) * daysInMonth);
  const forecastDelta = incomeForecast - planIncome;
  const progress = planIncome > 0 ? Math.min(totalIncome / planIncome, 1.4) : 0;
  const netCashFlowForecast = Math.round((netCashFlow / dayOfMonth) * daysInMonth);
  const netCashFlowPlan = plan.net_cash_flow_plan;
  const netCashFlowDelta = netCashFlowForecast - netCashFlowPlan;
  const netCashFlowProgress =
    netCashFlowPlan > 0
      ? Math.min(Math.max(netCashFlow / netCashFlowPlan, 0), 1.4)
      : netCashFlow >= netCashFlowPlan
        ? 1
        : 0;

  return {
    month,
    plan,
    totals,
    total_income: totalIncome,
    net_cash_flow: netCashFlow,
    plan_income: planIncome,
    income_forecast: incomeForecast,
    forecast_delta: forecastDelta,
    forecast_status: forecastDelta >= 0 ? "good" : "risk",
    progress,
    net_cash_flow_forecast: netCashFlowForecast,
    net_cash_flow_delta: netCashFlowDelta,
    net_cash_flow_status: netCashFlowForecast >= netCashFlowPlan ? "good" : "risk",
    net_cash_flow_progress: netCashFlowProgress,
    days_elapsed: dayOfMonth,
    days_in_month: daysInMonth,
    entries,
  };
}

function log(db, userId, action, entity, entityId, payload) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId || null, action, entity, entityId, JSON.stringify(payload || {}), nowIso());
}

module.exports = {
  createSession,
  createUser,
  deleteSession,
  disableUser,
  getSessionUser,
  getUserByLogin,
  listReferences,
  listUsers,
  addReference,
  openDatabase,
  publicUser,
  summarize,
  updateUser,
  upsertEntry,
  upsertPlan,
};
