import type { Meta } from "./types";
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
const GL_CAP = 500;
const LC_CAP = 100;

interface NamedListFile {
  comment?: string;
  speciesIds: string[];
}

interface CachedLists {
  gl: string[];
  lc: string[];
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

function uniqueSpeciesIds(rows: unknown, cap: number): string[] {
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw =
      row && typeof row === "object" && "speciesId" in row
        ? String((row as { speciesId?: unknown }).speciesId ?? "")
        : "";
    const id = canonId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

function readPvpokeCache(): CachedLists | null {
  try {
    const raw = localStorage.getItem(PVPOKE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedLists;
    if (!Array.isArray(parsed.gl) || !Array.isArray(parsed.lc)) return null;
    if (!Number.isFinite(parsed.fetchedAt)) return null;
    return parsed;
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

async function fetchRankingIds(url: string, cap: number): Promise<string[]> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`PvPoke ${res.status}`);
  const ids = uniqueSpeciesIds(await res.json(), cap);
  if (ids.length < Math.min(20, cap)) throw new Error("PvPoke list too small");
  return ids;
}

function bundledLists(): CachedLists {
  return {
    gl: (glTop500Json as string[]).map(canonId),
    lc: (lcTop100Json as string[]).map(canonId),
    fetchedAt: 0,
  };
}

function cacheUsable(cached: CachedLists | null): cached is CachedLists {
  return Boolean(cached && cached.gl.length >= 20 && cached.lc.length >= 20);
}

type PvpokeLists = {
  gl: string[];
  lc: string[];
  source: NonNullable<Meta["pvpokeSource"]>;
  fetchedAt: number;
};

let pvpokeInflight: Promise<PvpokeLists> | null = null;

async function fetchLiveLists(stale: CachedLists | null): Promise<PvpokeLists> {
  const bundled = bundledLists();
  try {
    const [gl, lc] = await Promise.all([
      fetchRankingIds(GL_RANKINGS_URL, GL_CAP),
      fetchRankingIds(LC_RANKINGS_URL, LC_CAP),
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
    glTop500: toSet(lists.gl),
    lcTop100: toSet(lists.lc),
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
