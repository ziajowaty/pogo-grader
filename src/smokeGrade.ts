import { readFileSync } from "node:fs";
import { parseInventoryCsv } from "./parseCsv";
import { loadMeta } from "./meta";
import { gradeBox } from "./grade";
import { clampFamilyKeep, FAMILY_KEEP_MIN, type Mon } from "./types";

function must(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function streamOrder(rows: { mon: { sourceRow: number } }[], label: string): void {
  for (let i = 1; i < rows.length; i++) {
    must(
      rows[i].mon.sourceRow >= rows[i - 1].mon.sourceRow,
      `${label} must stay in CSV order (${rows[i - 1].mon.sourceRow} then ${rows[i].mon.sourceRow})`,
    );
  }
}

const csv = readFileSync(new URL("../fixtures/sample-pokegenie.csv", import.meta.url), "utf8");
const parsed = parseInventoryCsv(csv);
const meta = await loadMeta();
must(meta.pvpokeSource === "bundled", "Node loadMeta must stay on vendored PvPoke lists");
const result = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500 });
const all = [...result.keep, ...result.look, ...result.dump];

must(parsed.dialect === "pokegenie", `expected pokegenie, got ${parsed.dialect}`);
must(parsed.mons.length === 10, `expected 10 mons, got ${parsed.mons.length}`);
must(result.pvpRankKeep === 500, "echo pvpRankKeep 500");
must(result.pvpListKeep === 500, "default pvpListKeep 500");
must(result.familyKeep === 2, "default familyKeep 2");
must(clampFamilyKeep(0) === 0 && FAMILY_KEEP_MIN === 0, "familyKeep 0 is a valid clamp");
must(result.keepAllGood === false, "default extras as dupes");
must(result.keepShadow === true, "default KEEP every shadow");
must(Array.isArray(meta.glRankings) && meta.glRankings.length === 500, "bundled GL rankings 500");
must(Array.isArray(meta.lcRankings) && meta.lcRankings.length === 100, "bundled LC rankings 100");
must(
  Array.isArray(meta.raidRankings) &&
    meta.raidRankings.filter((row) => !row.asSpeciesId).length === meta.raidAttackers.size,
  "raid table finals match KEEP set",
);
must(meta.raidRankings?.some((row) => row.speciesId === "machamp") === true, "machamp on raid table");
must(meta.raidEvolution?.bulbasaur === "venusaur", "bulbasaur maps to venusaur for raids");
must(meta.raidEvolution?.ivysaur === "venusaur", "ivysaur maps to venusaur for raids");
must(
  meta.raidRankings?.some((row) => row.speciesId === "bulbasaur" && row.asSpeciesId === "venusaur") === true,
  "bulbasaur listed as Venusaur pre-evo",
);

const fox = all.find((g) => g.mon.speciesId === "ninetales_alolan_shadow");
must(fox?.verdict === "KEEP", "alolan shadow ninetales must KEEP");
must(fox?.keepClasses.includes("shadow") === true, "shadow keep class");

const favoriteToad = all.find((g) => g.mon.speciesId === "seismitoad" && g.mon.favorite === true);
must(favoriteToad?.verdict === "KEEP", "favorite seismitoad must KEEP");

const extraToads = all.filter((g) => g.mon.speciesId === "seismitoad" && g.mon.favorite !== true);
must(extraToads.length === 2, `expected 2 extra seismitoads, got ${extraToads.length}`);
must(
  extraToads.every((g) => g.verdict === "DUMP"),
  `extra seismitoads should DUMP when a keeper exists, got ${extraToads.map((g) => g.verdict).join(",")}`,
);
must(
  extraToads.every((g) => g.reasons.some((r) => r.includes("Extra copy"))),
  "extra dump reason",
);

const machamp = all.find((g) => g.mon.speciesId === "machamp_shadow");
must(machamp?.verdict === "KEEP", "shadow machamp must KEEP");

const wooper = all.find((g) => g.mon.speciesId === "wooper");
must(wooper?.keepClasses.includes("gl") === true, "0/15/15 wooper should KEEP via GL at ≤500");
must(wooper?.gl != null && wooper.gl.rank <= 500, "wooper GL rank should be ≤500");

