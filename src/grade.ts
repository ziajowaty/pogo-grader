import type {
  GradeResult,
  GradedMon,
  LeagueRank,
  Meta,
  MetaLeagueRank,
  Mon,
  PvpJob,
  PvpLeague,
  PvpokeRankRow,
  Verdict,
  Gender,
} from "./types";
import {
  clampFamilyKeep,
  clampPvpKeep,
  clampPvpListKeep,
  clampPvpRankKeep,
  clampRaidIvKeep,
  clampRaidKeep,
  normalizePvpFillOrder,
  DEFAULT_FAMILY_KEEP,
  DEFAULT_PVP_ANY,
  DEFAULT_PVP_KEEP,
  DEFAULT_PVP_LIST_KEEP,
  DEFAULT_PVP_RANK_KEEP,
  DEFAULT_RAID_IV_KEEP,
  DEFAULT_RAID_KEEP,
  GL_LIST_CAP,
  LC_LIST_CAP,
  ML_LIST_CAP,
  prettySpeciesId,
  UL_LIST_CAP,
} from "./types";
import { evolutionGenderOk } from "./genderForm";
import { canonId } from "./meta";
import {
  fitsLeagueCap,
  getRankGm,
  GREAT_LEAGUE_CAP,
  LITTLE_CUP_CAP,
  MASTER_LEAGUE_CAP,
  lookupBaseStats,
  rankCappedLeagueAs,
  rankLittleCup,
  ULTRA_LEAGUE_CAP,
  raidIvPercent,
  type RankGm,
} from "./rank";

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

function gatedLcSet(meta: Meta, listKeep: number): Set<string> {
  const rows = meta.lcRankings;
  if (rows && rows.length > 0) {
    return new Set(rows.filter((row) => row.rank <= listKeep).map((row) => row.speciesId));
  }
  return meta.lcTop100;
}

