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
  dynamax?: boolean;
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

export interface PvpokeRankRow {
  rank: number;
  speciesId: string;
  speciesName: string;
  score?: number;
}

export interface MetaLeagueRank {
  rank: number;
  of: number;
  speciesId: string;
  speciesName: string;
}

export interface GradedMon {
  mon: Mon;
  verdict: Verdict;
  reasons: string[];
  keepClasses: string[];
  gl?: LeagueRank | null;
  lc?: LeagueRank | null;
  /** PvPoke Great League overall placement (1 = best), even if outside the species cutoff. */
  glMeta?: MetaLeagueRank | null;
  /** PvPoke Little Cup overall placement (1 = best), even if outside the species cutoff. */
  lcMeta?: MetaLeagueRank | null;
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
  /** Species in PvPoke GL overall this far down count as PvP. Rank 1 is best. */
  pvpListKeep: number;
  /** LOOK this many best copies of a PvP/raid family with no KEEP; extras DUMP. */
  familyKeep: number;
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
  /** Ordered PvPoke GL overall list (up to 500 unique species). */
  glRankings?: PvpokeRankRow[];
  /** Ordered PvPoke Little Cup overall list (up to 100 unique species). */
  lcRankings?: PvpokeRankRow[];
  raidAttackers: Set<string>;
  limited: Set<string>;
  legendary: Set<string>;
  mythical: Set<string>;
  /** unevolved -> family GL evo id */
  glEvolution: Record<string, string>;
  dumpCap: number;
  /** Keep GL/LC IVs at this rank or better. Rank 1 is best. Default 500. */
  pvpRankKeep?: number;
  /** Keep PvPoke GL overall species this far down. Rank 1 is best. Default 500. */
  pvpListKeep?: number;
  /**
   * When a PvP/raid family has no KEEP, LOOK this many best copies and DUMP the rest.
   * Default 2. Does not change KEEP slot caps (2 GL, 2 LC, 6 raid).
   */
  familyKeep?: number;
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

/** How far down PvPoke GL overall a species still counts as PvP. */
export const GL_LIST_CAP = 500;
export const LC_LIST_CAP = 100;
export const DEFAULT_PVP_LIST_KEEP = 500;

/** Best copies to LOOK in a PvP/raid family that has no KEEP. */
export const DEFAULT_FAMILY_KEEP = 2;
export const FAMILY_KEEP_MAX = 99;

export function clampPvpRankKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PVP_RANK_KEEP;
  return Math.min(PVP_RANK_OF, Math.max(1, Math.round(v)));
}

export function clampPvpListKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PVP_LIST_KEEP;
  return Math.min(GL_LIST_CAP, Math.max(1, Math.round(v)));
}

export function prettySpeciesId(id: string): string {
  return id
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function clampFamilyKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_FAMILY_KEEP;
  return Math.min(FAMILY_KEEP_MAX, Math.max(1, Math.round(v)));
}
