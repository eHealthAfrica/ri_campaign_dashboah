// Serves the built app and the data files, and decides who may read restricted data.
// Node built-ins only, so there is nothing extra to patch or deploy.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 10;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Compared when the username is unknown, so response time does not reveal which names exist.
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function makeSession(username, secret, now) {
  const body = Buffer.from(
    JSON.stringify({ u: username, exp: now + SESSION_HOURS * 3_600_000 }),
  ).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function readSession(req, secret, now) {
  const match = /(?:^|;\s*)ri_session=([^;]+)/.exec(req.headers.cookie ?? "");
  if (!match) return null;
  const [body, signature] = match[1].split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString());
    return session.exp > now ? session.u : null;
  } catch {
    return null;
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 4096) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("too large");
  }
  return JSON.parse(raw);
}

/** Returns the absolute path only if it stays inside root and is a file. */
function safeFile(root, urlPath) {
  const base = resolve(root);
  const target = resolve(join(base, urlPath));
  if (target !== base && !target.startsWith(base + sep)) return null;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

function sendFile(req, res, file, cacheControl) {
  const headers = {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": cacheControl,
    Vary: "Accept-Encoding",
  };
  const gz = `${file}.gz`;
  const useGzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "") && existsSync(gz);
  if (useGzip) headers["Content-Encoding"] = "gzip";
  res.writeHead(200, headers);
  createReadStream(useGzip ? gz : file).pipe(res);
}

export function createApp({ dataDir, distDir, usersFile, secret, secureCookies = false, now = Date.now }) {
  const failures = new Map();

  const loadUsers = () => (existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, "utf8")) : {});

  const cookie = (value, maxAge) =>
    `ri_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`;

  async function login(req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { error: "Bad request" });
    }
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const key = `${req.socket.remoteAddress}|${username}`;
    const record = failures.get(key);
    if (record && record.count >= MAX_FAILURES && record.until > now()) {
      return sendJson(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    }
    const stored = loadUsers()[username];
    const ok = passwordMatches(password, stored ?? DUMMY_HASH) && Boolean(stored);
    if (!ok) {
      const count = record && record.until > now() ? record.count + 1 : 1;
      failures.set(key, { count, until: now() + LOCK_MINUTES * 60_000 });
      return sendJson(res, 401, { error: "Incorrect username or password." });
    }
    failures.delete(key);
    sendJson(res, 200, { username }, {
      "Set-Cookie": cookie(makeSession(username, secret, now()), SESSION_HOURS * 3600),
    });
  }

  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");

    let path;
    try {
      path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      return sendJson(res, 400, { error: "Bad request" });
    }
    const user = readSession(req, secret, now());

    if (path === "/api/login" && req.method === "POST") return login(req, res);
    if (path === "/api/logout" && req.method === "POST") {
      return sendJson(res, 200, {}, { "Set-Cookie": cookie("", 0) });
    }
    if (path === "/api/me") return sendJson(res, 200, { username: user });
    if (path.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });

    if (path.startsWith("/data/")) {
      const [, zone, ...rest] = path.split("/").slice(1);
      if (zone !== "public" && zone !== "restricted") return sendJson(res, 404, { error: "Not found" });
      const isRestricted = zone === "restricted";
      if (isRestricted && !user) return sendJson(res, 401, { error: "Sign in required" });
      // Each zone is its own root, so "public/../restricted" cannot cross between them.
      const file = safeFile(join(dataDir, zone), rest.join("/"));
      if (!file) return sendJson(res, 404, { error: "Not found" });
      // Browsers and proxies must not keep restricted data for other users.
      return sendFile(req, res, file, isRestricted ? "private, no-store" : "public, no-cache");
    }

    const asset = path !== "/" && safeFile(distDir, path);
    if (asset) {
      const hashed = path.startsWith("/assets/");
      return sendFile(req, res, asset, hashed ? "public, max-age=31536000, immutable" : "public, max-age=300");
    }
    const index = safeFile(distDir, "index.html");
    if (!index) return sendJson(res, 503, { error: "App not built. Run npm run build." });
    sendFile(req, res, index, "no-cache");
  });
}
