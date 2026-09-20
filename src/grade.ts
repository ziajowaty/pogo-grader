import type {
  GradeResult,
  GradedMon,
  LeagueRank,
  Meta,
  MetaLeagueRank,
  Mon,
  PvpJob,
  PvpokeRankRow,
  Verdict,
} from "./types";
import {
  clampFamilyKeep,
  clampPvpKeep,
  clampPvpListKeep,
  clampPvpRankKeep,
  clampRaidIvKeep,
  DEFAULT_FAMILY_KEEP,
  DEFAULT_PVP_KEEP,
  DEFAULT_PVP_LIST_KEEP,
  DEFAULT_PVP_RANK_KEEP,
  DEFAULT_RAID_IV_KEEP,
  GL_LIST_CAP,
  LC_LIST_CAP,
  prettySpeciesId,
} from "./types";
import { canonId } from "./meta";
import {
  fitsLeagueCap,
  getRankGm,
  GREAT_LEAGUE_CAP,
  LITTLE_CUP_CAP,
  rankGreatLeagueAs,
  rankLittleCup,
  raidIvPercent,
  type RankGm,
} from "./rank";

const RAID_KEEP = 6;
const MAX_REASON = 8;

function hasId(set: Set<string>, speciesId: string): boolean {
  const id = canonId(speciesId);
  if (set.has(id)) return true;
  if (id.endsWith("_shadow") && set.has(id.slice(0, -7))) return true;
  return false;
}

function indexRanks(rows: PvpokeRankRow[] | undefined): Map<string, PvpokeRankRow> {
  const map = new Map<string, PvpokeRankRow>();
  if (!rows) return map;
  for (const row of rows) map.set(row.speciesId, row);
  return map;
}

function toMetaRank(row: PvpokeRankRow, of: number): MetaLeagueRank {
  return {
    rank: row.rank,
    of,
    speciesId: row.speciesId,
    speciesName: row.speciesName,
  };
}

function lookupRank(speciesId: string, index: Map<string, PvpokeRankRow>): PvpokeRankRow | null {
  const id = canonId(speciesId);
  const direct = index.get(id);
  if (direct) return direct;
  if (id.endsWith("_shadow")) return index.get(id.slice(0, -7)) ?? null;
  return null;
}

function gatedGlSet(meta: Meta, listKeep: number): Set<string> {
  const rows = meta.glRankings;
  if (rows && rows.length > 0) {
    return new Set(rows.filter((row) => row.rank <= listKeep).map((row) => row.speciesId));
  }
  return meta.glTop500;
}

function raidGateId(speciesId: string, meta: Meta): string | null {
  const id = canonId(speciesId);
  if (meta.raidAttackers.has(id)) return id;
  if (id.endsWith("_shadow") && meta.raidAttackers.has(id.slice(0, -7))) return id.slice(0, -7);
  const mapped = meta.raidEvolution?.[id];
  if (mapped && (meta.raidAttackers.has(mapped) || hasId(meta.raidAttackers, mapped))) return mapped;
  if (id.endsWith("_shadow")) {
    const inner = raidGateId(id.slice(0, -7), meta);
    if (!inner) return null;
    const shadowEvo = inner.endsWith("_shadow") ? inner : `${inner}_shadow`;
    if (meta.raidAttackers.has(shadowEvo)) return shadowEvo;
    return inner;
  }
  return null;
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function familyKey(speciesId: string, meta: Meta): string {
  const id = canonId(speciesId);
  return meta.familyOf?.[id] ?? id;
}

function membersByFamily(meta: Meta): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!meta.familyOf) return map;
  for (const [id, fid] of Object.entries(meta.familyOf)) {
    const list = map.get(fid);
    if (list) list.push(id);
    else map.set(fid, [id]);
  }
  return map;
}

function familyMembers(
  speciesId: string,
  meta: Meta,
  byFamily: Map<string, string[]>,
): string[] {
  const members = byFamily.get(familyKey(speciesId, meta));
  if (members && members.length) return members;
  return [canonId(speciesId)];
}

function canBecome(from: string, target: string, meta: Meta): boolean {
  const a = canonId(from);
  const b = canonId(target);
  if (a === b) return true;
  if (meta.evoReach?.[a]?.includes(b)) return true;
  if (meta.glEvolution[a] === b) return true;
  if (meta.raidEvolution?.[a] === b) return true;
  return false;
}

function independentGlIds(members: string[], gateSet: Set<string>, meta: Meta): string[] {
  const direct = members.filter((id) => gateSet.has(id));
  if (direct.length) return uniqueIds(direct);
  const mapped: string[] = [];
  for (const id of members) {
    const evo = meta.glEvolution[id];
    if (evo && gateSet.has(evo)) mapped.push(evo);
  }
  return uniqueIds(mapped);
}

