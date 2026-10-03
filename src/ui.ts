import type {
  GradeResult,
  GradedMon,
  Meta,
  ParseResult,
  PokemonType,
  PvpokeRankRow,
  RaidAttackerRow,
  Verdict,
} from "./types";
import { viableRaidTier } from "./dittobase";
import {
  clampFamilyKeep,
  clampPvpKeep,
  clampPvpListKeep,
  clampPvpRankKeep,
  clampRaidIvKeep,
  clampRaidKeep,
  DEFAULT_FAMILY_KEEP,
  DEFAULT_KEEP_FAVORITE,
  DEFAULT_KEEP_GL,
  DEFAULT_KEEP_LC,
  DEFAULT_KEEP_ML,
  DEFAULT_KEEP_UL,
  DEFAULT_KEEP_LUCKY,
  DEFAULT_KEEP_SHADOW,
  DEFAULT_PVP_ANY,
  DEFAULT_PVP_KEEP,
  DEFAULT_PVP_LIST_KEEP,
  DEFAULT_PVP_RANK_KEEP,
  DEFAULT_RAID_IV_KEEP,
  DEFAULT_RAID_KEEP,
  FAMILY_KEEP_MAX,
  FAMILY_KEEP_MIN,
  GL_LIST_CAP,
  isPokemonType,
  LC_LIST_CAP,
  ML_LIST_CAP,
  UL_LIST_CAP,
  POKEMON_TYPES,
  prettyPokemonType,
  prettySpeciesId,
  PVP_KEEP_MAX,
  PVP_KEEP_MIN,
  PVP_RANK_OF,
  RAID_IV_KEEP_MAX,
  RAID_IV_KEEP_MIN,
  RAID_KEEP_MAX,
  RAID_KEEP_MIN,
} from "./types";
import { compareScanStream } from "./grade";
import { familyIdsMatchingQuery, rankingsRowMatches } from "./meta";
import { clearLastCsv, loadLastCsv, saveLastCsv } from "./lastCsv";
import { fitsLeagueCap, getRankGm, GREAT_LEAGUE_CAP, MASTER_LEAGUE_CAP, ULTRA_LEAGUE_CAP } from "./rank";

function skipScanString(opts: { keepLucky?: boolean; keepFavorite?: boolean } = {}): string {
  const keepLucky = opts.keepLucky !== false;
  const keepFavorite = opts.keepFavorite !== false;
  return [
    "!shiny",
    "!legendary",
    "!mythical",
    "!ultrabeast",
    ...(keepLucky ? ["!lucky"] : []),
    "!costume",
    "!background",
    "!4*",
    "!dynamax",
    "!gigantamax",
    ...(keepFavorite ? ["!favorite"] : []),
    "!#",
  ].join("&");
}

const SKIP_SCAN = skipScanString();
const LIST_PAINT_MAX = 200;
const RANK_PRESETS = [50, 150, 500, 4096] as const;
const LIST_KEEP_PRESETS = [100, 200, 300, 500] as const;
const PVP_KEEP_PRESETS = [1, 2, 3] as const;
const RAID_KEEP_PRESETS = [1, 3, 6, 12] as const;
const FAMILY_KEEP_PRESETS = [FAMILY_KEEP_MIN, 1, 2, 6, FAMILY_KEEP_MAX] as const;
const RAID_IV_PRESETS = [RAID_IV_KEEP_MIN, 80, 90, 95, RAID_IV_KEEP_MAX] as const;
const RANK_KEEP_KEY = "pogo-grader.pvpRankKeep";
const LIST_KEEP_KEY = "pogo-grader.pvpListKeep";
const PVP_ANY_KEY = "pogo-grader.pvpAny";
const PVP_KEEP_KEY = "pogo-grader.pvpKeep.v2";
const RAID_KEEP_KEY = "pogo-grader.raidKeep";
const FAMILY_KEEP_KEY = "pogo-grader.familyKeep";
const RAID_IV_KEEP_KEY = "pogo-grader.raidIvKeep";
const RAID_IV_KEEP_KEY_LEGACY = "pogo-grader.raidSpKeep";
const KEEP_ALL_GOOD_KEY = "pogo-grader.keepAllGood";
const KEEP_LUCKY_KEY = "pogo-grader.keepLucky";
const KEEP_FAVORITE_KEY = "pogo-grader.keepFavorite";
const KEEP_SHADOW_KEY = "pogo-grader.keepShadow";
const KEEP_GL_KEY = "pogo-grader.keepGl";
const KEEP_LC_KEY = "pogo-grader.keepLc";
const KEEP_UL_KEY = "pogo-grader.keepUl";
const KEEP_ML_KEY = "pogo-grader.keepMl";
const PIN_DETAIL_KEY = "pogo-grader.pinDetail";
const TAB_KEY = "pogo-grader.tab";
const BOX_FILTER_KEY = "pogo-grader.boxFilter";

type Tab = Verdict | "BOX";
type RankingsTab = "gl" | "ul" | "ml" | "lc" | "raid";
type BoxSort = "cp" | "scan";
type BoxFilter = Record<Verdict, boolean>;

const BOX_DISMISS_PREFIX = "pogo-grader.boxDismissed.";

interface Engine {
  parseInventoryCsv: (text: string) => ParseResult;
  gradeBox: (mons: ParseResult["mons"], meta: Meta) => GradeResult;
  loadMeta: (request?: { ultra?: boolean; master?: boolean }) => Promise<Meta>;
}

interface AppState {
  tab: Tab;
  result: GradeResult | null;
  parse: ParseResult | null;
  fileName: string;
  error: string;
  busy: string;
  engine: Engine | null;
  meta: Meta | null;
  pvpRankKeep: number;
  pvpListKeep: number;
  pvpAny: boolean;
  pvpKeep: number;
  raidKeep: number;
  familyKeep: number;
  raidIvKeep: number;
  keepAllGood: boolean;
  keepLucky: boolean;
  keepFavorite: boolean;
  keepShadow: boolean;
  keepGl: boolean;
  keepLc: boolean;
  keepUl: boolean;
  keepMl: boolean;
  pinDetail: boolean;
  rankingsTab: RankingsTab;
  rankingsFilter: string;
  rankingsRaidType: PokemonType | "";
  boxSort: BoxSort;
  /** Which verdicts the LIST grid draws. Off hides that group from this grid only. */
  boxFilter: BoxFilter;
  /** sourceRow values removed from the list and tracks. Last removed is last. */
  dismissed: number[];
  boxSelected: number | null;
  boxFileKey: string;
}

function readStoredRankKeep(): number {
  try {
    const raw = localStorage.getItem(RANK_KEEP_KEY);
    if (raw == null || raw === "") return DEFAULT_PVP_RANK_KEEP;
    return clampPvpRankKeep(Number(raw));
  } catch {
    return DEFAULT_PVP_RANK_KEEP;
  }
}

function readStoredListKeep(): number {
  try {
    const raw = localStorage.getItem(LIST_KEEP_KEY);
    if (raw == null || raw === "") return DEFAULT_PVP_LIST_KEEP;
    return clampPvpListKeep(Number(raw));
  } catch {
    return DEFAULT_PVP_LIST_KEEP;
  }
}

function readStoredPvpAny(): boolean {
  try {
    const raw = localStorage.getItem(PVP_ANY_KEY);
    if (raw == null || raw === "") return DEFAULT_PVP_ANY;
    return raw === "1";
  } catch {
    return DEFAULT_PVP_ANY;
  }
}

function readStoredPvpKeep(): number {
  try {
    const raw = localStorage.getItem(PVP_KEEP_KEY);
    if (raw == null || raw === "") return DEFAULT_PVP_KEEP;
    return clampPvpKeep(Number(raw));
  } catch {
    return DEFAULT_PVP_KEEP;
  }
}

function readStoredRaidKeep(): number {
  try {
    const raw = localStorage.getItem(RAID_KEEP_KEY);
    if (raw != null && raw !== "") return clampRaidKeep(Number(raw));
    const legacy = localStorage.getItem(PVP_KEEP_KEY);
    const next = legacy != null && legacy !== "" ? clampRaidKeep(Number(legacy)) : DEFAULT_RAID_KEEP;
    try {
      localStorage.setItem(RAID_KEEP_KEY, String(next));
    } catch {
      /* private mode */
    }
    return next;
  } catch {
    return DEFAULT_RAID_KEEP;
  }
}

function readStoredFamilyKeep(): number {
  try {
    const raw = localStorage.getItem(FAMILY_KEEP_KEY);
    if (raw == null || raw === "") return DEFAULT_FAMILY_KEEP;
    return clampFamilyKeep(Number(raw));
  } catch {
    return DEFAULT_FAMILY_KEEP;
  }
}

function readStoredRaidIvKeep(): number {
  try {
    const raw = localStorage.getItem(RAID_IV_KEEP_KEY) ?? localStorage.getItem(RAID_IV_KEEP_KEY_LEGACY);
    if (raw == null || raw === "") return DEFAULT_RAID_IV_KEEP;
    return clampRaidIvKeep(Number(raw));
  } catch {
    return DEFAULT_RAID_IV_KEEP;
  }
}

function readStoredKeepAllGood(): boolean {
  try {
    return localStorage.getItem(KEEP_ALL_GOOD_KEY) === "1";
  } catch {
    return false;
  }
}

function readStoredKeepLucky(): boolean {
  try {
    const raw = localStorage.getItem(KEEP_LUCKY_KEY);
    if (raw == null) return DEFAULT_KEEP_LUCKY;
    return raw !== "0";
  } catch {
    return DEFAULT_KEEP_LUCKY;
  }
}

function readStoredKeepFavorite(): boolean {
  try {
    const raw = localStorage.getItem(KEEP_FAVORITE_KEY);
    if (raw == null) return DEFAULT_KEEP_FAVORITE;
    return raw !== "0";
  } catch {
    return DEFAULT_KEEP_FAVORITE;
  }
}

function readStoredPinDetail(): boolean {
  try {
    return localStorage.getItem(PIN_DETAIL_KEY) !== "0";
  } catch {
    return true;
  }
}

function defaultBoxFilter(): BoxFilter {
  return { KEEP: true, LOOK: true, DUMP: true };
}

function readStoredBoxFilter(): BoxFilter {
  const next = defaultBoxFilter();
  try {
    const raw = localStorage.getItem(BOX_FILTER_KEY);
    if (!raw) return next;
    const parsed = JSON.parse(raw) as Partial<BoxFilter>;
    if (parsed.KEEP === false) next.KEEP = false;
    if (parsed.LOOK === false) next.LOOK = false;
    if (parsed.DUMP === false) next.DUMP = false;
    return next;
  } catch {
    return defaultBoxFilter();
  }
}

function readStoredKeepShadow(): boolean {
  try {
    const raw = localStorage.getItem(KEEP_SHADOW_KEY);
    if (raw == null) return DEFAULT_KEEP_SHADOW;
    return raw !== "0";
  } catch {
    return DEFAULT_KEEP_SHADOW;
  }
}

function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    return raw !== "0";
  } catch {
    return fallback;
  }
}

const state: AppState = {
  tab: readStoredTab() ?? "DUMP",
  result: null,
  parse: null,
  fileName: "",
  error: "",
  busy: "",
  engine: null,
  meta: null,
  pvpRankKeep: readStoredRankKeep(),
  pvpListKeep: readStoredListKeep(),
  pvpAny: readStoredPvpAny(),
  pvpKeep: readStoredPvpKeep(),
  raidKeep: readStoredRaidKeep(),
  familyKeep: readStoredFamilyKeep(),
  raidIvKeep: readStoredRaidIvKeep(),
  keepAllGood: readStoredKeepAllGood(),
  keepLucky: readStoredKeepLucky(),
  keepFavorite: readStoredKeepFavorite(),
  keepShadow: readStoredKeepShadow(),
  keepGl: readStoredFlag(KEEP_GL_KEY, DEFAULT_KEEP_GL),
  keepLc: readStoredFlag(KEEP_LC_KEY, DEFAULT_KEEP_LC),
  keepUl: readStoredFlag(KEEP_UL_KEY, DEFAULT_KEEP_UL),
  keepMl: readStoredFlag(KEEP_ML_KEY, DEFAULT_KEEP_ML),
  pinDetail: readStoredPinDetail(),
  rankingsTab: "gl",
  rankingsFilter: "",
  rankingsRaidType: "",
  boxSort: "scan",
  boxFilter: readStoredBoxFilter(),
  dismissed: [],
  boxSelected: null,
  boxFileKey: "",
};

