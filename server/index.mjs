import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function loadSecret() {
  if (process.env.RI_SESSION_SECRET) return process.env.RI_SESSION_SECRET;
  const file = join(here, ".session-secret");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8");
}

const usersFile = process.env.RI_USERS_FILE ?? join(here, "users.json");
const port = Number(process.env.PORT ?? 8787);

createApp({
  dataDir: process.env.RI_DATA_DIR ?? join(here, "..", "data"),
  distDir: join(here, "..", "dist"),
  usersFile,
  secret: loadSecret(),
  secureCookies: process.env.NODE_ENV === "production",
}).listen(port, () => {
  console.log(`RI dashboard on http://localhost:${port}`);
  if (!existsSync(usersFile)) console.log("No users yet. Create one with: npm run add-user -- <username>");
});
