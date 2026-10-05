import {
  dittobaseTypeUrl,
  DITTOBASE_UA,
  entriesFromRaidFile,
  entryIsViable,
  parseDittobaseTypePage,
  raidFileFromPages,
  type DittoRaidEntry,
  type DittoRaidFile,
} from "./dittobase";
import type { Meta, PokemonType, PvpokeRankRow, RaidAttackerRow } from "./types";
import { GL_LIST_CAP, isPokemonType, LC_LIST_CAP, ML_LIST_CAP, POKEMON_TYPES, prettySpeciesId, UL_LIST_CAP } from "./types";
// @ts-ignore Vite JSON snapshots
import glTop500Json from "../data/gl-top500.json";
// @ts-ignore Vite JSON snapshots
import lcTop100Json from "../data/lc-top100.json";
// @ts-ignore Vite JSON snapshots
import glEvolutionJson from "../data/gl-evolution.json";
// @ts-ignore Vite JSON snapshots
import legendaryJson from "../data/legendary.json";
// @ts-ignore Vite JSON snapshots
import mythicalJson from "../data/mythical.json";
// @ts-ignore Vite JSON snapshots
import limitedJson from "../data/limited.json";
// @ts-ignore Vite JSON snapshots
import raidAttackersJson from "../data/raid-attackers.json";
// @ts-ignore Vite JSON snapshots
import evolutionsJson from "../data/evolutions.json";
// @ts-ignore Vite JSON snapshots
import speciesTypesJson from "../data/species-types.json";

const PVPOKE_TTL_MS = 24 * 60 * 60 * 1000;
/** v2 stores up to 1000 species. Older caches were cut at 500 (GL) and 100 (LC). */
const PVPOKE_CACHE_KEY = "pogo-grader.pvpokeLists.v2";
const RAID_TTL_MS = 24 * 60 * 60 * 1000;
const RAID_CACHE_KEY = "pogo-grader.raidAttackers.dittobase";
const RAID_LIVE_MIN = 40;
const GL_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-1500.json";
const LC_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/little/overall/rankings-500.json";
const UL_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-2500.json";
const ML_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-10000.json";
const UL_CACHE_KEY = "pogo-grader.pvpokeUltra.v2";
const ML_CACHE_KEY = "pogo-grader.pvpokeMaster.v2";
interface NamedListFile {
  comment?: string;
  speciesIds: string[];
}

interface EvolutionFile {
  comment?: string;
  from?: Record<string, string[]>;
}

interface SpeciesTypesFile {
  comment?: string;
  types?: Record<string, string[]>;
}

interface CachedLists {
  gl: PvpokeRankRow[];
  lc: PvpokeRankRow[];
  fetchedAt: number;
}

export function canonId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

function dittobaseTypeFetchUrl(type: PokemonType): string {
  if (typeof window !== "undefined" && import.meta.env?.DEV) {
    return `/ditto/pokemon-go/best-attackers/${type}`;
  }
  return dittobaseTypeUrl(type);
}

function toSet(ids: string[]): Set<string> {
  return new Set(ids.map(canonId));
}

function coreSpeciesId(id: string): string {
  return id
    .replace(/_shadow$/, "")
    .replace(/_mega_[xy]$/, "")
    .replace(/_mega$/, "")
    .replace(/_primal$/, "");
}

function setHasId(set: Set<string>, id: string): boolean {
  if (set.has(id)) return true;
  const core = coreSpeciesId(id);
  return core !== id && set.has(core);
}

function loadSpeciesTypes(data: unknown): Record<string, PokemonType[]> {
  const raw = (data as SpeciesTypesFile).types ?? {};
  const out: Record<string, PokemonType[]> = {};
  for (const [id, types] of Object.entries(raw)) {
    if (!Array.isArray(types)) continue;
    const key = canonId(id);
    if (!key) continue;
    const cleaned = types.filter((type): type is PokemonType => typeof type === "string" && isPokemonType(type));
    if (cleaned.length) out[key] = cleaned;
  }
  return out;
}

function typesOf(id: string, map: Record<string, PokemonType[]>): PokemonType[] {
  const speciesId = canonId(id);
  if (!speciesId) return [];
  const hit = map[speciesId];
  if (hit) return hit;
  if (speciesId.endsWith("_shadow")) return typesOf(speciesId.slice(0, -7), map);
  return [];
}

