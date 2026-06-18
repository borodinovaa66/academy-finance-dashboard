const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3040);
const PUBLIC_DIR = path.join(__dirname, "public");
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1Sq4hb_OrWKvA5MBXA8aeqjzN9-LUsd422lQ7mD4ONvA";
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "CEO Dashboard";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 120000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

let cachedDashboard = null;
let cachedAt = 0;

function send(res, statusCode, body, headers = {}) {
  const isText = typeof body === "string";
  const payload = isText ? body : JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function serviceAccountConfig() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_FILE;
  const rawJson = jsonPath ? fs.readFileSync(jsonPath, "utf8") : process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  }
  return {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  };
}

async function getAccessToken() {
  const { clientEmail, privateKey } = serviceAccountConfig();
  if (!clientEmail || !privateKey) {
    throw Object.assign(new Error("Не настроен Google Service Account"), { statusCode: 500, code: "GOOGLE_AUTH_MISSING" });
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error_description || data.error || "Google auth error"), { statusCode: 502 });
  return data.access_token;
}

async function readRange(range) {
  const token = await getAccessToken();
  const encodedRange = encodeURIComponent(`'${SHEET_NAME}'!${range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data.error?.message || "Не удалось прочитать Google Sheet"), { statusCode: response.status });
  }
  return data.values || [];
}

function cell(row, index) {
  return row?.[index] ?? "";
}

function parseDashboard(rows) {
  const meta = {
    period: cell(rows[1], 1),
    productPeriod: cell(rows[1], 3),
    updatedAt: cell(rows[1], 5),
    overallStatus: cell(rows[1], 7) || "нет данных",
    source: `Google Sheets: РнП`,
  };
  const kpis = rows.slice(7, 27).filter((row) => cell(row, 0)).map((row) => ({
    name: cell(row, 0),
    type: cell(row, 2),
    plan: cell(row, 3),
    fact: cell(row, 4),
    progress: cell(row, 5),
    status: cell(row, 6) || "нет данных",
    comment: cell(row, 7),
    owner: cell(row, 8),
  }));
  const product = rows.slice(30, 35).filter((row) => cell(row, 0)).map((row) => ({
    name: cell(row, 0),
    type: cell(row, 2),
    plan: cell(row, 3),
    fact: cell(row, 4),
    progress: cell(row, 5),
    status: cell(row, 6) || "нет данных",
    comment: cell(row, 7),
    owner: cell(row, 8),
  }));
  const actions = rows.slice(38, 43).filter((row) => cell(row, 0)).map((row) => ({
    priority: cell(row, 0),
    problem: cell(row, 1),
    signal: cell(row, 2),
    reason: cell(row, 3),
    action: cell(row, 4),
    owner: cell(row, 5),
    due: cell(row, 6),
    ceoDecision: cell(row, 7),
    status: cell(row, 8) || "не заполнено",
  }));
  return { meta, kpis, product, actions };
}

async function getDashboard(force = false) {
  if (!force && cachedDashboard && Date.now() - cachedAt < CACHE_TTL_MS) return cachedDashboard;
  const rows = await readRange("A1:I45");
  cachedDashboard = parseDashboard(rows);
  cachedAt = Date.now();
  return cachedDashboard;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const force = url.searchParams.get("refresh") === "1";
    const dashboard = await getDashboard(force);
    return send(res, 200, dashboard);
  }
  return send(res, 404, { error: "Маршрут не найден" });
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
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(indexContent);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(fullPath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    send(res, statusCode, {
      error: statusCode === 500 ? "Внутренняя ошибка сервера" : error.message,
      code: error.code || "ERROR",
      setup:
        error.code === "GOOGLE_AUTH_MISSING"
          ? "Нужно задать GOOGLE_SERVICE_ACCOUNT_JSON_FILE, GOOGLE_SERVICE_ACCOUNT_JSON или GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY и расшарить Google Sheet на client_email."
          : undefined,
    });
    if (statusCode >= 500) console.error(error);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`RnP dashboard listening on http://127.0.0.1:${PORT}`);
});
