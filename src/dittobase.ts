import { isPokemonType, POKEMON_TYPES, type PokemonType } from "./types";

/** Dittobase best-attackers page. One path segment per attacking move type. */
export const DITTOBASE_ATTACKERS_ORIGIN = "https://www.dittobase.com";
export const DITTOBASE_UA = "pogo-grader/0.1 (raid attacker cache; https://github.com/ziajowaty/pogo-grader)";

/** A tier and better count as raid KEEP. B and below stay on the ranking table only. */

/** Cosmetic or drive forms Dittobase splits that the grader treats as one species. */
const SLUG_ALIAS: Record<string, string> = {
  "florges-red": "florges",
  "genesect-normal": "genesect",
  "ho-oh-s": "ho-oh-shadow",
  "lugia-s": "lugia-shadow",
  "polteageist-antique": "polteageist",
  "polteageist-phony": "polteageist",
  "sinistcha-masterpiece": "sinistcha",
};

/** Dittobase omits the default form suffix that PvPoke-style ids use. */
const DEFAULT_FORM: Record<string, string> = {
  giratina: "giratina_altered",
  landorus: "landorus_incarnate",
  thundurus: "thundurus_incarnate",
  tornadus: "tornadus_incarnate",
  keldeo: "keldeo_ordinary",
  shaymin: "shaymin_land",
  hoopa: "hoopa_confined",
  meloetta: "meloetta_aria",
  zacian: "zacian_hero",
  zamazenta: "zamazenta_hero",
  enamorus: "enamorus_incarnate",
  darmanitan: "darmanitan_standard",
};

export interface DittobaseMovesetRow {
  slug: string;
  name: string;
  /** 1 = best eDPS of this attacking type on the page. */
  rank: number;
  tier: string;
  edps: number;
}

export interface DittobaseTypePage {
  type: PokemonType;
  updatedAt: string | null;
  /** Full list length reported by Dittobase. The HTML only embeds the first page. */
  resultCount: number;
  rows: DittobaseMovesetRow[];
}

export interface DittoTypeRank {
  rank: number;
  tier: string;
  edps: number;
}

export interface DittoRaidEntry {
  speciesId: string;
  bestEdps: number;
  typeRanks: Partial<Record<PokemonType, DittoTypeRank>>;
}

export interface DittoRaidFile {
  comment?: string;
  fetched: string;
  updatedAt?: string;
  source: string;
  /** Move type → eDPS order. `rank` is Dittobase's number, not renumbered. */
  lists: Partial<Record<PokemonType, Array<{ id: string; rank: number; tier: string; edps: number }>>>;
}

export function dittobaseTypeUrl(type: PokemonType): string {
  return `${DITTOBASE_ATTACKERS_ORIGIN}/pokemon-go/best-attackers/${type}`;
}

/** SSS / SSSS / S+ and A / A+ are raid KEEP. B, C, and D are ranked only. */
export function viableRaidTier(tier: string): boolean {
  return /^S+\+?$/.test(tier) || tier === "A" || tier === "A+";
}

/** Hyphenated Dittobase pokedex slug → grader speciesId. */
export function dittoSlugToSpeciesId(slug: string): string {
  const aliased = SLUG_ALIAS[slug.trim().toLowerCase()] ?? slug;
  let id = aliased.trim().toLowerCase().replace(/-/g, "_");
  id = id
    .replace(/_alola(?=_|$)/g, "_alolan")
    .replace(/_galar(?=_|$)/g, "_galarian")
    .replace(/_hisui(?=_|$)/g, "_hisuian")
    .replace(/_paldea(?=_|$)/g, "_paldean");
  if (DEFAULT_FORM[id]) id = DEFAULT_FORM[id];
  return id;
}

export function pageTruncatesViable(rows: DittobaseMovesetRow[], resultCount: number): boolean {
  if (resultCount <= rows.length) return false;
  const last = rows[rows.length - 1];
  return last != null && viableRaidTier(last.tier);
}

function decodeNextFlight(html: string): string {
  const marker = "self.__next_f.push(";
  const parts: string[] = [];
  let from = 0;
  while (from < html.length) {
    const start = html.indexOf(marker, from);
    if (start < 0) break;
    const jsonStart = start + marker.length;
    let i = jsonStart;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    const raw = html.slice(jsonStart, i);
    const arr = JSON.parse(raw) as unknown[];
    parts.push(typeof arr[1] === "string" ? arr[1] : JSON.stringify(arr));
    from = i;
  }
  return parts.join("\n");
}

function jsonSliceAt(blob: string, key: string, open: "[" | "{"): string {
  const token = `"${key}":`;
  const at = blob.indexOf(token);
  if (at < 0) throw new Error(`Dittobase payload missing ${key}`);
  const start = blob.indexOf(open, at);
  if (start < 0) throw new Error(`Dittobase payload missing ${key} value`);
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < blob.length; i++) {
    const c = blob[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0 && c === close) return blob.slice(start, i + 1);
    }
  }
  throw new Error(`Dittobase payload truncated at ${key}`);
}

interface RawResult {
  pokemon?: { slug?: unknown; name?: unknown };
  bestMoveset?: { edps?: unknown };
}