function raidTags(id: string, limited: Set<string>, legendary: Set<string>, mythical: Set<string>): string[] {
  const tags: string[] = [];
  if (id.includes("_mega")) tags.push("Mega");
  if (id.includes("primal")) tags.push("Primal");
  if (id.endsWith("_shadow")) tags.push("Shadow");
  if (setHasId(legendary, id)) tags.push("Legendary");
  else if (setHasId(mythical, id)) tags.push("Mythical");
  else if (setHasId(limited, id)) tags.push("Limited");
  return tags;
}

const REGIONAL_FORMS = ["alolan", "galarian", "hisuian", "paldean"] as const;

/**
 * PvPoke still lists Cubone → Alolan Marowak. That branch is not a standing
 * evolution: there is no Alolan Cubone, and regular Cubone only becomes Marowak.
 * A few events have turned it on temporarily.
 */
const EVENT_ONLY_EVOLUTIONS = new Set(["cubone>marowak_alolan", "cubone_shadow>marowak_alolan_shadow"]);

function isShadowId(id: string): boolean {
  return id.endsWith("_shadow");
}

function stripShadowId(id: string): string {
  return isShadowId(id) ? id.slice(0, -7) : id;
}

function withShadowId(core: string, shadow: boolean): string {
  return shadow ? `${core}_shadow` : core;
}

function regionalTokens(core: string): string[] {
  return core.split("_").filter((part) => (REGIONAL_FORMS as readonly string[]).includes(part));
}

/** `darumaka` + galarian → `darumaka_galarian`; `darmanitan_standard` + galarian → `darmanitan_galarian_standard`. */
function insertRegional(core: string, region: string): string {
  const parts = core.split("_").filter(Boolean);
  if (parts.includes(region)) return core;
  return [parts[0], region, ...parts.slice(1)].filter(Boolean).join("_");
}

function speciesKnown(id: string, known: Set<string>): boolean {
  return known.has(id) || (isShadowId(id) && known.has(stripShadowId(id)));
}

/**
 * Drop evolutions the pre-evo cannot actually become.
 * A regional final belongs to the regional pre-evo when that pre-evo exists
 * (Darumaka does not become Galarian Darmanitan; Galarian Darumaka does).
 * A regional pre-evo does not become the other region's final when its own
 * final exists (Alolan Rattata does not become Kanto Raticate).
 */
function evolutionEdgeOk(from: string, to: string, known: Set<string>): boolean {
  if (EVENT_ONLY_EVOLUTIONS.has(`${from}>${to}`)) return false;
  const fromCore = stripShadowId(from);
  const toCore = stripShadowId(to);
  const fromRegions = regionalTokens(fromCore);
  const toRegions = regionalTokens(toCore);
  const fromShadow = isShadowId(from);

  for (const region of toRegions) {
    if (fromRegions.includes(region)) continue;
    if (speciesKnown(withShadowId(insertRegional(fromCore, region), fromShadow), known)) return false;
  }
  for (const region of fromRegions) {
    if (toRegions.includes(region)) continue;
    if (speciesKnown(withShadowId(insertRegional(toCore, region), isShadowId(to)), known)) return false;
  }
  if ((toCore.includes("_mega") || toCore.includes("_primal")) && fromRegions.length > 0) {
    const megaBase = toCore.replace(/_mega(?:_[xy])?$/, "").replace(/_primal$/, "");
    const megaRegions = regionalTokens(megaBase);
    if (fromRegions.some((region) => !megaRegions.includes(region))) return false;
  }
  return true;
}

function keepStandingEvolutionEdges(edges: Record<string, string[]>): Record<string, string[]> {
  const known = new Set<string>();
  for (const [from, tos] of Object.entries(edges)) {
    known.add(from);
    for (const to of tos) known.add(to);
  }
  const out: Record<string, string[]> = {};
  for (const [from, tos] of Object.entries(edges)) {
    const next = tos.filter((to) => evolutionEdgeOk(from, to, known));
    if (next.length > 0) out[from] = next;
  }
  return out;
}

function loadEvolutionEdges(data: unknown): Record<string, string[]> {
  const raw = (data as EvolutionFile).from ?? {};
  const out: Record<string, string[]> = {};
  for (const [from, tos] of Object.entries(raw)) {
    if (!Array.isArray(tos)) continue;
    const key = canonId(from);
    if (!key) continue;
    const next = tos.map(canonId).filter(Boolean);
    if (next.length === 0) continue;
    out[key] = next;
  }
  return keepStandingEvolutionEdges(out);
}

