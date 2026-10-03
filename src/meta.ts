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
const PVPOKE_CACHE_KEY = "pogo-grader.pvpokeLists";
const RAID_TTL_MS = 24 * 60 * 60 * 1000;
const RAID_CACHE_KEY = "pogo-grader.raidAttackers";
const RAID_LIVE_MIN = 40;
const GL_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-1500.json";
const LC_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/little/overall/rankings-500.json";
const UL_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-2500.json";
const ML_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-10000.json";
const UL_CACHE_KEY = "pogo-grader.pvpokeUltra";
const ML_CACHE_KEY = "pogo-grader.pvpokeMaster";
const POKEBATTLER_ATTACKERS_QUERY =
  "shadow=true&mega=true&legendary=true&partyPower=false&sort=points&selectedType=POKEMON_TYPE_ALL&moveType=POKEMON_TYPE_ALL";
export const POKEBATTLER_ATTACKERS_URL = `https://www.pokebattler.com/api/attackers.json?${POKEBATTLER_ATTACKERS_QUERY}`;
export const POKEBATTLER_UA = "pogo-grader/0.1 (raid attacker cache; https://github.com/ziajowaty/pogo-grader)";

/** Pokébattler omits the default form suffix that PvPoke-style ids use. */
const POKEBATTLER_DEFAULT_FORM: Record<string, string> = {
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

/** Map a Pokébattler `pokemonId` (e.g. `MACHAMP_SHADOW_FORM`) onto grader `speciesId`. */
export function pokebattlerToCanonId(raw: string): string {
  let id = canonId(raw);
  if (!id) return "";
  const shadow = /_shadow(?:_form)?$/.test(id);
  id = id.replace(/_shadow_form$/, "").replace(/_shadow$/, "");
  id = id.replace(/_form$/, "");
  id = id.replace(/_alola(?=_|$)/g, "_alolan");
  id = id.replace(/_galar(?=_|$)/g, "_galarian");
  id = id.replace(/_hisui(?=_|$)/g, "_hisuian");
  id = id.replace(/_paldea(?=_|$)/g, "_paldean");
  if (POKEBATTLER_DEFAULT_FORM[id]) id = POKEBATTLER_DEFAULT_FORM[id];
  if (shadow && !id.endsWith("_shadow")) id = `${id}_shadow`;
  return id;
}

function pokebattlerType(raw: unknown): PokemonType | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/^pokemon_type_/i, "").toLowerCase();
  return isPokemonType(t) ? t : null;
}

export interface PokebattlerAttackers {
  ids: string[];
  types: Record<string, PokemonType[]>;
}

/** Unique species from Pokébattler `/api/attackers.json`, first occurrence wins. */
export function parsePokebattlerAttackers(raw: unknown): PokebattlerAttackers {
  if (!Array.isArray(raw)) return { ids: [], types: {} };
  const ids: string[] = [];
  const seen = new Set<string>();
  const types: Record<string, PokemonType[]> = {};
  for (const row of raw) {
    if (!row || typeof row !== "object" || !("pokemonId" in row)) continue;
    const id = pokebattlerToCanonId(String((row as { pokemonId?: unknown }).pokemonId ?? ""));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    const rec = row as { type?: unknown; type2?: unknown };
    const t1 = pokebattlerType(rec.type);
    const t2 = pokebattlerType(rec.type2);
    const pair = [t1, t2].filter((t): t is PokemonType => t != null);
    if (pair.length && !id.endsWith("_shadow")) types[id] = pair;
  }
  return { ids, types };
}