function raidGateId(speciesId: string, meta: Meta, gender: Gender): string | null {
  const id = canonId(speciesId);
  if (meta.raidAttackers.has(id)) return id;
  if (id.endsWith("_shadow") && meta.raidAttackers.has(id.slice(0, -7))) return id.slice(0, -7);
  const mapped = meta.raidEvolution?.[id];
  if (
    mapped &&
    evolutionGenderOk(mapped, gender) &&
    (meta.raidAttackers.has(mapped) || hasId(meta.raidAttackers, mapped))
  ) {
    return mapped;
  }
  if (id.endsWith("_shadow")) {
    const inner = raidGateId(id.slice(0, -7), meta, gender);
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

function canBecome(from: string, target: string, meta: Meta, gender: Gender): boolean {
  const a = canonId(from);
  const b = canonId(target);
  if (a === b) return true;
  if (!evolutionGenderOk(b, gender)) return false;
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

function gatedRankSet(rows: PvpokeRankRow[] | undefined, listKeep: number): Set<string> {
  if (!rows?.length) return new Set();
  return new Set(rows.filter((row) => row.rank <= listKeep).map((row) => row.speciesId));
}

/** Listed stages for an open league, plus the subset inside the species cutoff. */
function openLeagueIds(
  members: string[],
  rows: PvpokeRankRow[] | undefined,
  listKeep: number,
  pvpAny: boolean,
  meta: Meta,
  gm: RankGm,
): { listed: string[]; gated: string[] } {
  if (pvpAny) {
    const stages = anyGlIds(members, meta, gm);
    return { listed: stages, gated: stages };
  }
  if (!rows?.length) return { listed: [], gated: [] };
  const full = new Set(rows.map((row) => row.speciesId));
  const gate = gatedRankSet(rows, listKeep);
  const listed = independentGlIds(members, full, meta);
  return { listed, gated: listed.filter((id) => gate.has(id)) };
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

function hasBaseStats(id: string, gm: RankGm): boolean {
  return lookupBaseStats(id, gm) != null;
}

/** Every non-mega stage this family can become, when the PvPoke list is not the gate. */
function anyGlIds(members: string[], meta: Meta, gm: RankGm): string[] {
  const ids: string[] = [];
  for (const id of members) {
    const reach = meta.evoReach?.[id];
    if (reach?.length) ids.push(...reach);
    else ids.push(id);
    const mapped = meta.glEvolution[id];
    if (mapped) ids.push(mapped);
  }
  return uniqueIds(ids.filter((id) => !isMegaStage(id) && hasBaseStats(id, gm)));
}

/** Unevolved species that can still evolve. Little Cup when any species is viable. */
function isLittleCupSpecies(id: string, meta: Meta, members: string[]): boolean {
  if (!id || isMegaStage(id)) return false;
  for (const member of members) {
    if (member === id) continue;
    if (meta.evoReach?.[member]?.includes(id)) return false;
  }
  return (meta.evoReach?.[id] ?? []).some((next) => next !== id);
}

function anyLcIds(members: string[], meta: Meta, gm: RankGm): string[] {
  return uniqueIds(members.filter((id) => isLittleCupSpecies(id, meta, members) && hasBaseStats(id, gm)));
}

/**
 * Listed species fill in PvPoke order. Unlisted finals fill before unlisted
 * pre-evos, so a non-meta Bidoof becomes Bibarel before it stays Bidoof.
 */
function stageFillRank(id: string, index: Map<string, PvpokeRankRow>, meta: Meta): number {
  const listed = lookupRank(id, index)?.rank;
  if (listed != null) return listed;
  const evolvesFurther = (meta.evoReach?.[id] ?? []).some((next) => next !== id && !isMegaStage(next));
  return evolvesFurther ? GL_LIST_CAP + 2 : GL_LIST_CAP + 1;
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

function kindRank(kind: JobKind, order: readonly PvpLeague[]): number {
  if (kind === "raid") return order.length;
  const at = order.indexOf(kind);
  return at < 0 ? order.length : at;
}

type CappedKind = "gl" | "ul" | "ml";

const CAPPED_LABEL: Record<CappedKind, string> = {
  gl: "Great League",
  ul: "Ultra League",
  ml: "Master League",
};

const CAPPED_SHORT: Record<CappedKind, string> = { gl: "GL", ul: "UL", ml: "ML" };

function isCappedKind(kind: JobKind): kind is CappedKind {
  return kind === "gl" || kind === "ul" || kind === "ml";
}

function capNumber(kind: CappedKind): number {
  if (kind === "gl") return GREAT_LEAGUE_CAP;
  if (kind === "ul") return ULTRA_LEAGUE_CAP;
  return MASTER_LEAGUE_CAP;
}

function listCapOf(kind: CappedKind): number {
  if (kind === "gl") return GL_LIST_CAP;
  if (kind === "ul") return UL_LIST_CAP;
  return ML_LIST_CAP;
}

function compareRoles(a: RoleDef, b: RoleDef, order: readonly PvpLeague[]): number {
  const ka = kindRank(a.kind, order);
  const kb = kindRank(b.kind, order);
  if (ka !== kb) return ka - kb;
  if (a.metaRank !== b.metaRank) return a.metaRank - b.metaRank;
  return a.speciesId.localeCompare(b.speciesId);
}

/**
 * One job per copy. Bright leagues fill in `fillOrder`. Within a league,
 * exhaust the higher PvPoke species (Dragonair #85 before Dragonite #340)
 * before touching the next identity. Raid leftovers last. Each capped stage
 * and each Little Cup species gets `pvpKeep` seats (1–3, default 1). Each raid
 * attacker gets `raidKeep` seats (1–12, default 1).
 */
function assignFamilyJobs(
  rows: GradedMon[],
  roles: RoleDef[],
  costOf: (g: GradedMon, role: RoleDef) => number | null,
  fillOrder: readonly PvpLeague[],
): Map<GradedMon, RoleDef> {
  const assigned = new Map<GradedMon, RoleDef>();
  const live = [...roles].filter((role) => role.slots > 0).sort((a, b) => compareRoles(a, b, fillOrder));
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

function leagueRanks(g: GradedMon, kind: CappedKind): LeagueRank[] | undefined {
  if (kind === "gl") return g.glAs;
  if (kind === "ul") return g.ulAs;
  return g.mlAs;
}

function leagueMetas(g: GradedMon, kind: CappedKind): MetaLeagueRank[] | undefined {
  if (kind === "gl") return g.glMetaAs;
  if (kind === "ul") return g.ulMetaAs;
  return g.mlMetaAs;
}

function rankIn(g: GradedMon, kind: CappedKind, speciesId: string): LeagueRank | null {
  return leagueRanks(g, kind)?.find((r) => r.evoSpeciesId === speciesId) ?? null;
}

function metaIn(g: GradedMon, kind: CappedKind, speciesId: string): MetaLeagueRank | null {
  return leagueMetas(g, kind)?.find((m) => m.speciesId === speciesId) ?? null;
}

function openOrderAs(a: GradedMon, b: GradedMon, kind: CappedKind, speciesId: string): number {
  const ar = rankIn(a, kind, speciesId)?.rank ?? 10_000;
  const br = rankIn(b, kind, speciesId)?.rank ?? 10_000;
  if (ar !== br) return ar - br;
  const asp = rankIn(a, kind, speciesId)?.statProduct ?? -1;
  const bsp = rankIn(b, kind, speciesId)?.statProduct ?? -1;
  if (asp !== bsp) return bsp - asp;
  const aiv = a.mon.ivPercent ?? -1;
  const biv = b.mon.ivPercent ?? -1;
  if (aiv !== biv) return biv - aiv;
  return a.mon.sourceRow - b.mon.sourceRow;
}

function betterAsReason(
  g: GradedMon,
  ranks: LeagueRank[] | undefined = g.glAs,
  league = "GL",
): string | null {
  if (!ranks || ranks.length < 2) return null;
  const sorted = [...ranks].sort((a, b) => a.rank - b.rank || b.statProduct - a.statProduct);
  if (sorted[0].evoSpeciesId === sorted[1].evoSpeciesId) return null;
  if (sorted[0].rank === sorted[1].rank) return null;
  return `${league} better as ${prettySpeciesId(sorted[0].evoSpeciesId)} (${sorted[0].rank}/${sorted[0].of}) than ${prettySpeciesId(sorted[1].evoSpeciesId)} (${sorted[1].rank}/${sorted[1].of})`;
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

function keepGlOn(meta: Meta): boolean {
  return meta.keepGl !== false;
}

function keepLcOn(meta: Meta): boolean {
  return meta.keepLc !== false;
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

function ulOrder(a: GradedMon, b: GradedMon): number {
  const ar = a.ul?.rank ?? 10_000;
  const br = b.ul?.rank ?? 10_000;
  if (ar !== br) return ar - br;
  const asp = a.ul?.statProduct ?? -1;
  const bsp = b.ul?.statProduct ?? -1;
  if (asp !== bsp) return bsp - asp;
  const aiv = a.mon.ivPercent ?? -1;
  const biv = b.mon.ivPercent ?? -1;
  if (aiv !== biv) return biv - aiv;
  return a.mon.sourceRow - b.mon.sourceRow;
}

function mlOrder(a: GradedMon, b: GradedMon): number {
  const ar = a.ml?.rank ?? 10_000;
  const br = b.ml?.rank ?? 10_000;
  if (ar !== br) return ar - br;
  const asp = a.ml?.statProduct ?? -1;
  const bsp = b.ml?.statProduct ?? -1;
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

function pvpAnyOn(meta: Meta): boolean {
  return meta.pvpAny ?? DEFAULT_PVP_ANY;
}

function pvpKeepCap(meta: Meta): number {
  return clampPvpKeep(meta.pvpKeep ?? DEFAULT_PVP_KEEP);
}

function raidKeepCap(meta: Meta): number {
  return clampRaidKeep(meta.raidKeep ?? DEFAULT_RAID_KEEP);
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

function cappedCapMiss(g: GradedMon, speciesId: string, kind: CappedKind, gm: RankGm): string | null {
  const leagueCap = capNumber(kind);
  const league = CAPPED_LABEL[kind];
  const cap = fitsLeagueCap(g.mon, speciesId, leagueCap, gm);
  if (cap.fits) return null;
  const name = prettySpeciesId(speciesId);
  if (canonId(g.mon.speciesId) === speciesId || cap.cp == null || cap.cp === g.mon.cp) {
    return `CP ${g.mon.cp} over ${league} ${leagueCap}`;
  }
  return `${name} would be CP ${cap.cp} over ${league} ${leagueCap}`;
}

function lcCapMiss(g: GradedMon): string | null {
  if (g.mon.cp <= LITTLE_CUP_CAP) return null;
  return `CP ${g.mon.cp} over Little Cup ${LITTLE_CUP_CAP}`;
}

function cappedFloor(g: GradedMon, kind: CappedKind, cutoff: number, gm: RankGm): boolean {
  const stages = leagueRanks(g, kind) ?? [];
  const leagueCap = capNumber(kind);
  return stages.some((r) => rankMeets(r, cutoff) && fitsLeagueCap(g.mon, r.evoSpeciesId, leagueCap, gm).fits);
}

function pvpFloorLegal(
  g: GradedMon,
  cutoff: number,
  gm: RankGm,
  keepGl: boolean,
  keepUl: boolean,
  keepMl: boolean,
  keepLc: boolean,
): boolean {
  if (keepLc && rankMeets(g.lc, cutoff) && g.mon.cp <= LITTLE_CUP_CAP) return true;
  if (keepGl && cappedFloor(g, "gl", cutoff, gm)) return true;
  if (keepUl && cappedFloor(g, "ul", cutoff, gm)) return true;
  if (keepMl && cappedFloor(g, "ml", cutoff, gm)) return true;
  return false;
}

function bestRankedLabel(ids: string[], index: Map<string, PvpokeRankRow>, league: string): string | null {
  if (ids.length === 0) return null;
  let bestId = ids[0];
  let bestRank = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const rank = lookupRank(id, index)?.rank;
    if (rank != null && rank < bestRank) {
      bestRank = rank;
      bestId = id;
    }
  }
  const name = prettySpeciesId(bestId);
  return Number.isFinite(bestRank) ? `${name} ${league} #${bestRank}` : name;
}

/** Why a listed family with no keeper stays LOOK when spares are 0. */
function noKeeperFamilyReason(
  ind: { gl: string[]; ul: string[]; ml: string[]; lc: string[]; raid: string[] },
  glIndex: Map<string, PvpokeRankRow>,
  ulIndex: Map<string, PvpokeRankRow>,
  mlIndex: Map<string, PvpokeRankRow>,
  lcIndex: Map<string, PvpokeRankRow>,
  keepGl: boolean,
  keepUl: boolean,
  keepMl: boolean,
  keepLc: boolean,
  fillOrder: readonly PvpLeague[],
): string {
  const on: Record<PvpLeague, boolean> = { gl: keepGl, ul: keepUl, ml: keepMl, lc: keepLc };
  const ids: Record<PvpLeague, string[]> = { gl: ind.gl, ul: ind.ul, ml: ind.ml, lc: ind.lc };
  const index: Record<PvpLeague, Map<string, PvpokeRankRow>> = {
    gl: glIndex,
    ul: ulIndex,
    ml: mlIndex,
    lc: lcIndex,
  };
  const short: Record<PvpLeague, string> = { gl: "GL", ul: "UL", ml: "ML", lc: "LC" };
  let label: string | null = null;
  for (const kind of fillOrder) {
    if (!on[kind]) continue;
    label = bestRankedLabel(ids[kind], index[kind], short[kind]);
    if (label) break;
  }
  if (!label && ind.raid.length) label = `${prettySpeciesId(ind.raid[0])} raid`;
  if (!label) return "PvP/raid family: IVs miss KEEP";
  return `PvP/raid family: ${label} — IVs miss KEEP`;
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
  seats: number,
): string {
  const { verb, name } = jobAction(g, job.speciesId);
  if (job.kind === "lc") {
    const iv = g.lc;
    const meta = g.lcMeta;
    const metaBit = meta ? ` #${meta.rank}/${meta.of}` : "";
    const rankBit = iv ? `: ${iv.rank}/${iv.of} (keep ≤${cutoff})` : " (IV rank unavailable)";
    return `${verb} ${name} for Little Cup${metaBit}${rankBit}`;
  }
  if (isCappedKind(job.kind)) {
    const iv = rankIn(g, job.kind, job.speciesId);
    const meta = metaIn(g, job.kind, job.speciesId);
    const metaBit = meta ? ` #${meta.rank}/${meta.of}` : "";
    const rankBit = iv ? `: ${iv.rank}/${iv.of} (keep ≤${cutoff})` : " (IV rank unavailable)";
    return `${verb} ${name} for ${CAPPED_LABEL[job.kind]}${metaBit}${rankBit}`;
  }
  const ivBit = g.raidIv ? ` ${g.raidIv.percent}% IV` : "";
  const head = verb === "Evolve to" ? `Evolve to ${name} for raids` : `Raid attacker`;
  if (limited) return `${head}${ivBit} (limited — keep all)`;
  if (keepAllGood) return `${head}${ivBit} (keep all eligible)`;
  return `${head}${ivBit} (copy ${raidCopy || g.copyRankInGroup} of ${raidN}, keep ${Math.min(seats, raidN)} ≥${raidIvKeep}%)`;
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
  if (!isCappedKind(role.kind)) return null;
  if (!canBecome(g.mon.speciesId, role.speciesId, meta, g.mon.gender)) return null;
  const over = cappedCapMiss(g, role.speciesId, role.kind, gm);
  if (over) return over;
  const iv = rankIn(g, role.kind, role.speciesId);
  const short = CAPPED_SHORT[role.kind];
  if (!iv) return `${short} rank unknown — IVs not unique`;
  if (iv.rank > cutoff) {
    return `${short} ${iv.rank}/${iv.of} worse than keep ≤${cutoff} as ${prettySpeciesId(role.speciesId)}`;
  }
  return extraJobReason(
    CAPPED_LABEL[role.kind],
    prettySpeciesId(role.speciesId),
    iv.rank,
    iv.of,
    winners,
    (row) => rankIn(row, role.kind as CappedKind, role.speciesId),
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
 * DUMP extras in scan order (first scanned at top).
 */
export function gradeBox(mons: Mon[], meta: Meta): GradeResult {
  const gm: RankGm = getRankGm(meta.glEvolution);
  const cutoff = pvpCutoff(meta);
  const listKeep = pvpListCutoff(meta);
  const pvpAny = pvpAnyOn(meta);
  const pvpKeep = pvpKeepCap(meta);
  const raidKeep = raidKeepCap(meta);
  const familyKeep = familyKeepCap(meta);
  const raidIvKeep = raidIvFloor(meta);
  const keepAllGood = Boolean(meta.keepAllGood);
  const keepLucky = keepLuckyOn(meta);
  const keepFavorite = keepFavoriteOn(meta);
  const keepShadow = keepShadowOn(meta);
  const keepGl = keepGlOn(meta);
  const keepUl = meta.keepUl === true;
  const keepMl = meta.keepMl === true;
  const keepLc = keepLcOn(meta);
  const fillOrder = normalizePvpFillOrder(meta.pvpFillOrder);
  const glSlots = pvpKeep;
  const lcSlots = pvpKeep;
  const raidSlots = raidKeep;
  const glIndex = indexRanks(meta.glRankings);
  const ulIndex = indexRanks(meta.ulRankings);
  const mlIndex = indexRanks(meta.mlRankings);
  const lcIndex = indexRanks(meta.lcRankings);
  const glOf = meta.glRankings?.length || GL_LIST_CAP;
  const ulOf = meta.ulRankings?.length || UL_LIST_CAP;
  const mlOf = meta.mlRankings?.length || ML_LIST_CAP;
  const lcOf = meta.lcRankings?.length || LC_LIST_CAP;
  const gateMeta: Meta = {
    ...meta,
    glTop500: gatedGlSet(meta, listKeep),
    lcTop100: gatedLcSet(meta, listKeep),
  };
  const families = membersByFamily(meta);
  const independentGlCache = new Map<string, string[]>();
  const listedGlCache = new Map<string, string[]>();
  const independentUlCache = new Map<string, string[]>();
  const listedUlCache = new Map<string, string[]>();
  const independentMlCache = new Map<string, string[]>();
  const listedMlCache = new Map<string, string[]>();
  const independentLcCache = new Map<string, string[]>();
  const independentRaidCache = new Map<string, string[]>();

  const independentsOf = (speciesId: string) => {
    const key = familyKey(speciesId, meta);
    if (!independentGlCache.has(key)) {
      const members = familyMembers(speciesId, meta, families);
      if (pvpAny) {
        const stages = anyGlIds(members, meta, gm);
        listedGlCache.set(key, stages);
        independentGlCache.set(key, stages);
        independentLcCache.set(key, anyLcIds(members, meta, gm));
      } else {
        const listed = independentGlIds(members, meta.glTop500, meta);
        listedGlCache.set(key, listed);
        independentGlCache.set(key, listed.filter((id) => gateMeta.glTop500.has(id)));
        independentLcCache.set(key, independentLcIds(members, gateMeta));
      }
      const ultra = openLeagueIds(members, meta.ulRankings, listKeep, pvpAny, meta, gm);
      listedUlCache.set(key, ultra.listed);
      independentUlCache.set(key, ultra.gated);
      const master = openLeagueIds(members, meta.mlRankings, listKeep, pvpAny, meta, gm);
      listedMlCache.set(key, master.listed);
      independentMlCache.set(key, master.gated);
      independentRaidCache.set(key, independentRaidIds(members, meta));
    }
    return {
      key,
      gl: independentGlCache.get(key)!,
      listedGl: listedGlCache.get(key)!,
      ul: independentUlCache.get(key)!,
      listedUl: listedUlCache.get(key)!,
      ml: independentMlCache.get(key)!,
      listedMl: listedMlCache.get(key)!,
      lc: independentLcCache.get(key)!,
      raid: independentRaidCache.get(key)!,
    };
  };

  const rankStages = (mon: Mon, targets: string[], cap: number, index: Map<string, PvpokeRankRow>, of: number) => {
    const ranks = targets
      .map((t) => rankCappedLeagueAs(mon, gm, t, cap))
      .filter((r): r is LeagueRank => r != null)
      .sort((a, b) => a.rank - b.rank || b.statProduct - a.statProduct);
    const metas = targets
      .map((t) => {
        const row = lookupRank(t, index);
        return row ? toMetaRank(row, of) : null;
      })
      .filter((r): r is MetaLeagueRank => r != null);
    const primary = ranks[0] ?? null;
    const primaryMeta = (primary && metas.find((m) => m.speciesId === primary.evoSpeciesId)) || null;
    return { ranks, metas, primary, primaryMeta };
  };

  const graded: GradedMon[] = mons.map((mon) => {
    const ind = independentsOf(mon.speciesId);
    const glTargets = ind.listedGl.filter(
      (t) => !isMegaStage(t) && canBecome(mon.speciesId, t, meta, mon.gender),
    );
    const glAs = glTargets
      .map((t) => rankCappedLeagueAs(mon, gm, t, GREAT_LEAGUE_CAP))
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
    const stageTargets = (ids: string[]) =>
      ids.filter((t) => !isMegaStage(t) && canBecome(mon.speciesId, t, meta, mon.gender));
    const ultra = keepUl ? rankStages(mon, stageTargets(ind.listedUl), ULTRA_LEAGUE_CAP, ulIndex, ulOf) : null;
    const master = keepMl ? rankStages(mon, stageTargets(ind.listedMl), MASTER_LEAGUE_CAP, mlIndex, mlOf) : null;
    const lc = pvpAny ? ind.lc.includes(canonId(mon.speciesId)) : isLcSpecies(mon.speciesId, gateMeta);
    const lcRow = lookupRank(mon.speciesId, lcIndex);
    const raidTarget =
      raidGateId(mon.speciesId, meta, mon.gender) ??
      ind.raid.find((t) => canBecome(mon.speciesId, t, meta, mon.gender)) ??
      null;
    return {
      mon,
      verdict: "LOOK" as Verdict,
      reasons: [],
      keepClasses: [],
      gl: primary,
      ul: ultra?.primary,
      ml: master?.primary,
      lc: lc ? rankLittleCup(mon, gm) : null,
      glAs,
      ulAs: ultra?.ranks,
      mlAs: master?.ranks,
      glMeta: primaryMeta,
      ulMeta: ultra?.primaryMeta,
      mlMeta: master?.primaryMeta,
      lcMeta: lcRow ? toMetaRank(lcRow, lcOf) : null,
      glMetaAs,
      ulMetaAs: ultra?.metas,
      mlMetaAs: master?.metas,
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
    const glIds = keepGl ? ind.gl : [];
    const ulIds = keepUl ? ind.ul : [];
    const mlIds = keepMl ? ind.ml : [];
    const lcIds = keepLc ? ind.lc : [];
    const raidIds = ind.raid;
    const sortByKind: Record<PvpLeague, (a: GradedMon, b: GradedMon) => number> = {
      gl: glOrder,
      ul: ulOrder,
      ml: mlOrder,
      lc: lcOrder,
    };
    const idsByKind: Record<PvpLeague, string[]> = { gl: glIds, ul: ulIds, ml: mlIds, lc: lcIds };
    const lead = fillOrder.find((kind) => idsByKind[kind].length);
    rows.sort(lead ? sortByKind[lead] : raidOrder);
    rows.forEach((g, i) => {
      g.copiesInGroup = n;
      g.copyRankInGroup = i + 1;
    });

    const raidRows = raidIds.length
      ? rows.filter((g) => raidIds.some((t) => canBecome(g.mon.speciesId, t, meta, g.mon.gender)))
      : [];
    const raidEligible = raidRows.filter((g) => raidIvMeets(g, raidIvKeep));
    const raidOrdered = [...raidEligible].sort(raidOrder);
    const hundoSlot = keepAllGood ? null : bestHundo(rows);

    const cappedRole = (id: string, kind: CappedKind, index: Map<string, PvpokeRankRow>): RoleDef => ({
      kind,
      speciesId: id,
      slots: glSlots,
      metaRank: pvpAny ? stageFillRank(id, index, meta) : (lookupRank(id, index)?.rank ?? listCapOf(kind) + 1),
    });
    const roles: RoleDef[] = [
      ...glIds.map((id) => cappedRole(id, "gl", glIndex)),
      ...ulIds.map((id) => cappedRole(id, "ul", ulIndex)),
      ...mlIds.map((id) => cappedRole(id, "ml", mlIndex)),
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
      if (isCappedKind(role.kind)) {
        if (!canBecome(g.mon.speciesId, role.speciesId, meta, g.mon.gender)) return null;
        if (!fitsLeagueCap(g.mon, role.speciesId, capNumber(role.kind), gm).fits) return null;
        const iv = rankIn(g, role.kind, role.speciesId);
        if (!rankMeets(iv, cutoff)) return null;
        return iv!.rank;
      }
      if (role.kind === "lc") {
        if (canonId(g.mon.speciesId) !== role.speciesId) return null;
        if (g.mon.cp > LITTLE_CUP_CAP) return null;
        if (!rankMeets(g.lc, cutoff)) return null;
        return g.lc!.rank;
      }
      if (!raidIds.some((t) => canBecome(g.mon.speciesId, t, meta, g.mon.gender))) return null;
      if (!raidIvMeets(g, raidIvKeep)) return null;
      const pct = g.raidIv?.percent ?? 0;
      return Math.round((100 - pct) * 100);
    }, fillOrder);

    const winnersByRole = new Map<string, GradedMon[]>();
    for (const [g, role] of jobs) {
      const list = winnersByRole.get(roleKey(role)) ?? [];
      list.push(g);
      winnersByRole.set(roleKey(role), list);
    }
    for (const role of roles) {
      const list = winnersByRole.get(roleKey(role)) ?? [];
      const kind = role.kind;
      if (isCappedKind(kind)) list.sort((a, b) => openOrderAs(a, b, kind, role.speciesId));
      else if (kind === "lc") list.sort(lcOrder);
      else list.sort(raidOrder);
      const of = list.length;
      list.forEach((g, i) => {
        const speciesId =
          role.kind === "raid" ? (g.raidIv?.evoSpeciesId ?? role.speciesId) : role.speciesId;
        g.pvpJob = { kind: role.kind, speciesId, seat: i + 1, of };
      });
    }

    const glKeep = new Set<GradedMon>();
    const ulKeep = new Set<GradedMon>();
    const mlKeep = new Set<GradedMon>();
    const lcKeep = new Set<GradedMon>();
    const raidKeep = new Set<GradedMon>();
    for (const g of rows) {
      if (g.pvpJob?.kind === "gl") glKeep.add(g);
      if (g.pvpJob?.kind === "ul") ulKeep.add(g);
      if (g.pvpJob?.kind === "ml") mlKeep.add(g);
      if (g.pvpJob?.kind === "lc") lcKeep.add(g);
      if (g.pvpJob?.kind === "raid") raidKeep.add(g);
    }

    for (const g of rows) {
      const classes = idKeepClasses(g.mon, meta, keepShadow, keepLucky, keepFavorite);
      if (glKeep.has(g)) classes.push("gl");
      if (ulKeep.has(g)) classes.push("ul");
      if (mlKeep.has(g)) classes.push("ml");
      if (lcKeep.has(g)) classes.push("lc");
      const limited = isLimitedMon(g.mon, meta);
      if (raidKeep.has(g) && !limited) classes.push("raid");
      if (
        limited &&
        (raidKeep.has(g) ||
          raidIds.some((t) => canBecome(g.mon.speciesId, t, meta, g.mon.gender)) ||
          Boolean(raidGateId(g.mon.speciesId, meta, g.mon.gender))) &&
        !classes.includes("raid")
      ) {
        classes.push("raid");
      }
      if (
        isHundo(g.mon) &&
        (keepAllGood || glKeep.has(g) || ulKeep.has(g) || mlKeep.has(g) || lcKeep.has(g) || raidKeep.has(g) || g === hundoSlot)
      ) {
        classes.push("hundo");
      }
      g.keepClasses = classes;

      const job = g.pvpJob;
      if (job) {
        const raidCopy = raidOrdered.indexOf(g) + 1;
        const raidN = raidEligible.length || n;
        pushReason(g, jobKeepReason(g, job, cutoff, raidIvKeep, keepAllGood, limited, raidCopy, raidN, raidSlots));
        for (const role of roles) {
          if (!isCappedKind(role.kind)) continue;
          if (job.kind === role.kind && job.speciesId === role.speciesId) continue;
          const over = cappedCapMiss(g, role.speciesId, role.kind, gm);
          if (over) pushReason(g, over);
        }
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
        if (keepGl) {
          const better = betterAsReason(g);
          if (better) pushReason(g, better);
        }
        if (keepUl) {
          const better = betterAsReason(g, g.ulAs, "UL");
          if (better) pushReason(g, better);
        }
        if (keepMl) {
          const better = betterAsReason(g, g.mlAs, "ML");
          if (better) pushReason(g, better);
        }
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
              `Raid copies: ${raidEligible.length}, keeping ${Math.min(raidSlots, raidEligible.length)}`,
            );
          }
        }
      }
    }

    groupSummaries.push({ key, size: n, kept: 0 });
  }

  // Family ranking sorts per-group copies; tracks follow first-scanned-first.
  graded.sort(byScanStream);

  const dumpFuel: GradedMon[] = [];
  const extraOfKeeper = new Set<GradedMon>();
  const extraOfFamily = new Set<GradedMon>();

  const groupAnchor = new Map<string, boolean>();
  for (const [key, rows] of groups) {
    const hasKeep = rows.some((row) => row.keepClasses.length > 0);
    const hasFloor = rows.some((row) => pvpFloorLegal(row, cutoff, gm, keepGl, keepUl, keepMl, keepLc));
    groupAnchor.set(key, hasKeep || hasFloor);
  }

  for (const g of graded) {
    if (g.keepClasses.length) {
      g.verdict = "KEEP";
      continue;
    }

    const hardNeverDump =
      isLimitedMon(g.mon, meta) ||
      g.mon.hasSpecialMove === true ||
      g.mon.ivUnique === false;

    if (g.mon.ivUnique === false) pushReason(g, "IVs not unique; cannot dump");
    if (g.mon.hasSpecialMove === true) pushReason(g, "Special / legacy move — never dump");

    if (hardNeverDump) {
      g.verdict = "LOOK";
      continue;
    }

    const key = familyKey(g.mon.speciesId, meta);
    const anchored = groupAnchor.get(key) === true;
    const ind = independentsOf(g.mon.speciesId);
    const pvpOrRaidFamily =
      (keepGl ? ind.gl.length : 0) +
        (keepUl ? ind.ul.length : 0) +
        (keepMl ? ind.ml.length : 0) +
        (keepLc ? ind.lc.length : 0) +
        ind.raid.length >
      0;

    if (pvpOrRaidFamily && !anchored) {
      // 0 dumps species that are not on a PvP or raid list. A listed family stays LOOK.
      if (familyKeep === 0 || g.copyRankInGroup <= familyKeep) {
        g.verdict = "LOOK";
        pushReason(
          g,
          familyKeep === 0
            ? noKeeperFamilyReason(ind, glIndex, ulIndex, mlIndex, lcIndex, keepGl, keepUl, keepMl, keepLc, fillOrder)
            : `PvP/raid family: ${familyKeep} best (no keeper)`,
        );
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

  for (const g of dumpFuel) {
    g.verdict = "DUMP";
    pushReason(
      g,
      extraOfKeeper.has(g)
        ? "Extra copy — family already has a keeper"
        : extraOfFamily.has(g)
          ? `Extra copy — keeping ${familyKeep} best of PvP/raid family`
          : familyKeep === 0
            ? "Useless for PvP/raids — keep 0 per family"
            : "Not GL/LC/raid/limited; unique IVs",
    );
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
    pvpRankKeep: cutoff,
    pvpListKeep: listKeep,
    pvpAny,
    pvpKeep,
    raidKeep,
    familyKeep,
    raidIvKeep,
    keepAllGood,
    keepLucky,
    keepFavorite,
    keepShadow,
    keepGl,
    keepLc,
    keepUl,
    keepMl,
    pvpFillOrder: fillOrder,
    groups: groupSummaries,
  };
}
