// Single source of truth for the marketplace taxonomy.
// Mirrors the front-end CATEGORIES so both sides agree on ids/offerings.

export const CATEGORIES = [
  { id: "beauty", name: "Beauty",
    offerings: ["Bridal hair & makeup", "Special-occasion makeup", "Barbering & grooming", "Henna / Mehndi", "Nail services", "Tailoring & alterations"] },
  { id: "decor", name: "Décor & Venue",
    offerings: ["Floral arrangements", "Stage & backdrop design", "Balloon décor", "Canopy, table & chair rental", "Tent / marquee rental", "Inflatable rentals", "Ambient & uplighting", "Venue booking"] },
  { id: "ent", name: "Entertainment & Performers",
    offerings: ["DJ services", "Live band", "Stand-up comedy", "Dance troupe", "Solo instrumentalist", "MC / Host", "Children's entertainment"] },
  { id: "mgmt", name: "Event Management & Coordination",
    offerings: ["Full event planning", "Day-of coordination", "Ushering & guest management", "Officiant services", "Registration & check-in"] },
  { id: "food", name: "Food & Beverage",
    offerings: ["Full-service catering", "Small chops / finger foods", "Food truck", "Bartending & mixology", "Cake & desserts", "Coffee / beverage cart"] },
  { id: "logi", name: "Logistics & Support Services",
    offerings: ["Event security", "Guest transportation", "Professional driver", "Valet & parking", "Sound & lighting rental", "Power / generator rental", "Cleaning & waste"] },
  { id: "media", name: "Media & Visual",
    offerings: ["Event photography", "Videography", "Photo booth", "Drone coverage", "Live streaming", "LED screens & projection"] },
];

// Occupations that legally require a licence/credential (drives the licensed flag).
export const LICENSE_BY_OFFERING = {
  "Bartending & mixology": "Alcohol-server certification (TABC / RBS / MAST / Smart Serve)",
  "Full-service catering": "Caterer licence + food-handler certification",
  "Small chops / finger foods": "Food-handler / food-safety certification",
  "Food truck": "Mobile food-vendor permit + food-handler certification",
  "Event security": "Security-guard / security-services licence",
  "Officiant services": "Authorised / registered to solemnise marriages",
  "Guest transportation": "For-hire / chauffeur endorsement (CDL-P for 16+ seats)",
  "Professional driver": "For-hire / chauffeur endorsement",
  "Barbering & grooming": "Barber / cosmetology licence",
  "Bridal hair & makeup": "Cosmetology licence (hair services)",
  "Drone coverage": "FAA Part 107 remote-pilot certificate (US)",
};

export const CUISINE_OPTIONS = [
  "Nigerian", "Ghanaian", "West African", "Ethiopian", "American (BBQ)", "Mexican",
  "Italian", "French", "Greek", "Spanish", "Mediterranean", "Lebanese",
  "Middle Eastern", "Indian", "Pakistani", "Chinese", "Japanese", "Korean",
  "Thai", "Vietnamese", "Filipino", "Jamaican",
];
