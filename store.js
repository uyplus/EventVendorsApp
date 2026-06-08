// Tiny JSON-file persistence. Zero native dependencies so `npm install`
// always works. Swap this module for a real database (Postgres/Prisma,
// SQLite, MongoDB) in production — the rest of the API only touches getDb()/save().

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "db.json");

let db = { users: [], vendors: [], quotes: [], reports: [], seq: { user: 0, vendor: 0, quote: 0, report: 0 } };

export function load() {
  if (fs.existsSync(DB_PATH)) {
    try { db = JSON.parse(fs.readFileSync(DB_PATH, "utf8")); } catch (e) { /* keep defaults */ }
  }
  if (!db.seq) db.seq = { user: 0, vendor: 0, quote: 0, report: 0 };
  if (!db.reports) db.reports = [];
  return db;
}
export function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
export function getDb() { return db; }
export function nextId(kind) { db.seq[kind] = (db.seq[kind] || 0) + 1; return db.seq[kind]; }
