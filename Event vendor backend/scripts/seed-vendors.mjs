#!/usr/bin/env node
// scripts/seed-vendors.mjs
//
// Scrapes Google Places and Yelp Fusion for event-service vendors, then
// inserts them into EventVendors as pre-populated, unclaimed listings.
//
// PREREQUISITES
//   1. Run schema_v14.sql in Supabase SQL Editor first
//   2. Set env vars (copy from your Render dashboard or .env):
//
//      SUPABASE_URL=https://<ref>.supabase.co
//      SUPABASE_SERVICE_KEY=<service_role key>          ← NOT the anon key
//      GOOGLE_PLACES_API_KEY=<key from Google Cloud Console>
//      YELP_API_KEY=<key from https://www.yelp.com/developers>
//
// USAGE
//   node scripts/seed-vendors.mjs                         # all cities, all categories
//   node scripts/seed-vendors.mjs --city "New York"       # one city
//   node scripts/seed-vendors.mjs --category food         # one category
//   node scripts/seed-vendors.mjs --source yelp           # only Yelp
//   node scripts/seed-vendors.mjs --dry-run               # log rows, don't insert
//
// RATE LIMITS
//   Google Places: 50 QPS; we target ~1 req/s to stay well under.
//   Yelp Fusion:   500 calls/day free. --source yelp uses ~2 × cities × categories calls.
//   If you need more than the free tiers allow, run the script on different days.

import { createClient }  from "@supabase/supabase-js";
import { randomUUID }    from "crypto";
import { setTimeout as sleep } from "timers/promises";

// ─── CLI args ────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const flag  = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? (args[i + 1] || true) : null;
};
const CITY_FILTER     = flag("city");
const CAT_FILTER      = flag("category");
const SOURCE_FILTER   = flag("source");      // 'google' | 'yelp' | null (both)
const DRY_RUN         = args.includes("--dry-run");
const RADIUS_METERS   = 30_000;             // 30 km search radius per city
const MAX_PER_SEARCH  = 20;                 // results to request per query
const DELAY_MS        = 1_100;             // ms between API calls

// ─── Supabase ────────────────────────────────────────────────────────────────
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_PLACES_API_KEY, YELP_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("✗ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ─── Target cities ────────────────────────────────────────────────────────────
const CITIES = [
  // United States
  { name: "New York",      region: "New York",        country: "US", lat: 40.7128, lng: -74.0060 },
  { name: "Los Angeles",   region: "California",      country: "US", lat: 34.0522, lng: -118.2437 },
  { name: "Chicago",       region: "Illinois",        country: "US", lat: 41.8781, lng:  -87.6298 },
  { name: "Houston",       region: "Texas",           country: "US", lat: 29.7604, lng:  -95.3698 },
  { name: "Miami",         region: "Florida",         country: "US", lat: 25.7617, lng:  -80.1918 },
  { name: "Atlanta",       region: "Georgia",         country: "US", lat: 33.7490, lng:  -84.3880 },
  { name: "Dallas",        region: "Texas",           country: "US", lat: 32.7767, lng:  -96.7970 },
  { name: "Phoenix",       region: "Arizona",         country: "US", lat: 33.4484, lng: -112.0740 },
  { name: "Las Vegas",     region: "Nevada",          country: "US", lat: 36.1699, lng: -115.1398 },
  { name: "Washington DC", region: "DC",              country: "US", lat: 38.9072, lng:  -77.0369 },
  // Canada
  { name: "Toronto",       region: "Ontario",         country: "CA", lat: 43.6532, lng:  -79.3832 },
  { name: "Vancouver",     region: "British Columbia",country: "CA", lat: 49.2827, lng: -123.1207 },
  { name: "Montreal",      region: "Quebec",          country: "CA", lat: 45.5017, lng:  -73.5673 },
  { name: "Calgary",       region: "Alberta",         country: "CA", lat: 51.0447, lng: -114.0719 },
  { name: "Ottawa",        region: "Ontario",         country: "CA", lat: 45.4215, lng:  -75.6972 },
  // Nigeria
  { name: "Lagos",         region: "Lagos",           country: "NG", lat:  6.5244, lng:    3.3792 },
  { name: "Abuja",         region: "FCT",             country: "NG", lat:  9.0765, lng:    7.3986 },
  { name: "Port Harcourt", region: "Rivers",          country: "NG", lat:  4.8156, lng:    7.0498 },
].filter(c => !CITY_FILTER || c.name.toLowerCase() === CITY_FILTER.toLowerCase());

// ─── Category definitions ─────────────────────────────────────────────────────
// Maps EventVendors internal category keys to:
//   • hue:       color for the gradient card placeholder
//   • google:    text search queries for Google Places Text Search API
//   • yelp:      Yelp search term + categories
const CATEGORIES = {
  beauty: {
    hue: 320,
    google: ["wedding hair makeup artist", "bridal beauty salon", "wedding makeup artist"],
    yelp: { term: "wedding hair makeup", categories: "hair,makeup,nailsalons" },
  },
  decor: {
    hue: 150,
    google: ["wedding florist", "event venue wedding", "wedding decorator"],
    yelp: { term: "wedding florist event decor", categories: "florists,eventdecor,venues" },
  },
  entertainment: {
    hue: 200,
    google: ["wedding DJ entertainment", "wedding band performers", "live music events"],
    yelp: { term: "wedding DJ band", categories: "djs,musicians,evententertainment" },
  },
  eventmgmt: {
    hue: 240,
    google: ["wedding planner", "event coordinator", "event management company"],
    yelp: { term: "wedding planner coordinator", categories: "eventplanning,weddingevents" },
  },
  food: {
    hue: 30,
    google: ["wedding catering service", "event catering company", "wedding cake bakery"],
    yelp: { term: "wedding catering", categories: "caterers,fooddeliveryservices,bakeries" },
  },
  logistics: {
    hue: 180,
    google: ["event rental company", "party equipment rental", "wedding transport"],
    yelp: { term: "event equipment rental", categories: "partyequipmentrentals,truckreintal" },
  },
  media: {
    hue: 280,
    google: ["wedding photographer", "wedding videographer", "event photographer"],
    yelp: { term: "wedding photographer videographer", categories: "photographers,videographers" },
  },
};

const activeCats = Object.entries(CATEGORIES).filter(([k]) => !CAT_FILTER || k === CAT_FILTER);

// ─── Stats ───────────────────────────────────────────────────────────────────
let stats = { tried: 0, inserted: 0, skipped: 0, errors: 0 };

// ─── Google Places helper ─────────────────────────────────────────────────────
async function googlePlacesSearch(query, lat, lng) {
  if (!GOOGLE_PLACES_API_KEY) return [];
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query",    query);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius",   String(RADIUS_METERS));
  url.searchParams.set("key",      GOOGLE_PLACES_API_KEY);
  const res  = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
    console.warn("  [Google] status:", data.status, data.error_message || "");
  return (data.results || []).slice(0, MAX_PER_SEARCH);
}