function raidHit(id: string, raid: Set<string>): string | null {
  if (raid.has(id)) return id;
  if (id.endsWith("_shadow") && raid.has(id.slice(0, -7))) return id.slice(0, -7);
  return null;
}

function pickRaidTarget(from: string, hits: string[]): string | null {
  if (hits.length === 0) return null;
  const wantShadow = from.endsWith("_shadow");
  const unique = [...new Set(hits)];
  unique.sort((a, b) => {
    const as = a.endsWith("_shadow") === wantShadow ? 1 : 0;
    const bs = b.endsWith("_shadow") === wantShadow ? 1 : 0;
    if (as !== bs) return bs - as;
    const am = a.includes("_mega") || a.includes("primal") ? 1 : 0;
    const bm = b.includes("_mega") || b.includes("primal") ? 1 : 0;
    if (am !== bm) return am - bm;
    return a.localeCompare(b);
  });
  return unique[0];
}

function reachableRaidHits(from: string, edges: Record<string, string[]>, raid: Set<string>): string[] {
  const seen = new Set<string>();
  const stack = [...(edges[from] ?? [])];
  const hits: string[] = [];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    const hit = raidHit(cur, raid);
    if (hit) hits.push(hit);
    const next = edges[cur];
    if (next) stack.push(...next);
  }
  return hits;
}

function buildFamilyIndex(edges: Record<string, string[]>): {
  familyOf: Record<string, string>;
  evoReach: Record<string, string[]>;
} {
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    if (parent[x] == null) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };

  const nodes = new Set<string>();
  for (const [from, tos] of Object.entries(edges)) {
    nodes.add(from);
    find(from);
    for (const to of tos) {
      nodes.add(to);
      find(to);
      union(from, to);
    }
  }

  const familyOf: Record<string, string> = {};
  for (const n of nodes) familyOf[n] = find(n);

  const evoReach: Record<string, string[]> = {};
  for (const n of nodes) {
    const seen = new Set<string>([n]);
    const stack = [...(edges[n] ?? [])];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      const next = edges[cur];
      if (next) stack.push(...next);
    }
    evoReach[n] = [...seen];
  }
  return { familyOf, evoReach };
}

/**
 * Form words that show up on many species ids. They narrow which family member
 * triggers a rankings search, and a query that is only these words stays a
 * direct name/tag filter (so "shadow" does not pull in every relative).
 */
const RANKINGS_FORM_QUALIFIERS = new Set([
  "shadow",
  "mega",
  "alolan",
  "galarian",
  "hisuian",
  "paldean",
  "primal",
]);

function speciesIdentity(id: string): string {
  const parts = canonId(id).split("_");
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || RANKINGS_FORM_QUALIFIERS.has(part)) continue;
    if ((part === "x" || part === "y") && parts[i - 1] === "mega") continue;
    kept.push(part);
  }
  return kept.join(" ");
}

function splitRankingsQuery(query: string): { identity: string; forms: Set<string> } {
  const parts = query
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const forms = new Set<string>();
  const identityParts: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (RANKINGS_FORM_QUALIFIERS.has(part)) {
      forms.add(part);
      continue;
    }
    if ((part === "x" || part === "y") && parts[i - 1] === "mega") {
      forms.add(part);
      continue;
    }
    identityParts.push(part);
  }
  return { identity: identityParts.join(" "), forms };
}

function speciesHasForms(id: string, forms: Set<string>): boolean {
  if (forms.size === 0) return true;
  const parts = new Set(canonId(id).split("_"));
  for (const form of forms) {
    if (form === "x" || form === "y") {
      if (!canonId(id).includes(`_mega_${form}`)) return false;
      continue;
    }
    if (!parts.has(form)) return false;
  }
  return true;
}

/** Species ids in every evolutionary family touched by a rankings name query. */
export function familyIdsMatchingQuery(
  query: string,
  familyOf: Record<string, string> | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!familyOf) return ids;
  const { identity, forms } = splitRankingsQuery(query);
  if (!identity) return ids;
  const families = new Set<string>();
  for (const [id, family] of Object.entries(familyOf)) {
    if (!speciesHasForms(id, forms)) continue;
    if (speciesIdentity(id).includes(identity)) families.add(family);
  }
  if (families.size === 0) return ids;
  for (const [id, family] of Object.entries(familyOf)) {
    if (families.has(family)) ids.add(id);
  }
  return ids;
}