const dumps = result.dump.map((g) => g.mon.speciesId);
must(
  dumps[0] === "seismitoad" && dumps[1] === "seismitoad" && dumps[2] === "bidoof",
  `DUMP should follow CSV order, got ${dumps.join(",")}`,
);
streamOrder(result.keep, "KEEP");
streamOrder(result.look, "LOOK");
streamOrder(result.dump, "DUMP");

const wooperMon = parsed.mons.find((m) => m.speciesId === "wooper");
must(Boolean(wooperMon), "fixture wooper");
const extraWooper: Mon = {
  ...wooperMon!,
  sourceRow: 99,
  atk: 15,
  def: 0,
  sta: 0,
  ivPercent: 33.3,
  favorite: false,
  nickname: "junk-wooper",
};
const withExtraWooper = gradeBox([...parsed.mons, extraWooper], { ...meta, pvpRankKeep: 500 });
must(
  withExtraWooper.dump.some((g) => g.mon.sourceRow === 99),
  "extra wooper DUMP when GL keeper exists",
);
must(
  withExtraWooper.keep.some((g) => g.mon.speciesId === "wooper" && g.mon.sourceRow !== 99),
  "original wooper still KEEP",
);

const noFavMons = parsed.mons.map((m) =>
  m.speciesId === "seismitoad" ? { ...m, favorite: false } : m,
);
const noFavTight = gradeBox(noFavMons, { ...meta, pvpRankKeep: 1 });
const tightToads = [...noFavTight.keep, ...noFavTight.look, ...noFavTight.dump].filter(
  (g) => g.mon.speciesId === "seismitoad",
);
const toadKeep = tightToads.filter((g) => g.verdict === "KEEP");
const toadLook = tightToads.filter((g) => g.verdict === "LOOK");
const toadDump = tightToads.filter((g) => g.verdict === "DUMP");
if (toadKeep.length === 0) {
  must(tightToads.length === 3, "fixture has 3 seismitoads");
  must(toadLook.length === 2, "no-keeper GL family LOOKs familyKeep 2");
  must(toadDump.length === 1, "no-keeper GL family dumps extras beyond familyKeep");
  must(
    toadLook.every((g) => g.copyRankInGroup <= 2),
    "LOOK copies are the 2 best of the family",
  );
  must(
    toadDump.every((g) => g.copyRankInGroup > 2),
    "DUMP copies are worse than familyKeep",
  );
} else {
  must(
    toadDump.length === tightToads.length - toadKeep.length,
    "when a seismitoad still KEEPs, the rest DUMP",
  );
}

const noFavAll = gradeBox(noFavMons, { ...meta, pvpRankKeep: 1, familyKeep: 99 });
const allToads = [...noFavAll.keep, ...noFavAll.look, ...noFavAll.dump].filter(
  (g) => g.mon.speciesId === "seismitoad",
);
if (allToads.every((g) => g.verdict !== "KEEP")) {
  must(
    allToads.every((g) => g.verdict === "LOOK"),
    "familyKeep 99 keeps a no-keeper GL family as LOOK",
  );
}

const noFavOne = gradeBox(noFavMons, { ...meta, pvpRankKeep: 1, familyKeep: 1 });
const oneToads = [...noFavOne.keep, ...noFavOne.look, ...noFavOne.dump].filter(
  (g) => g.mon.speciesId === "seismitoad",
);
if (oneToads.every((g) => g.verdict !== "KEEP")) {
  must(
    oneToads.filter((g) => g.verdict === "LOOK").length === 1,
    "familyKeep 1 LOOKs only the best copy",
  );
  must(
    oneToads.filter((g) => g.verdict === "DUMP").length === 2,
    "familyKeep 1 dumps the other two",
  );
}