function independentLcIds(members: string[], meta: Meta): string[] {
  return uniqueIds(members.filter((id) => hasId(meta.lcTop100, id)));
}

function independentRaidIds(members: string[], meta: Meta): string[] {
  const direct = members.filter((id) => meta.raidAttackers.has(id) || hasId(meta.raidAttackers, id));
  if (direct.length) return uniqueIds(direct);
  const mapped: string[] = [];
  for (const id of members) {
    const evo = meta.raidEvolution?.[id];
    if (evo) mapped.push(evo);
  }
  return uniqueIds(mapped);
}

function isMegaStage(id: string): boolean {
  return /_mega(?:_[xy])?$/.test(id) || id.includes("_primal") || id.includes("gigantamax");
}

type JobKind = PvpJob["kind"];

interface RoleDef {
  kind: JobKind;
  speciesId: string;
  slots: number;
  metaRank: number;
}

function roleKey(role: Pick<RoleDef, "kind" | "speciesId">): string {
  return `${role.kind}:${role.speciesId}`;
}

const KIND_ORDER: Record<JobKind, number> = { gl: 0, lc: 1, raid: 2 };

function compareRoles(a: RoleDef, b: RoleDef): number {
  const ka = KIND_ORDER[a.kind];
  const kb = KIND_ORDER[b.kind];
  if (ka !== kb) return ka - kb;
  if (a.metaRank !== b.metaRank) return a.metaRank - b.metaRank;
  return a.speciesId.localeCompare(b.speciesId);
}

/**
 * One job per copy. Fill Great League before Little Cup, and within a league
 * exhaust the higher PvPoke species (Dragonair #85 before Dragonite #340)
 * before touching the next identity. Raid leftovers last. Seat count per
 * GL/LC identity is `pvpKeep` (1–3).
 */
function assignFamilyJobs(
  rows: GradedMon[],
  roles: RoleDef[],
  costOf: (g: GradedMon, role: RoleDef) => number | null,
): Map<GradedMon, RoleDef> {
  const assigned = new Map<GradedMon, RoleDef>();
  const live = [...roles].filter((role) => role.slots > 0).sort(compareRoles);
  if (rows.length === 0 || live.length === 0) return assigned;

  const infinite = live.some((role) => !Number.isFinite(role.slots));
  if (infinite) {
    for (const g of rows) {
      for (const role of live) {
        if (costOf(g, role) != null) {
          assigned.set(g, role);
          break;
        }
      }
    }
    return assigned;
  }

  const remaining = new Set(rows);
  for (const role of live) {
    const eligible = [...remaining]
      .map((g) => {
        const cost = costOf(g, role);
        return cost == null ? null : { g, cost };
      })
      .filter((row): row is { g: GradedMon; cost: number } => row != null)
      .sort((a, b) => a.cost - b.cost || a.g.mon.sourceRow - b.g.mon.sourceRow);
    const take = eligible.slice(0, role.slots);
    for (const { g } of take) {
      assigned.set(g, role);
      remaining.delete(g);
    }
  }
  return assigned;
}

function rankAs(g: GradedMon, speciesId: string): LeagueRank | null {
  return g.glAs?.find((r) => r.evoSpeciesId === speciesId) ?? null;
}

function metaAs(g: GradedMon, speciesId: string): MetaLeagueRank | null {
  return g.glMetaAs?.find((m) => m.speciesId === speciesId) ?? (g.glMeta?.speciesId === speciesId ? g.glMeta : null);
}

function glOrderAs(a: GradedMon, b: GradedMon, speciesId: string): number {
  const ar = rankAs(a, speciesId)?.rank ?? 10_000;
  const br = rankAs(b, speciesId)?.rank ?? 10_000;
  if (ar !== br) return ar - br;
  const asp = rankAs(a, speciesId)?.statProduct ?? -1;
  const bsp = rankAs(b, speciesId)?.statProduct ?? -1;
  if (asp !== bsp) return bsp - asp;
  const aiv = a.mon.ivPercent ?? -1;
  const biv = b.mon.ivPercent ?? -1;
  if (aiv !== biv) return biv - aiv;
  return a.mon.sourceRow - b.mon.sourceRow;
}

function betterAsReason(g: GradedMon): string | null {
  const ranks = g.glAs;
  if (!ranks || ranks.length < 2) return null;
  const sorted = [...ranks].sort((a, b) => a.rank - b.rank || b.statProduct - a.statProduct);
  if (sorted[0].evoSpeciesId === sorted[1].evoSpeciesId) return null;
  if (sorted[0].rank === sorted[1].rank) return null;
  return `Better as ${prettySpeciesId(sorted[0].evoSpeciesId)} (${sorted[0].rank}/${sorted[0].of}) than ${prettySpeciesId(sorted[1].evoSpeciesId)} (${sorted[1].rank}/${sorted[1].of})`;
}

