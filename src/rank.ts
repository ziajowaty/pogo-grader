import type { LeagueRank, Mon, RaidSpRank } from "./types";
// @ts-ignore Vite JSON snapshots
import baseStatsJson from "../data/base-stats.json";
// @ts-ignore Vite JSON snapshots
import cpmJson from "../data/cpm.json";
// @ts-ignore Vite JSON snapshots
import glEvolutionJson from "../data/gl-evolution.json";

export const IV_COMBOS = 4096;
export const GREAT_LEAGUE_CAP = 1500;
export const LITTLE_CUP_CAP = 500;
export const RANK_LEVEL_CAP = 50;

export interface BaseStats {
  atk: number;
  def: number;
  hp: number;
}

export interface RankGm {
  baseStats: Record<string, BaseStats>;
  cpm: number[];
  glEvolution: Record<string, string>;
  levelCap?: number;
}

const baseStats = baseStatsJson as Record<string, BaseStats>;
const cpmTable = cpmJson as number[];
const defaultGlEvolution = glEvolutionJson as Record<string, string>;

const tableCache = new Map<string, { rank: Uint16Array; sp: Float64Array }>();

function canonId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

export function getRankGm(glEvolution?: Record<string, string>): RankGm {
  return {
    baseStats,
    cpm: cpmTable,
    glEvolution: glEvolution ?? defaultGlEvolution,
    levelCap: RANK_LEVEL_CAP,
  };
}

function stripShadow(id: string): string {
  return id.endsWith("_shadow") ? id.slice(0, -7) : id;
}

export function lookupBaseStats(speciesId: string, gm: RankGm): BaseStats | undefined {
  const id = canonId(speciesId);
  return gm.baseStats[id] ?? gm.baseStats[stripShadow(id)];
}

export function resolveGlSpeciesId(speciesId: string, gm: RankGm): string {
  const id = canonId(speciesId);
  return gm.glEvolution[id] ?? id;
}

function ivsOf(mon: Mon): { atk: number; def: number; sta: number } | null {
  if (!mon.ivUnique) return null;
  if (mon.atk == null || mon.def == null || mon.sta == null) return null;
  const atk = Math.round(mon.atk);
  const def = Math.round(mon.def);
  const sta = Math.round(mon.sta);
  if (![atk, def, sta].every((n) => n >= 0 && n <= 15)) return null;
  return { atk, def, sta };
}

function cpAt(cpm: number, atk: number, def: number, sta: number): number {
  const cp = Math.floor((atk * Math.sqrt(def) * Math.sqrt(sta) * cpm * cpm) / 10);
  return cp < 10 ? 10 : cp;
}

function maxCpmIndex(
  cpm: number[],
  cap: number,
  atk: number,
  def: number,
  sta: number,
  maxIdx: number,
): number {
  if (cpAt(cpm[maxIdx], atk, def, sta) <= cap) return maxIdx;
  if (cpAt(cpm[0], atk, def, sta) > cap) return -1;
  let lo = 0;
  let hi = maxIdx;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cpAt(cpm[mid], atk, def, sta) <= cap) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function buildTable(
  stats: BaseStats,
  cap: number,
  cpm: number[],
  maxIdx: number,
  shedinja: boolean,
): { rank: Uint16Array; sp: Float64Array } {
  const sp = new Float64Array(IV_COMBOS);
  for (let a = 0; a < 16; a++) {
    const atk = stats.atk + a;
    for (let d = 0; d < 16; d++) {
      const def = stats.def + d;
      for (let s = 0; s < 16; s++) {
        const sta = stats.hp + s;
        const idx = (a << 8) | (d << 4) | s;
        const li = maxCpmIndex(cpm, cap, atk, def, sta, maxIdx);
        if (li < 0) {
          sp[idx] = 0;
          continue;
        }
        const m = cpm[li];
        const pAtk = m * atk;
        const pDef = m * def;
        let hp = Math.floor(m * sta);
        if (hp < 10) hp = 10;
        if (shedinja) hp = 10;
        sp[idx] = pAtk * pDef * hp;
      }
    }
  }
  const ranked = Array.from({ length: IV_COMBOS }, (_, i) => i).sort(
    (i, j) => sp[j] - sp[i] || i - j,
  );
  const rank = new Uint16Array(IV_COMBOS);
  for (let i = 0; i < IV_COMBOS; ) {
    let j = i + 1;
    while (j < IV_COMBOS && sp[ranked[j]] === sp[ranked[i]]) j++;
    const r = i + 1;
    for (let k = i; k < j; k++) rank[ranked[k]] = r;
    i = j;
  }
  return { rank, sp };
}

