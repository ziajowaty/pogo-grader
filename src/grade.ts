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
  DEFAULT_FAMILY_KEEP,
  DEFAULT_PVP_LIST_KEEP,
  DEFAULT_PVP_RANK_KEEP,
  GL_LIST_CAP,
  LC_LIST_CAP,
} from "./types";
import { canonId } from "./meta";
import { getRankGm, rankGreatLeague, rankLittleCup, type RankGm } from "./rank";

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

function glMetaRow(
  speciesId: string,
  meta: Meta,
  index: Map<string, PvpokeRankRow>,
): PvpokeRankRow | null {
  const id = canonId(speciesId);
  const direct = index.get(id);
  if (direct) return direct;
  const mapped = meta.glEvolution[id];
  if (mapped) {
    const row = index.get(mapped);
    if (row) return row;
  }
  if (id.endsWith("_shadow")) {
    const inner = glMetaRow(id.slice(0, -7), meta, index);
    if (!inner) return null;
    const shadowEvo = inner.speciesId.endsWith("_shadow")
      ? inner.speciesId
      : `${inner.speciesId}_shadow`;
    return index.get(shadowEvo) ?? inner;
  }
  return null;
}

function gatedGlSet(meta: Meta, listKeep: number): Set<string> {
  const rows = meta.glRankings;
  if (rows && rows.length > 0) {
    return new Set(rows.filter((row) => row.rank <= listKeep).map((row) => row.speciesId));
  }
  return meta.glTop500;
}