function isLcSpecies(speciesId: string, meta: Meta): boolean {
  return hasId(meta.lcTop100, speciesId);
}

function isLimitedMon(mon: Mon, meta: Meta): boolean {
  if (mon.legendary || mon.mythical) return true;
  const id = mon.speciesId;
  return (
    hasId(meta.limited, id) || hasId(meta.legendary, id) || hasId(meta.mythical, id)
  );
}

function isHundo(mon: Mon): boolean {
  if (mon.atk === 15 && mon.def === 15 && mon.sta === 15) return true;
  return Boolean(mon.ivUnique && mon.ivPercent != null && mon.ivPercent >= 100);
}

function isMaxForm(mon: Mon): boolean {
  if (mon.dynamax) return true;
  const blob = `${mon.speciesId} ${mon.form}`;
  return /dynamax|gigantamax|giganta|\bdmax\b|\bgmax\b/i.test(blob);
}

function keepLuckyOn(meta: Meta): boolean {
  return meta.keepLucky !== false;
}

function keepFavoriteOn(meta: Meta): boolean {
  return meta.keepFavorite !== false;
}

function keepShadowOn(meta: Meta): boolean {
  return meta.keepShadow !== false;
}

function idKeepClasses(
  mon: Mon,
  meta: Meta,
  keepShadow: boolean,
  keepLucky: boolean,
  keepFavorite: boolean,
): string[] {
  const classes: string[] = [];
  if (mon.shiny) classes.push("shiny");
  if (keepLucky && mon.lucky) classes.push("lucky");
  if (mon.costume) classes.push("costume");
  if (mon.background) classes.push("background");
  if (keepFavorite && mon.favorite) classes.push("favorite");
  if (mon.hasSpecialMove) classes.push("special-move");
  if (keepShadow && mon.shadow) classes.push("shadow");
  if (isMaxForm(mon)) classes.push("max");
  if (mon.legendary || hasId(meta.legendary, mon.speciesId)) classes.push("legendary");
  else if (mon.mythical || hasId(meta.mythical, mon.speciesId)) classes.push("mythical");
  else if (hasId(meta.limited, mon.speciesId)) classes.push("limited");
  return classes;
}

