// Usage: npm run add-user -- <username>   Prompts for a password and stores only its hash.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/app.mjs";

const usersFile =
  process.env.RI_USERS_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "server", "users.json");
const username = (process.argv[2] ?? "").trim().toLowerCase();
if (!username) {
  console.error("Usage: npm run add-user -- <username>");
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.startsWith(prompt)) process.stdout.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      done(answer);
    });
  });
}

const password = await askHidden(`Password for ${username}: `);
if (password.length < 10) {
  console.error("Use at least 10 characters.");
  process.exit(1);
}
const users = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, "utf8")) : {};
users[username] = hashPassword(password);
writeFileSync(usersFile, JSON.stringify(users, null, 2), { mode: 0o600 });
console.log(`Saved ${username}.`);