const noFavZero = gradeBox(noFavMons, { ...meta, pvpRankKeep: 1, familyKeep: 0 });
const zeroToads = [...noFavZero.keep, ...noFavZero.look, ...noFavZero.dump].filter(
  (g) => g.mon.speciesId === "seismitoad",
);
if (zeroToads.every((g) => g.verdict !== "KEEP")) {
  must(
    zeroToads.every((g) => g.verdict === "DUMP"),
    "familyKeep 0 dumps a no-keeper GL family",
  );
  must(
    zeroToads.every((g) => g.reasons.some((r) => r.includes("keep 0 per family"))),
    "familyKeep 0 dump reason",
  );
}

const sampleZero = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, familyKeep: 0 });
must(sampleZero.keep.length === result.keep.length, "familyKeep 0 does not drop KEEP");
const junkZero = [...sampleZero.keep, ...sampleZero.look, ...sampleZero.dump].filter((g) =>
  ["bidoof", "caterpie"].includes(g.mon.speciesId),
);
must(
  junkZero.every((g) => g.verdict === "DUMP"),
  "familyKeep 0 dumps ungated junk including only copies",
);
must(
  sampleZero.keep.some(
    (g) => g.mon.speciesId === "weedle" && g.keepClasses.includes("raid") && g.reasons.some((r) => /as Beedrill/i.test(r)),
  ),
  "familyKeep 0 still KEEPs a raid pre-evo",
);
must(
  sampleZero.keep.some((g) => g.mon.speciesId === "wooper" && g.keepClasses.includes("gl")),
  "familyKeep 0 still KEEPs a PvP floor copy",
);
must(
  sampleZero.dump.every((g) => !g.mon.shadow),
  "familyKeep 0 still never dumps shadows",
);

const tight = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 1 });
must(tight.pvpRankKeep === 1, "echo pvpRankKeep 1");
const wooperTight = [...tight.keep, ...tight.look, ...tight.dump].find((g) => g.mon.speciesId === "wooper");
must(wooperTight?.keepClasses.includes("gl") !== true, "rank-1 floor must drop wooper GL keep");
must(wooperTight?.verdict !== "DUMP", "only wooper still never DUMP");

const extraWoopers: Mon[] = [1, 2, 3].map((i) => ({
  ...wooperMon!,
  sourceRow: 600 + i,
  atk: 15,
  def: i,
  sta: 0,
  ivPercent: 33.3,
  favorite: false,
  nickname: `junk-wooper-${i}`,
}));
const wooperFamily = gradeBox([wooperMon!, ...extraWoopers], { ...meta, pvpRankKeep: 1, familyKeep: 2 });
const wooperRows = [...wooperFamily.keep, ...wooperFamily.look, ...wooperFamily.dump].filter(
  (g) => g.mon.speciesId === "wooper",
);
must(wooperRows.length === 4, "four woopers in family test");
if (wooperRows.every((g) => g.verdict !== "KEEP")) {
  must(
    wooperRows.filter((g) => g.verdict === "LOOK").length === 2,
    "no-keeper wooper family LOOKs 2 best",
  );
  must(
    wooperRows.filter((g) => g.verdict === "DUMP").length === 2,
    "no-keeper wooper family dumps extras beyond 2",
  );
}
const wooperZero = gradeBox([wooperMon!, ...extraWoopers], { ...meta, pvpRankKeep: 1, familyKeep: 0 });
const wooperZeroRows = [...wooperZero.keep, ...wooperZero.look, ...wooperZero.dump].filter(
  (g) => g.mon.speciesId === "wooper",
);
if (wooperZeroRows.every((g) => g.verdict !== "KEEP")) {
  must(
    wooperZeroRows.every((g) => g.verdict === "DUMP"),
    "familyKeep 0 dumps a no-keeper wooper family",
  );
}
must(
  tight.keep.some((g) => g.mon.speciesId === "seismitoad" && g.keepClasses.includes("favorite")),
  "favorite still KEEP when rank floor is 1",
);
must(
  tight.dump.some((g) => g.mon.speciesId === "seismitoad"),
  "favorite seismitoad still anchors extra DUMP at rank floor 1",
);

const none = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 4096 });
must(none.pvpRankKeep === 4096, "pvpRankKeep 4096");

