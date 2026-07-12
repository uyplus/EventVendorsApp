// Seed listings for the marketplace. Mirrors the front-end demo data so the
// API returns objects in exactly the shape the UI expects.

let id = 0;
const v = (o) => ({
  id: ++id, rating: 4, reviews: 1300, premium: false, sponsored: false, verified: true,
  licensed: true, equipmentHire: false, fullService: true, years: 6, languages: ["English"],
  about: "We bring polished, reliable service to every event we touch — from intimate gatherings to large-scale celebrations.",
  cuisines: null, services: null, ...o,
});

const ALL_SEED_VENDORS = [
  v({ name: "King Mike's Castles", cat: "decor", offering: "Inflatable rentals", price: 3, startingPrice: 100, city: "Calgary", region: "AB", country: "CA", distance: 4, rating: 4.6, reviews: 11600, premium: true, sponsored: true, equipmentHire: true, fullService: false, years: 9, languages: ["English", "French"], hue: 14 }),
  v({ name: "Chief Uyi's Inflatables", cat: "decor", offering: "Inflatable rentals", price: 2, startingPrice: 80, city: "Toronto", region: "ON", country: "CA", distance: 7, rating: 4.4, sponsored: true, equipmentHire: true, fullService: false, hue: 22 }),
  v({ name: "Offiong's Bouncing Castles", cat: "decor", offering: "Inflatable rentals", price: 2, startingPrice: 75, city: "Brampton", region: "ON", country: "CA", distance: 12, rating: 4.5, reviews: 980, equipmentHire: true, fullService: false, hue: 8 }),
  v({ name: "Bloom & Stem Florals", cat: "decor", offering: "Floral arrangements", price: 3, startingPrice: 250, city: "Vancouver", region: "BC", country: "CA", distance: 9, rating: 4.8, reviews: 540, hue: 350 }),
  v({ name: "Grand Marquee Rentals", cat: "decor", offering: "Tent / marquee rental", price: 4, startingPrice: 600, city: "Houston", region: "TX", country: "US", distance: 15, rating: 4.3, reviews: 410, equipmentHire: true, fullService: false, hue: 30 }),

  v({ name: "King Mike's Photography", cat: "media", offering: "Event photography", price: 3, startingPrice: 350, city: "Calgary", region: "AB", country: "CA", distance: 5, rating: 4.7, reviews: 11600, premium: true, sponsored: true, hue: 222 }),
  v({ name: "Hope's Photography", cat: "media", offering: "Event photography", price: 2, startingPrice: 200, city: "Edmonton", region: "AB", country: "CA", distance: 11, rating: 4.5, sponsored: true, hue: 210 }),
  v({ name: "Royal Films & Video", cat: "media", offering: "Videography", price: 4, startingPrice: 500, city: "New York", region: "NY", country: "US", distance: 6, rating: 4.9, reviews: 870, premium: true, years: 12, hue: 234 }),
  v({ name: "Skyline Drone Co.", cat: "media", offering: "Drone coverage", price: 3, startingPrice: 300, city: "Lagos", region: "Lagos", country: "NG", distance: 8, rating: 4.4, reviews: 220, licensed: false, hue: 245 }),
  v({ name: "Pop & Print Photo Booth", cat: "media", offering: "Photo booth", price: 1, startingPrice: 150, city: "Mississauga", region: "ON", country: "CA", distance: 10, rating: 4.6, equipmentHire: true, fullService: false, hue: 256 }),

  v({ name: "DJ Pulse", cat: "ent", offering: "DJ services", price: 2, startingPrice: 180, city: "Abuja", region: "FCT", country: "NG", distance: 3, rating: 4.7, reviews: 2100, sponsored: true, languages: ["English", "Hausa"], hue: 268 }),
  v({ name: "The Velvet Band", cat: "ent", offering: "Live band", price: 4, startingPrice: 800, city: "Chicago", region: "IL", country: "US", distance: 14, rating: 4.8, reviews: 640, premium: true, years: 15, hue: 280 }),
  v({ name: "Laugh Lab Comedy", cat: "ent", offering: "Stand-up comedy", price: 2, startingPrice: 220, city: "Toronto", region: "ON", country: "CA", distance: 9, rating: 4.3, reviews: 310, hue: 292 }),
  v({ name: "Heritage Dance Troupe", cat: "ent", offering: "Dance troupe", price: 3, startingPrice: 400, city: "Lagos", region: "Lagos", country: "NG", distance: 7, rating: 4.6, reviews: 450, languages: ["English", "Yoruba"], hue: 305 }),

  v({ name: "Spice Route Catering", cat: "food", offering: "Full-service catering", price: 3, startingPrice: 800, city: "Calgary", region: "AB", country: "CA", distance: 6, rating: 4.7, reviews: 1900, premium: true, sponsored: true, languages: ["English", "Hindi"], cuisines: ["Indian", "Pakistani", "Middle Eastern", "Mediterranean"], services: { food: ["Full-service catering", "Small chops / finger foods"] }, hue: 38 }),
  v({ name: "Naija Flavours Catering", cat: "food", offering: "Full-service catering", price: 2, startingPrice: 500, city: "Abuja", region: "FCT", country: "NG", distance: 5, rating: 4.8, reviews: 2600, languages: ["English", "Igbo"], cuisines: ["Nigerian", "West African", "Ghanaian"], hue: 32 }),
  v({ name: "Olive & Vine Catering", cat: "food", offering: "Full-service catering", price: 4, startingPrice: 1200, city: "New York", region: "NY", country: "US", distance: 10, rating: 4.6, reviews: 480, cuisines: ["Italian", "French", "Mediterranean", "Greek"], hue: 24 }),
  v({ name: "Naija Small Chops", cat: "food", offering: "Small chops / finger foods", price: 2, startingPrice: 300, city: "Abuja", region: "FCT", country: "NG", distance: 4, rating: 4.8, reviews: 2600, cuisines: ["Nigerian", "West African"], hue: 30 }),
  v({ name: "The Roaming Grill", cat: "food", offering: "Food truck", price: 1, startingPrice: 120, city: "Austin", region: "TX", country: "US", distance: 13, rating: 4.5, reviews: 540, licensed: false, equipmentHire: true, cuisines: ["American (BBQ)", "Mexican"], hue: 44 }),
  v({ name: "Craft & Pour Bar Co.", cat: "food", offering: "Bartending & mixology", price: 3, startingPrice: 350, city: "Seattle", region: "WA", country: "US", distance: 8, rating: 4.6, reviews: 720, hue: 26 }),
  v({ name: "Sugar Atelier Cakes", cat: "food", offering: "Cake & desserts", price: 2, startingPrice: 90, city: "Toronto", region: "ON", country: "CA", distance: 10, rating: 4.9, reviews: 1100, hue: 16 }),

  v({ name: "Glow Bridal Studio", cat: "beauty", offering: "Bridal hair & makeup", price: 3, startingPrice: 250, city: "Vancouver", region: "BC", country: "CA", distance: 5, rating: 4.9, reviews: 1300, premium: true, languages: ["English", "Mandarin"], hue: 332 }),
  v({ name: "Sharp Cuts Mobile Barber", cat: "beauty", offering: "Barbering & grooming", price: 1, startingPrice: 40, city: "Lagos", region: "Lagos", country: "NG", distance: 6, rating: 4.5, reviews: 480, hue: 344 }),
  v({ name: "Henna by Zara", cat: "beauty", offering: "Henna / Mehndi", price: 2, startingPrice: 80, city: "Mississauga", region: "ON", country: "CA", distance: 9, rating: 4.8, reviews: 900, languages: ["English", "Urdu"], hue: 320 }),
  v({ name: "Stitch & Co. Tailors", cat: "beauty", offering: "Tailoring & alterations", price: 2, startingPrice: 60, city: "Lagos", region: "Lagos", country: "NG", distance: 6, rating: 4.7, reviews: 410, hue: 300 }),

  v({ name: "Pinnacle Event Planners", cat: "mgmt", offering: "Full event planning", price: 4, startingPrice: 1500, city: "New York", region: "NY", country: "US", distance: 7, rating: 4.8, reviews: 360, premium: true, sponsored: true, years: 14, hue: 200 }),
  v({ name: "On-Cue Coordination", cat: "mgmt", offering: "Day-of coordination", price: 2, startingPrice: 500, city: "Calgary", region: "AB", country: "CA", distance: 4, rating: 4.6, reviews: 230, hue: 192 }),
  v({ name: "Rev. Daniel — Officiant", cat: "mgmt", offering: "Officiant services", price: 1, startingPrice: 200, city: "Houston", region: "TX", country: "US", distance: 11, rating: 4.9, reviews: 140, hue: 208 }),

  v({ name: "Guardian Event Security", cat: "logi", offering: "Event security", price: 3, startingPrice: 400, city: "Lagos", region: "Lagos", country: "NG", distance: 5, rating: 4.5, reviews: 410, sponsored: true, hue: 150 }),
  v({ name: "Citywide Shuttle", cat: "logi", offering: "Guest transportation", price: 2, startingPrice: 300, city: "Toronto", region: "ON", country: "CA", distance: 8, rating: 4.4, reviews: 290, equipmentHire: true, hue: 162 }),
  v({ name: "Premier Chauffeurs", cat: "logi", offering: "Professional driver", price: 3, startingPrice: 120, city: "Toronto", region: "ON", country: "CA", distance: 7, rating: 4.7, reviews: 340, equipmentHire: true, hue: 168 }),
  v({ name: "BrightStage Sound & Light", cat: "logi", offering: "Sound & lighting rental", price: 3, startingPrice: 150, city: "Abuja", region: "FCT", country: "NG", distance: 6, rating: 4.6, reviews: 670, equipmentHire: true, fullService: false, hue: 140 }),
  v({ name: "PowerUp Generators", cat: "logi", offering: "Power / generator rental", price: 2, startingPrice: 200, city: "Lagos", region: "Lagos", country: "NG", distance: 9, rating: 4.3, reviews: 350, equipmentHire: true, fullService: false, hue: 130 }),
];

export const SEED_VENDORS = ALL_SEED_VENDORS.filter((x) => x.country === "US" || x.country === "CA");
