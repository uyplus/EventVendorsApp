// Seeds demo vendors into whichever store is active (Postgres or JSON).
// Runs automatically on boot if the vendors table is empty; also `npm run seed`.

import { repo } from "./repo.js";
import { SEED_VENDORS } from "./vendorsSeed.js";

export async function ensureSeeded() {
  await repo.init();
  if ((await repo.countVendors()) > 0) return false;
  for (const vd of SEED_VENDORS) {
    // strip the demo numeric id — the DB assigns its own; keep everything else
    const { id, ...rest } = vd;
    await repo.createVendor({ ...rest, ownerUserId: null });
  }
  return true;
}

// allow running directly: `node src/seed.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSeeded()
    .then((seeded) => repo.countVendors().then((n) => {
      console.log(seeded ? `Seeded ${n} vendors.` : "Already seeded; nothing to do.");
      process.exit(0);
    }))
    .catch((e) => { console.error("Seed failed:", e.message); process.exit(1); });
}