export function unionUniqueIds(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const id = canonId(raw);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function pokebattlerAttackersUrl(): string {
  if (typeof window !== "undefined" && import.meta.env?.DEV) {
    return `/pb-api/attackers.json?${POKEBATTLER_ATTACKERS_QUERY}`;
  }
  return POKEBATTLER_ATTACKERS_URL;
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
  return out;
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

function fillTypeRanks(rows: RaidAttackerRow[]): void {
  for (const row of rows) row.typeRanks = {};
  const finals = rows.filter((row) => !row.asSpeciesId);
  for (const type of POKEMON_TYPES) {
    let n = 0;
    const byId = new Map<string, number>();
    for (const row of finals) {
      if (!row.types.includes(type)) continue;
      n += 1;
      byId.set(row.speciesId, n);
      row.typeRanks[type] = n;
    }
    for (const row of rows) {
      if (!row.asSpeciesId) continue;
      const inherited = byId.get(row.asSpeciesId);
      if (inherited == null) continue;
      if (row.asTypes?.includes(type) || row.types.includes(type)) {
        row.typeRanks[type] = inherited;
      }
    }
  }
}

function buildRaidRankings(
  ids: string[],
  raidEvolution: Record<string, string>,
  limited: Set<string>,
  legendary: Set<string>,
  mythical: Set<string>,
  typeMap: Record<string, PokemonType[]>,
): RaidAttackerRow[] {
  const seen = new Set<string>();
  const rankOf = new Map<string, number>();
  const rows: RaidAttackerRow[] = [];
  let rank = 0;
  for (const raw of ids) {
    const speciesId = canonId(raw);
    if (!speciesId || seen.has(speciesId)) continue;
    seen.add(speciesId);
    rank += 1;
    rankOf.set(speciesId, rank);
    rows.push({
      rank,
      typeRanks: {},
      speciesId,
      speciesName: prettySpeciesId(speciesId),
      tags: raidTags(speciesId, limited, legendary, mythical),
      types: typesOf(speciesId, typeMap),
    });
  }
  for (const [from, to] of Object.entries(raidEvolution)) {
    if (!from || seen.has(from)) continue;
    seen.add(from);
    rows.push({
      rank: rankOf.get(to) ?? rank + 1,
      typeRanks: {},
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
  fillTypeRanks(rows);
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

interface CachedRaidList {
  ids: string[];
  types: Record<string, PokemonType[]>;
  fetchedAt: number;
}

type RaidLists = {
  ids: string[];
  types: Record<string, PokemonType[]>;
  source: NonNullable<Meta["raidSource"]>;
  fetchedAt: number;
};

let raidInflight: Promise<RaidLists> | null = null;

function raidCacheUsable(cached: CachedRaidList | null): cached is CachedRaidList {
  return Boolean(cached && cached.ids.length >= RAID_LIVE_MIN);
}

function readRaidCache(): CachedRaidList | null {
  try {
    const raw = localStorage.getItem(RAID_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ids?: unknown; types?: unknown; fetchedAt?: unknown };
    if (!Array.isArray(parsed.ids) || !Number.isFinite(parsed.fetchedAt)) return null;
    const ids = parsed.ids.map((id) => canonId(String(id))).filter(Boolean);
    if (ids.length < RAID_LIVE_MIN) return null;
    const types: Record<string, PokemonType[]> = {};
    if (parsed.types && typeof parsed.types === "object") {
      for (const [key, val] of Object.entries(parsed.types as Record<string, unknown>)) {
        if (!Array.isArray(val)) continue;
        const cleaned = val.filter((t): t is PokemonType => typeof t === "string" && isPokemonType(t));
        if (cleaned.length) types[canonId(key)] = cleaned;
      }
    }
    return { ids, types, fetchedAt: Number(parsed.fetchedAt) };
  } catch {
    return null;
  }
}

function writeRaidCache(list: CachedRaidList): void {
  try {
    localStorage.setItem(RAID_CACHE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

async function fetchPokebattlerAttackers(): Promise<PokebattlerAttackers> {
  const headers: Record<string, string> = {};
  if (typeof window === "undefined") headers["User-Agent"] = POKEBATTLER_UA;
  const res = await fetch(pokebattlerAttackersUrl(), { cache: "no-cache", headers });
  if (!res.ok) throw new Error(`Pokébattler ${res.status}`);
  const parsed = parsePokebattlerAttackers(await res.json());
  if (parsed.ids.length < RAID_LIVE_MIN) throw new Error("Pokébattler attacker list too small");
  return parsed;
}

async function fetchLiveRaid(stale: CachedRaidList | null): Promise<RaidLists> {
  try {
    const live = await fetchPokebattlerAttackers();
    const fetchedAt = Date.now();
    writeRaidCache({ ids: live.ids, types: live.types, fetchedAt });
    return { ids: live.ids, types: live.types, fetchedAt, source: "live" };
  } catch {
    if (raidCacheUsable(stale)) {
      return { ids: stale.ids, types: stale.types, fetchedAt: stale.fetchedAt, source: "cache" };
    }
    return { ids: [], types: {}, fetchedAt: 0, source: "bundled" };
  }
}

async function loadRaidLists(): Promise<RaidLists> {
  const canFetch = typeof fetch === "function" && typeof localStorage !== "undefined";
  if (!canFetch) {
    return { ids: [], types: {}, fetchedAt: 0, source: "bundled" };
  }

  const cached = readRaidCache();
  if (raidCacheUsable(cached) && Date.now() - cached.fetchedAt < RAID_TTL_MS) {
    return { ids: cached.ids, types: cached.types, fetchedAt: cached.fetchedAt, source: "cache" };
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
  const bundledRaidIds = listFile(raidAttackersJson);
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
  const raidIds = unionUniqueIds(raidLive.ids, bundledRaidIds);
  const raidAttackers = toSet(raidIds);
  const raidTypeMap = { ...typeMap, ...raidLive.types };
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
    raidRankings: buildRaidRankings(raidIds, raidEvolution, limited, legendary, mythical, raidTypeMap),
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