export interface RankingsFilterRow {
  speciesId: string;
  speciesName: string;
  tags?: string[];
  asSpeciesId?: string;
  asSpeciesName?: string;
  types?: string[];
  asTypes?: string[];
}

/** Rankings text filter: the row, its raid target, or any evolutionary relative. */
export function rankingsRowMatches(
  row: RankingsFilterRow,
  query: string,
  familyIds: ReadonlySet<string>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (familyIds.has(row.speciesId)) return true;
  if (row.asSpeciesId && familyIds.has(row.asSpeciesId)) return true;
  if (
    row.speciesName.toLowerCase().includes(q) ||
    row.speciesId.includes(q) ||
    prettySpeciesId(row.speciesId).toLowerCase().includes(q)
  ) {
    return true;
  }
  if (row.asSpeciesId?.includes(q) || row.asSpeciesName?.toLowerCase().includes(q)) return true;
  if (row.types?.some((type) => type.includes(q))) return true;
  if (row.asTypes?.some((type) => type.includes(q))) return true;
  return Boolean(row.tags?.some((tag) => tag.toLowerCase().includes(q)));
}

function buildRaidEvolution(raid: Set<string>, edges: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const from of Object.keys(edges)) {
    if (raidHit(from, raid)) continue;
    const pick = pickRaidTarget(from, reachableRaidHits(from, edges, raid));
    if (pick) out[from] = pick;
  }
  return out;
}

function compareRaidRows(a: RaidAttackerRow, b: RaidAttackerRow): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const ap = a.asSpeciesId ? 1 : 0;
  const bp = b.asSpeciesId ? 1 : 0;
  if (ap !== bp) return ap - bp;
  return a.speciesName.localeCompare(b.speciesName) || a.speciesId.localeCompare(b.speciesId);
}

function moveRanksOf(entry: DittoRaidEntry): {
  typeRanks: Partial<Record<PokemonType, number>>;
  typeTiers: Partial<Record<PokemonType, string>>;
} {
  const typeRanks: Partial<Record<PokemonType, number>> = {};
  const typeTiers: Partial<Record<PokemonType, string>> = {};
  for (const type of POKEMON_TYPES) {
    const info = entry.typeRanks[type];
    if (!info) continue;
    typeRanks[type] = info.rank;
    typeTiers[type] = info.tier;
  }
  return { typeRanks, typeTiers };
}

function buildRaidRankings(
  entries: DittoRaidEntry[],
  raidEvolution: Record<string, string>,
  limited: Set<string>,
  legendary: Set<string>,
  mythical: Set<string>,
  typeMap: Record<string, PokemonType[]>,
): RaidAttackerRow[] {
  const seen = new Set<string>();
  const rankOf = new Map<string, number>();
  const inherited = new Map<string, ReturnType<typeof moveRanksOf> & { viable: boolean }>();
  const rows: RaidAttackerRow[] = [];
  let rank = 0;
  for (const entry of entries) {
    const speciesId = canonId(entry.speciesId);
    if (!speciesId || seen.has(speciesId)) continue;
    seen.add(speciesId);
    rank += 1;
    rankOf.set(speciesId, rank);
    const moves = moveRanksOf(entry);
    const viable = entryIsViable(entry);
    inherited.set(speciesId, { ...moves, viable });
    rows.push({
      rank,
      typeRanks: moves.typeRanks,
      typeTiers: moves.typeTiers,
      viable,
      speciesId,
      speciesName: prettySpeciesId(speciesId),
      tags: raidTags(speciesId, limited, legendary, mythical),
      types: typesOf(speciesId, typeMap),
    });
  }
  for (const [from, to] of Object.entries(raidEvolution)) {
    if (!from || seen.has(from)) continue;
    seen.add(from);
    const parent = inherited.get(to);
    rows.push({
      rank: rankOf.get(to) ?? rank + 1,
      typeRanks: { ...(parent?.typeRanks ?? {}) },
      typeTiers: { ...(parent?.typeTiers ?? {}) },
      viable: parent?.viable !== false,
      speciesId: from,
      speciesName: prettySpeciesId(from),
      tags: raidTags(from, limited, legendary, mythical),
      types: typesOf(from, typeMap),
      asSpeciesId: to,
      asSpeciesName: prettySpeciesId(to),
      asTypes: typesOf(to, typeMap),
    });
  }
  rows.sort(compareRaidRows);
  return rows;
}

