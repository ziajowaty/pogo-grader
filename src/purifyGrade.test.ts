import { gradeBox } from "./grade";
import { loadMeta, mergeReturnFamilies, returnPurifyBase } from "./meta";
import { getRankGm, GREAT_LEAGUE_CAP, purifiedCp, rankCappedLeagueAs, rankPurifiedAs } from "./rank";
import type { GradedMon, Meta, Mon, PvpokeRankRow } from "./types";

function must(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function ivMon(
  speciesId: string,
  speciesName: string,
  row: number,
  atk: number,
  def: number,
  sta: number,
  extra: Partial<Mon> = {},
): Mon {
  return {
    source: "pokegenie",
    sourceRow: row,
    speciesName,
    speciesId,
    form: "Normal",
    gender: "male",
    cp: 400,
    hp: 90,
    atk,
    def,
    sta,
    ivUnique: true,
    ivPercent: ((atk + def + sta) / 45) * 100,
    level: 20,
    shadow: false,
    purified: false,
    ...extra,
  };
}

function withMoveset(
  rows: PvpokeRankRow[] | undefined,
  id: string,
  moveset: string[],
  rank: number,
  name: string,
): PvpokeRankRow[] {
  const next = [...(rows ?? [])];
  const i = next.findIndex((row) => row.speciesId === id);
  if (i >= 0) next[i] = { ...next[i], moveset };
  else next.push({ speciesId: id, rank, speciesName: name, moveset });
  return next;
}

function shadowWob(row: number, atk: number, def: number, sta: number): Mon {
  return ivMon("wobbuffet_shadow", "Wobbuffet", row, atk, def, sta, { shadow: true, form: "Shadow" });
}

function pileText(rows: GradedMon[]): string {
  return rows.map((g) => `${g.verdict} r${g.mon.sourceRow} ${g.pvpJob?.kind ?? "-"}:${g.pvpJob?.speciesId ?? "-"} ${g.reasons[0] ?? ""}`).join(" | ");
}

function betterRank(a: { rank: number; statProduct: number }, b: { rank: number; statProduct: number }): boolean {
  return a.rank < b.rank || (a.rank === b.rank && a.statProduct >= b.statProduct);
}

const loaded = await loadMeta();
const gl = withMoveset(
  withMoveset(loaded.glRankings, "wobbuffet", ["COUNTER", "MIRROR_COAT", "RETURN"], 219, "Wobbuffet"),
  "wobbuffet_shadow",
  ["COUNTER", "MIRROR_COAT", "FRUSTRATION"],
  417,
  "Wobbuffet",
);
const meta: Meta = {
  ...loaded,
  glRankings: gl,
  familyOf: mergeReturnFamilies(loaded.familyOf, ["wobbuffet"]),
  keepShadow: false,
  keepLucky: false,
  keepFavorite: false,
  keepUl: false,
  keepMl: false,
  pvpRankKeep: 4096,
  pvpListKeep: 500,
};

must(returnPurifyBase("wobbuffet_shadow", gl) === "wobbuffet", "Return on the normal moveset opens the purify seat");

const gm = getRankGm(meta.glEvolution);
const low = shadowWob(1, 0, 15, 15);
const mid = shadowWob(2, 5, 15, 15);
const lowRank = rankPurifiedAs(low, gm, "wobbuffet", GREAT_LEAGUE_CAP);
const midRank = rankPurifiedAs(mid, gm, "wobbuffet", GREAT_LEAGUE_CAP);
must(lowRank != null && midRank != null, "purified GL ranks exist");
const betterRow = betterRank(lowRank, midRank) ? 1 : 2;

const two = gradeBox([low, mid], meta);
must(two.keep.length === 2, `two shadows KEEP, got ${pileText([...two.keep, ...two.look, ...two.dump])}`);
const purify = two.keep.find((g) => g.pvpJob?.speciesId === "wobbuffet");
const stay = two.keep.find((g) => g.pvpJob?.speciesId === "wobbuffet_shadow");
must(purify != null && purify.reasons.some((r) => r.startsWith("Purify to")), "one KEEP is the purify seat");
must(stay != null && stay.reasons.some((r) => r.startsWith("Stay")), "one KEEP is the shadow seat");
must(purify.mon.sourceRow === betterRow, `purify seat goes to the better purified rank (row ${betterRow})`);

const three = gradeBox([low, mid, shadowWob(3, 10, 10, 10)], meta);
must(three.keep.length === 2, `a third shadow does not KEEP, got ${pileText([...three.keep, ...three.look, ...three.dump])}`);
must(
  three.dump.length === 1 && three.keep.some((g) => g.pvpJob?.speciesId === "wobbuffet") && three.keep.some((g) => g.pvpJob?.speciesId === "wobbuffet_shadow"),
  `the extra shadow DUMPs, got ${pileText([...three.keep, ...three.look, ...three.dump])}`,
);

const one = gradeBox([low], meta);
must(
  one.keep.length === 1 && one.keep[0].pvpJob?.speciesId === "wobbuffet" && one.keep[0].reasons.some((r) => r.startsWith("Purify to")),
  `one shadow takes the better species by purifying, got ${pileText([...one.keep, ...one.look, ...one.dump])}`,
);

const shadowReturn = withMoveset(gl, "wobbuffet_shadow", ["COUNTER", "MIRROR_COAT", "RETURN"], 417, "Wobbuffet");
must(returnPurifyBase("wobbuffet_shadow", shadowReturn) == null, "Return on the shadow moveset is not a purify seat");
const noPurify = gradeBox([low, mid], { ...meta, glRankings: shadowReturn });
must(
  !noPurify.keep.some((g) => g.reasons.some((r) => r.startsWith("Purify to"))),
  "no purify job when the shadow moveset also has Return",
);

const normal = ivMon("wobbuffet", "Wobbuffet", 1, 0, 15, 15);
const shadow = shadowWob(2, 15, 0, 0);
const mixed = gradeBox([normal, shadow], meta);
const normalJobs = mixed.keep.filter((g) => g.pvpJob?.speciesId === "wobbuffet");
must(normalJobs.length === 1, `normal and shadow share one Wobbuffet seat, got ${pileText([...mixed.keep, ...mixed.look, ...mixed.dump])}`);
const normalRank = rankCappedLeagueAs(normal, gm, "wobbuffet", GREAT_LEAGUE_CAP);
const purifiedRank = rankPurifiedAs(shadow, gm, "wobbuffet", GREAT_LEAGUE_CAP);
must(normalRank != null && purifiedRank != null, "both Wobbuffet ranks exist");
const expectRow = betterRank(normalRank, purifiedRank) ? 1 : 2;
must(normalJobs[0].mon.sourceRow === expectRow, `the better Wobbuffet rank takes the normal seat (row ${expectRow})`);
const shadowKept = mixed.keep.some((g) => g.pvpJob?.speciesId === "wobbuffet_shadow");
must(
  expectRow === 1 ? shadowKept : !shadowKept,
  expectRow === 1
    ? `the leftover shadow KEEPs the shadow seat, got ${pileText([...mixed.keep, ...mixed.look, ...mixed.dump])}`
    : "a shadow that took the normal seat cannot also keep the shadow seat",
);

const raidMeta: Meta = {
  ...loaded,
  familyOf: mergeReturnFamilies(loaded.familyOf, ["gengar"]),
  keepGl: false,
  keepLc: false,
  keepShadow: false,
  keepLucky: false,
  keepFavorite: false,
  raidIvKeep: 0,
};
const raid = gradeBox(
  [
    ivMon("gengar", "Gengar", 1, 10, 10, 10),
    ivMon("gengar_shadow", "Gengar", 2, 10, 10, 10, { shadow: true, form: "Shadow" }),
  ],
  raidMeta,
);
must(
  raid.keep.length === 2 && raid.keep.every((g) => g.pvpJob?.kind === "raid"),
  `merged Gengar lines keep both raid seats, got ${pileText([...raid.keep, ...raid.look, ...raid.dump])}`,
);

const lcRows: PvpokeRankRow[] = [
  { speciesId: "cubone", rank: 46, speciesName: "Cubone", moveset: ["MUD_SLAP", "BONE_CLUB", "RETURN"] },
  { speciesId: "cubone_shadow", rank: 58, speciesName: "Cubone", moveset: ["MUD_SLAP", "BONE_CLUB", "BULLDOZE"] },
  { speciesId: "magikarp", rank: 527, speciesName: "Magikarp", moveset: ["SPLASH", "STRUGGLE", "RETURN"] },
  { speciesId: "magikarp_shadow", rank: 528, speciesName: "Magikarp", moveset: ["SPLASH", "STRUGGLE", "FRUSTRATION"] },
];
const lcMeta: Meta = {
  ...loaded,
  lcRankings: lcRows,
  familyOf: mergeReturnFamilies(loaded.familyOf, ["cubone", "magikarp"]),
  keepGl: false,
  keepUl: false,
  keepMl: false,
  keepShadow: false,
  keepLucky: false,
  keepFavorite: false,
  pvpRankKeep: 4096,
  pvpListKeep: 1000,
};
const bone = ivMon("cubone_shadow", "Cubone", 1, 2, 15, 1, { shadow: true, form: "Shadow", level: 8, cp: 191 });
const boneCp = purifiedCp(bone, "cubone", gm);
must(boneCp != null && boneCp > 500, `level-25 Cubone is over Little Cup, got ${boneCp}`);
const boneGrade = gradeBox([bone], lcMeta);
must(
  boneGrade.keep.concat(boneGrade.look, boneGrade.dump).every((g) => !g.reasons.some((r) => r.startsWith("Purify to"))),
  `Cubone has no purified Little Cup seat, got ${pileText([...boneGrade.keep, ...boneGrade.look, ...boneGrade.dump])}`,
);
must(
  boneGrade.keep.some((g) => g.pvpJob?.kind === "lc" && g.pvpJob.speciesId === "cubone_shadow"),
  `Cubone still keeps its own Little Cup seat, got ${pileText([...boneGrade.keep, ...boneGrade.look, ...boneGrade.dump])}`,
);
const karp = ivMon("magikarp_shadow", "Magikarp", 1, 1, 15, 7, { shadow: true, form: "Shadow", level: 8, cp: 40 });
const karpCp = purifiedCp(karp, "magikarp", gm);
must(karpCp != null && karpCp <= 500, `level-25 Magikarp still fits Little Cup, got ${karpCp}`);
const karpGrade = gradeBox([karp], lcMeta);
must(
  karpGrade.keep.some(
    (g) => g.pvpJob?.speciesId === "magikarp" && g.reasons.some((r) => r.startsWith("Purify to") && r.includes("Little Cup")),
  ),
  `Magikarp still purifies for Little Cup, got ${pileText([...karpGrade.keep, ...karpGrade.look, ...karpGrade.dump])}`,
);

console.log("purify grade ok");
