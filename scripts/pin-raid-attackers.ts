/**
 * Refresh data/raid-attackers.json from Dittobase best-attackers pages.
 * Run: npm run pin:raid
 *
 * The Pages app fetches this file from raw.githubusercontent.com (Dittobase
 * sends no CORS header) and caches it for 24 hours. The scheduled workflow
 * refreshes it. Local `npm run dev` still reads Dittobase through the Vite
 * `/ditto` proxy. A failed fetch leaves the previous snapshot in place.
 * Unchanged attacker lists are not rewritten. Type pages are fetched two at a
 * time with a short pause. Dittobase has no combined attackers endpoint.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DITTOBASE_TYPE_BATCH,
  DITTOBASE_TYPE_GAP_MS,
  DITTOBASE_UA,
  dittoSlugToSpeciesId,
  dittobaseTypeUrl,
  mapInBatches,
  pageTruncatesViable,
  parseDittobaseTypePage,
  raidFileFromPages,
  viableRaidTier,
  type DittobaseTypePage,
} from "../src/dittobase";
import { POKEMON_TYPES } from "../src/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "data", "raid-attackers.json");
const typesPath = join(root, "data", "species-types.json");
const pinPath = join(root, "data", "pin.json");

async function fetchType(type: (typeof POKEMON_TYPES)[number]): Promise<DittobaseTypePage> {
  const res = await fetch(dittobaseTypeUrl(type), {
    headers: { "user-agent": DITTOBASE_UA, accept: "text/html" },
  });
  if (!res.ok) throw new Error(`${type} HTTP ${res.status}`);
  const page = parseDittobaseTypePage(await res.text());
  if (page.type !== type) throw new Error(`asked for ${type}, page said ${page.type}`);
  if (pageTruncatesViable(page.rows, page.resultCount)) {
    throw new Error(
      `${type}: viable tier still open at row ${page.rows.length} of ${page.resultCount}`,
    );
  }
  return page;
}

async function main(): Promise<void> {
  const pages = await mapInBatches(POKEMON_TYPES, DITTOBASE_TYPE_BATCH, DITTOBASE_TYPE_GAP_MS, async (type) => {
    const page = await fetchType(type);
    const last = page.rows[page.rows.length - 1];
    console.log(`fetch ${type}: ${page.rows.length}/${page.resultCount} last ${last?.tier} #${last?.rank}`);
    return page;
  });

  const types = JSON.parse(readFileSync(typesPath, "utf8")) as { types: Record<string, string[]> };
  const known = new Set(Object.keys(types.types));
  const unknown = new Map<string, string>();
  for (const page of pages) {
    for (const row of page.rows) {
      const id = dittoSlugToSpeciesId(row.slug);
      if (!known.has(id) && !known.has(id.replace(/_shadow$/, ""))) {
        unknown.set(row.slug, id);
      }
    }
  }
  if (unknown.size > 0) {
    console.error("slugs with no species-types id:");
    for (const [slug, id] of [...unknown.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.error(`  ${slug} → ${id}`);
    }
    throw new Error(`${unknown.size} Dittobase slugs did not match species-types.json`);
  }

  const fetched = new Date().toISOString().slice(0, 10);
  const file = raidFileFromPages(pages, fetched);
  const viable = new Set<string>();
  const ranked = new Set<string>();
  for (const type of POKEMON_TYPES) {
    for (const row of file.lists[type] ?? []) {
      ranked.add(row.id);
      if (viableRaidTier(row.tier)) viable.add(row.id);
    }
  }
  const previous = JSON.parse(readFileSync(outPath, "utf8")) as { lists?: unknown };
  if (JSON.stringify(previous.lists) === JSON.stringify(file.lists)) {
    console.log(`unchanged (${viable.size} viable / ${ranked.size} ranked)`);
    return;
  }

  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`);

  const pin = JSON.parse(readFileSync(pinPath, "utf8")) as {
    fetched: string;
    sources: Record<string, string>;
    notes: Record<string, string>;
    counts: Record<string, number>;
    note: string;
  };
  pin.fetched = fetched;
  pin.sources.raidAttackers = file.source;
  pin.counts.raidAttackers = viable.size;
  pin.notes.raidAttackers =
    "Dittobase eDPS, A tier and better. The JSON also keeps the embedded page (lower tiers) for the rankings table.";
  pin.note =
    "raidAttackers is Dittobase eDPS, A tier and better, one best moveset per species per attacking type. The JSON keeps the embedded page (lower tiers included) as the rankings fallback. species-types.json is a separate PvPoke gamemaster snapshot.";
  writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
  console.log(`wrote ${viable.size} viable / ${ranked.size} ranked species to ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