function listFile(data: unknown): string[] {
  if (Array.isArray(data)) return data as string[];
  return (data as NamedListFile).speciesIds ?? [];
}

function scoreOf(row: { score?: unknown }): number | undefined {
  return typeof row.score === "number" && Number.isFinite(row.score) ? row.score : undefined;
}

function rowFromId(id: string, rank: number, speciesName?: string, score?: number): PvpokeRankRow {
  const speciesId = canonId(id);
  return {
    rank,
    speciesId,
    speciesName: (speciesName && speciesName.trim()) || prettySpeciesId(speciesId),
    score,
  };
}

function uniqueRankRows(rows: unknown, cap: number): PvpokeRankRow[] {
  if (!Array.isArray(rows)) return [];
  const out: PvpokeRankRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row === "string") {
      const id = canonId(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(rowFromId(id, out.length + 1));
      if (out.length >= cap) break;
      continue;
    }
    if (!row || typeof row !== "object" || !("speciesId" in row)) continue;
    const rec = row as { speciesId?: unknown; speciesName?: unknown; score?: unknown };
    const id = canonId(String(rec.speciesId ?? ""));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(
      rowFromId(
        id,
        out.length + 1,
        typeof rec.speciesName === "string" ? rec.speciesName : undefined,
        scoreOf(rec),
      ),
    );
    if (out.length >= cap) break;
  }
  return out;
}

function coerceRankRows(raw: unknown, cap: number): PvpokeRankRow[] | null {
  const rows = uniqueRankRows(raw, cap);
  if (rows.length < Math.min(20, cap)) return null;
  return rows;
}

function readPvpokeCache(): CachedLists | null {
  try {
    const raw = localStorage.getItem(PVPOKE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { gl?: unknown; lc?: unknown; fetchedAt?: unknown };
    const gl = coerceRankRows(parsed.gl, GL_LIST_CAP);
    const lc = coerceRankRows(parsed.lc, LC_LIST_CAP);
    if (!gl || !lc || !Number.isFinite(parsed.fetchedAt)) return null;
    return { gl, lc, fetchedAt: Number(parsed.fetchedAt) };
  } catch {
    return null;
  }
}

function writePvpokeCache(lists: CachedLists): void {
  try {
    localStorage.setItem(PVPOKE_CACHE_KEY, JSON.stringify(lists));
  } catch {
    /* quota / private mode */
  }
}

async function fetchRankingRows(url: string, cap: number): Promise<PvpokeRankRow[]> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`PvPoke ${res.status}`);
  const rows = uniqueRankRows(await res.json(), cap);
  if (rows.length < Math.min(20, cap)) throw new Error("PvPoke list too small");
  return rows;
}

function bundledLists(): CachedLists {
  return {
    gl: uniqueRankRows(glTop500Json, GL_LIST_CAP),
    lc: uniqueRankRows(lcTop100Json, LC_LIST_CAP),
    fetchedAt: 0,
  };
}

function cacheUsable(cached: CachedLists | null): cached is CachedLists {
  return Boolean(cached && cached.gl.length >= 20 && cached.lc.length >= 20);
}

type PvpokeLists = {
  gl: PvpokeRankRow[];
  lc: PvpokeRankRow[];
  source: NonNullable<Meta["pvpokeSource"]>;
  fetchedAt: number;
};

let pvpokeInflight: Promise<PvpokeLists> | null = null;

async function fetchLiveLists(stale: CachedLists | null): Promise<PvpokeLists> {
  const bundled = bundledLists();
  try {
    const [gl, lc] = await Promise.all([
      fetchRankingRows(GL_RANKINGS_URL, GL_LIST_CAP),
      fetchRankingRows(LC_RANKINGS_URL, LC_LIST_CAP),
    ]);
    const fetchedAt = Date.now();
    writePvpokeCache({ gl, lc, fetchedAt });
    return { gl, lc, fetchedAt, source: "live" };
  } catch {
    if (cacheUsable(stale)) {
      return { gl: stale.gl, lc: stale.lc, fetchedAt: stale.fetchedAt, source: "cache" };
    }
    return { ...bundled, source: "bundled" };
  }
}

