/**
 * Refresh data/raid-attackers.json from Pokébattler aggregated rankings.
 * Unions live unique species into the vendored KEEP set (never shrinks).
 *
 *   npx tsx scripts/pin-raid-attackers.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsePokebattlerAttackers,
  POKEBATTLER_ATTACKERS_URL,
  POKEBATTLER_UA,
  unionUniqueIds,
} from "../src/meta.ts";
import type { PokemonType } from "../src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raidPath = join(root, "data/raid-attackers.json");
const pinPath = join(root, "data/pin.json");
const typesPath = join(root, "data/species-types.json");

const res = await fetch(POKEBATTLER_ATTACKERS_URL, {
  headers: { "User-Agent": POKEBATTLER_UA },
});
if (!res.ok) {
  throw new Error(`Pokébattler ${res.status} ${res.statusText}`);
}

const live = parsePokebattlerAttackers(await res.json());
if (live.ids.length < 40) {
  throw new Error(`Pokébattler list too small (${live.ids.length})`);
}

const current = JSON.parse(readFileSync(raidPath, "utf8")) as {
  comment?: string;
  speciesIds: string[];
};
const speciesIds = unionUniqueIds(live.ids, current.speciesIds);
const added = speciesIds.filter((id) => !current.speciesIds.includes(id));

writeFileSync(
  raidPath,
  `${JSON.stringify({
    comment:
      "Wide-minmax raid KEEP set: Pokébattler /api/attackers.json unique speciesIds in rank order, then older KEEP extras. Shadows and megas distinct. Limited raid bosses stay in limited.json.",
    speciesIds,
  })}\n`,
);

const typeFile = JSON.parse(readFileSync(typesPath, "utf8")) as {
  comment?: string;
  types: Record<string, PokemonType[]>;
};
let typeAdded = 0;
for (const [id, types] of Object.entries(live.types)) {
  if (!types.length || typeFile.types[id]) continue;
  typeFile.types[id] = types;
  typeAdded++;
}
if (typeAdded) {
  writeFileSync(typesPath, `${JSON.stringify(typeFile)}\n`);
}

const pin = JSON.parse(readFileSync(pinPath, "utf8")) as {
  fetched?: string;
  sources?: Record<string, string>;
  notes?: Record<string, string>;
  counts?: Record<string, number>;
};
pin.fetched = new Date().toISOString().slice(0, 10);
pin.sources = {
  ...pin.sources,
  raidAttackers: POKEBATTLER_ATTACKERS_URL,
};
pin.notes = {
  ...pin.notes,
  raidAttackers:
    "Pokébattler unique-species rank order, then older KEEP extras (shadows/megas distinct, 24h server cache)",
};
pin.counts = { ...pin.counts, raidAttackers: speciesIds.length };
writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);

console.log(
  `raid attackers ${current.speciesIds.length} → ${speciesIds.length} (+${added.length} live)${
    added.length ? `\n  added: ${added.join(", ")}` : ""
  }${typeAdded ? `\n  types added: ${typeAdded}` : ""}`,
);
