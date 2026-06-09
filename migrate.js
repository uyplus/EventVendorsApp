// Applies src/schema.sql to the database in DATABASE_URL.
// Usage: npm run migrate   (requires DATABASE_URL to be set)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { usingPg, initDb, query, closePool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!usingPg) {
    console.error("DATABASE_URL is not set. Set it before running migrations (see .env.example).");
    process.exit(1);
  }
  await initDb();
  for (const f of ["schema.sql", "schema_v2.sql"]) {
    const fp = path.join(__dirname, f);
    if (fs.existsSync(fp)) { await query(fs.readFileSync(fp, "utf8")); console.log(`✓ Applied ${f}`); }
  }
  console.log("✓ All schema applied successfully.");
  await closePool();
  process.exit(0);
}

main().catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
