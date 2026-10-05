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

export const POKEMON_TYPES = [
  "normal",
  "fire",
  "water",
  "grass",
  "electric",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

const POKEMON_TYPE_SET: ReadonlySet<string> = new Set(POKEMON_TYPES);

export function isPokemonType(value: string): value is PokemonType {
  return POKEMON_TYPE_SET.has(value);
}

export function prettyPokemonType(type: PokemonType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Raid ranking row. `rank` is best Dittobase eDPS across types (1 = best). */
export interface RaidAttackerRow {
  rank: number;
  /** Dittobase rank for that attacking move type (1 = best). Not renumbered. Pre-evos inherit the target. */
  typeRanks: Partial<Record<PokemonType, number>>;
  /** Dittobase tier for that move type. Pre-evos inherit the target. */
  typeTiers?: Partial<Record<PokemonType, string>>;
  /** False when every listed type is below A. Omitted rows count as raid KEEP. */
  viable?: boolean;
  speciesId: string;
  speciesName: string;
  tags: string[];
  types: PokemonType[];
  /** Raid attacker this pre-evo KEEPs as, when different from speciesId. */
  asSpeciesId?: string;
  asSpeciesName?: string;
  asTypes?: PokemonType[];
}

export interface MetaLeagueRank {
  rank: number;
  of: number;
  speciesId: string;
  speciesName: string;
}

/** Raid IV% ((atk+def+sta)/45) for a copy counted as a raid attacker. */
export interface RaidIvRank {
  percent: number;
  evoSpeciesId: string;
}

export interface GradedMon {
  mon: Mon;
  verdict: Verdict;
  reasons: string[];
  keepClasses: string[];
  gl?: LeagueRank | null;
  ul?: LeagueRank | null;
  ml?: LeagueRank | null;
  lc?: LeagueRank | null;
  /** Every independent GL stage this copy can become, best IV-rank first. */
  glAs?: LeagueRank[];
  /** Every independent Ultra League stage this copy can become, best IV-rank first. */
  ulAs?: LeagueRank[];
  /** Every independent Master League stage this copy can become, best IV-rank first. */
  mlAs?: LeagueRank[];
  /** PvPoke Great League overall placement (1 = best), even if outside the species cutoff. */
  glMeta?: MetaLeagueRank | null;
  /** PvPoke Ultra League overall placement (1 = best), even if outside the species cutoff. */
  ulMeta?: MetaLeagueRank | null;
  /** PvPoke Master League overall placement (1 = best), even if outside the species cutoff. */
  mlMeta?: MetaLeagueRank | null;
  /** PvPoke Little Cup overall placement (1 = best), even if outside the species cutoff. */
  lcMeta?: MetaLeagueRank | null;
  /** PvPoke GL placement for each independent stage in `glAs`. */
  glMetaAs?: MetaLeagueRank[];
  /** PvPoke Ultra placement for each independent stage in `ulAs`. */
  ulMetaAs?: MetaLeagueRank[];
  /** PvPoke Master placement for each independent stage in `mlAs`. */
  mlMetaAs?: MetaLeagueRank[];
  /** IV% for raid KEEP ((atk+def+sta)/45). */
  raidIv?: RaidIvRank | null;
  /**
   * Exclusive PvP/raid job for this copy (one job per Pokémon).
   * Bright leagues fill in `pvpFillOrder` (default Great, Ultra, Master, Little Cup).
   * Within a league, higher PvPoke species fill first (Dragonair before Dragonite).
   * Raid leftovers last. A faded league is not a job. Ultra and Master stay
   * faded until selected.
   */
  pvpJob?: PvpJob | null;
  /**
   * Seat this copy holds because nobody passed the KEEP bar.
   * It does not KEEP. One Pokémon still takes only one seat.
   */
  lookJob?: PvpJob | null;
  copiesInGroup: number;
  copyRankInGroup: number;
}

/** Leagues that can claim a PvP seat, in the default fill order. */
export const DEFAULT_PVP_FILL_ORDER = ["gl", "ul", "ml", "lc"] as const;
export type PvpLeague = (typeof DEFAULT_PVP_FILL_ORDER)[number];

export function isPvpLeague(value: string): value is PvpLeague {
  return (DEFAULT_PVP_FILL_ORDER as readonly string[]).includes(value);
}

/** A permutation of the four leagues. Unknown entries are dropped; missing leagues are appended in default order. */
export function normalizePvpFillOrder(raw: unknown): PvpLeague[] {
  const seen = new Set<PvpLeague>();
  const out: PvpLeague[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string" || !isPvpLeague(item) || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  for (const league of DEFAULT_PVP_FILL_ORDER) {
    if (!seen.has(league)) out.push(league);
  }
  return out;
}

/** One PvP or raid identity this copy is assigned to. */
export interface PvpJob {
  kind: "gl" | "ul" | "ml" | "lc" | "raid";
  speciesId: string;
  /** 1-based seat among copies assigned this same job. */
  seat: number;
  of: number;
}

export interface GradeResult {
  keep: GradedMon[];
  look: GradedMon[];
  dump: GradedMon[];
  /** Core CSV rows. Empty when no core file was graded. Not part of the scan tracks. */
  core: GradedMon[];
  /** GL/LC KEEP only if 4096-rank is this or better (1 = best). */
  pvpRankKeep: number;
  /** Species in PvPoke GL overall this far down count as PvP. Rank 1 is best. */
  pvpListKeep: number;
  /** When true, every species with stats is PvP-viable. The GL top-N cutoff is ignored. */
  pvpAny: boolean;
  /** Copies kept per Great League stage and per Little Cup species. */
  pvpKeep: number;
  /** Copies kept of each family's raid attacker. Independent of `pvpKeep`. */
  raidKeep: number;
  /** Raid KEEP only if IV% is this or better. 0 keeps any IV. */
  raidIvKeep: number;
  /** When true, every eligible 4* / raid / PvP-floor copy KEEPs. When false, extras are dupes. */
  keepAllGood: boolean;
  /** When true, lucky KEEPs. When false, luckies must earn KEEP another way and extras can DUMP. */
  keepLucky: boolean;
  /** When true, a favorite KEEPs. When false, a star is not protected and can DUMP if other rules do not save it. */
  keepFavorite: boolean;
  /** When true, every shadow KEEPs. When false, a shadow must earn KEEP another way; useless copies can DUMP. */
  keepShadow: boolean;
  /** When true, Great League is a KEEP job. When false, good GL IVs do not KEEP. */
  keepGl: boolean;
  /** When true, Little Cup is a KEEP job. When false, good LC IVs do not KEEP. */
  keepLc: boolean;
  /** When true, Ultra League is a KEEP job. Default false. */
  keepUl: boolean;
  /** When true, Master League is a KEEP job. Default false. */
  keepMl: boolean;
  /** League fill order used for this grade. Raid stays after these. */
  pvpFillOrder: PvpLeague[];
  groups: Array<{
    key: string;
    size: number;
    kept: number;
  }>;
}

export interface Meta {
  glTop500: Set<string>;
  lcTop100: Set<string>;
  /** Ordered PvPoke GL overall list (up to the species cap). */
  glRankings?: PvpokeRankRow[];
  /** Ordered PvPoke Little Cup overall list (up to the species cap). */
  lcRankings?: PvpokeRankRow[];
  /** Ordered PvPoke Ultra League overall list. Present only after Ultra is selected. */
  ulRankings?: PvpokeRankRow[];
  /** Ordered PvPoke Master League overall list. Present only after Master is selected. */
  mlRankings?: PvpokeRankRow[];
  ulSource?: "live" | "cache" | "missing";
  mlSource?: "live" | "cache" | "missing";
  ulFetchedAt?: number;
  mlFetchedAt?: number;
  raidAttackers: Set<string>;
  /** Dittobase raid rankings (eDPS order, then pre-evos). Includes rows below the A-tier KEEP line. */
  raidRankings?: RaidAttackerRow[];
  /** unevolved -> family raid attacker id */
  raidEvolution?: Record<string, string>;
  limited: Set<string>;
  legendary: Set<string>;
  mythical: Set<string>;
  /** unevolved -> family GL evo id */
  glEvolution: Record<string, string>;
  /** Evolution-graph family id (min member). Shadows are their own family. */
  familyOf?: Record<string, string>;
  /** Forward-reachable evo ids including self. */
  evoReach?: Record<string, string[]>;
  /** Keep GL/LC IVs at this rank or better. Rank 1 is best. Default 500. */
  pvpRankKeep?: number;
  /** Keep PvPoke species this far down in each league, including Little Cup. Rank 1 is best. Default 500. Ignored when `pvpAny`. */
  pvpListKeep?: number;
  /**
   * When true, Great League is any species with base stats (not only the PvPoke list),
   * and Little Cup is any unevolved species that can still evolve (not only the Little Cup list).
   * IV floor (`pvpRankKeep`) still applies. Default false.
   */
  pvpAny?: boolean;
  /**
   * Copies kept per PvP job: each PvPoke Great League stage and each Little Cup
   * species. 1–3, default 1. Higher PvPoke GL stages fill first.
   * Does not cap raid attackers (`raidKeep`).
   * `keepAllGood` still keeps every hundo; it does not add extra copies of the same job.
   */
  pvpKeep?: number;
  /**
   * Copies kept of each family's raid attacker. 1–12, default 1.
   * Highest attack fills first. Independent of `pvpKeep`.
   * Limited raid species still KEEP every copy. `keepAllGood` still keeps every hundo.
   */
  raidKeep?: number;
  /**
   * Raid KEEP only if IV% ((atk+def+sta)/45) is at least this. 0 keeps any IV.
   * Default 90.
   */
  raidIvKeep?: number;
  /**
   * Keep every eligible good copy (all 4*, all raid attackers, all PvP-floor IVs).
   * Off = one job per copy (`pvpKeep` per GL stage and LC species, `raidKeep` per
   * raid attacker, plus 1 hundo per family). On still does not duplicate a filled job.
   */
  keepAllGood?: boolean;
  /**
   * Keep luckies. Off = luckies LOOK/DUMP unless another keep class fires.
   * Default true.
   */
  keepLucky?: boolean;
  /**
   * Keep favorites. Off = the star does not protect the copy. Other KEEP rules
   * still apply, and a star that fails them can DUMP. Default true.
   */
  keepFavorite?: boolean;
  /**
   * Keep every shadow. Off = shadow is not a keep class and is not dump-protected.
   * Useless copies can DUMP. Other KEEP rules still apply. Default true.
   */
  keepShadow?: boolean;
  /**
   * When false, Great League is not a KEEP job. Good GL IVs do not KEEP
   * and do not count as a PvP floor. Default true.
   */
  keepGl?: boolean;
  /**
   * When false, Little Cup is not a KEEP job. Good LC IVs do not KEEP
   * and do not count as a PvP floor. Default true.
   */
  keepLc?: boolean;
  /**
   * When true, Ultra League is a KEEP job. Good UL IVs can KEEP and count as a
   * PvP floor. Default false. Rankings are fetched only while this is on.
   */
  keepUl?: boolean;
  /**
   * When true, Master League is a KEEP job. Good ML IVs can KEEP and count as a
   * PvP floor. Default false. Rankings are fetched only while this is on.
   */
  keepMl?: boolean;
  /**
   * Order in which bright leagues claim a copy. Faded leagues stay in the list
   * and are skipped. Within a league, better PvPoke species still fill first.
   * Raid seats stay after every league. Default Great League, Ultra League,
   * Master League, Little Cup.
   */
  pvpFillOrder?: PvpLeague[];
  /** How KEEP PvP species lists were loaded. */
  pvpokeSource?: "live" | "cache" | "bundled";
  pvpokeFetchedAt?: number;
  /** How the raid list was loaded (Dittobase live, then cache, then the vendored snapshot). */
  raidSource?: "live" | "cache" | "bundled";
  raidFetchedAt?: number;
}

/** Rank 1 is best. Keep GL/LC copies at this rank or better. */
export const DEFAULT_PVP_RANK_KEEP = 500;
export const PVP_RANK_OF = 4096;

/** Unique species kept from one PvPoke ranking file, and the species-cutoff maximum. */
export const PVP_LIST_CAP = 1000;
export const GL_LIST_CAP = PVP_LIST_CAP;
export const UL_LIST_CAP = PVP_LIST_CAP;
export const ML_LIST_CAP = PVP_LIST_CAP;
export const LC_LIST_CAP = PVP_LIST_CAP;
export const DEFAULT_PVP_LIST_KEEP = 500;
/** Off: only the PvPoke GL/LC lists count. On: any species with stats can be PvP. */
export const DEFAULT_PVP_ANY = false;

/** Copies kept per Great League stage and Little Cup species. */
export const DEFAULT_PVP_KEEP = 1;
export const PVP_KEEP_MIN = 1;
export const PVP_KEEP_MAX = 3;

/** Copies kept of each family's raid attacker. */
export const DEFAULT_RAID_KEEP = 1;
export const RAID_KEEP_MIN = 1;
export const RAID_KEEP_MAX = 12;

export const DEFAULT_KEEP_LUCKY = true;
export const DEFAULT_KEEP_FAVORITE = true;
export const DEFAULT_KEEP_SHADOW = true;
/** Great League and Little Cup both KEEP until faded. */
export const DEFAULT_KEEP_GL = true;
export const DEFAULT_KEEP_LC = true;
/** Ultra League and Master League stay off until selected. */
export const DEFAULT_KEEP_UL = false;
export const DEFAULT_KEEP_ML = false;
export const DEFAULT_RAID_IV_KEEP = 90;
export const RAID_IV_KEEP_MIN = 0;
export const RAID_IV_KEEP_MAX = 100;

export function clampPvpRankKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PVP_RANK_KEEP;
  return Math.min(PVP_RANK_OF, Math.max(1, Math.round(v)));
}

export function clampPvpListKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PVP_LIST_KEEP;
  return Math.min(PVP_LIST_CAP, Math.max(1, Math.round(v)));
}

export function clampPvpKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PVP_KEEP;
  return Math.min(PVP_KEEP_MAX, Math.max(PVP_KEEP_MIN, Math.round(v)));
}

export function clampRaidKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_RAID_KEEP;
  return Math.min(RAID_KEEP_MAX, Math.max(RAID_KEEP_MIN, Math.round(v)));
}

export function prettySpeciesId(id: string): string {
  return id
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function clampRaidIvKeep(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_RAID_IV_KEEP;
  return Math.min(RAID_IV_KEEP_MAX, Math.max(RAID_IV_KEEP_MIN, Math.round(v)));
}
