const crypto = require("node:crypto");

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token, secret) {
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"));
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function sessionCookie(token, secure = false) {
  const parts = [
    `funnel_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie() {
  return "funnel_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

module.exports = {
  SESSION_TTL_MS,
  clearSessionCookie,
  hashPassword,
  hashToken,
  parseCookies,
  randomToken,
  sessionCookie,
  verifyPassword,
};
