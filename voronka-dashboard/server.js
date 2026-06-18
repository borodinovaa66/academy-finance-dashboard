const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  SESSION_TTL_MS,
  clearSessionCookie,
  hashToken,
  parseCookies,
  randomToken,
  sessionCookie,
  verifyPassword,
} = require("./src/auth");
const {
  createSession,
  createUser,
  addReference,
  deleteSession,
  disableUser,
  getSessionUser,
  getUserByLogin,
  listActiveLaunches,
  listArchivedLaunches,
  listLaunches,
  listReferences,
  listUsers,
  openDatabase,
  publicUser,
  summarize,
  updateUser,
  upsertLaunch,
  upsertReport,
  upsertWebinarResult,
} = require("./src/database");

const PORT = Number(process.env.PORT || 3030);
const SESSION_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";
const PUBLIC_DIR = path.join(__dirname, "public");
const db = openDatabase();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, statusCode, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(Object.assign(new Error("Слишком большой запрос"), { statusCode: 413 }));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Некорректный JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function getCurrentUser(req) {
  const token = parseCookies(req.headers.cookie || "").funnel_session;
  if (!token) return null;
  return getSessionUser(db, hashToken(token, SESSION_SECRET));
}

function requireAuth(req) {
  const user = getCurrentUser(req);
  if (!user) throw Object.assign(new Error("Требуется вход"), { statusCode: 401 });
  return user;
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw Object.assign(new Error("Недостаточно прав"), { statusCode: 403 });
}

function secureCookie(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const user = getUserByLogin(db, String(body.login || "").trim());
    if (!user || !verifyPassword(String(body.password || ""), user.salt, user.password_hash)) {
      return send(res, 401, { error: "Неверный логин или пароль" });
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    createSession(db, hashToken(token, SESSION_SECRET), user.id, expiresAt);
    return send(res, 200, { user: publicUser(user) }, { "Set-Cookie": sessionCookie(token, secureCookie(req)) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie || "").funnel_session;
    if (token) deleteSession(db, hashToken(token, SESSION_SECRET));
    return send(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    return send(res, 200, { user: publicUser(getCurrentUser(req)) });
  }

  const user = requireAuth(req);

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const launchId = Number(url.searchParams.get("launch_id") || 0);
    const payload = {
      user: publicUser(user),
      summary: summarize(db, launchId),
      launches: listLaunches(db),
      active_launches: listActiveLaunches(db),
      archived_launches: listArchivedLaunches(db),
      references: listReferences(db),
    };
    if (user.role === "admin") payload.users = listUsers(db);
    return send(res, 200, payload);
  }

  if (req.method === "POST" && url.pathname === "/api/references") {
    requireRole(user, ["project", "admin"]);
    const result = addReference(db, user.id, await parseBody(req));
    return send(res, result.created ? 201 : 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/launch") {
    requireRole(user, ["project", "admin"]);
    const id = upsertLaunch(db, user.id, await parseBody(req));
    return send(res, 200, { id });
  }

  if (req.method === "POST" && url.pathname === "/api/reports") {
    requireRole(user, ["project", "admin"]);
    upsertReport(db, user.id, await parseBody(req));
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/webinar-result") {
    requireRole(user, ["project", "admin"]);
    upsertWebinarResult(db, user.id, await parseBody(req));
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    requireRole(user, ["admin"]);
    return send(res, 200, { users: listUsers(db) });
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    requireRole(user, ["admin"]);
    const id = createUser(db, user.id, await parseBody(req));
    return send(res, 201, { id });
  }

  const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (req.method === "PUT" && userMatch) {
    requireRole(user, ["admin"]);
    const targetId = Number(userMatch[1]);
    const body = await parseBody(req);
    if (targetId === user.id && (body.active === false || body.active === "false" || body.role !== "admin")) {
      throw Object.assign(new Error("Нельзя удалить себя или снять с себя роль админа"), { statusCode: 400 });
    }
    updateUser(db, user.id, targetId, body);
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && userMatch) {
    requireRole(user, ["admin"]);
    const targetId = Number(userMatch[1]);
    if (targetId === user.id) throw Object.assign(new Error("Нельзя удалить самого себя"), { statusCode: 400 });
    disableUser(db, user.id, targetId);
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: "Маршрут не найден" });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexErr, indexContent) => {
        if (indexErr) return send(res, 404, "Not found");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexContent);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(fullPath)] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    const statusCode = error.statusCode || 500;
    send(res, statusCode, { error: statusCode === 500 ? "Внутренняя ошибка сервера" : error.message });
    if (statusCode === 500) console.error(error);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Funnel dashboard listening on http://127.0.0.1:${PORT}`);
});