function cmpNum(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function glOrder(a: GradedMon, b: GradedMon): number {
  const ar = a.gl?.rank ?? 10_000;
  const br = b.gl?.rank ?? 10_000;
  if (ar !== br) return ar - br;
  const asp = a.gl?.statProduct ?? -1;
  const bsp = b.gl?.statProduct ?? -1;
  if (asp !== bsp) return bsp - asp;
  const aiv = a.mon.ivPercent ?? -1;
  const biv = b.mon.ivPercent ?? -1;
  if (aiv !== biv) return biv - aiv;
  return a.mon.sourceRow - b.mon.sourceRow;
}

function lcOrder(a: GradedMon, b: GradedMon): number {
  const ar = a.lc?.rank ?? 10_000;
  const br = b.lc?.rank ?? 10_000;
  if (ar !== br) return ar - br;
  const asp = a.lc?.statProduct ?? -1;
  const bsp = b.lc?.statProduct ?? -1;
  if (asp !== bsp) return bsp - asp;
  const aiv = a.mon.ivPercent ?? -1;
  const biv = b.mon.ivPercent ?? -1;
  if (aiv !== biv) return biv - aiv;
  return a.mon.sourceRow - b.mon.sourceRow;
}

function raidOrder(a: GradedMon, b: GradedMon): number {
  const atk = cmpNum(b.mon.atk ?? -1, a.mon.atk ?? -1);
  if (atk) return atk;
  const iv = cmpNum(b.mon.ivPercent ?? -1, a.mon.ivPercent ?? -1);
  if (iv) return iv;
  return a.mon.sourceRow - b.mon.sourceRow;
}

function bestHundo(rows: GradedMon[]): GradedMon | null {
  const hundos = rows.filter((g) => isHundo(g.mon));
  if (hundos.length === 0) return null;
  return [...hundos].sort(raidOrder)[0];
}

function pvpCutoff(meta: Meta): number {
  return clampPvpRankKeep(meta.pvpRankKeep ?? DEFAULT_PVP_RANK_KEEP);
}

function pvpListCutoff(meta: Meta): number {
  return clampPvpListKeep(meta.pvpListKeep ?? DEFAULT_PVP_LIST_KEEP);
}

function pvpKeepCap(meta: Meta): number {
  return clampPvpKeep(meta.pvpKeep ?? DEFAULT_PVP_KEEP);
}

function familyKeepCap(meta: Meta): number {
  return clampFamilyKeep(meta.familyKeep ?? DEFAULT_FAMILY_KEEP);
}

function raidIvFloor(meta: Meta): number {
  return clampRaidIvKeep(meta.raidIvKeep ?? DEFAULT_RAID_IV_KEEP);
}

function raidIvMeets(g: GradedMon, floor: number): boolean {
  if (floor <= 0) return true;
  return g.raidIv != null && g.raidIv.percent >= floor;
}

function rankMeets(rank: LeagueRank | null | undefined, cutoff: number): boolean {
  return rank != null && rank.rank <= cutoff;
}

function glCapMiss(g: GradedMon, speciesId: string, gm: RankGm): string | null {
  const cap = fitsLeagueCap(g.mon, speciesId, GREAT_LEAGUE_CAP, gm);
  if (cap.fits) return null;
  const name = prettySpeciesId(speciesId);
  if (canonId(g.mon.speciesId) === speciesId || cap.cp == null || cap.cp === g.mon.cp) {
    return `CP ${g.mon.cp} over Great League ${GREAT_LEAGUE_CAP}`;
  }
  return `${name} would be CP ${cap.cp} over Great League ${GREAT_LEAGUE_CAP}`;
}

function lcCapMiss(g: GradedMon): string | null {
  if (g.mon.cp <= LITTLE_CUP_CAP) return null;
  return `CP ${g.mon.cp} over Little Cup ${LITTLE_CUP_CAP}`;
}

function glFitsCap(g: GradedMon, speciesId: string, gm: RankGm): boolean {
  return fitsLeagueCap(g.mon, speciesId, GREAT_LEAGUE_CAP, gm).fits;
}

function pvpFloorLegal(g: GradedMon, cutoff: number, gm: RankGm): boolean {
  if (rankMeets(g.lc, cutoff) && g.mon.cp <= LITTLE_CUP_CAP) return true;
  const stages = g.glAs ?? (g.gl ? [g.gl] : []);
  return stages.some((r) => rankMeets(r, cutoff) && glFitsCap(g, r.evoSpeciesId, gm));
}

function pushReason(g: GradedMon, reason: string): void {
  if (g.reasons.length >= MAX_REASON) return;
  if (!g.reasons.includes(reason)) g.reasons.push(reason);
}

function jobAction(g: GradedMon, targetId: string): { verb: "Stay" | "Evolve to"; name: string } {
  const name = prettySpeciesId(targetId);
  if (canonId(g.mon.speciesId) === targetId) return { verb: "Stay", name };
  return { verb: "Evolve to", name };
}

function jobKeepReason(
  g: GradedMon,
  job: PvpJob,
  cutoff: number,
  raidIvKeep: number,
  keepAllGood: boolean,
  limited: boolean,
  raidCopy: number,
  raidN: number,
): string {
  const { verb, name } = jobAction(g, job.speciesId);
  if (job.kind === "lc") {
    const iv = g.lc;
    const meta = g.lcMeta;
    const metaBit = meta ? ` #${meta.rank}/${meta.of}` : "";
    const rankBit = iv ? `: ${iv.rank}/${iv.of} (keep ≤${cutoff})` : " (IV rank unavailable)";
    return `${verb} ${name} for Little Cup${metaBit}${rankBit}`;
  }
  if (job.kind === "gl") {
    const iv = rankAs(g, job.speciesId);
    const meta = metaAs(g, job.speciesId);
    const metaBit = meta ? ` #${meta.rank}/${meta.of}` : "";
    const rankBit = iv ? `: ${iv.rank}/${iv.of} (keep ≤${cutoff})` : " (IV rank unavailable)";
    return `${verb} ${name} for Great League${metaBit}${rankBit}`;
  }
  const ivBit = g.raidIv ? ` ${g.raidIv.percent}% IV` : "";
  const head = verb === "Evolve to" ? `Evolve to ${name} for raids` : `Raid attacker`;
  if (limited) return `${head}${ivBit} (limited — keep all)`;
  if (keepAllGood) return `${head}${ivBit} (keep all eligible)`;
  return `${head}${ivBit} (copy ${raidCopy || g.copyRankInGroup} of ${raidN}, keep ${Math.min(RAID_KEEP, raidN)} ≥${raidIvKeep}%)`;
}

function extraJobReason(
  league: string,
  name: string,
  rank: number,
  of: number,
  winners: GradedMon[],
  rankOf: (g: GradedMon) => LeagueRank | null | undefined,
): string {
  const kept = winners
    .map((row) => rankOf(row)?.rank)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const keptBit =
    kept.length === 0 ? "none" : kept.length === 1 ? `${kept[0]}/${of}` : kept.map((n) => `${n}/${of}`).join(" and ");
  return `${league} as ${name} ${rank}/${of} extra — kept ${keptBit}`;
}

function roleMissReason(
  g: GradedMon,
  role: RoleDef,
  cutoff: number,
  winners: GradedMon[],
  meta: Meta,
  gm: RankGm,
): string | null {
  if (role.kind === "raid") return null;
  if (role.kind === "lc") {
    if (canonId(g.mon.speciesId) !== role.speciesId) return null;
    const over = lcCapMiss(g);
    if (over) return over;
    if (!g.lc) return "LC rank unknown — IVs not unique";
    if (g.lc.rank > cutoff) return `LC ${g.lc.rank}/${g.lc.of} worse than keep ≤${cutoff}`;
    return extraJobReason("Little Cup", prettySpeciesId(role.speciesId), g.lc.rank, g.lc.of, winners, (row) => row.lc);
  }
  if (!canBecome(g.mon.speciesId, role.speciesId, meta)) return null;
  const over = glCapMiss(g, role.speciesId, gm);
  if (over) return over;
  const iv = rankAs(g, role.speciesId);
  if (!iv) return "GL rank unknown — IVs not unique";
  if (iv.rank > cutoff) {
    return `GL ${iv.rank}/${iv.of} worse than keep ≤${cutoff} as ${prettySpeciesId(role.speciesId)}`;
  }
  return extraJobReason(
    "Great League",
    prettySpeciesId(role.speciesId),
    iv.rank,
    iv.of,
    winners,
    (row) => rankAs(row, role.speciesId),
  );
}

function byScanStream(a: GradedMon, b: GradedMon): number {
  return compareScanStream(a.mon, b.mon);
}

/** Calcy History is last-scan-first; tables follow first-scanned-first (scan time, then CSV line). */
export function compareScanStream(a: Mon, b: Mon): number {
  const ta = scanTimeMs(a.scanDate);
  const tb = scanTimeMs(b.scanDate);
  if (ta != null && tb != null && ta !== tb) return ta - tb;
  return a.sourceRow - b.sourceRow;
}

function scanTimeMs(raw?: string): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "-" || s === "?") return null;
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return Date.UTC(
      year,
      Number(m[1]) - 1,
      Number(m[2]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    );
  }
  const iso = Date.parse(s);
  return Number.isFinite(iso) ? iso : null;
}