async function loadPvpokeLists(): Promise<PvpokeLists> {
  const bundled = bundledLists();
  const canFetch = typeof fetch === "function" && typeof localStorage !== "undefined";
  if (!canFetch) {
    return { ...bundled, source: "bundled" };
  }

  const cached = readPvpokeCache();
  if (cacheUsable(cached) && Date.now() - cached.fetchedAt < PVPOKE_TTL_MS) {
    return { gl: cached.gl, lc: cached.lc, fetchedAt: cached.fetchedAt, source: "cache" };
  }

  if (!pvpokeInflight) {
    pvpokeInflight = fetchLiveLists(cached).finally(() => {
      pvpokeInflight = null;
    });
  }
  return pvpokeInflight;
}

interface CachedRaidFile extends DittoRaidFile {
  fetchedAt: number;
}

type RaidLists = {
  file: DittoRaidFile;
  source: NonNullable<Meta["raidSource"]>;
  fetchedAt: number;
};

let raidInflight: Promise<RaidLists> | null = null;

function bundledRaidFile(): DittoRaidFile {
  return raidAttackersJson as DittoRaidFile;
}

function raidFileUsable(file: DittoRaidFile | null): file is DittoRaidFile {
  if (!file?.lists) return false;
  if (!POKEMON_TYPES.every((type) => (file.lists[type]?.length ?? 0) >= 20)) return false;
  return entriesFromRaidFile(file).filter(entryIsViable).length >= RAID_LIVE_MIN;
}

