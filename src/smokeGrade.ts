import { readFileSync } from "node:fs";
import { parseInventoryCsv } from "./parseCsv";
import { loadMeta } from "./meta";
import { gradeBox } from "./grade";
import type { Mon } from "./types";

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
must(result.keepAllGood === false, "default extras as dupes");

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
const toadDump = tightToads.filter((g) => g.verdict === "DUMP");
if (toadKeep.length === 0) {
  must(
    toadDump.length === 0,
    "GL family with no keeper must not DUMP",
  );
} else {
  must(
    toadDump.length === tightToads.length - toadKeep.length,
    "when a seismitoad still KEEPs, the rest DUMP",
  );
}

const tight = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 1 });
must(tight.pvpRankKeep === 1, "echo pvpRankKeep 1");
const wooperTight = [...tight.keep, ...tight.look, ...tight.dump].find((g) => g.mon.speciesId === "wooper");
must(wooperTight?.keepClasses.includes("gl") !== true, "rank-1 floor must drop wooper GL keep");
must(wooperTight?.verdict !== "DUMP", "only wooper still never DUMP");
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
      extraWooperDump: withExtraWooper.dump.filter((g) => g.mon.speciesId === "wooper").length,
      noFavTightToads: tightToads.map((g) => `${g.verdict}:${g.gl?.rank ?? "?"}`),
      raidMachamp,
      dupeMachampKeep: dupeHundos.keep.length,
      allMachampKeep: allHundos.keep.length,
    },
    null,
    2,
  ),
);
console.log("smokeGrade passed");