/**
 * Wide-minmax box grader. KEEP if any keep class fires.
 * DUMP extras in scan order (first scanned at top), capped at meta.dumpCap (rest LOOK with dump-cap).
 */
export function gradeBox(mons: Mon[], meta: Meta): GradeResult {
  const gm: RankGm = getRankGm(meta.glEvolution);
  const cutoff = pvpCutoff(meta);
  const listKeep = pvpListCutoff(meta);
  const pvpKeep = pvpKeepCap(meta);
  const familyKeep = familyKeepCap(meta);
  const raidIvKeep = raidIvFloor(meta);
  const keepAllGood = Boolean(meta.keepAllGood);
  const keepLucky = keepLuckyOn(meta);
  const keepFavorite = keepFavoriteOn(meta);
  const keepShadow = keepShadowOn(meta);
  const glSlots = keepAllGood ? Number.POSITIVE_INFINITY : pvpKeep;
  const lcSlots = keepAllGood ? Number.POSITIVE_INFINITY : pvpKeep;
  const raidSlots = keepAllGood ? Number.POSITIVE_INFINITY : RAID_KEEP;
  const glIndex = indexRanks(meta.glRankings);
  const lcIndex = indexRanks(meta.lcRankings);
  const glOf = meta.glRankings?.length || GL_LIST_CAP;
  const lcOf = meta.lcRankings?.length || LC_LIST_CAP;
  const gateMeta: Meta = { ...meta, glTop500: gatedGlSet(meta, listKeep) };
  const families = membersByFamily(meta);
  const independentGlCache = new Map<string, string[]>();
  const listedGlCache = new Map<string, string[]>();
  const independentLcCache = new Map<string, string[]>();
  const independentRaidCache = new Map<string, string[]>();

  const independentsOf = (speciesId: string) => {
    const key = familyKey(speciesId, meta);
    if (!independentGlCache.has(key)) {
      const members = familyMembers(speciesId, meta, families);
      const listed = independentGlIds(members, meta.glTop500, meta);
      listedGlCache.set(key, listed);
      independentGlCache.set(key, listed.filter((id) => gateMeta.glTop500.has(id)));
      independentLcCache.set(key, independentLcIds(members, meta));
      independentRaidCache.set(key, independentRaidIds(members, meta));
    }
    return {
      key,
      gl: independentGlCache.get(key)!,
      listedGl: listedGlCache.get(key)!,
      lc: independentLcCache.get(key)!,
      raid: independentRaidCache.get(key)!,
    };
  };

  const graded: GradedMon[] = mons.map((mon) => {
    const ind = independentsOf(mon.speciesId);
    const glTargets = ind.listedGl.filter(
      (t) => !isMegaStage(t) && canBecome(mon.speciesId, t, meta),
    );
    const glAs = glTargets
      .map((t) => rankGreatLeagueAs(mon, gm, t))
      .filter((r): r is LeagueRank => r != null)
      .sort((a, b) => a.rank - b.rank || b.statProduct - a.statProduct);
    const glMetaAs = glTargets
      .map((t) => {
        const row = lookupRank(t, glIndex);
        return row ? toMetaRank(row, glOf) : null;
      })
      .filter((r): r is MetaLeagueRank => r != null);
    const primary = glAs[0] ?? null;
    const primaryMeta = (primary && glMetaAs.find((m) => m.speciesId === primary.evoSpeciesId)) || null;
    const lc = isLcSpecies(mon.speciesId, meta);
    const lcRow = lookupRank(mon.speciesId, lcIndex);
    const raidTarget =
      raidGateId(mon.speciesId, meta) ?? ind.raid.find((t) => canBecome(mon.speciesId, t, meta)) ?? null;
    return {
      mon,
      verdict: "LOOK" as Verdict,
      reasons: [],
      keepClasses: [],
      gl: primary,
      lc: lc ? rankLittleCup(mon, gm) : null,
      glAs,
      glMeta: primaryMeta,
      lcMeta: lcRow ? toMetaRank(lcRow, lcOf) : null,
      glMetaAs,
      raidIv: raidTarget ? raidIvPercent(mon, raidTarget) : null,
      pvpJob: null,
      copiesInGroup: 1,
      copyRankInGroup: 1,
    };
  });

  const groups = new Map<string, GradedMon[]>();
  for (const g of graded) {
    const key = familyKey(g.mon.speciesId, meta);
    const list = groups.get(key);
    if (list) list.push(g);
    else groups.set(key, [g]);
  }

  const groupSummaries: GradeResult["groups"] = [];

  for (const [key, rows] of groups) {
    const n = rows.length;
    const ind = independentsOf(rows[0].mon.speciesId);
    const glIds = ind.gl;
    const lcIds = ind.lc;
    const raidIds = ind.raid;
    rows.sort((a, b) => {
      if (glIds.length) return glOrder(a, b);
      if (lcIds.length) return lcOrder(a, b);
      return raidOrder(a, b);
    });
    rows.forEach((g, i) => {
      g.copiesInGroup = n;
      g.copyRankInGroup = i + 1;
    });

    const raidRows = raidIds.length
      ? rows.filter((g) => raidIds.some((t) => canBecome(g.mon.speciesId, t, meta)))
      : [];
    const raidEligible = raidRows.filter((g) => raidIvMeets(g, raidIvKeep));
    const raidOrdered = [...raidEligible].sort(raidOrder);
    const hundoSlot = keepAllGood ? null : bestHundo(rows);

    const roles: RoleDef[] = [
      ...glIds.map((id) => ({
        kind: "gl" as const,
        speciesId: id,
        slots: glSlots,
        metaRank: lookupRank(id, glIndex)?.rank ?? GL_LIST_CAP + 1,
      })),
      ...lcIds.map((id) => ({
        kind: "lc" as const,
        speciesId: id,
        slots: lcSlots,
        metaRank: lookupRank(id, lcIndex)?.rank ?? LC_LIST_CAP + 1,
      })),
    ];
    if (raidIds.length) {
      roles.push({ kind: "raid", speciesId: raidIds[0], slots: raidSlots, metaRank: 10_000 });
    }

    const jobs = assignFamilyJobs(rows, roles, (g, role) => {
      if (role.kind === "gl") {
        if (!canBecome(g.mon.speciesId, role.speciesId, meta)) return null;
        if (!glFitsCap(g, role.speciesId, gm)) return null;
        const iv = rankAs(g, role.speciesId);
        if (!rankMeets(iv, cutoff)) return null;
        return iv!.rank;
      }
      if (role.kind === "lc") {
        if (canonId(g.mon.speciesId) !== role.speciesId) return null;
        if (g.mon.cp > LITTLE_CUP_CAP) return null;
        if (!rankMeets(g.lc, cutoff)) return null;
        return g.lc!.rank;
      }
      if (!raidIds.some((t) => canBecome(g.mon.speciesId, t, meta))) return null;
      if (!raidIvMeets(g, raidIvKeep)) return null;
      const pct = g.raidIv?.percent ?? 0;
      return Math.round((100 - pct) * 100);
    });

    const winnersByRole = new Map<string, GradedMon[]>();
    for (const [g, role] of jobs) {
      const list = winnersByRole.get(roleKey(role)) ?? [];
      list.push(g);
      winnersByRole.set(roleKey(role), list);
    }
    for (const role of roles) {
      const list = winnersByRole.get(roleKey(role)) ?? [];
      if (role.kind === "gl") list.sort((a, b) => glOrderAs(a, b, role.speciesId));
      else if (role.kind === "lc") list.sort(lcOrder);
      else list.sort(raidOrder);
      const of = list.length;
      list.forEach((g, i) => {
        const speciesId =
          role.kind === "raid" ? (g.raidIv?.evoSpeciesId ?? role.speciesId) : role.speciesId;
        g.pvpJob = { kind: role.kind, speciesId, seat: i + 1, of };
      });
    }

    const glKeep = new Set<GradedMon>();
    const lcKeep = new Set<GradedMon>();
    const raidKeep = new Set<GradedMon>();
    for (const g of rows) {
      if (g.pvpJob?.kind === "gl") glKeep.add(g);
      if (g.pvpJob?.kind === "lc") lcKeep.add(g);
      if (g.pvpJob?.kind === "raid") raidKeep.add(g);
    }

    for (const g of rows) {
      const classes = idKeepClasses(g.mon, meta, keepShadow, keepLucky, keepFavorite);
      if (glKeep.has(g)) classes.push("gl");
      if (lcKeep.has(g)) classes.push("lc");
      const limited = isLimitedMon(g.mon, meta);
      if (raidKeep.has(g) && !limited) classes.push("raid");
      if (
        limited &&
        (raidKeep.has(g) ||
          raidIds.some((t) => canBecome(g.mon.speciesId, t, meta)) ||
          Boolean(raidGateId(g.mon.speciesId, meta))) &&
        !classes.includes("raid")
      ) {
        classes.push("raid");
      }
      if (
        isHundo(g.mon) &&
        (keepAllGood || glKeep.has(g) || lcKeep.has(g) || raidKeep.has(g) || g === hundoSlot)
      ) {
        classes.push("hundo");
      }
      g.keepClasses = classes;

      const job = g.pvpJob;
      if (job) {
        const raidCopy = raidOrdered.indexOf(g) + 1;
        const raidN = raidEligible.length || n;
        pushReason(g, jobKeepReason(g, job, cutoff, raidIvKeep, keepAllGood, limited, raidCopy, raidN));
      } else if (roles.length) {
        pushReason(g, "No PvP/raid job — extra in this family");
      }

      if (classes.includes("shiny")) pushReason(g, "Shiny");
      if (classes.includes("lucky")) pushReason(g, "Lucky");
      if (classes.includes("costume")) pushReason(g, "Costume");
      if (classes.includes("background")) pushReason(g, "Background");
      if (classes.includes("hundo")) pushReason(g, "4* / hundo");
      if (classes.includes("favorite")) pushReason(g, "Favorite");
      if (classes.includes("special-move")) pushReason(g, "Special / legacy move");
      if (classes.includes("shadow")) pushReason(g, "Shadow");
      if (classes.includes("max")) pushReason(g, "Dynamax / Gigantamax");
      if (classes.includes("legendary")) pushReason(g, "Legendary");
      if (classes.includes("mythical")) pushReason(g, "Mythical");
      if (classes.includes("limited")) pushReason(g, "Limited (UB / Dialgadex-style)");

      if (!job) {
        const better = betterAsReason(g);
        if (better) pushReason(g, better);
        for (const role of roles) {
          if (role.kind === "raid") continue;
          const winners = winnersByRole.get(roleKey(role)) ?? [];
          const miss = roleMissReason(g, role, cutoff, winners, meta, gm);
          if (miss) pushReason(g, miss);
        }
        if (raidRows.includes(g) && !raidKeep.has(g) && !limited) {
          if (raidIvKeep > 0 && !raidIvMeets(g, raidIvKeep)) {
            pushReason(
              g,
              g.raidIv
                ? `Raid ${g.raidIv.percent}% IV worse than keep ≥${raidIvKeep}%`
                : "Raid IV unavailable — IVs not unique",
            );
          } else {
            pushReason(
              g,
              keepAllGood
                ? `Raid copies: ${raidEligible.length}`
                : `Raid copies: ${raidEligible.length}, keeping ${Math.min(RAID_KEEP, raidEligible.length)}`,
            );
          }
        }
      }
    }

    groupSummaries.push({ key, size: n, kept: 0 });
  }

  // Family ranking sorts per-group copies; tracks follow first-scanned-first.
  graded.sort(byScanStream);

  const dumpCap = meta.dumpCap ?? 100;
  const dumpFuel: GradedMon[] = [];
  const extraOfKeeper = new Set<GradedMon>();
  const extraOfFamily = new Set<GradedMon>();

  const groupAnchor = new Map<string, boolean>();
  for (const [key, rows] of groups) {
    const hasKeep = rows.some((row) => row.keepClasses.length > 0);
    const hasFloor = rows.some((row) => pvpFloorLegal(row, cutoff, gm));
    groupAnchor.set(key, hasKeep || hasFloor);
  }

  for (const g of graded) {
    if (g.keepClasses.length) {
      g.verdict = "KEEP";
      continue;
    }

    const hardNeverDump =
      g.mon.shadow ||
      g.mon.favorite === true ||
      isLimitedMon(g.mon, meta) ||
      g.mon.hasSpecialMove === true ||
      g.mon.ivUnique === false;

    if (g.mon.shadow) pushReason(g, "Shadow — never dump in v1");
    if (g.mon.favorite === true) pushReason(g, "Favorite — never dump");
    if (g.mon.ivUnique === false) pushReason(g, "IVs not unique; cannot dump");
    if (g.mon.hasSpecialMove === true) pushReason(g, "Special / legacy move — never dump");

    if (hardNeverDump) {
      g.verdict = "LOOK";
      continue;
    }

    const key = familyKey(g.mon.speciesId, meta);
    const anchored = groupAnchor.get(key) === true;
    const ind = independentsOf(g.mon.speciesId);
    const pvpOrRaidFamily = ind.gl.length + ind.lc.length + ind.raid.length > 0;

    if (pvpOrRaidFamily && !anchored) {
      if (familyKeep > 0 && g.copyRankInGroup <= familyKeep) {
        g.verdict = "LOOK";
        pushReason(g, `PvP/raid family: ${familyKeep} best (no keeper)`);
        continue;
      }
      extraOfFamily.add(g);
      dumpFuel.push(g);
      continue;
    }

    if (anchored) {
      extraOfKeeper.add(g);
      dumpFuel.push(g);
      continue;
    }

    if (familyKeep > 0 && (g.copiesInGroup === 1 || g.copyRankInGroup === 1)) {
      g.verdict = "LOOK";
      pushReason(g, g.copiesInGroup === 1 ? "only copy" : "best junk copy — not the last");
      continue;
    }

    dumpFuel.push(g);
  }

  let dumped = 0;
  let dumpCapped = false;
  for (const g of dumpFuel) {
    if (dumped < dumpCap) {
      g.verdict = "DUMP";
      pushReason(
        g,
        extraOfKeeper.has(g)
          ? "Extra copy — family already has a keeper"
          : extraOfFamily.has(g)
            ? familyKeep === 0
              ? "Useless for PvP/raids — keep 0 per family"
              : `Extra copy — keeping ${familyKeep} best of PvP/raid family`
            : familyKeep === 0
              ? "Useless for PvP/raids — keep 0 per family"
              : "Not GL/LC/raid/limited; unique IVs",
      );
      dumped++;
    } else {
      g.verdict = "LOOK";
      pushReason(g, "dump-cap");
      dumpCapped = true;
    }
  }

  const keep: GradedMon[] = [];
  const look: GradedMon[] = [];
  const dump: GradedMon[] = [];
  const keptByKey = new Map<string, number>();
  for (const g of graded) {
    if (g.verdict === "KEEP") {
      keep.push(g);
      const key = familyKey(g.mon.speciesId, meta);
      keptByKey.set(key, (keptByKey.get(key) ?? 0) + 1);
    } else if (g.verdict === "DUMP") dump.push(g);
    else look.push(g);
  }

  for (const row of groupSummaries) {
    row.kept = keptByKey.get(row.key) ?? 0;
  }
  groupSummaries.sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
  keep.sort(byScanStream);
  look.sort(byScanStream);
  dump.sort(byScanStream);

  return {
    keep,
    look,
    dump,
    dumpCap,
    dumpCapped,
    pvpRankKeep: cutoff,
    pvpListKeep: listKeep,
    pvpKeep,
    familyKeep,
    raidIvKeep,
    keepAllGood,
    keepLucky,
    keepFavorite,
    keepShadow,
    groups: groupSummaries,
  };
}