function readRaidCache(): CachedRaidFile | null {
  try {
    const raw = localStorage.getItem(RAID_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRaidFile;
    if (!Number.isFinite(parsed.fetchedAt) || !raidFileUsable(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaidCache(file: DittoRaidFile, fetchedAt: number): void {
  try {
    localStorage.setItem(RAID_CACHE_KEY, JSON.stringify({ ...file, fetchedAt }));
  } catch {
    /* quota / private mode */
  }
}

async function fetchDittobaseRaidFile(): Promise<DittoRaidFile> {
  const headers: Record<string, string> = {};
  if (typeof window === "undefined") headers["User-Agent"] = DITTOBASE_UA;
  const pages = await Promise.all(
    POKEMON_TYPES.map(async (type) => {
      const res = await fetch(dittobaseTypeFetchUrl(type), { cache: "no-cache", headers });
      if (!res.ok) throw new Error(`Dittobase ${type} ${res.status}`);
      const page = parseDittobaseTypePage(await res.text());
      if (page.type !== type) throw new Error(`Dittobase asked for ${type}, got ${page.type}`);
      return page;
    }),
  );
  const file = raidFileFromPages(pages, new Date().toISOString().slice(0, 10));
  if (!raidFileUsable(file)) throw new Error("Dittobase attacker list too small");
  return file;
}

async function fetchLiveRaid(stale: CachedRaidFile | null): Promise<RaidLists> {
  try {
    const live = await fetchDittobaseRaidFile();
    const fetchedAt = Date.now();
    writeRaidCache(live, fetchedAt);
    return { file: live, fetchedAt, source: "live" };
  } catch {
    if (stale && raidFileUsable(stale)) {
      return { file: stale, fetchedAt: stale.fetchedAt, source: "cache" };
    }
    return { file: bundledRaidFile(), fetchedAt: 0, source: "bundled" };
  }
}

async function loadRaidLists(): Promise<RaidLists> {
  const bundled = { file: bundledRaidFile(), fetchedAt: 0, source: "bundled" as const };
  const canFetch = typeof fetch === "function" && typeof localStorage !== "undefined";
  if (!canFetch) return bundled;

  const cached = readRaidCache();
  if (cached && Date.now() - cached.fetchedAt < RAID_TTL_MS) {
    return { file: cached, fetchedAt: cached.fetchedAt, source: "cache" };
  }

  if (!raidInflight) {
    raidInflight = fetchLiveRaid(cached).finally(() => {
      raidInflight = null;
    });
  }
  return raidInflight;
}

export interface LeagueListRequest {
  /** Fetch PvPoke Ultra League overall. Default false. */
  ultra?: boolean;
  /** Fetch PvPoke Master League overall. Default false. */
  master?: boolean;
}

interface LoadedOptional {
  rows: PvpokeRankRow[];
  source: NonNullable<Meta["ulSource"]>;
  fetchedAt: number;
}

interface CachedOptional {
  rows: PvpokeRankRow[];
  fetchedAt: number;
}

function readOptionalCache(key: string, cap: number): CachedOptional | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: unknown; fetchedAt?: unknown };
    const rows = coerceRankRows(parsed.rows, cap);
    if (!rows || !Number.isFinite(parsed.fetchedAt)) return null;
    return { rows, fetchedAt: Number(parsed.fetchedAt) };
  } catch {
    return null;
  }
}

function writeOptionalCache(key: string, list: CachedOptional): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

const optionalInflight = new Map<string, Promise<LoadedOptional>>();

async function loadOptionalLeague(which: "ultra" | "master"): Promise<LoadedOptional> {
  const pending = optionalInflight.get(which);
  if (pending) return pending;
  const job = fetchOptionalLeague(which).finally(() => {
    optionalInflight.delete(which);
  });
  optionalInflight.set(which, job);
  return job;
}

async function fetchOptionalLeague(which: "ultra" | "master"): Promise<LoadedOptional> {
  const cap = which === "ultra" ? UL_LIST_CAP : ML_LIST_CAP;
  const key = which === "ultra" ? UL_CACHE_KEY : ML_CACHE_KEY;
  const url = which === "ultra" ? UL_RANKINGS_URL : ML_RANKINGS_URL;
  const canFetch = typeof fetch === "function" && typeof localStorage !== "undefined";
  if (!canFetch) return { rows: [], source: "missing", fetchedAt: 0 };

  const cached = readOptionalCache(key, cap);
  if (cached && Date.now() - cached.fetchedAt < PVPOKE_TTL_MS) {
    return { rows: cached.rows, source: "cache", fetchedAt: cached.fetchedAt };
  }
  try {
    const rows = await fetchRankingRows(url, cap);
    const fetchedAt = Date.now();
    writeOptionalCache(key, { rows, fetchedAt });
    return { rows, source: "live", fetchedAt };
  } catch {
    if (cached) return { rows: cached.rows, source: "cache", fetchedAt: cached.fetchedAt };
    return { rows: [], source: "missing", fetchedAt: 0 };
  }
}

/** PvPoke GL/LC lists (24h browser cache) plus vendored rank/raid gates. Ultra and Master lists load only when requested. */
export async function loadMeta(request?: LeagueListRequest): Promise<Meta> {
  const limited = toSet(listFile(limitedJson as NamedListFile));
  const legendary = toSet(legendaryJson as string[]);
  const mythical = toSet(mythicalJson as string[]);
  const evoEdges = loadEvolutionEdges(evolutionsJson);
  const typeMap = loadSpeciesTypes(speciesTypesJson);
  const { familyOf, evoReach } = buildFamilyIndex(evoEdges);
  const wantUltra = request?.ultra === true;
  const wantMaster = request?.master === true;
  const [lists, raidLive, ultra, master] = await Promise.all([
    loadPvpokeLists(),
    loadRaidLists(),
    wantUltra ? loadOptionalLeague("ultra") : Promise.resolve(null),
    wantMaster ? loadOptionalLeague("master") : Promise.resolve(null),
  ]);
  const raidEntries = entriesFromRaidFile(raidLive.file);
  const raidAttackers = toSet(
    raidEntries.filter(entryIsViable).map((entry) => entry.speciesId),
  );
  const raidEvolution = buildRaidEvolution(raidAttackers, evoEdges);
  return {
    glTop500: toSet(lists.gl.map((row) => row.speciesId)),
    lcTop100: toSet(lists.lc.map((row) => row.speciesId)),
    glRankings: lists.gl,
    lcRankings: lists.lc,
    ...(ultra
      ? { ulRankings: ultra.rows, ulSource: ultra.source, ulFetchedAt: ultra.fetchedAt || undefined }
      : {}),
    ...(master
      ? { mlRankings: master.rows, mlSource: master.source, mlFetchedAt: master.fetchedAt || undefined }
      : {}),
    raidAttackers,
    raidRankings: buildRaidRankings(raidEntries, raidEvolution, limited, legendary, mythical, typeMap),
    raidEvolution,
    familyOf,
    evoReach,
    limited,
    legendary,
    mythical,
    glEvolution: Object.fromEntries(
      Object.entries(glEvolutionJson as Record<string, string>).map(([k, v]) => [
        canonId(k),
        canonId(v),
      ]),
    ),
    pvpokeSource: lists.source,
    pvpokeFetchedAt: lists.fetchedAt || undefined,
    raidSource: raidLive.source,
    raidFetchedAt: raidLive.fetchedAt || undefined,
  };
}