function glGateId(speciesId: string, meta: Meta): string | null {
  const id = canonId(speciesId);
  if (meta.glTop500.has(id)) return id;
  const mapped = meta.glEvolution[id];
  if (mapped && meta.glTop500.has(mapped)) return mapped;
  if (id.endsWith("_shadow")) {
    const inner = glGateId(id.slice(0, -7), meta);
    if (!inner) return null;
    const shadowEvo = inner.endsWith("_shadow") ? inner : `${inner}_shadow`;
    if (meta.glTop500.has(shadowEvo)) return shadowEvo;
    return inner;
  }
  return null;
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

function idKeepClasses(mon: Mon, meta: Meta): string[] {
  const classes: string[] = [];
  if (mon.shiny) classes.push("shiny");
  if (mon.lucky) classes.push("lucky");
  if (mon.costume) classes.push("costume");
  if (mon.background) classes.push("background");
  if (mon.favorite) classes.push("favorite");
  if (mon.hasSpecialMove) classes.push("special-move");
  if (mon.shadow) classes.push("shadow");
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

function leaderboardOrder(a: GradedMon, b: GradedMon, meta: Meta): number {
  const gl = Boolean(glGateId(a.mon.speciesId, meta) || glGateId(b.mon.speciesId, meta));
  if (gl) return glOrder(a, b);
  if (isLcSpecies(a.mon.speciesId, meta) || isLcSpecies(b.mon.speciesId, meta)) {
    return lcOrder(a, b);
  }
  if (hasId(meta.raidAttackers, a.mon.speciesId) || hasId(meta.raidAttackers, b.mon.speciesId)) {
    return raidOrder(a, b);
  }
  return raidOrder(a, b);
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

function rankMeets(rank: LeagueRank | null | undefined, cutoff: number): boolean {
  return rank != null && rank.rank <= cutoff;
}

function pushReason(g: GradedMon, reason: string): void {
  if (g.reasons.length >= MAX_REASON) return;
  if (!g.reasons.includes(reason)) g.reasons.push(reason);
}

function rankLabel(kind: "GL" | "LC", g: GradedMon, cutoff: number): string {
  const block = kind === "GL" ? g.gl : g.lc;
  const metaRank = kind === "GL" ? g.glMeta : g.lcMeta;
  const metaBit = metaRank ? ` #${metaRank.rank}/${metaRank.of}` : "";
  if (!block) {
    return kind === "GL"
      ? `Great League${metaBit} (IV rank unavailable)`
      : `Little Cup${metaBit} (IV rank unavailable)`;
  }
  const evo =
    kind === "GL" && block.evoSpeciesId && block.evoSpeciesId !== canonId(g.mon.speciesId)
      ? ` as ${block.evoSpeciesId}`
      : "";
  const league = kind === "GL" ? "Great League" : "Little Cup";
  return `${league}${metaBit}: ${block.rank}/${block.of} (keep ≤${cutoff})${evo}`;
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
  const keepAllGood = Boolean(meta.keepAllGood);
  const glSlots = keepAllGood ? Number.POSITIVE_INFINITY : GL_KEEP;
  const lcSlots = keepAllGood ? Number.POSITIVE_INFINITY : LC_KEEP;
  const raidSlots = keepAllGood ? Number.POSITIVE_INFINITY : RAID_KEEP;
  const glIndex = indexRanks(meta.glRankings);
  const lcIndex = indexRanks(meta.lcRankings);
  const glOf = meta.glRankings?.length || GL_LIST_CAP;
  const lcOf = meta.lcRankings?.length || LC_LIST_CAP;
  const gateMeta: Meta = { ...meta, glTop500: gatedGlSet(meta, listKeep) };
  const graded: GradedMon[] = mons.map((mon) => {
    const glSpecies = glGateId(mon.speciesId, gateMeta);
    const lc = isLcSpecies(mon.speciesId, meta);
    const glRow = glMetaRow(mon.speciesId, meta, glIndex);
    const lcRow = lookupRank(mon.speciesId, lcIndex);
    return {
      mon,
      verdict: "LOOK" as Verdict,
      reasons: [],
      keepClasses: [],
      gl: glSpecies ? rankGreatLeague(mon, gm) : null,
      lc: lc ? rankLittleCup(mon, gm) : null,
      glMeta: glRow ? toMetaRank(glRow, glOf) : null,
      lcMeta: lcRow ? toMetaRank(lcRow, lcOf) : null,
      copiesInGroup: 1,
      copyRankInGroup: 1,
    };
  });

  const groups = new Map<string, GradedMon[]>();
  for (const g of graded) {
    const key = canonId(g.mon.speciesId) || g.mon.speciesId;
    const list = groups.get(key);
    if (list) list.push(g);
    else groups.set(key, [g]);
  }

  const groupSummaries: GradeResult["groups"] = [];

  for (const [key, rows] of groups) {
    const n = rows.length;
    rows.sort((a, b) => leaderboardOrder(a, b, gateMeta));
    rows.forEach((g, i) => {
      g.copiesInGroup = n;
      g.copyRankInGroup = i + 1;
    });

    const glRows = glGateId(rows[0].mon.speciesId, gateMeta) ? rows : [];
    const lcRows = isLcSpecies(rows[0].mon.speciesId, meta) ? rows : [];
    const raidRows = hasId(meta.raidAttackers, rows[0].mon.speciesId) ? rows : [];
    const glEligible = glRows.filter((g) => rankMeets(g.gl, cutoff));
    const lcEligible = lcRows.filter((g) => rankMeets(g.lc, cutoff));
    const glKeep = glEligible.length ? topSet(glEligible, glSlots, glOrder) : new Set<GradedMon>();
    const lcKeep = lcEligible.length ? topSet(lcEligible, lcSlots, lcOrder) : new Set<GradedMon>();
    const raidKeep = raidRows.length ? topSet(raidRows, raidSlots, raidOrder) : new Set<GradedMon>();
    const hundoSlot = keepAllGood ? null : bestHundo(rows);

    const glKeptRanks = [...glKeep]
      .map((g) => g.copyRankInGroup)
      .sort((a, b) => a - b);
    const lcKeptRanks = [...lcKeep]
      .map((g) => g.copyRankInGroup)
      .sort((a, b) => a - b);

    for (const g of rows) {
      const classes = idKeepClasses(g.mon, meta);
      if (glKeep.has(g)) classes.push("gl");
      if (lcKeep.has(g)) classes.push("lc");
      const limited = isLimitedMon(g.mon, meta);
      if (raidKeep.has(g) && !limited) classes.push("raid");
      if (limited && hasId(meta.raidAttackers, g.mon.speciesId) && !classes.includes("raid")) {
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
      if (classes.includes("gl")) pushReason(g, rankLabel("GL", g, cutoff));
      if (classes.includes("lc")) pushReason(g, rankLabel("LC", g, cutoff));
      if (classes.includes("raid")) {
        pushReason(
          g,
          limited
            ? "Raid attacker (limited — keep all)"
            : keepAllGood
              ? "Raid attacker (keep all eligible)"
              : `Raid attacker (copy ${g.copyRankInGroup} of ${n}, keep ${Math.min(RAID_KEEP, n)})`,
        );
      }

      if (glRows.length && !glKeep.has(g)) {
        pushReason(g, missRankReason("GL", g, cutoff, n, glKeptRanks));
      }
      if (lcRows.length && !lcKeep.has(g)) {
        pushReason(g, missRankReason("LC", g, cutoff, n, lcKeptRanks));
      }
      if (raidRows.length && !raidKeep.has(g) && !limited) {
        pushReason(
          g,
          keepAllGood
            ? `Raid copies: ${n}`
            : `Raid copies: ${n}, keeping ${Math.min(RAID_KEEP, n)}`,
        );
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

    const key = canonId(g.mon.speciesId) || g.mon.speciesId;
    const anchored = groupAnchor.get(key) === true;
    const pvpOrRaidFamily =
      Boolean(glGateId(g.mon.speciesId, gateMeta)) ||
      isLcSpecies(g.mon.speciesId, meta) ||
      hasId(meta.raidAttackers, g.mon.speciesId);

    if (pvpOrRaidFamily && !anchored) {
      if (g.copyRankInGroup <= familyKeep) {
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

    if (g.copiesInGroup === 1 || g.copyRankInGroup === 1) {
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
          ? "Extra copy — species already has a keeper"
          : extraOfFamily.has(g)
            ? `Extra copy — keeping ${familyKeep} best of PvP/raid family`
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
      const key = canonId(g.mon.speciesId) || g.mon.speciesId;
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
    keepAllGood,
    groups: groupSummaries,
  };
}
