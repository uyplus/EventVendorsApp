// Builds data/geo.json — the full worldwide country → state → city dataset —
// from the open-source "countries-states-cities" database (dr5hn, ODbL).
//
// Usage:  node scripts/build-geo.mjs            (needs internet, Node 18+)
//
// Alternative sources you can adapt this to:
//   • GeoNames (https://download.geonames.org/export/dump/) — admin1/admin2 + cities
//   • Any provider that gives country/state/city; just emit the nested shape below.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "geo.json");
const SRC = "https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/countries%2Bstates%2Bcities.json";

console.log("Downloading countries-states-cities dataset… (~30 MB)");
const res = await fetch(SRC);
if (!res.ok) { console.error("Download failed:", res.status, res.statusText); process.exit(1); }
const data = await res.json();

const geo = {};
for (const c of data) {
  const country = {};
  for (const st of c.states || []) {
    country[st.name] = (st.cities || []).map((ci) => ci.name);
  }
  geo[c.name] = country;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(geo));
const totalCities = Object.values(geo).reduce((n, st) => n + Object.values(st).reduce((m, cs) => m + cs.length, 0), 0);
console.log(`Wrote ${OUT}: ${Object.keys(geo).length} countries, ${totalCities.toLocaleString()} cities.`);
console.log("Restart the server to serve the full dataset.");