const toadRow = meta.glRankings?.find((row) => row.speciesId === "seismitoad");
must(Boolean(toadRow), "seismitoad is in bundled GL rankings");
must(favoriteToad?.glMeta?.rank === toadRow?.rank, "graded seismitoad shows PvPoke GL rank");
const wooperLcRow = meta.lcRankings?.find((row) => row.speciesId === "wooper");
must(wooper?.lcMeta?.rank === wooperLcRow?.rank, "graded wooper shows PvPoke LC rank");
const quagRow = meta.glRankings?.find((row) => row.speciesId === "quagsire");
must(wooper?.glMeta?.rank === quagRow?.rank, "wooper GL meta rank is the quagsire evo");

const listCut = Math.max(1, (toadRow?.rank ?? 2) - 1);
const cutList = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, pvpListKeep: listCut });
must(cutList.pvpListKeep === listCut, "echo pvpListKeep cutoff");
const cutToad = [...cutList.keep, ...cutList.look, ...cutList.dump].find(
  (g) => g.mon.speciesId === "seismitoad" && g.mon.favorite === true,
);
must(cutToad?.keepClasses.includes("gl") !== true, "GL species cutoff drops seismitoad PvP keep");
must(cutToad?.glMeta?.rank === toadRow?.rank, "cutoff still shows PvPoke rank on the graded row");
must(cutToad?.verdict === "KEEP", "favorite seismitoad still KEEP when off the PvPoke list");

function hundoAt(speciesId: string, speciesName: string, row: number, atk = 15): Mon {
  return {
    source: "pokegenie",
    sourceRow: row,
    speciesName,
    speciesId,
    form: "Normal",
    gender: "male",
    cp: 2800,
    hp: 160,
    atk,
    def: 15,
    sta: 15,
    ivUnique: true,
    ivPercent: 100,
    shadow: false,
    purified: false,
  };
}

const eightHundos = Array.from({ length: 8 }, (_, i) => hundoAt("machamp", "Machamp", 300 + i, 15));
const dupeHundos = gradeBox(eightHundos, { ...meta, keepAllGood: false });
const allHundos = gradeBox(eightHundos, { ...meta, keepAllGood: true });
const raidMachamp = meta.raidAttackers.has("machamp");
if (raidMachamp) {
  must(dupeHundos.keep.length === 6, `dupe mode keeps 6 raid 4*, got ${dupeHundos.keep.length}`);
  must(dupeHundos.dump.length === 2, `dupe mode dumps extra 4* raid, got ${dupeHundos.dump.length}`);
} else {
  must(dupeHundos.keep.length === 1, "dupe mode keeps 1 hundo if not a raid species");
  must(dupeHundos.dump.length === 7, "extra 4* dump as dupes");
}
must(allHundos.keep.length === 8, "keepAllGood keeps every 4*");
must(allHundos.dump.length === 0, "keepAllGood dumps none of the 4* raid set");

const twoBidoofHundos = [
  hundoAt("bidoof", "Bidoof", 400),
  hundoAt("bidoof", "Bidoof", 401),
];
const dupeBidoof = gradeBox(twoBidoofHundos, { ...meta, keepAllGood: false });
const allBidoof = gradeBox(twoBidoofHundos, { ...meta, keepAllGood: true });
must(dupeBidoof.keep.length === 1 && dupeBidoof.dump.length === 1, "one 4* Bidoof kept as dupe");
must(allBidoof.keep.length === 2, "keepAllGood keeps both 4* Bidoofs");

