// Serves location data (country → state/province → city).
//
// Source of truth, in priority order:
//   1. data/geo.json  — the full worldwide dataset (run `npm run build-geo`)
//   2. GEO_SEED       — the bundled ~20-country seed (works out of the box)
//
// Shape (both): { "Country": { "State/Province": ["City", ...] } }

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GEO_SEED } from "./geoSeed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_PATH = path.join(__dirname, "..", "data", "geo.json");

let GEO = GEO_SEED;
let SOURCE = "seed";
try {
  if (fs.existsSync(GEO_PATH)) {
    GEO = JSON.parse(fs.readFileSync(GEO_PATH, "utf8"));
    SOURCE = "geo.json";
  }
} catch (e) {
  console.warn("Could not read data/geo.json, using bundled seed:", e.message);
}
console.log(`Location data: ${Object.keys(GEO).length} countries (source: ${SOURCE})`);

export const source = () => SOURCE;
export const countries = () => Object.keys(GEO).sort();
export const statesOf = (country) => Object.keys(GEO[country] || {}).sort();
export const citiesOf = (country, state) => {
  const c = GEO[country];
  if (!c) return [];
  if (state) return (c[state] || []).slice().sort();
  return Array.from(new Set([].concat(...Object.values(c)))).sort();
};