function parseGoogleResult(place, city, catKey, hue) {
  const addr = place.formatted_address || "";
  return {
    name:       place.name,
    cat:        catKey,
    city:       city.name,
    region:     city.region,
    country:    city.country,
    about:      place.types ? `${place.types.slice(0,3).join(", ")} in ${city.name}` : "",
    phone:      "",                              // needs Place Details call — saved for later
    website:    "",
    photos:     [],                              // Google photo refs need another API call
    hue,
    rating:     place.rating ?? 0,
    reviews:    place.user_ratings_total ?? 0,
    source:     "google",
    sourceId:   `google:${place.place_id}`,
    sourceUrl:  `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
    claimToken: randomUUID(),
    claimTokenExpires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
  };
}

// ─── Yelp Fusion helper ───────────────────────────────────────────────────────
async function yelpSearch(term, categories, lat, lng) {
  if (!YELP_API_KEY) return [];
  const url = new URL("https://api.yelp.com/v3/businesses/search");
  url.searchParams.set("term",       term);
  url.searchParams.set("latitude",   String(lat));
  url.searchParams.set("longitude",  String(lng));
  url.searchParams.set("radius",     String(Math.min(RADIUS_METERS, 40000)));
  url.searchParams.set("categories", categories);
  url.searchParams.set("limit",      String(MAX_PER_SEARCH));
  url.searchParams.set("sort_by",    "rating");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${YELP_API_KEY}` } });
  if (!res.ok) {
    console.warn("  [Yelp] HTTP", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = await res.json();
  return data.businesses || [];
}

function parseYelpResult(biz, city, catKey, hue) {
  const loc = biz.location || {};
  return {
    name:       biz.name,
    cat:        catKey,
    city:       city.name,
    region:     city.region,
    country:    city.country,
    about:      biz.categories ? biz.categories.map(c => c.title).join(", ") : "",
    phone:      biz.display_phone || "",
    website:    biz.url || "",
    photos:     biz.image_url ? [{ src: biz.image_url, type: "image" }] : [],
    hue,
    rating:     biz.rating ?? 0,
    reviews:    biz.review_count ?? 0,
    source:     "yelp",
    sourceId:   `yelp:${biz.id}`,
    sourceUrl:  biz.url || "",
    claimToken: randomUUID(),
    claimTokenExpires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ─── Database insert ──────────────────────────────────────────────────────────
async function insertVendor(vendor) {
  stats.tried++;
  if (DRY_RUN) {
    console.log(`  [dry-run] Would insert: ${vendor.name} (${vendor.source} ${vendor.cat})`);
    stats.inserted++;
    return;
  }
  try {
    const { error } = await db.from("vendors").upsert(
      {
        name:                 vendor.name,
        cat:                  vendor.cat,
        city:                 vendor.city,
        region:               vendor.region,
        country:              vendor.country,
        about:                vendor.about,
        business_phone:       vendor.phone,
        website:              vendor.website,
        photos:               vendor.photos,
        hue:                  vendor.hue,
        rating:               vendor.rating,
        reviews:              vendor.reviews,
        plan:                 "free",
        languages:            ["English"],
        offering:             "",
        services:             {},
        pre_populated:        true,
        claimed:              false,
        source:               vendor.source,
        source_id:            vendor.sourceId,
        source_url:           vendor.sourceUrl,
        claim_token:          vendor.claimToken,
        claim_token_expires:  vendor.claimTokenExpires,
        max_photos:           10,
        price:                2,
        starting_price:       0,
        full_service:         true,
        years:                0,
        service_areas:        [],
      },
      { onConflict: "source_id", ignoreDuplicates: true }
    );
    if (error) {
      if (error.code === "23505") {
        stats.skipped++; return; // duplicate source_id
      }
      throw error;
    }
    stats.inserted++;
    console.log(`  ✓ ${vendor.name} (${vendor.cat}, ${vendor.source})`);
  } catch (e) {
    stats.errors++;
    console.error(`  ✗ ${vendor.name}: ${e.message}`);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
console.log(`\n=== EventVendors Vendor Seeder ===`);
console.log(`Cities: ${CITIES.length}, Categories: ${activeCats.length}`);
console.log(`Sources: ${SOURCE_FILTER || "google + yelp"}, Dry-run: ${DRY_RUN}\n`);

if (!GOOGLE_PLACES_API_KEY && !SOURCE_FILTER?.includes("yelp"))
  console.warn("⚠  GOOGLE_PLACES_API_KEY not set — skipping Google Places.");
if (!YELP_API_KEY && !SOURCE_FILTER?.includes("google"))
  console.warn("⚠  YELP_API_KEY not set — skipping Yelp.\n");

for (const city of CITIES) {
  console.log(`\n── ${city.name}, ${city.country} ──`);

  for (const [catKey, catDef] of activeCats) {

    // ── Google Places ──
    if (!SOURCE_FILTER || SOURCE_FILTER === "google") {
      for (const query of catDef.google) {
        await sleep(DELAY_MS);
        try {
          const results = await googlePlacesSearch(query, city.lat, city.lng);
          for (const place of results) {
            const vendor = parseGoogleResult(place, city, catKey, catDef.hue);
            await insertVendor(vendor);
          }
          if (results.length)
            console.log(`  [Google] "${query}" → ${results.length} results`);
        } catch (e) {
          console.error(`  [Google] error for "${query}":`, e.message);
        }
      }
    }

    // ── Yelp Fusion ──
    if (!SOURCE_FILTER || SOURCE_FILTER === "yelp") {
      await sleep(DELAY_MS);
      try {
        const results = await yelpSearch(catDef.yelp.term, catDef.yelp.categories, city.lat, city.lng);
        for (const biz of results) {
          const vendor = parseYelpResult(biz, city, catKey, catDef.hue);
          await insertVendor(vendor);
        }
        if (results.length)
          console.log(`  [Yelp] "${catDef.yelp.term}" → ${results.length} results`);
      } catch (e) {
        console.error(`  [Yelp] error for "${catDef.yelp.term}":`, e.message);
      }
    }
  }
}

console.log(`\n=== Done ===`);
console.log(`Tried: ${stats.tried} | Inserted: ${stats.inserted} | Skipped (dup): ${stats.skipped} | Errors: ${stats.errors}`);
if (!DRY_RUN && stats.inserted > 0) {
  console.log(`\n✓ Vendors are now live and visible in search.`);
  console.log(`  Each has a 90-day claim token — send outreach emails using:`);
  console.log(`  SELECT name, claim_token FROM vendors WHERE pre_populated=true AND claimed=false;\n`);
}