function tableFor(
  stats: BaseStats,
  cap: number,
  gm: RankGm,
  shedinja: boolean,
): { rank: Uint16Array; sp: Float64Array } {
  const levelCap = gm.levelCap ?? RANK_LEVEL_CAP;
  const maxIdx = Math.min((levelCap - 1) * 2, gm.cpm.length - 1);
  const key = `${stats.atk},${stats.def},${stats.hp},${cap},${levelCap},${shedinja ? 1 : 0}`;
  let table = tableCache.get(key);
  if (!table) {
    table = buildTable(stats, cap, gm.cpm, maxIdx, shedinja);
    tableCache.set(key, table);
  }
  return table;
}

function rankAt(
  mon: Mon,
  gm: RankGm,
  speciesId: string,
  cap: number,
): LeagueRank | null {
  const ivs = ivsOf(mon);
  if (!ivs) return null;
  const stats = lookupBaseStats(speciesId, gm);
  if (!stats) return null;
  const shedinja = stripShadow(canonId(speciesId)) === "shedinja";
  const table = tableFor(stats, cap, gm, shedinja);
  const idx = (ivs.atk << 8) | (ivs.def << 4) | ivs.sta;
  return {
    rank: table.rank[idx],
    of: IV_COMBOS,
    statProduct: table.sp[idx],
    evoSpeciesId: speciesId,
  };
}

/** Great League 1500 CP rank for unique IVs, as the family GL evo when mapped. */
export function rankGreatLeague(mon: Mon, gm: RankGm): LeagueRank | null {
  return rankGreatLeagueAs(mon, gm, resolveGlSpeciesId(mon.speciesId, gm));
}

/** Rank this copy as an explicit species (pre-evo scored as each listed family stage). */
export function rankGreatLeagueAs(mon: Mon, gm: RankGm, speciesId: string): LeagueRank | null {
  return rankAt(mon, gm, canonId(speciesId), GREAT_LEAGUE_CAP);
}

/** Little Cup 500 CP rank for the unevolved form (no evo remap). */
export function rankLittleCup(mon: Mon, gm: RankGm): LeagueRank | null {
  return rankAt(mon, gm, canonId(mon.speciesId), LITTLE_CUP_CAP);
}

/** Uncapped raid stat product vs a hundo. Falls back to IV% when base stats are missing. */
export function raidStatProduct(mon: Mon, gm: RankGm, speciesId: string): RaidSpRank | null {
  const ivs = ivsOf(mon);
  if (!ivs) return null;
  const id = canonId(speciesId);
  const stats = lookupBaseStats(id, gm);
  const statProduct = stats
    ? (stats.atk + ivs.atk) * (stats.def + ivs.def) * (stats.hp + ivs.sta)
    : ivs.atk + ivs.def + ivs.sta;
  const maxStatProduct = stats
    ? (stats.atk + 15) * (stats.def + 15) * (stats.hp + 15)
    : 45;
  if (maxStatProduct <= 0) return null;
  return {
    percent: Math.round((statProduct / maxStatProduct) * 1000) / 10,
    statProduct,
    maxStatProduct,
    evoSpeciesId: id,
  };
}
