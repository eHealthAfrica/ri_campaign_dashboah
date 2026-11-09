// Precompress the build so the server can send .gz files without compressing per request.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dir = join(import.meta.dirname, "..", "dist", "assets");
for (const name of readdirSync(dir)) {
  if (/\.(js|mjs|css)$/.test(name)) writeFileSync(join(dir, `${name}.gz`), gzipSync(readFileSync(join(dir, name)), { level: 9 }));
}