function errMsg(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function raidTypeFilterButtons(): string {
  const all = `<button type="button" class="type-chip type-chip--all is-active" data-raid-type="all" aria-pressed="true">All types</button>`;
  const types = POKEMON_TYPES.map(
    (type) =>
      `<button type="button" class="type-chip type-chip--${type}" data-raid-type="${type}" aria-pressed="false">${prettyPokemonType(type)}</button>`,
  ).join("");
  return `${all}${types}`;
}

function raidRowHasType(row: RaidAttackerRow, type: PokemonType): boolean {
  return row.typeRanks[type] != null;
}

function raidRowCut(row: RaidAttackerRow, type: PokemonType | ""): boolean {
  if (type) return !viableRaidTier(row.typeTiers?.[type] ?? "");
  return row.viable === false;
}

function raidFinalRow(meta: Meta | null, speciesId: string, evoSpeciesId?: string): RaidAttackerRow | undefined {
  if (!meta) return undefined;
  const target =
    evoSpeciesId ||
    (meta.raidAttackers.has(speciesId) ? speciesId : meta.raidEvolution?.[speciesId]);
  if (!target) return undefined;
  return meta.raidRankings?.find((row) => row.speciesId === target && !row.asSpeciesId);
}

function raidTypeRankEntries(row: RaidAttackerRow | undefined): Array<{ type: PokemonType; rank: number }> {
  if (!row) return [];
  return POKEMON_TYPES.flatMap((type) => {
    const rank = row.typeRanks[type];
    return rank != null ? [{ type, rank }] : [];
  }).sort((a, b) => a.rank - b.rank || a.type.localeCompare(b.type));
}

function typeChipMarkup(type: PokemonType): string {
  return `<span class="type-chip type-chip--tag type-chip--${type}">${prettyPokemonType(type)}</span>`;
}

function raidTypeRankChipMarkup(type: PokemonType, rank: number): string {
  return `<span class="chip type-chip--${type}">#${rank} attacker ${prettyPokemonType(type).toUpperCase()}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function markCopied(button: HTMLButtonElement): void {
  const prev = button.textContent;
  button.classList.add("is-copied");
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.classList.remove("is-copied");
    button.textContent = prev;
  }, 1400);
}

async function loadEngine(): Promise<Engine> {
  let parseMod: Record<string, unknown>;
  let gradeMod: Record<string, unknown>;
  let metaMod: Record<string, unknown>;
  try {
    // @ts-ignore csv agent owns parseCsv; runtime error is shown in the UI
    parseMod = (await import("./parseCsv")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not load parseCsv: ${errMsg(err)}`);
  }
  try {
    // @ts-ignore grade agent owns grade.ts
    gradeMod = (await import("./grade")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not load grade: ${errMsg(err)}`);
  }
  try {
    // @ts-ignore grade agent owns meta.ts
    metaMod = (await import("./meta")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not load meta: ${errMsg(err)}`);
  }

  const parseInventoryCsv = parseMod.parseInventoryCsv;
  const gradeBox = gradeMod.gradeBox;
  const loadMeta = metaMod.loadMeta;
  if (typeof parseInventoryCsv !== "function") {
    throw new Error("parseInventoryCsv is missing from parseCsv.");
  }
  if (typeof gradeBox !== "function") {
    throw new Error("gradeBox is missing from grade.");
  }
  if (typeof loadMeta !== "function") {
    throw new Error("loadMeta is missing from meta.");
  }

  return {
    parseInventoryCsv: parseInventoryCsv as Engine["parseInventoryCsv"],
    gradeBox: gradeBox as Engine["gradeBox"],
    loadMeta: loadMeta as Engine["loadMeta"],
  };
}

function formatIvs(mon: GradedMon["mon"]): string {
  const { atk, def, sta, ivPercent, ivUnique } = mon;
  if (atk != null && def != null && sta != null) {
    const star = ivUnique ? "" : " (not unique)";
    return `${atk}/${def}/${sta}${star}`;
  }
  if (ivPercent != null) return `${ivPercent}% IV`;
  return ivUnique ? "IVs known" : "IVs unknown";
}

function formatLeagueBits(
  kind: "GL" | "UL" | "ML" | "LC",
  metaRank: GradedMon["glMeta"],
  iv: GradedMon["gl"],
  asSpeciesId?: string,
): string {
  const as =
    asSpeciesId && asSpeciesId !== ""
      ? ` as ${prettySpeciesId(asSpeciesId)}`
      : "";
  if (metaRank && iv) {
    return `${kind}${as} #${metaRank.rank}/${metaRank.of} (${iv.rank}/${iv.of})`;
  }
  if (metaRank) return `${kind}${as} #${metaRank.rank}/${metaRank.of}`;
  if (iv) return `${kind}${as} ${iv.rank}/${iv.of}`;
  return "";
}

function leagueOverCapNote(
  mon: GradedMon["mon"],
  speciesId: string,
  meta: Meta | null,
  cap: number,
): string {
  if (!meta || !speciesId || cap >= MASTER_LEAGUE_CAP) return "";
  const fit = fitsLeagueCap(mon, speciesId, cap, getRankGm(meta.glEvolution));
  if (fit.fits || fit.cp == null) return "";
  return ` over ${cap} (${fit.cp} CP)`;
}

function cappedBits(
  on: boolean,
  kind: "GL" | "UL" | "ML",
  ranks: GradedMon["glAs"],
  primary: GradedMon["gl"],
  metas: GradedMon["glMetaAs"],
  primaryMeta: GradedMon["glMeta"],
  mon: GradedMon["mon"],
  meta: Meta | null,
  cap: number,
): string[] {
  if (!on) return [];
  const list = ranks?.length ? ranks : primary ? [primary] : [];
  if (list.length === 0) {
    const bit = formatLeagueBits(kind, primaryMeta, primary);
    return bit ? [bit] : [];
  }
  return list.map((iv) => {
    const metaRank =
      metas?.find((row) => row.speciesId === iv.evoSpeciesId) ??
      (primaryMeta?.speciesId === iv.evoSpeciesId ? primaryMeta : null);
    const as = iv.evoSpeciesId && iv.evoSpeciesId !== mon.speciesId ? iv.evoSpeciesId : "";
    return formatLeagueBits(kind, metaRank, iv, as) + leagueOverCapNote(mon, iv.evoSpeciesId, meta, cap);
  });
}

function formatRanks(item: GradedMon, meta: Meta | null): string {
  const glBits = cappedBits(state.keepGl, "GL", item.glAs, item.gl, item.glMetaAs, item.glMeta, item.mon, meta, GREAT_LEAGUE_CAP);
  const ulBits = cappedBits(state.keepUl, "UL", item.ulAs, item.ul, item.ulMetaAs, item.ulMeta, item.mon, meta, ULTRA_LEAGUE_CAP);
  const mlBits = cappedBits(state.keepMl, "ML", item.mlAs, item.ml, item.mlMetaAs, item.mlMeta, item.mon, meta, MASTER_LEAGUE_CAP);
  const lcBit = state.keepLc ? formatLeagueBits("LC", item.lcMeta, item.lc) : "";
  const raid = item.raidIv
    ? `Raid${item.raidIv.evoSpeciesId !== item.mon.speciesId ? ` as ${prettySpeciesId(item.raidIv.evoSpeciesId)}` : ""} ${item.raidIv.percent}% IV`
    : "";
  return [...glBits, ...ulBits, ...mlBits, lcBit, raid].filter(Boolean).join(" · ");
}

function jobLabel(item: GradedMon): string {
  const job = item.pvpJob;
  if (!job) return "";
  const name = prettySpeciesId(job.speciesId);
  if (job.kind === "lc") return `LC ${name}`;
  if (job.kind === "ul") return `UL ${name}`;
  if (job.kind === "ml") return `ML ${name}`;
  if (job.kind === "raid") return `Raid ${name}`;
  return `GL ${name}`;
}

function reasonClass(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("no pvp/raid job")) return "chip chip--nojob";
  if (r.startsWith("stay ") || r.startsWith("evolve to ")) {
    if (r.includes("little cup")) return "chip chip--lc";
    if (r.includes("ultra league")) return "chip chip--ul";
    if (r.includes("master league")) return "chip chip--ml";
    if (r.includes("great league")) return "chip chip--gl";
    if (r.includes("raid")) return "chip chip--raid";
  }
  if (r.startsWith("raid attacker")) return "chip chip--raid";
  if (r.includes("shiny")) return "chip chip--shiny";
  if (r.includes("lucky")) return "chip chip--lucky";
  if (r.includes("costume")) return "chip chip--costume";
  if (r.includes("background")) return "chip chip--background";
  if (r.includes("4*") || r.includes("hundo")) return "chip chip--hundo";
  if (r.includes("favorite")) return "chip chip--favorite";
  if (r.includes("special") || r.includes("legacy")) return "chip chip--special";
  if (r.includes("shadow")) return "chip chip--shadow";
  if (r.includes("dynamax") || r.includes("gigantamax")) return "chip chip--max";
  if (r.includes("legendary")) return "chip chip--legendary";
  if (r.includes("mythical")) return "chip chip--mythical";
  if (r.includes("% iv worse")) return "chip chip--raid-miss";
  if (r.includes("raid iv unavailable")) return "chip chip--raid-unknown";
  if (r.startsWith("gl better as")) return "chip chip--gl-better";
  if (r.startsWith("ul better as")) return "chip chip--ul-better";
  if (r.startsWith("ml better as")) return "chip chip--ml-better";
  if (r.includes("better as")) return "chip chip--gl-better";
  if (r.includes("over ultra league")) return "chip chip--ul-cap";
  if (r.includes("over master league")) return "chip chip--ml-cap";
  if (r.includes("over great league")) return "chip chip--gl-cap";
  if (r.includes("over little cup")) return "chip chip--lc-cap";
  if (r.startsWith("gl rank unknown")) return "chip chip--gl-unknown";
  if (r.startsWith("ul rank unknown")) return "chip chip--ul-unknown";
  if (r.startsWith("ml rank unknown")) return "chip chip--ml-unknown";
  if (r.startsWith("lc rank unknown")) return "chip chip--lc-unknown";
  if (r.includes("never dump") || r.includes("cannot dump") || r.includes("ivs not unique")) {
    return "chip chip--lock";
  }
  if (r.startsWith("gl ") && r.includes("worse than keep")) return "chip chip--gl-miss";
  if (r.startsWith("ul ") && r.includes("worse than keep")) return "chip chip--ul-miss";
  if (r.startsWith("ml ") && r.includes("worse than keep")) return "chip chip--ml-miss";
  if (r.startsWith("lc ") && r.includes("worse than keep")) return "chip chip--lc-miss";
  if (r.includes("worse than keep")) return "chip chip--raid-miss";
  if (r.startsWith("great league as ")) return "chip chip--gl-seat";
  if (r.startsWith("ultra league as ")) return "chip chip--ul-seat";
  if (r.startsWith("master league as ")) return "chip chip--ml-seat";
  if (r.startsWith("little cup as ")) return "chip chip--lc-seat";
  if (r.startsWith("pvp/raid family") && r.includes("no keeper")) return "chip chip--family-open";
  if (r.startsWith("pvp/raid family")) return "chip chip--family";
  if (r.includes("useless for pvp") || r.includes("keep 0 per family")) return "chip chip--junk";
  if (r === "only copy") return "chip chip--solo";
  if (r.includes("best junk")) return "chip chip--junk-best";
  if (r.includes("not gl/lc/raid")) return "chip chip--unlisted";
  if (r.startsWith("limited")) return "chip chip--limited";
  if (r.includes("already has a keeper")) return "chip chip--extra-keep";
  if (r.startsWith("extra copy")) return "chip chip--extra-spare";
  if (r.startsWith("raid copies")) return "chip chip--raid-copies";
  return "chip chip--loud";
}

function isNegativeReason(reason: string): boolean {
  const r = reason.toLowerCase();
  if (r.includes("no pvp/raid job")) return false;
  if (r.includes("% iv worse") || r.includes("raid iv unavailable") || r.includes("worse than keep")) return true;
  if (r.includes("useless for pvp") || r.includes("keep 0 per family") || r.includes("not gl/lc/raid")) return true;
  if (/^(gl|lc) rank unknown/.test(r)) return true;
  if (r.startsWith("extra copy") || r.startsWith("raid copies") || r.includes("duplicate")) return true;
  return false;
}

function isBetterAsReason(reason: string): boolean {
  return reason.toLowerCase().includes("better as");
}

function rowChips(item: GradedMon, verdict: Tab, meta: Meta | null): string {
  const hideNegative = verdict === "KEEP";
  const hideBetterAs = verdict === "DUMP";
  const reasonSpans = item.reasons
    .filter((reason) => {
      if (hideNegative && isNegativeReason(reason)) return false;
      if (hideBetterAs && isBetterAsReason(reason)) return false;
      return true;
    })
    .map((reason) => `<span class="${reasonClass(reason)}">${escapeHtml(reason)}</span>`);
  const typeSpans =
    verdict === "KEEP" || verdict === "DUMP"
      ? raidTypeRankEntries(raidFinalRow(meta, item.mon.speciesId, item.raidIv?.evoSpeciesId)).map((entry) =>
          raidTypeRankChipMarkup(entry.type, entry.rank),
        )
      : [];
  const spans = [...reasonSpans, ...typeSpans];
  if (spans.length === 0) return "";
  return `<div class="reasons">${spans.join("")}</div>`;
}