const bulbs = [
  hundoAt("bulbasaur", "Bulbasaur", 410, 15),
  hundoAt("bulbasaur", "Bulbasaur", 411, 10),
  hundoAt("bulbasaur", "Bulbasaur", 412, 0),
];
const bulbMeta = { ...meta, keepAllGood: false, pvpListKeep: 1, pvpRankKeep: 1 };
const bulbGrade = gradeBox(bulbs, bulbMeta);
const bulbKeep = bulbGrade.keep.filter((g) => g.mon.speciesId === "bulbasaur");
must(bulbKeep.length === 3, `bulbasaur raid pre-evos KEEP, got ${bulbKeep.length}`);
must(
  bulbKeep.every((g) => g.keepClasses.includes("raid") && g.reasons.some((r) => /as Venusaur/i.test(r))),
  "bulbasaur KEEP reason names Venusaur",
);
const ivy = gradeBox([hundoAt("ivysaur", "Ivysaur", 413, 14)], bulbMeta);
must(ivy.keep[0]?.keepClasses.includes("raid") === true, "ivysaur KEEP as raid");
must(ivy.keep[0]?.reasons.some((r) => /as Venusaur/i.test(r)) === true, "ivysaur reason names Venusaur");
const eightBulbs = Array.from({ length: 8 }, (_, i) =>
  hundoAt("bulbasaur", "Bulbasaur", 420 + i, i < 6 ? 15 : 10),
);
const bulbDupes = gradeBox(eightBulbs, bulbMeta);
must(bulbDupes.keep.length === 6, `dupe mode keeps 6 raid pre-evo copies, got ${bulbDupes.keep.length}`);
must(bulbDupes.dump.length === 2, `dupe mode dumps extra raid pre-evos, got ${bulbDupes.dump.length}`);

const mixedLine = [
  ...Array.from({ length: 4 }, (_, i) => hundoAt("bulbasaur", "Bulbasaur", 430 + i, 15)),
  ...Array.from({ length: 4 }, (_, i) => hundoAt("venusaur", "Venusaur", 440 + i, 15)),
];
const mixedDupes = gradeBox(mixedLine, bulbMeta);
must(mixedDupes.keep.length === 6, `family raid pool keeps 6 across Bulbasaur/Venusaur, got ${mixedDupes.keep.length}`);
must(mixedDupes.dump.length === 2, `family raid pool dumps extras across stages, got ${mixedDupes.dump.length}`);
must(
  mixedDupes.keep.concat(mixedDupes.dump).every((g) => g.copiesInGroup === 8),
  "Bulbasaur and Venusaur share one family copy count",
);

function ivMon(
  speciesId: string,
  speciesName: string,
  row: number,
  atk: number,
  def: number,
  sta: number,
): Mon {
  return {
    source: "pokegenie",
    sourceRow: row,
    speciesName,
    speciesId,
    form: "Normal",
    gender: "male",
    cp: 600,
    hp: 90,
    atk,
    def,
    sta,
    ivUnique: true,
    ivPercent: ((atk + def + sta) / 45) * 100,
    shadow: false,
    purified: false,
  };
}

must(meta.glTop500.has("machoke"), "machoke is independently on GL");
must(meta.glTop500.has("machamp"), "machamp is independently on GL");
const pvpOnly: typeof meta = {
  ...meta,
  keepAllGood: false,
  raidAttackers: new Set(),
  raidEvolution: {},
  pvpRankKeep: 4096,
  pvpListKeep: 500,
};
const bulkyMachop = ivMon("machop", "Machop", 500, 0, 15, 15);
const attackMachop = ivMon("machop", "Machop", 501, 15, 0, 0);
const dualMachops = gradeBox([bulkyMachop, attackMachop], pvpOnly);
const bulkyGraded = [...dualMachops.keep, ...dualMachops.look, ...dualMachops.dump].find(
  (g) => g.mon.sourceRow === 500,
);
const attackGraded = [...dualMachops.keep, ...dualMachops.look, ...dualMachops.dump].find(
  (g) => g.mon.sourceRow === 501,
);
must(
  bulkyGraded?.glAs?.some((r) => r.evoSpeciesId === "machoke") === true &&
    bulkyGraded?.glAs?.some((r) => r.evoSpeciesId === "machamp") === true,
  "machop is ranked as both Machoke and Machamp",
);
must(
  bulkyGraded?.reasons.some((r) => /better as machoke/i.test(r) || /better as machamp/i.test(r)) === true,
  `machop better-as reason, got ${bulkyGraded?.reasons.join(" | ")}`,
);
must(
  bulkyGraded &&
    attackGraded &&
    bulkyGraded.glAs &&
    attackGraded.glAs &&
    (bulkyGraded.copyRankInGroup < attackGraded.copyRankInGroup
      ? (bulkyGraded.gl?.rank ?? 9999) <= (attackGraded.gl?.rank ?? 9999)
      : (attackGraded.gl?.rank ?? 9999) <= (bulkyGraded.gl?.rank ?? 9999)),
  "family sort puts the better-as copy first",
);

