import type {
  GradeResult,
  GradedMon,
  LeagueRank,
  Meta,
  MetaLeagueRank,
  Mon,
  PvpokeRankRow,
  Verdict,
} from "./types";
import {
  clampFamilyKeep,
  clampPvpListKeep,
  clampPvpRankKeep,
  clampRaidIvKeep,
  DEFAULT_FAMILY_KEEP,
  DEFAULT_PVP_LIST_KEEP,
  DEFAULT_PVP_RANK_KEEP,
  DEFAULT_RAID_IV_KEEP,
  GL_LIST_CAP,
  LC_LIST_CAP,
  prettySpeciesId,
} from "./types";
import { canonId } from "./meta";
import { getRankGm, rankGreatLeagueAs, rankLittleCup, raidIvPercent, type RankGm } from "./rank";

const GL_KEEP = 2;
const LC_KEEP = 2;
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

function raidAsName(speciesId: string, meta: Meta): string | null {
  const asId = raidGateId(speciesId, meta);
  if (!asId) return null;
  if (asId === canonId(speciesId)) return null;
  return prettySpeciesId(asId);
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

function keepShadowOn(meta: Meta): boolean {
  return meta.keepShadow !== false;
}

function idKeepClasses(mon: Mon, meta: Meta, keepShadow: boolean): string[] {
  const classes: string[] = [];
  if (mon.shiny) classes.push("shiny");
  if (mon.lucky) classes.push("lucky");
  if (mon.costume) classes.push("costume");
  if (mon.background) classes.push("background");
  if (mon.favorite) classes.push("favorite");
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

function topSet(rows: GradedMon[], n: number, cmp: (a: GradedMon, b: GradedMon) => number): Set<GradedMon> {
  return new Set([...rows].sort(cmp).slice(0, n));
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

function pushReason(g: GradedMon, reason: string): void {
  if (g.reasons.length >= MAX_REASON) return;
  if (!g.reasons.includes(reason)) g.reasons.push(reason);
}

function rankLabel(
  kind: "GL" | "LC",
  g: GradedMon,
  cutoff: number,
  block?: LeagueRank | null,
  metaRank?: MetaLeagueRank | null,
): string {
  const iv = block ?? (kind === "GL" ? g.gl : g.lc);
  const meta = metaRank ?? (kind === "GL" ? g.glMeta : g.lcMeta) ?? null;
  const metaBit = meta ? ` #${meta.rank}/${meta.of}` : "";
  if (!iv) {
    return kind === "GL"
      ? `Great League${metaBit} (IV rank unavailable)`
      : `Little Cup${metaBit} (IV rank unavailable)`;
  }
  const evo =
    kind === "GL" && iv.evoSpeciesId && iv.evoSpeciesId !== canonId(g.mon.speciesId)
      ? ` as ${prettySpeciesId(iv.evoSpeciesId)}`
      : "";
  const league = kind === "GL" ? "Great League" : "Little Cup";
  return `${league}${metaBit}: ${iv.rank}/${iv.of} (keep ≤${cutoff})${evo}`;
}

function missRankReason(kind: "GL" | "LC", g: GradedMon, cutoff: number, n: number, keptCopyRanks: number[]): string {
  const block = kind === "GL" ? g.gl : g.lc;
  if (!block) return `${kind} rank unknown — IVs not unique`;
  if (block.rank > cutoff) return `${kind} ${block.rank}/${block.of} worse than keep ≤${cutoff}`;
  const kept =
    keptCopyRanks.length === 0
      ? "none"
      : keptCopyRanks.length === 1
        ? `copy ${keptCopyRanks[0]}`
        : `copies ${keptCopyRanks.join(" and ")}`;
  return `${n} copies; keep ${kind} ${kept} (≤${cutoff}/4096)`;
}

/**
 * Wide-minmax box grader. KEEP if any keep class fires.
 * DUMP extras in CSV order, capped at meta.dumpCap (rest LOOK with dump-cap).
 */
export function gradeBox(mons: Mon[], meta: Meta): GradeResult {
  const gm: RankGm = getRankGm(meta.glEvolution);
  const cutoff = pvpCutoff(meta);
  const listKeep = pvpListCutoff(meta);
  const familyKeep = familyKeepCap(meta);
  const raidIvKeep = raidIvFloor(meta);
  const keepAllGood = Boolean(meta.keepAllGood);
  const keepShadow = keepShadowOn(meta);
  const glSlots = keepAllGood ? Number.POSITIVE_INFINITY : GL_KEEP;
  const lcSlots = keepAllGood ? Number.POSITIVE_INFINITY : LC_KEEP;
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
      independentGlCache.set(
        key,
        listed.filter((id) => gateMeta.glTop500.has(id)),
      );
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
    const glTargets = ind.listedGl.filter((t) => canBecome(mon.speciesId, t, meta));
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
    const primaryMeta =
      (primary && glMetaAs.find((m) => m.speciesId === primary.evoSpeciesId)) || glMetaAs[0] || null;
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
    const listedGl = ind.listedGl;
    const lcIds = ind.lc;
    const raidIds = ind.raid;
    rows.sort((a, b) => {
      if (listedGl.length) return glOrder(a, b);
      if (lcIds.length) return lcOrder(a, b);
      return raidOrder(a, b);
    });
    rows.forEach((g, i) => {
      g.copiesInGroup = n;
      g.copyRankInGroup = i + 1;
    });

    const glKeep = new Set<GradedMon>();
    const glKeptAs = new Map<GradedMon, string[]>();
    for (const t of glIds) {
      const eligible = rows.filter(
        (g) => canBecome(g.mon.speciesId, t, meta) && rankMeets(rankAs(g, t), cutoff),
      );
      for (const g of topSet(eligible, glSlots, (a, b) => glOrderAs(a, b, t))) {
        glKeep.add(g);
        const list = glKeptAs.get(g) ?? [];
        list.push(t);
        glKeptAs.set(g, list);
      }
    }

    const lcKeep = new Set<GradedMon>();
    for (const t of lcIds) {
      const eligible = rows.filter(
        (g) => canonId(g.mon.speciesId) === t && rankMeets(g.lc, cutoff),
      );
      for (const g of topSet(eligible, lcSlots, lcOrder)) lcKeep.add(g);
    }

    const raidRows = raidIds.length
      ? rows.filter((g) => raidIds.some((t) => canBecome(g.mon.speciesId, t, meta)))
      : [];
    const raidEligible = raidRows.filter((g) => raidIvMeets(g, raidIvKeep));
    const raidKeep = raidEligible.length ? topSet(raidEligible, raidSlots, raidOrder) : new Set<GradedMon>();
    const raidOrdered = [...raidEligible].sort(raidOrder);
    const hundoSlot = keepAllGood ? null : bestHundo(rows);

    const glKeptRanks = [...glKeep]
      .map((g) => g.copyRankInGroup)
      .sort((a, b) => a - b);
    const lcKeptRanks = [...lcKeep]
      .map((g) => g.copyRankInGroup)
      .sort((a, b) => a - b);

    for (const g of rows) {
      const classes = idKeepClasses(g.mon, meta, keepShadow);
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
      if (classes.includes("gl")) {
        const targets = glKeptAs.get(g) ?? [];
        for (const t of targets) {
          pushReason(g, rankLabel("GL", g, cutoff, rankAs(g, t), metaAs(g, t)));
        }
      }
      const better = betterAsReason(g);
      if (better) pushReason(g, better);
      if (classes.includes("lc")) pushReason(g, rankLabel("LC", g, cutoff));
      if (classes.includes("raid")) {
        const asName = raidAsName(g.mon.speciesId, meta);
        const asBit = asName ? ` as ${asName}` : "";
        const ivBit = g.raidIv ? ` ${g.raidIv.percent}% IV` : "";
        const raidCopy = raidOrdered.indexOf(g) + 1;
        const raidN = raidEligible.length || n;
        pushReason(
          g,
          limited
            ? `Raid attacker${asBit}${ivBit} (limited — keep all)`
            : keepAllGood
              ? `Raid attacker${asBit}${ivBit} (keep all eligible)`
              : `Raid attacker${asBit}${ivBit} (copy ${raidCopy || g.copyRankInGroup} of ${raidN}, keep ${Math.min(RAID_KEEP, raidN)} ≥${raidIvKeep}%)`,
        );
      }

      if (glIds.length && !glKeep.has(g)) {
        pushReason(g, missRankReason("GL", g, cutoff, n, glKeptRanks));
      }
      if (lcIds.length && !lcKeep.has(g) && isLcSpecies(g.mon.speciesId, meta)) {
        pushReason(g, missRankReason("LC", g, cutoff, n, lcKeptRanks));
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

    groupSummaries.push({ key, size: n, kept: 0 });
  }

  const dumpCap = meta.dumpCap ?? 100;
  const dumpFuel: GradedMon[] = [];
  const extraOfKeeper = new Set<GradedMon>();
  const extraOfFamily = new Set<GradedMon>();

  const groupAnchor = new Map<string, boolean>();
  for (const [key, rows] of groups) {
    const hasKeep = rows.some((row) => row.keepClasses.length > 0);
    const hasFloor = rows.some((row) => rankMeets(row.gl, cutoff) || rankMeets(row.lc, cutoff));
    groupAnchor.set(key, hasKeep || hasFloor);
  }

  for (const g of graded) {
    if (g.keepClasses.length) {
      g.verdict = "KEEP";
      continue;
    }

    const hardNeverDump =
      g.mon.shadow ||
      isLimitedMon(g.mon, meta) ||
      g.mon.hasSpecialMove === true ||
      g.mon.ivUnique === false;

    if (g.mon.shadow) pushReason(g, "Shadow — never dump in v1");
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

  return {
    keep,
    look,
    dump,
    dumpCap,
    dumpCapped,
    pvpRankKeep: cutoff,
    pvpListKeep: listKeep,
    familyKeep,
    raidIvKeep,
    keepAllGood,
    keepShadow,
    groups: groupSummaries,
  };
}
