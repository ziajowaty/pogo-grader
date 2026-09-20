import type { Meta, PvpokeRankRow } from "./types";
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
  const limited = limitedJson as NamedListFile;
  const lists = await loadPvpokeLists();
  return {
    glTop500: toSet(lists.gl.map((row) => row.speciesId)),
    lcTop100: toSet(lists.lc.map((row) => row.speciesId)),
    glRankings: lists.gl,
    lcRankings: lists.lc,
    raidAttackers: toSet(listFile(raidAttackersJson)),
    limited: toSet(listFile(limited)),
    legendary: toSet(legendaryJson as string[]),
    mythical: toSet(mythicalJson as string[]),
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