/** Parse one Dittobase best-attackers HTML page (the embedded first page of results). */
export function parseDittobaseTypePage(html: string): DittobaseTypePage {
  const blob = decodeNextFlight(html);
  const results = JSON.parse(jsonSliceAt(blob, "initialResults", "[")) as unknown;
  const tiers = JSON.parse(jsonSliceAt(blob, "initialTiers", "[")) as unknown;
  if (!Array.isArray(results) || !Array.isArray(tiers)) {
    throw new Error("Dittobase results were not arrays");
  }
  if (results.length !== tiers.length) {
    throw new Error(`Dittobase rows ${results.length} != tiers ${tiers.length}`);
  }
  const typeMatch = /"typeSlug":"([a-z]+)"\s*,\s*"isOverall":false/.exec(blob);
  const typeSlug = typeMatch?.[1] ?? "";
  if (!isPokemonType(typeSlug)) throw new Error(`Dittobase type slug ${typeSlug || "(missing)"}`);
  const countMatch = /"initialResultCount":(\d+)/.exec(blob);
  const resultCount = countMatch ? Number(countMatch[1]) : results.length;
  const updatedMatch = /"updatedAt":"([^"]+)"/.exec(blob);
  const rows: DittobaseMovesetRow[] = [];
  for (let i = 0; i < results.length; i++) {
    const row = results[i] as RawResult;
    const slug = typeof row?.pokemon?.slug === "string" ? row.pokemon.slug : "";
    const name = typeof row?.pokemon?.name === "string" ? row.pokemon.name : slug;
    const edps = row?.bestMoveset?.edps;
    const tier = tiers[i];
    if (!slug || typeof tier !== "string" || typeof edps !== "number" || !Number.isFinite(edps)) {
      throw new Error(`Dittobase row ${i + 1} is incomplete`);
    }
    rows.push({ slug, name, rank: i + 1, tier, edps });
  }
  if (rows.length < 20) throw new Error(`Dittobase ${typeSlug} list too small (${rows.length})`);
  return {
    type: typeSlug,
    updatedAt: updatedMatch?.[1] ?? null,
    resultCount,
    rows,
  };
}

export function mergeDittobasePages(pages: DittobaseTypePage[]): DittoRaidEntry[] {
  const byId = new Map<string, DittoRaidEntry>();
  for (const page of pages) {
    for (const row of page.rows) {
      const speciesId = dittoSlugToSpeciesId(row.slug);
      if (!speciesId) continue;
      let entry = byId.get(speciesId);
      if (!entry) {
        entry = { speciesId, bestEdps: row.edps, typeRanks: {} };
        byId.set(speciesId, entry);
      }
      if (row.edps > entry.bestEdps) entry.bestEdps = row.edps;
      const prev = entry.typeRanks[page.type];
      if (!prev || row.rank < prev.rank) {
        entry.typeRanks[page.type] = { rank: row.rank, tier: row.tier, edps: row.edps };
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.bestEdps - a.bestEdps || a.speciesId.localeCompare(b.speciesId),
  );
}

export function entryIsViable(entry: DittoRaidEntry): boolean {
  return Object.values(entry.typeRanks).some((rank) => rank != null && viableRaidTier(rank.tier));
}

export function raidFileFromPages(pages: DittobaseTypePage[], fetched: string): DittoRaidFile {
  const lists: DittoRaidFile["lists"] = {};
  let updatedAt: string | undefined;
  for (const page of pages) {
    if (pageTruncatesViable(page.rows, page.resultCount)) {
      throw new Error(
        `Dittobase ${page.type} viable tier continues past the embedded ${page.rows.length} of ${page.resultCount}`,
      );
    }
    if (!updatedAt && page.updatedAt) updatedAt = page.updatedAt;
    const seen = new Set<string>();
    const rows: NonNullable<DittoRaidFile["lists"][PokemonType]> = [];
    for (const row of page.rows) {
      const id = dittoSlugToSpeciesId(row.slug);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id,
        rank: row.rank,
        tier: row.tier,
        edps: Math.round(row.edps * 1000) / 1000,
      });
    }
    lists[page.type] = rows;
  }
  for (const type of POKEMON_TYPES) {
    if (!lists[type]?.length) throw new Error(`Dittobase missing ${type}`);
  }
  return {
    comment:
      "Dittobase eDPS raid attackers (level 40, best moveset per attacking type). Embedded first page of each type list. A tier and better are raid KEEP; lower tiers stay on the ranking table. Fallback when a live fetch fails.",
    fetched,
    updatedAt,
    source: `${DITTOBASE_ATTACKERS_ORIGIN}/pokemon-go/best-attackers/{type}`,
    lists,
  };
}

export function entriesFromRaidFile(file: DittoRaidFile): DittoRaidEntry[] {
  const byId = new Map<string, DittoRaidEntry>();
  for (const type of POKEMON_TYPES) {
    const rows = file.lists[type] ?? [];
    for (const row of rows) {
      if (!row?.id || typeof row.rank !== "number" || typeof row.tier !== "string") continue;
      if (typeof row.edps !== "number" || !Number.isFinite(row.edps)) continue;
      let entry = byId.get(row.id);
      if (!entry) {
        entry = { speciesId: row.id, bestEdps: row.edps, typeRanks: {} };
        byId.set(row.id, entry);
      }
      if (row.edps > entry.bestEdps) entry.bestEdps = row.edps;
      const prev = entry.typeRanks[type];
      if (!prev || row.rank < prev.rank) {
        entry.typeRanks[type] = { rank: row.rank, tier: row.tier, edps: row.edps };
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.bestEdps - a.bestEdps || a.speciesId.localeCompare(b.speciesId),
  );
}