const threeMachamp = [0, 1, 2].map((i) => ivMon("machamp", "Machamp", 520 + i, i, 15, 15));
const champOnly = gradeBox(threeMachamp, pvpOnly);
must(champOnly.keep.length === 2, `machamp-only fills 2 Machamp GL slots, got ${champOnly.keep.length}`);
must(champOnly.dump.length === 1, "extra machamp dumps; cannot fill Machoke slots");
must(
  champOnly.keep.every((g) => g.glAs?.every((r) => r.evoSpeciesId === "machamp")),
  "fully evolved machamp is not ranked as Machoke",
);

const junkShadow: Mon = {
  ...hundoAt("bidoof", "Bidoof", 500, 0),
  speciesId: "bidoof_shadow",
  shadow: true,
  ivPercent: 33.3,
  atk: 0,
  def: 0,
  sta: 0,
};
const keepShadowOn = gradeBox([junkShadow], { ...meta, keepShadow: true });
must(keepShadowOn.keepShadow === true, "echo keepShadow true");
must(keepShadowOn.keep.length === 1, "KEEP shadow keeps a junk shadow");
must(keepShadowOn.keep[0].keepClasses.includes("shadow"), "KEEP shadow uses shadow keep class");
must(keepShadowOn.dump.length === 0, "KEEP shadow does not dump the junk shadow");

const keepShadowOff = gradeBox([junkShadow], { ...meta, keepShadow: false });
must(keepShadowOff.keepShadow === false, "echo keepShadow false");
must(keepShadowOff.keep.length === 0, "LOOK shadow drops the junk shadow keep class");
must(keepShadowOff.look.length === 1 && keepShadowOff.dump.length === 0, "LOOK shadow never dumps");
must(
  keepShadowOff.look[0].keepClasses.includes("shadow") !== true,
  "LOOK shadow does not attach shadow keep class",
);
must(
  keepShadowOff.look[0].reasons.some((r) => /shadow/i.test(r)),
  "LOOK shadow still explains never-dump",
);

const sampleNoShadowKeep = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, keepShadow: false });
must(
  sampleNoShadowKeep.dump.every((g) => !g.mon.shadow),
  "LOOK shadow still never dumps sample shadows",
);
const foxOff = [...sampleNoShadowKeep.keep, ...sampleNoShadowKeep.look, ...sampleNoShadowKeep.dump].find(
  (g) => g.mon.speciesId === "ninetales_alolan_shadow",
);
must(foxOff?.keepClasses.includes("shadow") !== true, "LOOK shadow drops ninetales shadow class");
must(foxOff?.verdict !== "DUMP", "alolan shadow ninetales still never DUMP");

console.log(
  JSON.stringify(
    {
      dialect: parsed.dialect,
      scanned: parsed.mons.length,
      keep: result.keep.length,
      look: result.look.length,
      dump: result.dump.length,
      dumpIds: dumps,
      keepIds: result.keep.map((g) => g.mon.speciesId),
      wooperGl: wooper?.gl,
      wooperGlMeta: wooper?.glMeta,
      wooperLcMeta: wooper?.lcMeta,
      toadGlMeta: favoriteToad?.glMeta,
      extraWooperDump: withExtraWooper.dump.filter((g) => g.mon.speciesId === "wooper").length,
      noFavTightToads: tightToads.map((g) => `${g.verdict}:${g.gl?.rank ?? "?"}`),
      familyKeep: result.familyKeep,
      raidMachamp,
      dupeMachampKeep: dupeHundos.keep.length,
      allMachampKeep: allHundos.keep.length,
    },
    null,
    2,
  ),
);
console.log("smokeGrade passed");
