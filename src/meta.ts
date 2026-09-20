import type { Meta, PvpokeRankRow, RaidAttackerRow } from "./types";
import { GL_LIST_CAP, LC_LIST_CAP, prettySpeciesId } from "./types";
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

const DUMP_CAP = 100;
const PVPOKE_TTL_MS = 24 * 60 * 60 * 1000;
const PVPOKE_CACHE_KEY = "pogo-grader.pvpokeLists";
const GL_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-1500.json";
const LC_RANKINGS_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/little/overall/rankings-500.json";

interface NamedListFile {
  comment?: string;
  speciesIds: string[];
}

interface EvolutionFile {
  comment?: string;
  from?: Record<string, string[]>;
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

function buildRaidEvolution(raid: Set<string>, edges: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const from of Object.keys(edges)) {
    if (raidHit(from, raid)) continue;
    const pick = pickRaidTarget(from, reachableRaidHits(from, edges, raid));
    if (pick) out[from] = pick;
  }
  return out;
}

function buildRaidRankings(
  ids: string[],
  raidEvolution: Record<string, string>,
  limited: Set<string>,
  legendary: Set<string>,
  mythical: Set<string>,
): RaidAttackerRow[] {
  const seen = new Set<string>();
  const rows: RaidAttackerRow[] = [];
  for (const raw of ids) {
    const speciesId = canonId(raw);
    if (!speciesId || seen.has(speciesId)) continue;
    seen.add(speciesId);
    rows.push({
      speciesId,
      speciesName: prettySpeciesId(speciesId),
      tags: raidTags(speciesId, limited, legendary, mythical),
    });
  }
  for (const [from, to] of Object.entries(raidEvolution)) {
    if (!from || seen.has(from)) continue;
    seen.add(from);
    rows.push({
      speciesId: from,
      speciesName: prettySpeciesId(from),
      tags: raidTags(from, limited, legendary, mythical),
      asSpeciesId: to,
      asSpeciesName: prettySpeciesId(to),
    });
  }
  rows.sort((a, b) => a.speciesName.localeCompare(b.speciesName) || a.speciesId.localeCompare(b.speciesId));
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

/** PvPoke GL/LC lists (24h browser cache) plus vendored rank/raid gates. */
export async function loadMeta(): Promise<Meta> {
  const limited = toSet(listFile(limitedJson as NamedListFile));
  const legendary = toSet(legendaryJson as string[]);
  const mythical = toSet(mythicalJson as string[]);
  const raidIds = listFile(raidAttackersJson);
  const raidAttackers = toSet(raidIds);
  const evoEdges = loadEvolutionEdges(evolutionsJson);
  const raidEvolution = buildRaidEvolution(raidAttackers, evoEdges);
  const { familyOf, evoReach } = buildFamilyIndex(evoEdges);
  const lists = await loadPvpokeLists();
  return {
    glTop500: toSet(lists.gl.map((row) => row.speciesId)),
    lcTop100: toSet(lists.lc.map((row) => row.speciesId)),
    glRankings: lists.gl,
    lcRankings: lists.lc,
    raidAttackers,
    raidRankings: buildRaidRankings(raidIds, raidEvolution, limited, legendary, mythical),
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
    dumpCap: DUMP_CAP,
    pvpokeSource: lists.source,
    pvpokeFetchedAt: lists.fetchedAt || undefined,
  };
}
