import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp, hashPassword } from "./app.mjs";

let base, server;
let clock = 1_000_000;

before(async () => {
  const root = mkdtempSync(join(tmpdir(), "ri-test-"));
  mkdirSync(join(root, "data/public"), { recursive: true });
  mkdirSync(join(root, "data/restricted"), { recursive: true });
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "data/public/summary.json"), "{}");
  writeFileSync(join(root, "data/restricted/settlements.json"), "[1]");
  writeFileSync(join(root, "secret.txt"), "top secret");
  writeFileSync(join(root, "dist/index.html"), "<html>app</html>");
  writeFileSync(join(root, "users.json"), JSON.stringify({ tester: hashPassword("correct-horse") }));
  server = createApp({
    dataDir: join(root, "data"),
    distDir: join(root, "dist"),
    usersFile: join(root, "users.json"),
    secret: "test-secret",
    now: () => clock,
  });
  await new Promise((done) => server.listen(0, done));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const login = (username, password) =>
  fetch(`${base}/api/login`, { method: "POST", body: JSON.stringify({ username, password }) });

test("public data is open and restricted data is not", async () => {
  assert.equal((await fetch(`${base}/data/public/summary.json`)).status, 200);
  assert.equal((await fetch(`${base}/data/restricted/settlements.json`)).status, 401);
});

test("public data is revalidated, so a new app never runs on old data", async () => {
  const res = await fetch(`${base}/data/public/summary.json`);
  assert.match(res.headers.get("cache-control"), /no-cache/);
});

test("signing in unlocks restricted data until the session expires", async () => {
  const res = await login("tester", "correct-horse");
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(";")[0];
  const data = await fetch(`${base}/data/restricted/settlements.json`, { headers: { cookie } });
  assert.equal(data.status, 200);
  assert.equal(data.headers.get("cache-control"), "private, no-store");

  clock += 13 * 3_600_000;
  assert.equal((await fetch(`${base}/data/restricted/settlements.json`, { headers: { cookie } })).status, 401);
});

test("a tampered session cookie is rejected", async () => {
  const forged = Buffer.from(JSON.stringify({ u: "admin", exp: clock + 1e9 })).toString("base64url");
  const headers = { cookie: `ri_session=${forged}.bad-signature` };
  assert.equal((await fetch(`${base}/data/restricted/settlements.json`, { headers })).status, 401);
  assert.equal((await (await fetch(`${base}/api/me`, { headers })).json()).username, null);
});

test("paths cannot escape the data directory", async () => {
  // Encoded slashes survive URL normalisation, so these reach the server as written.
  for (const path of ["/data/public/..%2f..%2fsecret.txt", "/..%2fsecret.txt", "/data/..%2fsecret.txt"]) {
    const res = await fetch(base + path);
    assert.doesNotMatch(await res.text(), /top secret/, path);
  }
  // A signed-out visitor cannot reach restricted files through the public prefix.
  for (const path of ["/data/public/..%2frestricted%2fsettlements.json", "/data/public/%2e%2e%2frestricted/settlements.json"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test("unknown users and wrong passwords get the same answer, then a lockout", async () => {
  assert.equal((await login("nobody", "whatever")).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await login("tester", "wrong")).status, 401);
  assert.equal((await login("tester", "wrong")).status, 429);
  assert.equal((await login("tester", "correct-horse")).status, 429);
  clock += 11 * 60_000;
  assert.equal((await login("tester", "correct-horse")).status, 200);
});

test("unknown pages fall back to the app", async () => {
  const res = await fetch(`${base}/quality`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /app/);
});
