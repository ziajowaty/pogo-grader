/** Locked contract. Other modules import this; do not fork duplicate types. */

export type Verdict = "KEEP" | "LOOK" | "DUMP";

export type Gender = "male" | "female" | "unknown";

export interface Mon {
  source: "calcyiv" | "pokegenie" | "unknown";
  sourceRow: number;
  speciesName: string;
  /** PvPoke-style id when resolved, e.g. quagsire_shadow */
  speciesId: string;
  dex?: number;
  form: string;
  gender: Gender;
  cp: number;
  hp: number;
  atk?: number;
  def?: number;
  sta?: number;
  ivUnique: boolean;
  ivPercent?: number;
  level?: number;
  shiny?: boolean;
  shadow: boolean;
  purified: boolean;
  lucky?: boolean;
  favorite?: boolean;
  costume?: boolean;
  background?: boolean;
  legendary?: boolean;
  mythical?: boolean;
  nickname?: string;
  fastMove?: string;
  chargedMove?: string;
  chargedMove2?: string;
  hasSpecialMove?: boolean;
  catchDate?: string;
  scanDate?: string;
}

export interface ParseIssue {
  row: number;
  message: string;
}

export interface ParseResult {
  dialect: "calcyiv" | "pokegenie" | "unknown";
  mons: Mon[];
  issues: ParseIssue[];
}

export interface LeagueRank {
  rank: number;
  of: number;
  statProduct: number;
  /** Evolution used for the rank (e.g. seismitoad). */
  evoSpeciesId: string;
}

export interface GradedMon {
  mon: Mon;
  verdict: Verdict;
  reasons: string[];
  keepClasses: string[];
  gl?: LeagueRank | null;
  lc?: LeagueRank | null;
  copiesInGroup: number;
  copyRankInGroup: number;
}

export interface GradeResult {
  keep: GradedMon[];
  look: GradedMon[];
  dump: GradedMon[];
  dumpCap: number;
  dumpCapped: boolean;
  /** GL/LC KEEP only if 4096-rank is this or better (1 = best). */
  pvpRankKeep: number;
  /** When true, every eligible 4* / raid / PvP-floor copy KEEPs. When false, extras are dupes. */
  keepAllGood: boolean;
  groups: Array<{
    key: string;
    size: number;
    kept: number;
  }>;
}

export interface Meta {
  glTop500: Set<string>;
  lcTop100: Set<string>;
  raidAttackers: Set<string>;
  limited: Set<string>;
  legendary: Set<string>;
  mythical: Set<string>;
  /** unevolved -> family GL evo id */
  glEvolution: Record<string, string>;
  dumpCap: number;
  /** Keep GL/LC IVs at this rank or better. Rank 1 is best. Default 500. */
  pvpRankKeep?: number;
  /**
   * Keep every eligible good copy (all 4*, all raid attackers, all PvP-floor IVs).
   * Off = treat extra good copies as dupes (2 GL, 2 LC, 6 raid, 1 hundo per species).
   */
  keepAllGood?: boolean;
  /** How KEEP PvP species lists were loaded. */
  pvpokeSource?: "live" | "cache" | "bundled";
  pvpokeFetchedAt?: number;
}

/** Rank 1 is best. Keep GL/LC copies at this rank or better. */
export const DEFAULT_PVP_RANK_KEEP = 500;
export const PVP_RANK_OF = 4096;

export function clampPvpRankKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PVP_RANK_KEEP;
  return Math.min(PVP_RANK_OF, Math.max(1, Math.round(v)));
}