function renderRow(item: GradedMon, verdict: Tab, meta: Meta | null): string {
  const { mon, copiesInGroup, copyRankInGroup } = item;
  const crowd = copiesInGroup > 2;
  const flags = [
    mon.shadow ? "shadow" : "",
    mon.purified ? "purified" : "",
    mon.form && mon.form.toLowerCase() !== "normal" ? mon.form : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const nick = mon.nickname?.trim();
  const species = mon.speciesName || mon.speciesId;
  const title = nick || species;
  const speciesBit = nick && species && nick !== species ? species : "";
  const crowdBadge = crowd
    ? `<span class="badge-crowd" title="Family copy rank (best first). Rows stay in scan order (first scanned at top).">${copyRankInGroup}/${copiesInGroup}</span>`
    : "";
  const job = jobLabel(item);
  const jobBadge = job
    ? `<span class="badge-job badge-job--${item.pvpJob?.kind ?? "gl"}">${escapeHtml(job)}</span>`
    : "";
  const line = [speciesBit, `IVs ${formatIvs(mon)}`, flags, formatRanks(item, meta)].filter(Boolean).join(" · ");

  return `<article class="row row--${verdict.toLowerCase()}${crowd ? " row--crowd" : ""}">
    <div class="row-top">
      <div class="species">${escapeHtml(title)}${jobBadge}${crowdBadge}</div>
      <div class="cp">${mon.cp}</div>
    </div>
    <div class="meta">${escapeHtml(line)}</div>
    ${rowChips(item, verdict, meta)}
  </article>`;
}

function paintTrack(
  listEl: HTMLElement,
  rows: GradedMon[],
  verdict: Tab,
  cap: number,
  meta: Meta | null,
): void {
  if (rows.length === 0) {
    listEl.innerHTML = `<p class="empty">None</p>`;
    return;
  }
  const shown = rows.slice(0, cap);
  const extra = rows.length - shown.length;
  listEl.innerHTML =
    shown.map((row) => renderRow(row, verdict, meta)).join("") +
    (extra > 0 ? `<p class="list-more">${extra} more in scan order</p>` : "");
}

function pvpokeStatus(meta: Meta | null): string {
  if (!meta?.pvpokeSource || meta.pvpokeSource === "bundled") return "PvPoke bundled";
  const at = meta.pvpokeFetchedAt ?? 0;
  const hours = Math.max(0, Math.floor((Date.now() - at) / 3_600_000));
  const age = hours < 1 ? "<1h" : `${hours}h`;
  return meta.pvpokeSource === "live" ? "PvPoke live" : `PvPoke ${age}`;
}

function raidListStatus(meta: Meta | null): string {
  if (!meta?.raidSource || meta.raidSource === "bundled") return "Dittobase bundled";
  const at = meta.raidFetchedAt ?? 0;
  const hours = Math.max(0, Math.floor((Date.now() - at) / 3_600_000));
  const age = hours < 1 ? "<1h" : `${hours}h`;
  return meta.raidSource === "live" ? "Dittobase live" : `Dittobase ${age}`;
}

function isTab(value: string | null): value is Tab {
  return value === "KEEP" || value === "LOOK" || value === "DUMP" || value === "BOX";
}

function readStoredTab(): Tab | null {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    return isTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

function persistTab(tab: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* private mode */
  }
}

function pickDefaultTab(result: GradeResult): Tab {
  if (result.dump.length > 0) return "DUMP";
  if (result.look.length > 0) return "LOOK";
  return "KEEP";
}

function boxStorageKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function readDismissed(key: string): number[] {
  if (!key) return [];
  try {
    const raw = sessionStorage.getItem(BOX_DISMISS_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  } catch {
    return [];
  }
}

function writeDismissed(key: string, rows: number[]): void {
  if (!key) return;
  try {
    if (rows.length === 0) sessionStorage.removeItem(BOX_DISMISS_PREFIX + key);
    else sessionStorage.setItem(BOX_DISMISS_PREFIX + key, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}

function shownRows(rows: GradedMon[]): GradedMon[] {
  if (state.dismissed.length === 0) return rows;
  const gone = new Set(state.dismissed);
  return rows.filter((row) => !gone.has(row.mon.sourceRow));
}

function boxPool(result: GradeResult): GradedMon[] {
  return shownRows([...result.keep, ...result.look, ...result.dump]);
}

function boxRows(result: GradeResult): GradedMon[] {
  const rows = boxPool(result).filter((row) => state.boxFilter[row.verdict]);
  const byCp = state.boxSort === "cp";
  rows.sort((a, b) => {
    if (byCp && a.mon.cp !== b.mon.cp) return b.mon.cp - a.mon.cp;
    return compareScanStream(a.mon, b.mon);
  });
  return rows;
}

function boxEmptyNote(result: GradeResult): string {
  if (boxPool(result).length === 0) {
    return state.dismissed.length > 0
      ? "All removed. Restore to show the list again."
      : "None";
  }
  return "None match these filters.";
}

function findGraded(sourceRow: number): GradedMon | undefined {
  const result = state.result;
  if (!result) return undefined;
  return (
    result.keep.find((row) => row.mon.sourceRow === sourceRow) ??
    result.look.find((row) => row.mon.sourceRow === sourceRow) ??
    result.dump.find((row) => row.mon.sourceRow === sourceRow)
  );
}

function boxLabel(item: GradedMon): { title: string; sub: string } {
  const { mon } = item;
  const species = mon.speciesName || mon.speciesId;
  const nick = mon.nickname?.trim();
  const title = nick || species;
  const speciesBit = nick && species && nick !== species ? species : "";
  const named = `${title} ${speciesBit}`;
  const sub = [
    speciesBit,
    mon.shadow && !/shadow/i.test(named) ? "shadow" : "",
    mon.purified && !/purified/i.test(named) ? "purified" : "",
    mon.form && !/^(normal|standard|none|default|\d+)$/i.test(mon.form.trim()) ? mon.form : "",
    mon.shiny && !/shiny/i.test(named) ? "shiny" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return { title, sub };
}

function mainBoxReason(item: GradedMon): string {
  const reasons = item.reasons;
  if (item.verdict === "KEEP") {
    const job = reasons.find((reason) =>
      /for great league|for ultra league|for master league|for little cup|for raids|raid attacker/i.test(reason),
    );
    if (job) return job;
    const identity = reasons.find((reason) =>
      /^(shiny|lucky|costume|background|4\* \/ hundo|favorite|special \/ legacy move|shadow|dynamax \/ gigantamax|legendary|mythical|limited)/i.test(
        reason,
      ),
    );
    if (identity) return identity;
    const visible = reasons.filter((reason) => !isNegativeReason(reason) && !/no pvp\/raid job/i.test(reason));
    return visible[0] ?? reasons[0] ?? "Kept";
  }
  if (item.verdict === "LOOK") {
    const deciding = reasons.find((reason) =>
      /never dump|cannot dump|only copy|best junk|pvp\/raid family/i.test(reason),
    );
    return deciding ?? reasons[reasons.length - 1] ?? "Worth a look";
  }
  const deciding = [...reasons].reverse().find((reason) =>
    /extra copy|useless for pvp|keep 0 per family|not gl\/lc\/raid/i.test(reason),
  );
  const rest = reasons.filter((reason) => !isBetterAsReason(reason));
  return deciding ?? rest[rest.length - 1] ?? reasons[reasons.length - 1] ?? "Dump";
}

function renderBoxDetail(item: GradedMon): string {
  const { mon } = item;
  const { title, sub } = boxLabel(item);
  const line = [`CP ${mon.cp}`, `IVs ${formatIvs(mon)}`, sub, formatRanks(item, state.meta)]
    .filter(Boolean)
    .join(" · ");
  return `<div class="box-detail-title">${escapeHtml(title)} <span class="box-detail-verdict box-detail-verdict--${item.verdict.toLowerCase()}">${item.verdict}</span></div>
    <div class="meta">${escapeHtml(line)}</div>
    ${rowChips(item, item.verdict, state.meta)}`;
}

function renderBoxTile(item: GradedMon, selected: boolean): string {
  const { mon } = item;
  const { title, sub } = boxLabel(item);
  const verdict = item.verdict.toLowerCase();
  const starTitle = state.keepFavorite
    ? "Favorite — always keep"
    : "Favorite — can dump if other rules do not save it";
  const star = mon.favorite ? `<span class="box-star" title="${starTitle}">★</span>` : "";
  const subHtml = sub ? `<div class="box-sub">${escapeHtml(sub)}</div>` : "";
  const openLabel = `${title}, CP ${mon.cp}, ${item.verdict}. Show details.`;
  return `<div class="box-tile box-tile--${verdict}${selected ? " is-selected" : ""}">
    <button type="button" class="box-open" data-box-open="${mon.sourceRow}" aria-pressed="${selected ? "true" : "false"}" aria-label="${escapeHtml(openLabel)}">
      <div class="box-cp">${star}<span class="box-cp-k">CP</span> ${mon.cp}</div>
      <div class="box-name">${escapeHtml(title)}</div>
      ${subHtml}
    </button>
    <button type="button" class="box-x" data-box-dismiss="${mon.sourceRow}" aria-label="Remove ${escapeHtml(title)} CP ${mon.cp} from the list" title="Remove from the list"></button>
  </div>`;
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app">
      <header class="app-header">
        <div>
          <h1>pogo-grader</h1>
          <p class="lede">Grade a Calcy / Poke Genie CSV into KEEP, LOOK, and DUMP. Stays on this device.</p>
        </div>
      </header>

      <div class="setup">
        <section class="card card--csv" aria-labelledby="csv-title">
          <h2 id="csv-title">CSV</h2>
          <label class="file-label" for="csv-file">Calcy IV or Poke Genie export</label>
          <div class="csv-field" id="csv-field">
            <label class="csv-pick" for="csv-file">
              <span id="csv-name" class="csv-name">Choose a CSV</span>
            </label>
            <input id="csv-file" class="csv-file" type="file" accept=".csv,text/csv" />
            <button type="button" id="csv-clear" class="csv-clear hidden" aria-label="Remove stored CSV" title="Remove stored CSV"></button>
          </div>
          <p id="status" class="status-line csv-loaded hidden"></p>
          <ul id="issues" class="issues hidden"></ul>
          <p class="note">Kept on this device until you clear it. Skip-scan KEEP museum first — Calcy often omits shiny.</p>
        </section>

        <section class="card card--skip" aria-labelledby="skip-title">
          <h2 id="skip-title">Skip-scan in GO</h2>
          <pre class="search-block" id="skip-scan">${escapeHtml(SKIP_SCAN)}</pre>
          <button type="button" class="btn btn--primary" data-copy="skip">Copy search</button>
          <p class="note">Hides KEEP museum so you scan the rest. Do not add <code>!shadow</code>. Fade Lucky and luckies stay in this search. Fade Favorite and favorites stay in this search.</p>
        </section>
      </div>

      <details class="card rankings-card">
        <summary class="rankings-head">
          <h2 id="rankings-title">Rankings</h2>
          <p class="note rankings-status" id="rankings-status">Loading lists…</p>
        </summary>
        <nav class="rankings-tabs" aria-label="Rankings lists">
          <button type="button" class="btn btn--preset" data-rankings-tab="gl">Great League</button>
          <button type="button" class="btn btn--preset" data-rankings-tab="ul" hidden>Ultra League</button>
          <button type="button" class="btn btn--preset" data-rankings-tab="ml" hidden>Master League</button>
          <button type="button" class="btn btn--preset" data-rankings-tab="lc">Little Cup</button>
          <button type="button" class="btn btn--preset" data-rankings-tab="raid">Raids</button>
        </nav>
        <div class="rankings-panes">
          <div class="rankings-pane is-active" data-rankings-pane="gl">
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--gl">Great League</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-gl">Filter</label>
              <input id="rankings-filter-gl" class="rankings-filter" type="search" placeholder="Name, family, or id" autocomplete="off" aria-label="Filter Great League rankings" data-rankings-filter />
            </div>
            <div id="rankings-gl" class="rankings-table-wrap"></div>
          </div>
          <div class="rankings-pane" data-rankings-pane="ul" hidden>
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--ul">Ultra League</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-ul">Filter</label>
              <input id="rankings-filter-ul" class="rankings-filter" type="search" placeholder="Name, family, or id" autocomplete="off" aria-label="Filter Ultra League rankings" data-rankings-filter />
            </div>
            <div id="rankings-ul" class="rankings-table-wrap"></div>
          </div>
          <div class="rankings-pane" data-rankings-pane="ml" hidden>
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--ml">Master League</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-ml">Filter</label>
              <input id="rankings-filter-ml" class="rankings-filter" type="search" placeholder="Name, family, or id" autocomplete="off" aria-label="Filter Master League rankings" data-rankings-filter />
            </div>
            <div id="rankings-ml" class="rankings-table-wrap"></div>
          </div>
          <div class="rankings-pane" data-rankings-pane="lc">
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--lc">Little Cup</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-lc">Filter</label>
              <input id="rankings-filter-lc" class="rankings-filter" type="search" placeholder="Name, family, or id" autocomplete="off" aria-label="Filter Little Cup rankings" data-rankings-filter />
            </div>
            <div id="rankings-lc" class="rankings-table-wrap"></div>
          </div>
          <div class="rankings-pane" data-rankings-pane="raid">
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--raid" id="rankings-raid-title">Raid attackers</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-raid">Filter</label>
              <input id="rankings-filter-raid" class="rankings-filter" type="search" placeholder="Name, family, id, or tag" autocomplete="off" aria-label="Filter raid attackers" data-rankings-filter />
            </div>
            <nav class="rankings-types" aria-label="Filter raid attackers by type">${raidTypeFilterButtons()}</nav>
            <p class="note rankings-raid-note" id="rankings-raid-note">Dittobase eDPS (1 = best). A tier and better are raid KEEP. Dimmed rows are ranked but not kept. Pre-evolutions sit with the attacker they count as.</p>
            <div id="rankings-raid" class="rankings-table-wrap"></div>
          </div>
        </div>
      </details>

      <div id="error" class="banner banner--error hidden" role="alert"></div>
      <p id="busy" class="status-line hidden"></p>

      <div id="results" class="hidden">
        <p class="banner banner--lock hidden" id="transfer-lock"></p>
      </div>

      <section class="card card--rules" aria-labelledby="rank-title">
        <h2 id="rank-title">KEEP rules</h2>
        <div class="rules">
          <section class="rule-group rule-group--keep" aria-labelledby="rules-tags">
            <h3 id="rules-tags">Always keep</h3>
            <div class="rule rule--tags">
              <div class="keep-chips" role="group" aria-labelledby="rules-tags">
                <button type="button" class="chip chip--lucky keep-chip" data-keep-chip="lucky" aria-pressed="true" title="KEEP luckies. Click to fade — luckies must earn KEEP another way.">Lucky</button>
                <button type="button" class="chip chip--shadow keep-chip" data-keep-chip="shadow" aria-pressed="true" title="KEEP every shadow. Click to fade — useless shadows can DUMP.">Shadow</button>
                <button type="button" class="chip chip--favorite keep-chip" data-keep-chip="favorite" aria-pressed="true" title="KEEP every favorite. Click to fade — a star does not protect the copy.">Favorite</button>
                <button type="button" class="chip chip--hundo keep-chip is-off" data-keep-chip="hundo" aria-pressed="false" title="KEEP every 4*. Click to fade — one 4* per family stays, extras can DUMP.">All 4*</button>
              </div>
              <p class="rule-hint">Bright tags KEEP. Fade Lucky, Shadow, or Favorite and that tag no longer protects the copy. All 4* starts faded — one 4* per family stays.</p>
            </div>
          </section>

          <section class="rule-group rule-group--who" aria-labelledby="rules-who">
            <h3 id="rules-who">Which Pokémon</h3>
            <div class="rule">
              <div class="rule-copy">
                <p class="rule-title" id="rules-leagues">Leagues</p>
                <p class="rule-hint">Bright leagues KEEP. Ultra League and Master League start faded and fetch their lists only after you brighten them.</p>
              </div>
              <div class="rule-control">
                <div class="keep-chips" role="group" aria-labelledby="rules-leagues">
                  <button type="button" class="chip chip--gl keep-chip" data-league="gl" aria-pressed="true" title="KEEP Great League. Click to fade — good Great League IVs no longer keep a copy.">Great League</button>
                  <button type="button" class="chip chip--ul keep-chip is-off" data-league="ul" aria-pressed="false" title="Ultra League starts off. Click to fetch its list and KEEP good Ultra League IVs.">Ultra League</button>
                  <button type="button" class="chip chip--ml keep-chip is-off" data-league="ml" aria-pressed="false" title="Master League starts off. Click to fetch its list and KEEP good Master League IVs.">Master League</button>
                  <button type="button" class="chip chip--lc keep-chip" data-league="lc" aria-pressed="true" title="KEEP Little Cup. Click to fade — good Little Cup IVs no longer keep a copy.">Little Cup</button>
                </div>
              </div>
            </div>
            <div class="rule">
              <div class="rule-copy">
                <p class="rule-title" id="pvp-species-label">PvP species</p>
                <p class="rule-hint" id="pvp-list-note"></p>
              </div>
              <div class="rule-control">
                <div class="mode-row" role="group" aria-labelledby="pvp-species-label">
                  <button type="button" class="btn btn--preset" data-pvp-any="0">Top list</button>
                  <button type="button" class="btn btn--preset" data-pvp-any="1">Any species</button>
                </div>
                <div id="pvp-list-cutoff">
                  <div class="rank-row">
                    <input id="pvp-list-keep" type="number" inputmode="numeric" min="1" max="${GL_LIST_CAP}" step="1" value="${state.pvpListKeep}" aria-label="PvPoke species cutoff" />
                    <span class="rank-suffix">/ ${GL_LIST_CAP}</span>
                  </div>
                  <div class="rank-presets" role="group" aria-label="PvPoke species cutoff">
                    ${LIST_KEEP_PRESETS.map(
                      (n) =>
                        `<button type="button" class="btn btn--preset" data-list-keep="${n}">${n}</button>`,
                    ).join("")}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="rule-group rule-group--iv" aria-labelledby="rules-iv">
            <h3 id="rules-iv">How good</h3>
            <div class="rule">
              <div class="rule-copy">
                <label class="rule-title" for="rank-keep">PvP IV rank</label>
                <p class="rule-hint" id="pvp-iv-note">Keep this rank or better. 1 is the best of ${PVP_RANK_OF} Great League and Little Cup spreads.</p>
              </div>
              <div class="rule-control">
                <div class="rank-row">
                  <input id="rank-keep" type="number" inputmode="numeric" min="1" max="${PVP_RANK_OF}" step="1" value="${state.pvpRankKeep}" aria-label="PvP IV rank" />
                  <span class="rank-suffix">/ ${PVP_RANK_OF}</span>
                </div>
                <div class="rank-presets" role="group" aria-label="PvP IV rank">
                  ${RANK_PRESETS.map(
                    (n) =>
                      `<button type="button" class="btn btn--preset" data-rank="${n}">${n === PVP_RANK_OF ? "any" : String(n)}</button>`,
                  ).join("")}
                </div>
              </div>
            </div>
            <div class="rule">
              <div class="rule-copy">
                <label class="rule-title" for="raid-iv-keep">Raid IV</label>
                <p class="rule-hint">Keep this percent or better. Attack, Defense, and Stamina out of 45.</p>
              </div>
              <div class="rule-control">
                <div class="rank-row">
                  <input id="raid-iv-keep" type="number" inputmode="numeric" min="${RAID_IV_KEEP_MIN}" max="${RAID_IV_KEEP_MAX}" step="1" value="${state.raidIvKeep}" aria-label="Raid IV percent" />
                  <span class="rank-suffix">% IV</span>
                </div>
                <div class="rank-presets" role="group" aria-label="Raid IV percent">
                  ${RAID_IV_PRESETS.map(
                    (n) =>
                      `<button type="button" class="btn btn--preset" data-raid-iv="${n}">${n === RAID_IV_KEEP_MIN ? "any" : String(n)}</button>`,
                  ).join("")}
                </div>
              </div>
            </div>
          </section>

          <section class="rule-group rule-group--count" aria-labelledby="rules-count">
            <h3 id="rules-count">How many</h3>
            <div class="rule">
              <div class="rule-copy">
                <label class="rule-title" for="pvp-keep">Copies per job</label>
                <p class="rule-hint" id="pvp-keep-note">Seats for each Great League stage and each Little Cup species. Better PvPoke species fill first.</p>
              </div>
              <div class="rule-control">
                <div class="rank-row">
                  <input id="pvp-keep" type="number" inputmode="numeric" min="${PVP_KEEP_MIN}" max="${PVP_KEEP_MAX}" step="1" value="${state.pvpKeep}" aria-label="Copies per job" />
                  <span class="rank-suffix">copies</span>
                </div>
                <div class="rank-presets" role="group" aria-label="Copies per job">
                  ${PVP_KEEP_PRESETS.map(
                    (n) =>
                      `<button type="button" class="btn btn--preset" data-pvp-keep="${n}">${n}</button>`,
                  ).join("")}
                </div>
              </div>
            </div>
            <div class="rule">
              <div class="rule-copy">
                <label class="rule-title rule-title--raid" for="raid-keep">Raid copies</label>
                <p class="rule-hint">Seats for each family's raid attacker. Highest attack fills first.</p>
              </div>
              <div class="rule-control">
                <div class="rank-row">
                  <input id="raid-keep" type="number" inputmode="numeric" min="${RAID_KEEP_MIN}" max="${RAID_KEEP_MAX}" step="1" value="${state.raidKeep}" aria-label="Raid copies" />
                  <span class="rank-suffix">copies</span>
                </div>
                <div class="rank-presets" role="group" aria-label="Raid copies">
                  ${RAID_KEEP_PRESETS.map(
                    (n) =>
                      `<button type="button" class="btn btn--preset" data-raid-keep="${n}">${n}</button>`,
                  ).join("")}
                </div>
              </div>
            </div>
            <div class="rule">
              <div class="rule-copy">
                <label class="rule-title" for="family-keep">Spares with no keeper</label>
                <p class="rule-hint">If a PvP or raid family has no KEEP, LOOK this many best copies. 0 leaves that family on LOOK and dumps only species that are not useful for PvP or raids.</p>
              </div>
              <div class="rule-control">
                <div class="rank-row">
                  <input id="family-keep" type="number" inputmode="numeric" min="${FAMILY_KEEP_MIN}" max="${FAMILY_KEEP_MAX}" step="1" value="${state.familyKeep}" aria-label="Spares with no keeper" />
                  <span class="rank-suffix">copies</span>
                </div>
                <div class="rank-presets" role="group" aria-label="Spares with no keeper">
                  ${FAMILY_KEEP_PRESETS.map(
                    (n) =>
                      `<button type="button" class="btn btn--preset" data-family-keep="${n}">${n === FAMILY_KEEP_MAX ? "all" : String(n)}</button>`,
                  ).join("")}
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <div id="grade-tables" class="hidden">
        <nav class="tabs" aria-label="Grade piles">
          <button type="button" class="tab" data-tab="KEEP">KEEP <span class="count" id="count-keep-tab">0</span></button>
          <button type="button" class="tab" data-tab="LOOK">LOOK <span class="count" id="count-look-tab">0</span></button>
          <button type="button" class="tab" data-tab="DUMP">DUMP <span class="count" id="count-dump-tab">0</span></button>
          <button type="button" class="tab" data-tab="BOX">LIST <span class="count" id="count-box-tab">0</span></button>
        </nav>

        <div class="tracks">
          <section class="track track--keep" data-track="KEEP">
            <header class="track-head">KEEP <span class="count" id="count-keep">0</span></header>
            <div id="list-keep" class="list"></div>
          </section>
          <section class="track track--look" data-track="LOOK">
            <header class="track-head">LOOK <span class="count" id="count-look">0</span></header>
            <div id="list-look" class="list"></div>
          </section>
          <section class="track track--dump" data-track="DUMP">
            <header class="track-head">DUMP <span class="count" id="count-dump">0</span></header>
            <div id="list-dump" class="list"></div>
          </section>
          <section class="track track--box" id="box-card" data-track="BOX" aria-labelledby="box-title">
            <header class="track-head">
              <span id="box-title">LIST</span>
            </header>
            <div class="box-scroll" id="box-scroll">
              <div class="box-sticky">
                <div class="box-tools">
                  <span class="count" id="count-box">0</span>
                  <button type="button" class="btn btn--preset is-active" id="box-pin" aria-pressed="true" title="Keep the details card on screen. Turn off when the window is short.">Pin</button>
                  <p class="note box-cleared" id="box-cleared"></p>
                  <button type="button" class="btn hidden" id="box-undo">Undo</button>
                  <button type="button" class="btn hidden" id="box-restore">Restore all</button>
                </div>
                <div class="mode-row box-filter" role="group" aria-label="List grid filters">
                  <button type="button" class="btn btn--preset${state.boxFilter.KEEP ? " is-active" : ""}" data-box-filter="KEEP" aria-pressed="${state.boxFilter.KEEP ? "true" : "false"}" title="Show KEEP copies in this grid. Turn off to drop them.">KEEP</button>
                  <button type="button" class="btn btn--preset${state.boxFilter.LOOK ? " is-active" : ""}" data-box-filter="LOOK" aria-pressed="${state.boxFilter.LOOK ? "true" : "false"}" title="Show LOOK copies in this grid. Turn off to drop them.">LOOK</button>
                  <button type="button" class="btn btn--preset${state.boxFilter.DUMP ? " is-active" : ""}" data-box-filter="DUMP" aria-pressed="${state.boxFilter.DUMP ? "true" : "false"}" title="Show DUMP copies in this grid. Turn off to drop them.">DUMP</button>
                </div>
                <div id="box-detail" class="box-detail hidden"></div>
              </div>
              <div class="mode-row box-sort" role="group" aria-label="List sort">
                <button type="button" class="btn btn--preset is-active" data-box-sort="scan" aria-pressed="true">Scan</button>
                <button type="button" class="btn btn--preset" data-box-sort="cp" aria-pressed="false">CP</button>
              </div>
              <div id="box-grid" class="box-grid"></div>
            </div>
          </section>
        </div>
      </div>
      <div id="box-tip" class="box-tip hidden" role="tooltip"></div>
    </div>
  `;

  const errorEl = root.querySelector("#error") as HTMLElement;
  const busyEl = root.querySelector("#busy") as HTMLElement;
  const resultsEl = root.querySelector("#results") as HTMLElement;
  const gradeTablesEl = root.querySelector("#grade-tables") as HTMLElement;
  const statusEl = root.querySelector("#status") as HTMLElement;
  const issuesEl = root.querySelector("#issues") as HTMLElement;
  const listKeepEl = root.querySelector("#list-keep") as HTMLElement;
  const listLookEl = root.querySelector("#list-look") as HTMLElement;
  const listDumpEl = root.querySelector("#list-dump") as HTMLElement;
  const boxScrollEl = root.querySelector("#box-scroll") as HTMLElement;
  const boxGridEl = root.querySelector("#box-grid") as HTMLElement;
  const boxStickyEl = root.querySelector(".box-sticky") as HTMLElement;
  const boxSortEl = boxScrollEl.querySelector(".box-sort") as HTMLElement;
  const boxDetailEl = root.querySelector("#box-detail") as HTMLElement;
  const boxPinEl = root.querySelector("#box-pin") as HTMLButtonElement;
  const boxTipEl = root.querySelector("#box-tip") as HTMLElement;
  const boxClearedEl = root.querySelector("#box-cleared") as HTMLElement;
  const boxUndoEl = root.querySelector("#box-undo") as HTMLElement;
  const boxRestoreEl = root.querySelector("#box-restore") as HTMLElement;
  const fileInput = root.querySelector("#csv-file") as HTMLInputElement;
  const csvField = root.querySelector("#csv-field") as HTMLElement;
  const csvName = root.querySelector("#csv-name") as HTMLElement;
  const csvClear = root.querySelector("#csv-clear") as HTMLButtonElement;
  const rankInput = root.querySelector("#rank-keep") as HTMLInputElement;
  const listKeepInput = root.querySelector("#pvp-list-keep") as HTMLInputElement;
  const listCutoffEl = root.querySelector("#pvp-list-cutoff") as HTMLElement;
  const listNoteEl = root.querySelector("#pvp-list-note") as HTMLElement;
  const pvpIvNoteEl = root.querySelector("#pvp-iv-note") as HTMLElement;
  const pvpKeepNoteEl = root.querySelector("#pvp-keep-note") as HTMLElement;
  const pvpKeepInput = root.querySelector("#pvp-keep") as HTMLInputElement;
  const raidKeepInput = root.querySelector("#raid-keep") as HTMLInputElement;
  const familyKeepInput = root.querySelector("#family-keep") as HTMLInputElement;
  const raidIvKeepInput = root.querySelector("#raid-iv-keep") as HTMLInputElement;
  const skipScanEl = root.querySelector("#skip-scan") as HTMLElement;
  const rankingsStatusEl = root.querySelector("#rankings-status") as HTMLElement;
  const rankingsGlEl = root.querySelector("#rankings-gl") as HTMLElement;
  const rankingsUlEl = root.querySelector("#rankings-ul") as HTMLElement;
  const rankingsMlEl = root.querySelector("#rankings-ml") as HTMLElement;
  const rankingsLcEl = root.querySelector("#rankings-lc") as HTMLElement;
  const rankingsRaidEl = root.querySelector("#rankings-raid") as HTMLElement;
  const rankingsRaidTitleEl = root.querySelector("#rankings-raid-title") as HTMLElement;
  const rankingsRaidNoteEl = root.querySelector("#rankings-raid-note") as HTMLElement;
  const rankingsFilterInputs = [
    ...root.querySelectorAll("[data-rankings-filter]"),
  ] as HTMLInputElement[];

  function gradeKnobs(meta: Meta): Meta {
    return {
      ...meta,
      pvpRankKeep: state.pvpRankKeep,
      pvpListKeep: state.pvpListKeep,
      pvpAny: state.pvpAny,
      pvpKeep: state.pvpKeep,
      keepGl: state.keepGl,
      keepLc: state.keepLc,
      keepUl: state.keepUl,
      keepMl: state.keepMl,
      raidKeep: state.raidKeep,
      familyKeep: state.familyKeep,
      raidIvKeep: state.raidIvKeep,
      keepAllGood: state.keepAllGood,
      keepLucky: state.keepLucky,
      keepFavorite: state.keepFavorite,
      keepShadow: state.keepShadow,
    };
  }

  function persistRankKeep(n: number): void {
    try {
      localStorage.setItem(RANK_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistListKeep(n: number): void {
    try {
      localStorage.setItem(LIST_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistPvpAny(on: boolean): void {
    try {
      localStorage.setItem(PVP_ANY_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistPvpKeep(n: number): void {
    try {
      localStorage.setItem(PVP_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistRaidKeep(n: number): void {
    try {
      localStorage.setItem(RAID_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistFamilyKeep(n: number): void {
    try {
      localStorage.setItem(FAMILY_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistRaidIvKeep(n: number): void {
    try {
      localStorage.setItem(RAID_IV_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistKeepAllGood(on: boolean): void {
    try {
      localStorage.setItem(KEEP_ALL_GOOD_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistKeepLucky(on: boolean): void {
    try {
      localStorage.setItem(KEEP_LUCKY_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistKeepFavorite(on: boolean): void {
    try {
      localStorage.setItem(KEEP_FAVORITE_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistKeepShadow(on: boolean): void {
    try {
      localStorage.setItem(KEEP_SHADOW_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistLeague(key: string, on: boolean): void {
    try {
      localStorage.setItem(key, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function selectedLeagueNames(): string[] {
    return [
      state.keepGl ? "Great League" : "",
      state.keepUl ? "Ultra League" : "",
      state.keepMl ? "Master League" : "",
      state.keepLc ? "Little Cup" : "",
    ].filter(Boolean);
  }

  function pvpSpeciesNote(): string {
    const open = [state.keepGl ? "Great League" : "", state.keepUl ? "Ultra League" : "", state.keepMl ? "Master League" : ""].filter(Boolean);
    if (!open.length && !state.keepLc) return "Every league is off. Good PvP IVs do not keep a copy.";
    if (state.pvpAny) {
      const bits: string[] = [];
      if (open.length === 1) bits.push(`Every species can be ${open[0]}.`);
      else if (open.length > 1) bits.push(`Every species can be ${open.join(", ")}.`);
      if (state.keepLc) bits.push("Little Cup is every unevolved Pokémon that can still evolve.");
      return bits.join(" ");
    }
    const bits: string[] = [];
    if (open.length === 1) bits.push(`${open[0]} species through this PvPoke rank.`);
    else if (open.length > 1) bits.push(`${open.join(", ")} species through this PvPoke rank.`);
    if (state.keepLc) bits.push(`Little Cup stays the top ${LC_LIST_CAP}.`);
    return bits.join(" ");
  }

  function pvpIvNote(): string {
    const names = selectedLeagueNames();
    if (names.length === 0) return "No league is on, so this floor is idle.";
    const which = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `Keep this rank or better. 1 is the best of ${PVP_RANK_OF} ${which} spreads.`;
  }

  function pvpCopiesNote(): string {
    const stages = [state.keepGl ? "Great League" : "", state.keepUl ? "Ultra League" : "", state.keepMl ? "Master League" : ""].filter(Boolean);
    if (!stages.length && !state.keepLc) return "No league is on, so these seats are idle.";
    const bits: string[] = [];
    if (stages.length === 1) bits.push(`Seats for each ${stages[0]} stage.`);
    else if (stages.length > 1) bits.push(`Seats for each ${stages.join(", ")} stage.`);
    if (state.keepLc) bits.push("Seats for each Little Cup species.");
    bits.push("Better PvPoke species fill first.");
    const order = selectedLeagueNames();
    if (order.length > 1) bits.push(`Fill order: ${order.join(", then ")}.`);
    return bits.join(" ");
  }

  function keepChipOn(chip: string | null): boolean {
    if (chip === "lucky") return state.keepLucky;
    if (chip === "shadow") return state.keepShadow;
    if (chip === "favorite") return state.keepFavorite;
    if (chip === "hundo") return state.keepAllGood;
    return true;
  }

  function paintRankControls(): void {
    rankInput.value = String(state.pvpRankKeep);
    listKeepInput.value = String(state.pvpListKeep);
    pvpKeepInput.value = String(state.pvpKeep);
    raidKeepInput.value = String(state.raidKeep);
    familyKeepInput.value = String(state.familyKeep);
    raidIvKeepInput.value = String(state.raidIvKeep);
    root.querySelectorAll("[data-rank]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-rank"));
      btn.classList.toggle("is-active", n === state.pvpRankKeep);
    });
    const pvpLeaguesOn = state.keepGl || state.keepUl || state.keepMl || state.keepLc;
    const openLeagueOn = state.keepGl || state.keepUl || state.keepMl;
    const glListOff = state.pvpAny || !openLeagueOn;
    listKeepInput.disabled = glListOff;
    listCutoffEl.classList.toggle("is-hidden", glListOff);
    listNoteEl.textContent = pvpSpeciesNote();
    pvpIvNoteEl.textContent = pvpIvNote();
    pvpKeepNoteEl.textContent = pvpCopiesNote();
    rankInput.disabled = !pvpLeaguesOn;
    pvpKeepInput.disabled = !pvpLeaguesOn;
    root.querySelectorAll("[data-list-keep]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-list-keep"));
      (btn as HTMLButtonElement).disabled = glListOff;
      btn.classList.toggle("is-active", !glListOff && n === state.pvpListKeep);
    });
    root.querySelectorAll("[data-pvp-any]").forEach((btn) => {
      const on = btn.getAttribute("data-pvp-any") === "1";
      (btn as HTMLButtonElement).disabled = !pvpLeaguesOn;
      btn.classList.toggle("is-active", on === state.pvpAny);
      btn.setAttribute("aria-pressed", on === state.pvpAny ? "true" : "false");
    });
    root.querySelectorAll("[data-rank]").forEach((btn) => {
      (btn as HTMLButtonElement).disabled = !pvpLeaguesOn;
    });
    root.querySelectorAll("[data-pvp-keep]").forEach((btn) => {
      (btn as HTMLButtonElement).disabled = !pvpLeaguesOn;
    });
    root.querySelectorAll("[data-league]").forEach((btn) => {
      const league = btn.getAttribute("data-league");
      const on =
        league === "lc" ? state.keepLc : league === "ul" ? state.keepUl : league === "ml" ? state.keepMl : state.keepGl;
      btn.classList.toggle("is-off", !on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    root.querySelectorAll("[data-rankings-tab]").forEach((btn) => {
      const tab = btn.getAttribute("data-rankings-tab");
      if (tab === "ul") btn.toggleAttribute("hidden", !state.keepUl);
      if (tab === "ml") btn.toggleAttribute("hidden", !state.keepMl);
    });
    root.querySelectorAll("[data-rankings-pane]").forEach((pane) => {
      const tab = pane.getAttribute("data-rankings-pane");
      if (tab === "ul") pane.toggleAttribute("hidden", !state.keepUl);
      if (tab === "ml") pane.toggleAttribute("hidden", !state.keepMl);
    });
    if ((state.rankingsTab === "ul" && !state.keepUl) || (state.rankingsTab === "ml" && !state.keepMl)) {
      state.rankingsTab = "gl";
    }
    root.querySelectorAll("[data-pvp-keep]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-pvp-keep"));
      btn.classList.toggle("is-active", n === state.pvpKeep);
    });
    root.querySelectorAll("[data-raid-keep]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-raid-keep"));
      btn.classList.toggle("is-active", n === state.raidKeep);
    });
    root.querySelectorAll("[data-family-keep]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-family-keep"));
      btn.classList.toggle("is-active", n === state.familyKeep);
    });
    root.querySelectorAll("[data-raid-iv]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-raid-iv"));
      btn.classList.toggle("is-active", n === state.raidIvKeep);
    });
    root.querySelectorAll("[data-keep-chip]").forEach((btn) => {
      const on = keepChipOn(btn.getAttribute("data-keep-chip"));
      btn.classList.toggle("is-off", !on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const transferLockEl = root.querySelector("#transfer-lock");
    if (transferLockEl) {
      transferLockEl.textContent = state.keepFavorite
        ? ""
        : "Favorites can DUMP when other rules do not save them.";
      transferLockEl.classList.toggle("hidden", state.keepFavorite);
    }
    skipScanEl.textContent = skipScanString({
      keepLucky: state.keepLucky,
      keepFavorite: state.keepFavorite,
    });
    rankingsFilterInputs.forEach((input) => {
      if (input.value !== state.rankingsFilter) input.value = state.rankingsFilter;
    });
    root.querySelectorAll("[data-rankings-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-rankings-tab") === state.rankingsTab);
    });
    root.querySelectorAll("[data-rankings-pane]").forEach((pane) => {
      pane.classList.toggle("is-active", pane.getAttribute("data-rankings-pane") === state.rankingsTab);
    });
    root.querySelectorAll("[data-raid-type]").forEach((btn) => {
      const value = (btn as HTMLElement).dataset.raidType ?? "";
      const on = value === "all" ? !state.rankingsRaidType : value === state.rankingsRaidType;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintRankings();
  }

  function rankingsFamilyIds(query: string): Set<string> {
    const q = query.trim();
    if (!q) return new Set();
    return familyIdsMatchingQuery(q, state.meta?.familyOf);
  }

  function raidTagClass(tag: string): string {
    if (tag === "Shadow") return "chip chip--shadow";
    if (tag === "Mega") return "chip chip--max";
    if (tag === "Primal") return "chip chip--raid";
    if (tag === "Legendary") return "chip chip--legendary";
    if (tag === "Mythical") return "chip chip--mythical";
    if (tag === "Limited") return "chip chip--limited";
    return "chip";
  }

  function renderRankingTable(
    rows: PvpokeRankRow[] | undefined,
    cutoff: number | null,
    empty: string,
  ): string {
    if (!rows || rows.length === 0) {
      return `<p class="empty">${escapeHtml(empty)}</p>`;
    }
    const q = state.rankingsFilter.trim().toLowerCase();
    const familyIds = rankingsFamilyIds(state.rankingsFilter);
    const shown = rows.filter((row) => rankingsRowMatches(row, q, familyIds));
    if (shown.length === 0) {
      return `<p class="empty">No species match “${escapeHtml(state.rankingsFilter.trim())}”</p>`;
    }
    const hasScore = shown.some((row) => row.score != null);
    const body = shown
      .map((row) => {
        const cut = cutoff != null && row.rank > cutoff;
        const name = row.speciesName || prettySpeciesId(row.speciesId);
        const score =
          hasScore && row.score != null ? row.score.toFixed(1) : hasScore ? "—" : "";
        return `<tr class="${cut ? "is-cut" : ""}">
          <td class="rankings-num">${row.rank}</td>
          <td>${escapeHtml(name)}</td>
          ${hasScore ? `<td class="rankings-num">${score}</td>` : ""}
        </tr>`;
      })
      .join("");
    return `<table class="rankings-table">
      <thead><tr><th>#</th><th>Species</th>${hasScore ? "<th>Score</th>" : ""}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function renderRaidTable(rows: RaidAttackerRow[] | undefined, empty: string): string {
    if (!rows || rows.length === 0) {
      return `<p class="empty">${escapeHtml(empty)}</p>`;
    }
    const type = state.rankingsRaidType;
    const typed = type ? rows.filter((row) => raidRowHasType(row, type)) : rows;
    const ordered = [...typed].sort((a, b) => {
      if (type) {
        const ar = a.typeRanks[type] ?? Number.MAX_SAFE_INTEGER;
        const br = b.typeRanks[type] ?? Number.MAX_SAFE_INTEGER;
        if (ar !== br) return ar - br;
      } else if (a.rank !== b.rank) return a.rank - b.rank;
      const ap = a.asSpeciesId ? 1 : 0;
      const bp = b.asSpeciesId ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return a.speciesName.localeCompare(b.speciesName) || a.speciesId.localeCompare(b.speciesId);
    });
    const q = state.rankingsFilter.trim().toLowerCase();
    const familyIds = rankingsFamilyIds(state.rankingsFilter);
    const shown = ordered.filter((row) => rankingsRowMatches(row, q, familyIds));
    if (shown.length === 0) {
      const typeLabel = type ? prettyPokemonType(type) : "";
      if (q) {
        const inType = typeLabel ? ` in ${typeLabel}` : "";
        return `<p class="empty">No species match “${escapeHtml(state.rankingsFilter.trim())}”${inType}</p>`;
      }
      return `<p class="empty">No ${escapeHtml(typeLabel || "raid")} attackers on the Dittobase list</p>`;
    }
    const body = shown
      .map((row) => {
        const chips = [
          ...row.types.map((pokeType) => typeChipMarkup(pokeType)),
          ...row.tags.map((tag) => `<span class="${raidTagClass(tag)}">${escapeHtml(tag)}</span>`),
        ];
        if (row.asSpeciesName) {
          chips.push(`<span class="chip chip--raid">as ${escapeHtml(row.asSpeciesName)}</span>`);
        }
        const tags = chips.length === 0 ? "" : `<div class="rankings-tags">${chips.join("")}</div>`;
        const displayRank = type ? (row.typeRanks[type] ?? row.rank) : row.rank;
        const cut = raidRowCut(row, type);
        return `<tr class="${cut ? "is-cut" : ""}">
          <td class="rankings-num">${displayRank}</td>
          <td>${escapeHtml(row.speciesName)}</td>
          <td>${tags}</td>
        </tr>`;
      })
      .join("");
    return `<table class="rankings-table">
      <thead><tr><th>#</th><th>Species</th><th>Types / tags</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function paintRankings(): void {
    const meta = state.meta;
    if (!meta) {
      rankingsStatusEl.textContent = "Loading lists…";
      rankingsGlEl.innerHTML = `<p class="empty">Waiting for PvPoke lists</p>`;
      rankingsUlEl.innerHTML = `<p class="empty">Waiting for PvPoke lists</p>`;
      rankingsMlEl.innerHTML = `<p class="empty">Waiting for PvPoke lists</p>`;
      rankingsLcEl.innerHTML = `<p class="empty">Waiting for PvPoke lists</p>`;
      rankingsRaidEl.innerHTML = `<p class="empty">Waiting for raid list</p>`;
      return;
    }
    const gl = meta.glRankings ?? [];
    const ul = meta.ulRankings ?? [];
    const ml = meta.mlRankings ?? [];
    const lc = meta.lcRankings ?? [];
    const raid = meta.raidRankings ?? [];
    const raidKeepCount = raid.filter((row) => !row.asSpeciesId && row.viable !== false).length;
    const raidPre = raid.filter((row) => Boolean(row.asSpeciesId)).length;
    const glIn = state.pvpAny ? gl.length : gl.filter((row) => row.rank <= state.pvpListKeep).length;
    const ulIn = state.pvpAny ? ul.length : ul.filter((row) => row.rank <= state.pvpListKeep).length;
    const mlIn = state.pvpAny ? ml.length : ml.filter((row) => row.rank <= state.pvpListKeep).length;
    const raidType = state.rankingsRaidType;
    const raidTypeLabel = raidType ? prettyPokemonType(raidType) : "";
    const raidTyped = raidType ? raid.filter((row) => raidRowHasType(row, raidType)).length : 0;
    const typeStatus = raidType ? ` · ${raidTyped} ${raidTypeLabel}` : "";
    const glStatus = !state.keepGl
      ? "GL off"
      : state.pvpAny
        ? "GL any species"
        : `GL ${glIn}/${gl.length || GL_LIST_CAP} in play`;
    const lcStatus = !state.keepLc
      ? "LC off"
      : state.pvpAny
        ? "LC any unevolved"
        : `LC top ${lc.length || LC_LIST_CAP}`;
    const ulStatus = !state.keepUl
      ? ""
      : openLeagueBusy === "ul"
        ? "UL loading…"
        : ul.length === 0
          ? "UL list missing"
          : state.pvpAny
            ? "UL any species"
            : `UL ${ulIn}/${ul.length || UL_LIST_CAP} in play`;
    const mlStatus = !state.keepMl
      ? ""
      : openLeagueBusy === "ml"
        ? "ML loading…"
        : ml.length === 0
          ? "ML list missing"
          : state.pvpAny
            ? "ML any species"
            : `ML ${mlIn}/${ml.length || ML_LIST_CAP} in play`;
    rankingsStatusEl.textContent = [pvpokeStatus(meta), raidListStatus(meta), glStatus, ulStatus, mlStatus, lcStatus, `${raidKeepCount} raid KEEP`, `${raidPre} pre-evos${typeStatus}`]
      .filter(Boolean)
      .join(" · ");
    rankingsRaidTitleEl.textContent = raidType ? `${raidTypeLabel} raid attackers` : "Raid attackers";
    rankingsRaidNoteEl.textContent = raidType
      ? `${raidTypeLabel} attackers by Dittobase eDPS (1 = best). A tier and better are raid KEEP. Dimmed rows are below A on ${raidTypeLabel}. Pre-evos share that attacker’s rank.`
      : "Dittobase eDPS (1 = best across types). A tier and better are raid KEEP. Dimmed rows are ranked but not kept. Pre-evolutions sit with the attacker they count as.";
    rankingsGlEl.innerHTML = renderRankingTable(
      gl,
      state.pvpAny ? null : state.pvpListKeep,
      "Great League list missing",
    );
    rankingsUlEl.innerHTML = state.keepUl
      ? renderRankingTable(
          ul,
          state.pvpAny ? null : state.pvpListKeep,
          openLeagueBusy === "ul" ? "Loading Ultra League rankings…" : "Ultra League list missing",
        )
      : "";
    rankingsMlEl.innerHTML = state.keepMl
      ? renderRankingTable(
          ml,
          state.pvpAny ? null : state.pvpListKeep,
          openLeagueBusy === "ml" ? "Loading Master League rankings…" : "Master League list missing",
        )
      : "";
    rankingsLcEl.innerHTML = renderRankingTable(lc, null, "Little Cup list missing");
    rankingsRaidEl.innerHTML = renderRaidTable(raid, "Raid attacker list missing");
  }

  function showError(message: string): void {
    state.error = message;
    errorEl.textContent = message;
    errorEl.classList.toggle("hidden", !message);
  }

  function showBusy(message: string): void {
    state.busy = message;
    busyEl.textContent = message;
    busyEl.classList.toggle("hidden", !message);
  }

  function paintList(): void {
    const result = state.result;
    if (!result) return;
    root.querySelectorAll(".tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === state.tab);
    });
    root.querySelectorAll(".track").forEach((track) => {
      track.classList.toggle("is-active", track.getAttribute("data-track") === state.tab);
    });
    paintTrack(listKeepEl, shownRows(result.keep), "KEEP", LIST_PAINT_MAX, state.meta);
    paintTrack(listLookEl, shownRows(result.look), "LOOK", LIST_PAINT_MAX, state.meta);
    const dumpRows = shownRows(result.dump);
    paintTrack(listDumpEl, dumpRows, "DUMP", dumpRows.length, state.meta);
  }

  function listScrolls(): { box: number; keep: number; look: number; dump: number } {
    return {
      box: boxScrollEl.scrollTop,
      keep: listKeepEl.scrollTop,
      look: listLookEl.scrollTop,
      dump: listDumpEl.scrollTop,
    };
  }

  function restoreListScrolls(saved: { box: number; keep: number; look: number; dump: number }): void {
    boxScrollEl.scrollTop = saved.box;
    listKeepEl.scrollTop = saved.keep;
    listLookEl.scrollTop = saved.look;
    listDumpEl.scrollTop = saved.dump;
  }

  function paintBoxChrome(): void {
    const gone = new Set(state.dismissed);
    if (state.boxSelected != null && gone.has(state.boxSelected)) state.boxSelected = null;
    const selected = state.boxSelected;
    for (const el of root.querySelectorAll<HTMLButtonElement>("[data-box-open]")) {
      const on = Number(el.dataset.boxOpen) === selected;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
      if (!on) el.removeAttribute("aria-describedby");
      el.closest(".box-tile")?.classList.toggle("is-selected", on);
    }
    const item = selected == null ? undefined : findGraded(selected);
    const hiddenByFilter = item != null && !state.boxFilter[item.verdict];
    if (!item || gone.has(item.mon.sourceRow) || hiddenByFilter) {
      boxDetailEl.classList.add("hidden");
      boxDetailEl.innerHTML = "";
    } else {
      boxDetailEl.classList.remove("hidden");
      boxDetailEl.innerHTML = renderBoxDetail(item);
    }
    placeBoxDetail();
    placeBoxTip();
    for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-box-filter]")) {
      const verdict = btn.dataset.boxFilter;
      if (verdict !== "KEEP" && verdict !== "LOOK" && verdict !== "DUMP") continue;
      const on = state.boxFilter[verdict];
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-box-sort]")) {
      const on = btn.dataset.boxSort === state.boxSort;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const n = state.dismissed.length;
    boxClearedEl.textContent = n === 0 ? "" : n === 1 ? "1 removed" : `${n} removed`;
    boxUndoEl.classList.toggle("hidden", n === 0);
    boxRestoreEl.classList.toggle("hidden", n === 0);
  }

  function paintBox(): void {
    const result = state.result;
    if (!result) return;
    const rows = boxRows(result);
    const selected = state.boxSelected;
    boxGridEl.innerHTML =
      rows.length > 0
        ? rows.map((row) => renderBoxTile(row, row.mon.sourceRow === selected)).join("")
        : `<p class="empty">${boxEmptyNote(result)}</p>`;
    const shown = String(rows.length);
    const boxCount = root.querySelector("#count-box");
    const boxTabCount = root.querySelector("#count-box-tab");
    if (boxCount) boxCount.textContent = shown;
    if (boxTabCount) boxTabCount.textContent = shown;
    paintBoxChrome();
  }

  function persistDismissed(): void {
    writeDismissed(state.boxFileKey, state.dismissed);
  }

  function commitDismiss(sourceRow: number): void {
    if (!Number.isFinite(sourceRow) || state.dismissed.includes(sourceRow)) return;
    const saved = listScrolls();
    state.dismissed.push(sourceRow);
    if (state.boxSelected === sourceRow) state.boxSelected = null;
    persistDismissed();
    paintResults();
    restoreListScrolls(saved);
  }

  function dismissBox(sourceRow: number): void {
    if (!Number.isFinite(sourceRow) || state.dismissed.includes(sourceRow)) return;
    const tile = boxGridEl
      .querySelector(`[data-box-dismiss="${sourceRow}"]`)
      ?.closest(".box-tile");
    if (!(tile instanceof HTMLElement) || tile.classList.contains("is-leaving")) {
      commitDismiss(sourceRow);
      return;
    }
    tile.classList.add("is-leaving");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      commitDismiss(sourceRow);
    };
    const anim = tile.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.86)" },
      ],
      { duration: 180, easing: "ease", fill: "forwards" },
    );
    anim.onfinish = finish;
    window.setTimeout(finish, 260);
  }

  function undoBox(): void {
    if (state.dismissed.length === 0) return;
    const saved = listScrolls();
    state.dismissed.pop();
    persistDismissed();
    paintResults();
    restoreListScrolls(saved);
  }

  function restoreBox(): void {
    if (state.dismissed.length === 0) return;
    const saved = listScrolls();
    state.dismissed = [];
    persistDismissed();
    paintResults();
    restoreListScrolls(saved);
  }

  function placeBoxDetail(): void {
    const pin = state.pinDetail;
    boxPinEl.classList.toggle("is-active", pin);
    boxPinEl.setAttribute("aria-pressed", pin ? "true" : "false");
    if (pin) {
      if (boxDetailEl.parentElement !== boxStickyEl) boxStickyEl.appendChild(boxDetailEl);
      return;
    }
    if (boxDetailEl.nextElementSibling !== boxSortEl) boxScrollEl.insertBefore(boxDetailEl, boxSortEl);
  }

  function toggleBox(sourceRow: number): void {
    if (!Number.isFinite(sourceRow)) return;
    state.boxSelected = state.boxSelected === sourceRow ? null : sourceRow;
    paintBoxChrome();
  }

  function placeBoxTip(): void {
    const selected = state.boxSelected;
    const item = selected == null ? undefined : findGraded(selected);
    const gone = state.dismissed.includes(selected ?? -1);
    const open = boxGridEl.querySelector(`[data-box-open="${selected}"]`);
    const tile = open?.closest(".box-tile");
    if (!item || gone || !(tile instanceof HTMLElement)) {
      boxTipEl.classList.add("hidden");
      boxTipEl.textContent = "";
      return;
    }
    const port = boxScrollEl.getBoundingClientRect();
    const rect = tile.getBoundingClientRect();
    const viewTop = Math.max(port.top, 0);
    const viewBottom = Math.min(port.bottom, window.innerHeight);
    const onScreen =
      rect.bottom > viewTop + 4 &&
      rect.top < viewBottom - 4 &&
      rect.right > 0 &&
      rect.left < window.innerWidth;
    if (!onScreen) {
      boxTipEl.classList.add("hidden");
      return;
    }
    boxTipEl.classList.remove("box-tip--keep", "box-tip--look", "box-tip--dump");
    boxTipEl.classList.add(`box-tip--${item.verdict.toLowerCase()}`);
    boxTipEl.textContent = mainBoxReason(item);
    boxTipEl.style.left = "-9999px";
    boxTipEl.classList.remove("hidden");
    const margin = 8;
    const tipW = boxTipEl.offsetWidth;
    const tipH = boxTipEl.offsetHeight;
    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));
    let top = rect.bottom + 6;
    let limitBottom = window.innerHeight - margin;
    const tabs = root.querySelector(".tabs");
    if (tabs instanceof HTMLElement && getComputedStyle(tabs).display !== "none") {
      const tabRect = tabs.getBoundingClientRect();
      if (tabRect.top > window.innerHeight * 0.5) limitBottom = Math.min(limitBottom, tabRect.top - margin);
    }
    if (top + tipH > limitBottom) top = rect.top - tipH - 6;
    if (top < margin) top = margin;
    boxTipEl.style.left = `${Math.round(left)}px`;
    boxTipEl.style.top = `${Math.round(top)}px`;
    const button = open instanceof HTMLButtonElement ? open : null;
    button?.setAttribute("aria-describedby", "box-tip");
  }

  function paintResults(): void {
    const result = state.result;
    const parse = state.parse;
    if (!result || !parse) {
      resultsEl.classList.add("hidden");
      gradeTablesEl.classList.add("hidden");
      statusEl.classList.add("hidden");
      statusEl.textContent = "";
      issuesEl.classList.add("hidden");
      issuesEl.innerHTML = "";
      return;
    }
    resultsEl.classList.remove("hidden");
    gradeTablesEl.classList.remove("hidden");
    statusEl.classList.remove("hidden");
    const removedNote = state.dismissed.length > 0 ? ` · ${state.dismissed.length} removed from list` : "";
    const leagueStatus = [
      result.keepGl ? "KEEP GL" : "GL off",
      result.keepUl ? "KEEP UL" : "",
      result.keepMl ? "KEEP ML" : "",
      result.keepLc ? "KEEP LC" : "LC off",
    ]
      .filter(Boolean)
      .join(" · ");
    const pvpStatus =
      result.keepGl || result.keepUl || result.keepMl || result.keepLc
        ? [
            `KEEP PvP ≤${result.pvpRankKeep}/${PVP_RANK_OF}`,
            result.keepGl || result.keepUl || result.keepMl
              ? result.pvpAny
                ? "PvP any species"
                : `PvPoke top ${result.pvpListKeep}/${GL_LIST_CAP}`
              : null,
            `Keep ${result.pvpKeep} PvP/identity`,
          ]
            .filter(Boolean)
            .join(" · ")
        : "PvP idle";
    statusEl.textContent = `${state.fileName} · ${parse.dialect} · ${parse.mons.length} scanned · ${leagueStatus} · ${pvpStatus} · Keep ${result.raidKeep} raid · Keep ${result.familyKeep}/family · KEEP raid ≥${result.raidIvKeep}% IV · ${result.keepAllGood ? "All 4*" : "One 4*"} · ${result.keepLucky ? "KEEP lucky" : "Lucky off"} · ${result.keepFavorite ? "KEEP favorite" : "Favorite can dump"} · ${result.keepShadow ? "KEEP shadow" : "Shadow can dump"} · ${pvpokeStatus(state.meta)} · ${raidListStatus(state.meta)}${removedNote}`;
    const counts: Array<[string, number]> = [
      ["keep", shownRows(result.keep).length],
      ["look", shownRows(result.look).length],
      ["dump", shownRows(result.dump).length],
    ];
    for (const [id, n] of counts) {
      const main = root.querySelector(`#count-${id}`) as HTMLElement | null;
      const tab = root.querySelector(`#count-${id}-tab`) as HTMLElement | null;
      if (main) main.textContent = String(n);
      if (tab) tab.textContent = String(n);
    }

    if (parse.issues.length > 0) {
      issuesEl.classList.remove("hidden");
      issuesEl.innerHTML = parse.issues
        .slice(0, 12)
        .map((issue) => `<li>Row ${issue.row}: ${escapeHtml(issue.message)}</li>`)
        .join("");
      if (parse.issues.length > 12) {
        issuesEl.insertAdjacentHTML(
          "beforeend",
          `<li>…and ${parse.issues.length - 12} more parse notes</li>`,
        );
      }
    } else {
      issuesEl.classList.add("hidden");
      issuesEl.innerHTML = "";
    }


    paintList();
    paintBox();
  }

  let csvEpoch = 0;

  function paintCsvField(): void {
    const filled = state.fileName.length > 0;
    csvField.classList.toggle("is-filled", filled);
    csvName.textContent = filled ? state.fileName : "Choose a CSV";
    csvName.title = filled ? state.fileName : "";
    csvClear.classList.toggle("hidden", !filled);
    csvClear.hidden = !filled;
  }

  function readFileText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsText(file);
    });
  }

  interface CsvSnapshot {
    fileName: string;
    parse: ParseResult | null;
    result: GradeResult | null;
    boxFileKey: string;
    dismissed: number[];
    boxSelected: number | null;
    tab: Tab;
  }

  function snapshotCsv(): CsvSnapshot {
    return {
      fileName: state.fileName,
      parse: state.parse,
      result: state.result,
      boxFileKey: state.boxFileKey,
      dismissed: state.dismissed.slice(),
      boxSelected: state.boxSelected,
      tab: state.tab,
    };
  }

  function applyCsvSnapshot(snap: CsvSnapshot): void {
    fileInput.value = "";
    state.fileName = snap.fileName;
    state.parse = snap.parse;
    state.result = snap.result;
    state.boxFileKey = snap.boxFileKey;
    state.dismissed = snap.dismissed;
    state.boxSelected = snap.boxSelected;
    state.tab = snap.tab;
    showBusy("");
    paintCsvField();
    paintResults();
  }

  function resetCsvView(): void {
    applyCsvSnapshot({
      fileName: "",
      parse: null,
      result: null,
      boxFileKey: "",
      dismissed: [],
      boxSelected: null,
      tab: state.tab,
    });
    showError("");
  }

  async function gradeCsv(
    text: string,
    file: { name: string; size: number; lastModified: number },
    persist: boolean,
    epoch: number,
    previous: CsvSnapshot,
  ): Promise<void> {
    const current = () => epoch === csvEpoch;
    const fail = async (message: string): Promise<void> => {
      if (!current()) return;
      applyCsvSnapshot(previous);
      showError(message);
      if (persist) return;
      try {
        await clearLastCsv();
      } catch {
        /* the error above still explains why the reload had nothing to grade */
      }
    };

    showError("");
    showBusy("Reading CSV on this device…");
    state.fileName = file.name;
    paintCsvField();
    resultsEl.classList.add("hidden");
    gradeTablesEl.classList.add("hidden");
    statusEl.classList.add("hidden");
    issuesEl.classList.add("hidden");

    let engine: Engine;
    try {
      engine = await loadEngine();
    } catch (err) {
      await fail(errMsg(err));
      return;
    }
    if (!current()) return;

    let parsed: ParseResult;
    try {
      showBusy("Parsing inventory…");
      parsed = engine.parseInventoryCsv(text);
    } catch (err) {
      await fail(`CSV parse failed: ${errMsg(err)}`);
      return;
    }
    if (!current()) return;

    let meta: Meta;
    try {
      showBusy("Loading meta gates…");
      meta = await engine.loadMeta({ ultra: state.keepUl, master: state.keepMl });
    } catch (err) {
      await fail(`loadMeta failed: ${errMsg(err)}`);
      return;
    }
    if (!current()) return;

    let graded: GradeResult;
    try {
      showBusy("Grading box…");
      graded = engine.gradeBox(parsed.mons, gradeKnobs(meta));
    } catch (err) {
      await fail(`gradeBox failed: ${errMsg(err)}`);
      return;
    }
    if (!current()) return;

    state.engine = engine;
    state.meta = meta;
    state.parse = parsed;
    state.result = graded;
    state.fileName = file.name;
    state.tab = readStoredTab() ?? pickDefaultTab(graded);
    state.boxFileKey = boxStorageKey(file);
    const alive = new Set(parsed.mons.map((mon) => mon.sourceRow));
    state.dismissed = readDismissed(state.boxFileKey).filter((row) => alive.has(row));
    state.boxSelected = null;
    if (state.dismissed.length > 0) writeDismissed(state.boxFileKey, state.dismissed);
    showBusy("");
    paintCsvField();
    paintRankings();
    paintResults();

    if (!persist || !current()) return;
    try {
      await saveLastCsv({
        name: file.name,
        text,
        size: file.size,
        lastModified: file.lastModified,
      });
    } catch (err) {
      if (!current()) return;
      showError(`Graded, but this browser could not keep the CSV: ${errMsg(err)}`);
    }
  }

  async function acceptFile(file: File): Promise<void> {
    const epoch = ++csvEpoch;
    const previous = snapshotCsv();
    state.fileName = file.name;
    paintCsvField();
    showError("");
    showBusy("Reading CSV on this device…");
    let text: string;
    try {
      text = await readFileText(file);
    } catch (err) {
      if (epoch !== csvEpoch) return;
      applyCsvSnapshot(previous);
      showError(errMsg(err));
      return;
    }
    if (epoch !== csvEpoch) return;
    await gradeCsv(text, file, true, epoch, previous);
  }

  async function clearStoredCsv(): Promise<void> {
    csvEpoch++;
    resetCsvView();
    try {
      await clearLastCsv();
    } catch (err) {
      showError(`Could not remove the stored CSV: ${errMsg(err)}`);
    }
  }

  function regradeLive(): void {
    const parsed = state.parse;
    const engine = state.engine;
    const meta = state.meta;
    if (!parsed || !engine || !meta) return;
    try {
      state.result = engine.gradeBox(parsed.mons, gradeKnobs(meta));
      paintResults();
    } catch (err) {
      showError(`gradeBox failed: ${errMsg(err)}`);
    }
  }

  function applyRankKeep(raw: unknown): void {
    const next = clampPvpRankKeep(raw);
    state.pvpRankKeep = next;
    persistRankKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyListKeep(raw: unknown): void {
    const next = clampPvpListKeep(raw);
    state.pvpListKeep = next;
    state.pvpAny = false;
    persistListKeep(next);
    persistPvpAny(false);
    paintRankControls();
    regradeLive();
  }

  function applyPvpAny(on: boolean): void {
    state.pvpAny = on;
    persistPvpAny(on);
    paintRankControls();
    regradeLive();
  }

  function applyPvpKeep(raw: unknown): void {
    const next = clampPvpKeep(raw);
    state.pvpKeep = next;
    persistPvpKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyRaidKeep(raw: unknown): void {
    const next = clampRaidKeep(raw);
    state.raidKeep = next;
    persistRaidKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyFamilyKeep(raw: unknown): void {
    const next = clampFamilyKeep(raw);
    state.familyKeep = next;
    persistFamilyKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyRaidIvKeep(raw: unknown): void {
    const next = clampRaidIvKeep(raw);
    state.raidIvKeep = next;
    persistRaidIvKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyKeepAllGood(on: boolean): void {
    state.keepAllGood = on;
    persistKeepAllGood(on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepLucky(on: boolean): void {
    state.keepLucky = on;
    persistKeepLucky(on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepFavorite(on: boolean): void {
    state.keepFavorite = on;
    persistKeepFavorite(on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepShadow(on: boolean): void {
    state.keepShadow = on;
    persistKeepShadow(on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepGl(on: boolean): void {
    state.keepGl = on;
    persistLeague(KEEP_GL_KEY, on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepLc(on: boolean): void {
    state.keepLc = on;
    persistLeague(KEEP_LC_KEY, on);
    paintRankControls();
    regradeLive();
  }

  let leagueEpoch = 0;
  let openLeagueBusy: "ul" | "ml" | "" = "";

  async function applyOpenLeague(which: "ul" | "ml", on: boolean): Promise<void> {
    if (which === "ul") state.keepUl = on;
    else state.keepMl = on;
    persistLeague(which === "ul" ? KEEP_UL_KEY : KEEP_ML_KEY, on);
    const epoch = ++leagueEpoch;
    const label = which === "ul" ? "Ultra League" : "Master League";
    if (on) {
      openLeagueBusy = which;
      showBusy(`Loading ${label} rankings…`);
    } else if (openLeagueBusy === which) {
      openLeagueBusy = "";
      showBusy("");
    }
    paintRankControls();
    if (on) {
      try {
        const engine = state.engine ?? (await loadEngine());
        state.engine = engine;
        if (epoch !== leagueEpoch) return;
        const fresh = await engine.loadMeta({ ultra: state.keepUl, master: state.keepMl });
        if (epoch !== leagueEpoch) return;
        state.meta = state.meta
          ? {
              ...state.meta,
              ulRankings: state.keepUl ? fresh.ulRankings : undefined,
              ulSource: state.keepUl ? fresh.ulSource : undefined,
              ulFetchedAt: state.keepUl ? fresh.ulFetchedAt : undefined,
              mlRankings: state.keepMl ? fresh.mlRankings : undefined,
              mlSource: state.keepMl ? fresh.mlSource : undefined,
              mlFetchedAt: state.keepMl ? fresh.mlFetchedAt : undefined,
            }
          : fresh;
        const loaded = which === "ul" ? state.meta.ulRankings : state.meta.mlRankings;
        const source = which === "ul" ? state.meta.ulSource : state.meta.mlSource;
        if (!loaded?.length || source === "missing") {
          showError(`Could not load ${label} rankings. That league will not KEEP until the list loads.`);
        } else {
          showError("");
        }
      } catch (err) {
        if (epoch === leagueEpoch) showError(`Could not load ${label} rankings: ${errMsg(err)}`);
      } finally {
        if (epoch === leagueEpoch) {
          openLeagueBusy = "";
          showBusy("");
        }
      }
    } else if (state.meta) {
      state.meta = {
        ...state.meta,
        ...(which === "ul"
          ? { ulRankings: undefined, ulSource: undefined, ulFetchedAt: undefined }
          : { mlRankings: undefined, mlSource: undefined, mlFetchedAt: undefined }),
      };
    }
    if (epoch !== leagueEpoch) return;
    paintRankControls();
    regradeLive();
  }

  paintRankControls();

  rankInput.addEventListener("change", () => {
    applyRankKeep(rankInput.value);
  });
  rankInput.addEventListener("blur", () => {
    applyRankKeep(rankInput.value);
  });
  listKeepInput.addEventListener("change", () => {
    applyListKeep(listKeepInput.value);
  });
  listKeepInput.addEventListener("blur", () => {
    applyListKeep(listKeepInput.value);
  });
  pvpKeepInput.addEventListener("change", () => {
    applyPvpKeep(pvpKeepInput.value);
  });
  pvpKeepInput.addEventListener("blur", () => {
    applyPvpKeep(pvpKeepInput.value);
  });
  raidKeepInput.addEventListener("change", () => {
    applyRaidKeep(raidKeepInput.value);
  });
  raidKeepInput.addEventListener("blur", () => {
    applyRaidKeep(raidKeepInput.value);
  });
  familyKeepInput.addEventListener("change", () => {
    applyFamilyKeep(familyKeepInput.value);
  });
  familyKeepInput.addEventListener("blur", () => {
    applyFamilyKeep(familyKeepInput.value);
  });
  raidIvKeepInput.addEventListener("change", () => {
    applyRaidIvKeep(raidIvKeepInput.value);
  });
  raidIvKeepInput.addEventListener("blur", () => {
    applyRaidIvKeep(raidIvKeepInput.value);
  });
  rankingsFilterInputs.forEach((input) => {
    input.addEventListener("input", () => {
      state.rankingsFilter = input.value;
      rankingsFilterInputs.forEach((other) => {
        if (other !== input) other.value = input.value;
      });
      paintRankings();
    });
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void acceptFile(file).catch((err) => {
      showBusy("");
      showError(errMsg(err));
    });
  });

  csvClear.addEventListener("click", () => {
    void clearStoredCsv();
  });

  document.addEventListener("scroll", () => placeBoxTip(), { capture: true, passive: true });
  window.addEventListener("resize", () => placeBoxTip());

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const rankBtn = target.closest("[data-rank]") as HTMLElement | null;
    if (rankBtn?.dataset.rank && !rankBtn.hasAttribute("disabled")) {
      applyRankKeep(rankBtn.dataset.rank);
      return;
    }

    const listKeepBtn = target.closest("[data-list-keep]") as HTMLElement | null;
    if (listKeepBtn?.dataset.listKeep && !listKeepBtn.hasAttribute("disabled")) {
      applyListKeep(listKeepBtn.dataset.listKeep);
      return;
    }

    const pvpAnyBtn = target.closest("[data-pvp-any]") as HTMLElement | null;
    if (pvpAnyBtn?.dataset.pvpAny != null && !pvpAnyBtn.hasAttribute("disabled")) {
      applyPvpAny(pvpAnyBtn.dataset.pvpAny === "1");
      return;
    }

    const leagueBtn = target.closest("[data-league]") as HTMLElement | null;
    if (leagueBtn?.dataset.league === "gl") {
      applyKeepGl(!state.keepGl);
      return;
    }
    if (leagueBtn?.dataset.league === "ul") {
      void applyOpenLeague("ul", !state.keepUl);
      return;
    }
    if (leagueBtn?.dataset.league === "ml") {
      void applyOpenLeague("ml", !state.keepMl);
      return;
    }
    if (leagueBtn?.dataset.league === "lc") {
      applyKeepLc(!state.keepLc);
      return;
    }

    const pvpKeepBtn = target.closest("[data-pvp-keep]") as HTMLElement | null;
    if (pvpKeepBtn?.dataset.pvpKeep && !pvpKeepBtn.hasAttribute("disabled")) {
      applyPvpKeep(pvpKeepBtn.dataset.pvpKeep);
      return;
    }

    const raidKeepBtn = target.closest("[data-raid-keep]") as HTMLElement | null;
    if (raidKeepBtn?.dataset.raidKeep) {
      applyRaidKeep(raidKeepBtn.dataset.raidKeep);
      return;
    }

    const rankingsTabBtn = target.closest("[data-rankings-tab]") as HTMLElement | null;
    if (
      rankingsTabBtn?.dataset.rankingsTab === "gl" ||
      rankingsTabBtn?.dataset.rankingsTab === "ul" ||
      rankingsTabBtn?.dataset.rankingsTab === "ml" ||
      rankingsTabBtn?.dataset.rankingsTab === "lc" ||
      rankingsTabBtn?.dataset.rankingsTab === "raid"
    ) {
      state.rankingsTab = rankingsTabBtn.dataset.rankingsTab;
      paintRankControls();
      return;
    }

    const raidTypeBtn = target.closest("[data-raid-type]") as HTMLElement | null;
    if (raidTypeBtn?.dataset.raidType != null) {
      const next = raidTypeBtn.dataset.raidType;
      if (next === "all") state.rankingsRaidType = "";
      else if (isPokemonType(next)) {
        state.rankingsRaidType = state.rankingsRaidType === next ? "" : next;
      }
      paintRankControls();
      return;
    }

    const familyKeepBtn = target.closest("[data-family-keep]") as HTMLElement | null;
    if (familyKeepBtn?.dataset.familyKeep) {
      applyFamilyKeep(familyKeepBtn.dataset.familyKeep);
      return;
    }

    const raidIvBtn = target.closest("[data-raid-iv]") as HTMLElement | null;
    if (raidIvBtn?.dataset.raidIv) {
      applyRaidIvKeep(raidIvBtn.dataset.raidIv);
      return;
    }

    const keepChipBtn = target.closest("[data-keep-chip]") as HTMLElement | null;
    if (keepChipBtn?.dataset.keepChip === "lucky") {
      applyKeepLucky(!state.keepLucky);
      return;
    }
    if (keepChipBtn?.dataset.keepChip === "shadow") {
      applyKeepShadow(!state.keepShadow);
      return;
    }
    if (keepChipBtn?.dataset.keepChip === "favorite") {
      applyKeepFavorite(!state.keepFavorite);
      return;
    }
    if (keepChipBtn?.dataset.keepChip === "hundo") {
      applyKeepAllGood(!state.keepAllGood);
      return;
    }

    const dismissBtn = target.closest("[data-box-dismiss]") as HTMLElement | null;
    if (dismissBtn?.dataset.boxDismiss) {
      dismissBox(Number(dismissBtn.dataset.boxDismiss));
      return;
    }

    if (target.closest("#box-pin")) {
      state.pinDetail = !state.pinDetail;
      try {
        localStorage.setItem(PIN_DETAIL_KEY, state.pinDetail ? "1" : "0");
      } catch {
        /* private mode */
      }
      placeBoxDetail();
      placeBoxTip();
      return;
    }

    if (target.closest("#box-undo")) {
      undoBox();
      return;
    }

    if (target.closest("#box-restore")) {
      restoreBox();
      return;
    }

    const boxFilterBtn = target.closest("[data-box-filter]") as HTMLElement | null;
    const filterVerdict = boxFilterBtn?.dataset.boxFilter;
    if (filterVerdict === "KEEP" || filterVerdict === "LOOK" || filterVerdict === "DUMP") {
      state.boxFilter[filterVerdict] = !state.boxFilter[filterVerdict];
      try {
        localStorage.setItem(BOX_FILTER_KEY, JSON.stringify(state.boxFilter));
      } catch {
        /* private mode */
      }
      const saved = listScrolls();
      paintBox();
      restoreListScrolls(saved);
      return;
    }

    const boxSortBtn = target.closest("[data-box-sort]") as HTMLElement | null;
    if (boxSortBtn?.dataset.boxSort === "cp" || boxSortBtn?.dataset.boxSort === "scan") {
      const next = boxSortBtn.dataset.boxSort;
      if (state.boxSort !== next) {
        state.boxSort = next;
        paintBox();
        boxScrollEl.scrollTop = 0;
      }
      return;
    }

    const boxOpenBtn = target.closest("[data-box-open]") as HTMLElement | null;
    if (boxOpenBtn?.dataset.boxOpen) {
      toggleBox(Number(boxOpenBtn.dataset.boxOpen));
      return;
    }

    const tabBtn = target.closest("[data-tab]") as HTMLElement | null;
    if (tabBtn?.dataset.tab && state.result) {
      const next = tabBtn.dataset.tab as Tab;
      if (next === "KEEP" || next === "LOOK" || next === "DUMP" || next === "BOX") {
        state.tab = next;
        persistTab(next);
        paintList();
      }
      return;
    }

    const copyBtn = target.closest("[data-copy]") as HTMLButtonElement | null;
    if (!copyBtn) return;
    const payload =
      copyBtn.dataset.copy === "skip"
        ? skipScanString({ keepLucky: state.keepLucky, keepFavorite: state.keepFavorite })
        : "";
    if (!payload) return;
    void copyText(payload).then((ok) => {
      if (ok) markCopied(copyBtn);
      else showError("Copy failed — select the search text manually.");
    });
  });

  placeBoxDetail();

  void loadEngine()
    .then((engine) => {
      state.engine = engine;
      const bootEpoch = leagueEpoch;
      return engine.loadMeta({ ultra: state.keepUl, master: state.keepMl }).then((fresh) => ({ fresh, bootEpoch }));
    })
    .then(({ fresh, bootEpoch }) => {
      if (bootEpoch !== leagueEpoch) return;
      state.meta = fresh;
      paintRankControls();
      if (state.parse) regradeLive();
    })
    .catch(() => {
      rankingsStatusEl.textContent = "Bundled lists load on grade";
    });

  void loadLastCsv()
    .then((stored) => {
      if (!stored || csvEpoch !== 0) return;
      const epoch = ++csvEpoch;
      return gradeCsv(stored.text, stored, false, epoch, snapshotCsv());
    })
    .catch((err) => {
      if (csvEpoch !== 0) return;
      showError(`Could not read the stored CSV: ${errMsg(err)}`);
    });
}
