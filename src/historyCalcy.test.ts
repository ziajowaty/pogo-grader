import { readFileSync } from "node:fs";
import { parseInventoryCsv } from "./parseCsv";
import { loadMeta } from "./meta";
import { gradeBox, compareScanStream } from "./grade";
import { dumpExecuteString, dumpPreviewString } from "./search";
import type { GradedMon, Mon, Verdict } from "./types";

/**
 * Comprehensive specs against a real Calcy IV history export
 * (fixtures/history-calcy.csv — 2026-09-18 box scan).
 */

function must(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function rowKey(m: Pick<Mon, "sourceRow" | "nickname" | "speciesName" | "cp">): string {
  return `${m.sourceRow}|${m.nickname ?? "-"}|${m.speciesName}|${m.cp}`;
}

function fixtureDataRows(raw: string): { line: number; ancestor: boolean; name: string; nick: string; cp: string }[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0]?.split(",") ?? [];
  const iAnc = header.indexOf("Ancestor?");
  const iName = header.indexOf("Name");
  const iNick = header.indexOf("Nickname");
  const iCp = header.indexOf("CP");
  must(iAnc >= 0 && iName >= 0 && iNick >= 0 && iCp >= 0, "history fixture header has Ancestor?/Name/Nickname/CP");
  return lines.slice(1).map((line, i) => {
    const cols = line.split(",");
    return {
      line: i + 2,
      ancestor: cols[iAnc] === "1",
      name: cols[iName] ?? "",
      nick: cols[iNick] ?? "",
      cp: cols[iCp] ?? "",
    };
  });
}

function inScanOrder(mons: Mon[]): Mon[] {
  return [...mons].sort(compareScanStream);
}

function assertTrackIsScanSubsequence(
  rows: GradedMon[],
  verdict: Verdict,
  streamMons: Mon[],
  byRow: Map<number, GradedMon>,
): void {
  const expected = streamMons.filter((m) => byRow.get(m.sourceRow)?.verdict === verdict);
  must(rows.length === expected.length, `${verdict} length ${rows.length} vs scan subsequence ${expected.length}`);
  for (let i = 0; i < expected.length; i++) {
    must(
      rowKey(rows[i].mon) === rowKey(expected[i]),
      `${verdict}[${i}] must be scan ${rowKey(expected[i])}, got ${rowKey(rows[i].mon)}`,
    );
  }
}

const EXPECTED_SHADOW_IDS = [
  "bagon_shadow",
  "drowzee_shadow",
  "litwick_shadow",
  "noibat_shadow",
  "onix_shadow",
  "pinsir_shadow",
  "porygon_shadow",
  "qwilfish_shadow",
  "sandshrew_alolan_shadow",
  "spheal_shadow",
  "taillow_shadow",
  "tentacool_shadow",
  "timburr_shadow",
  "tyrunt_shadow",
  "venonat_shadow",
  "voltorb_shadow",
  "yamask_shadow",
] as const;

const csv = readFileSync(new URL("../fixtures/history-calcy.csv", import.meta.url), "utf8");
const header = csv.split(/\r?\n/, 1)[0] ?? "";

must(header.includes("ShadowForm"), "fixture is a Calcy history export with ShadowForm");
must(header.includes("Lucky?"), "fixture has Lucky?");
must(header.includes("Dynamax"), "fixture has Dynamax");
must(header.includes("Ancestor?"), "fixture has Ancestor?");

const parsed = parseInventoryCsv(csv);
must(parsed.dialect === "calcyiv", `expected calcyiv, got ${parsed.dialect}`);
must(parsed.issues.length === 0, `parse issues: ${parsed.issues.map((i) => i.message).join("; ")}`);
must(parsed.mons.length === 134, `expected 134 scanned mons (ancestor skipped), got ${parsed.mons.length}`);

const fileRows = fixtureDataRows(csv);
const scannedFile = fileRows.filter((row) => !row.ancestor);
must(fileRows.some((row) => row.ancestor), "fixture still has the ancestor Gible skip");
must(scannedFile.length === parsed.mons.length, "parser count matches non-ancestor CSV rows");
for (let i = 0; i < scannedFile.length; i++) {
  const file = scannedFile[i];
  const mon = parsed.mons[i];
  must(mon.sourceRow === file.line, `parsed[${i}] sourceRow ${mon.sourceRow} vs CSV line ${file.line}`);
  must(mon.speciesName === file.name, `parsed[${i}] name ${mon.speciesName} vs CSV ${file.name}`);
  must(mon.nickname === file.nick, `parsed[${i}] nickname ${mon.nickname} vs CSV ${file.nick}`);
  must(String(mon.cp) === file.cp, `parsed[${i}] CP ${mon.cp} vs CSV ${file.cp}`);
}
must(
  parsed.mons.every((m, i) => i === 0 || m.sourceRow > parsed.mons[i - 1].sourceRow),
  "parser keeps CSV line order",
);

must(
  parsed.mons.every((m) => m.ivUnique),
  "every history row in this export is Unique?=1",
);
must(
  parsed.mons.every((m) => m.source === "calcyiv"),
  "all rows tagged calcyiv",
);

const shadows = parsed.mons.filter((m) => m.shadow);
const namedShadow = parsed.mons.filter((m) => /\bshadow\b/i.test(m.speciesName));
must(shadows.length === 20, `expected 20 shadows, got ${shadows.length}`);
must(namedShadow.length === 20, "Name suffix 'Shadow' matches ShadowForm=2 count");
must(
  namedShadow.every((m) => m.shadow),
  "Calcy 'Onix Shadow' / 'Sandshrew Alolan Shadow' names must set shadow=true",
);
must(
  shadows.every((m) => /_shadow$/.test(m.speciesId) && !m.speciesId.includes("shadow_shadow")),
  "shadow speciesId is PvPoke-style foo_shadow, never foo_shadow_shadow",
);
must(
  shadows.every((m) => !/\s/.test(m.speciesId)),
  "speciesId uses underscores, not spaces (PvPoke GL lists are onix_shadow)",
);

const shadowIds = [...new Set(shadows.map((m) => m.speciesId))].sort();
must(
  shadowIds.join(",") === EXPECTED_SHADOW_IDS.join(","),
  `shadow ids drifted: ${shadowIds.join(",")}`,
);

const alolaSand = parsed.mons.find((m) => /sandshrew/i.test(m.speciesName));
must(alolaSand?.speciesId === "sandshrew_alolan_shadow", "regional + shadow peels to sandshrew_alolan_shadow");
must(alolaSand?.shadow === true, "alolan shadow flag");
must(/^\d+$/.test(alolaSand?.form ?? ""), "numeric Calcy Form stays on form, not speciesId");

const shadowFormSeven = parsed.mons.filter((m) => !m.shadow && !/_shadow$/.test(m.speciesId));
must(shadowFormSeven.length === 114, "ShadowForm 1/7 rows are not this-copy shadows");

const luckies = parsed.mons.filter((m) => m.lucky);
must(luckies.length === 4, `expected 4 Lucky?=1, got ${luckies.length}`);
must(
  luckies.map((m) => m.speciesId).sort().join(",") === "aerodactyl,drilbur,machop,sableye",
  "lucky species",
);

const favorites = parsed.mons.filter((m) => m.favorite);
must(favorites.length === 1 && favorites[0].speciesId === "machop", "one favorite Machop");
must(favorites[0].nickname === "Mac♂93", "favorite nickname");

const dmax = parsed.mons.filter((m) => m.dynamax);
must(dmax.length === 1 && dmax[0].speciesId === "ralts", "one Dynamax=D Ralts");
must(dmax[0].nickname === "GL 19", "dynamax nickname");

const gibleMons = parsed.mons.filter((m) => m.speciesId === "gible");
must(gibleMons.length === 17, `expected 17 Gible, got ${gibleMons.length}`);

const meta = await loadMeta();
must(meta.pvpokeSource === "bundled", "Node loadMeta must stay on vendored PvPoke lists");
must(meta.raidSource === "bundled", "Node loadMeta must stay on vendored raid lists");
must(meta.glTop500.has("sandshrew_alolan_shadow"), "PvPoke GL list uses sandshrew_alolan_shadow");
must(meta.glTop500.has("qwilfish_shadow"), "PvPoke GL list uses qwilfish_shadow");
must(meta.lcTop100.has("onix_shadow"), "PvPoke LC list uses onix_shadow");

const result = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500 });
const all = [...result.keep, ...result.look, ...result.dump];
must(all.length === 134, "KEEP/LOOK/DUMP partition the box");
must(result.keep.length + result.look.length + result.dump.length === 134, "no dropped rows");
must(result.dump.length <= result.dumpCap, "dump cap respected");
must(result.dumpCapped === false, "134-row box should not hit dump-cap 100");
must(
  result.keep.length === 44 && result.look.length === 39 && result.dump.length === 51,
  `verdict snapshot keep/look/dump 44/39/51, got ${result.keep.length}/${result.look.length}/${result.dump.length}`,
);

must(
  parsed.mons[0]?.nickname === "UL 25" && parsed.mons[parsed.mons.length - 1]?.nickname === "Mac♂93",
  "History file is last-scan-first (UL 25 at top of CSV, Mac♂93 at bottom)",
);

const stream = inScanOrder(parsed.mons);
must(stream[0]?.nickname === "Tin♀64", `first scanned should lead tables, got ${stream[0]?.nickname}`);
must(stream[stream.length - 1]?.nickname === "UL 25", "last scanned (CSV top) is last in scan order");
must(
  stream.every((m, i) => i === 0 || compareScanStream(stream[i - 1], m) <= 0),
  "scan stream is chronological",
);

const byRow = new Map(all.map((g) => [g.mon.sourceRow, g]));
assertTrackIsScanSubsequence(result.keep, "KEEP", stream, byRow);
assertTrackIsScanSubsequence(result.look, "LOOK", stream, byRow);
assertTrackIsScanSubsequence(result.dump, "DUMP", stream, byRow);

const KEEP_HEAD = [
  "120|GL 129|Eevee|665",
  "124|GL 36|Tentacool Shadow|229",
  "131|GL 14|Charmander|355",
  "133|GL 165|Pikachu|434",
  "136|Mac♂93|Machop|724",
  "110|UL 27|Rhyhorn|923",
  "109|Lit♂58|Litwick Shadow|334",
  "106|Por49|Porygon Shadow|346",
];
const LOOK_HEAD = [
  "112|Tin♀64|Tinkatink|503",
  "113|Tin♀42|Tinkatink|390",
  "114|Squ♂27|Squirtle|486",
  "115|Bel♂71|Bellsprout|491",
  "118|Skw♀60|Skwovet|87",
  "121|GL 134|Hatenna|325",
  "125|Fid♀24|Fidough|11",
  "126|GL 189|Maschiff|781",
];
const DUMP_HEAD = [
  "116|GL 126|Charmander|511",
  "117|LL 85|Hatenna|232",
  "119|Stu♀51|Stunky|46",
  "122|Rhy♀60|Rhyhorn|577",
  "123|Pik♂40|Pikachu|347",
  "132|TRRhy♂58|Rhyhorn|1298",
  "134|TRRhy♂71|Rhyhorn|1404",
  "135|Pik♂62|Pikachu|594",
];
must(
  result.keep.slice(0, KEEP_HEAD.length).map((g) => rowKey(g.mon)).join(" || ") === KEEP_HEAD.join(" || "),
  `KEEP head must follow first-scanned-first, got ${result.keep.slice(0, 8).map((g) => rowKey(g.mon)).join(" || ")}`,
);
must(
  result.look.slice(0, LOOK_HEAD.length).map((g) => rowKey(g.mon)).join(" || ") === LOOK_HEAD.join(" || "),
  `LOOK head must follow first-scanned-first, got ${result.look.slice(0, 8).map((g) => rowKey(g.mon)).join(" || ")}`,
);
must(
  result.dump.slice(0, DUMP_HEAD.length).map((g) => rowKey(g.mon)).join(" || ") === DUMP_HEAD.join(" || "),
  `DUMP head must follow first-scanned-first, got ${result.dump.slice(0, 8).map((g) => rowKey(g.mon)).join(" || ")}`,
);
must(
  result.look[0]?.mon.nickname === "Tin♀64",
  "LOOK starts with the first Pokémon scanned",
);
must(
  result.dump[result.dump.length - 1]?.mon.nickname === "Fro♂76",
  `DUMP ends with the last-scanned dump, got ${result.dump[result.dump.length - 1]?.mon.nickname}`,
);

const dumpGibles = result.dump.filter((g) => g.mon.speciesId === "gible");
must(dumpGibles.length > 3, "history DUMP has several Gible extras");
must(
  dumpGibles.every((g, i) => i === 0 || compareScanStream(dumpGibles[i - 1].mon, g.mon) <= 0),
  "DUMP Gibles follow scan order, not History file order",
);
must(
  dumpGibles[0].mon.sourceRow > dumpGibles[dumpGibles.length - 1].mon.sourceRow,
  "DUMP Gibles are inverted vs CSV line order (History newest-first)",
);
const gibleFamilyOrder = [...dumpGibles].sort((a, b) => a.copyRankInGroup - b.copyRankInGroup);
must(
  dumpGibles.map((g) => g.copyRankInGroup).join(",") !== gibleFamilyOrder.map((g) => g.copyRankInGroup).join(","),
  "DUMP Gibles must not be re-sorted by family copy rank (that order is only the  n/N  badge)",
);

const reversed = gradeBox([...parsed.mons].reverse(), { ...meta, pvpRankKeep: 500 });
must(
  reversed.keep.map((g) => rowKey(g.mon)).join(" || ") === result.keep.map((g) => rowKey(g.mon)).join(" || "),
  "KEEP stays in scan order even if gradeBox input is reversed",
);
must(
  reversed.look.map((g) => rowKey(g.mon)).join(" || ") === result.look.map((g) => rowKey(g.mon)).join(" || "),
  "LOOK stays in scan order even if gradeBox input is reversed",
);
must(
  reversed.dump.map((g) => rowKey(g.mon)).join(" || ") === result.dump.map((g) => rowKey(g.mon)).join(" || "),
  "DUMP stays in scan order even if gradeBox input is reversed",
);

must(
  result.dump.every((g) => !g.mon.shadow),
  "KR-SHADOW: shadows never DUMP",
);
must(
  shadows.every((m) => {
    const g = all.find((row) => row.mon.sourceRow === m.sourceRow);
    return g?.verdict === "KEEP" && g.keepClasses.includes("shadow");
  }),
  "every history shadow KEEPs with keep class shadow",
);

const lookShadow = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, keepShadow: false });
must(lookShadow.keepShadow === false, "echo keepShadow false");
must(
  lookShadow.dump.every((g) => !g.mon.shadow),
  "LOOK shadow still never dumps history shadows",
);
must(
  shadows.every((m) => {
    const g = [...lookShadow.keep, ...lookShadow.look, ...lookShadow.dump].find(
      (row) => row.mon.sourceRow === m.sourceRow,
    );
    return g != null && g.verdict !== "DUMP" && !g.keepClasses.includes("shadow");
  }),
  "LOOK shadow drops the shadow keep class and still never dumps",
);

for (const lucky of luckies) {
  const g = all.find((row) => row.mon.sourceRow === lucky.sourceRow);
  must(g?.verdict === "KEEP" && g.keepClasses.includes("lucky"), `${lucky.speciesId} lucky KEEP`);
}

const noLucky = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, keepLucky: false });
must(noLucky.keepLucky === false, "echo keepLucky false");
const favMachop = [...noLucky.keep, ...noLucky.look, ...noLucky.dump].find((g) => g.mon.favorite);
must(
  favMachop?.verdict === "KEEP" && favMachop.keepClasses.includes("favorite"),
  "favorite Machop still KEEP with Lucky off",
);
must(!favMachop?.keepClasses.includes("lucky"), "Lucky off drops lucky class even on favorite Machop");

const noFavChip = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, keepFavorite: false });
must(noFavChip.keepFavorite === false, "echo keepFavorite false");
must(
  noFavChip.dump.every((g) => !g.mon.favorite),
  "LOOK favorite still never dumps history favorites",
);
const machopFavOff = [...noFavChip.keep, ...noFavChip.look, ...noFavChip.dump].find((g) => g.mon.favorite);
must(
  machopFavOff != null && !machopFavOff.keepClasses.includes("favorite"),
  "Favorite off drops favorite class on Machop",
);
must(machopFavOff?.verdict === "KEEP", "lucky Machop still KEEP with Favorite off");
for (const lucky of luckies) {
  const g = [...noLucky.keep, ...noLucky.look, ...noLucky.dump].find(
    (row) => row.mon.sourceRow === lucky.sourceRow,
  );
  must(g != null && !g.keepClasses.includes("lucky"), `${lucky.speciesId} has no lucky class when Lucky is off`);
}

const fav = all.find((g) => g.mon.favorite);
must(fav?.verdict === "KEEP" && fav.keepClasses.includes("favorite"), "favorite Machop KEEP");

const maxRalts = all.find((g) => g.mon.dynamax);
must(maxRalts?.verdict === "KEEP" && maxRalts.keepClasses.includes("max"), "dynamax Ralts KEEP");

const gibles = all.filter((g) => g.mon.speciesId === "gible");
must(gibles.length === 17, "graded 17 Gible");
const gibleKeep = gibles.filter((g) => g.verdict === "KEEP");
const gibleLook = gibles.filter((g) => g.verdict === "LOOK");
const gibleDump = gibles.filter((g) => g.verdict === "DUMP");
if (gibleKeep.length === 0) {
  must(gibleLook.length === result.familyKeep, "no-keeper Gible family LOOKs familyKeep best");
  must(gibleDump.length === 17 - result.familyKeep, "Gible extras beyond familyKeep DUMP");
  must(
    gibleLook.every((g) => g.copyRankInGroup <= result.familyKeep),
    "LOOK Gible are the best copies",
  );
} else {
  must(
    gibleDump.length === 17 - gibleKeep.length,
    "if a Gible KEEPs, remaining copies DUMP",
  );
}

const froakies = all.filter((g) => g.mon.speciesId === "froakie");
must(froakies.length > 0, "fixture has Froakie");
must(
  froakies.every((g) => g.raidIv?.evoSpeciesId === "greninja" || g.raidIv?.evoSpeciesId === "greninja_mega"),
  "Froakie is scored as Greninja for raid IV%",
);
must(
  froakies.every((g) => !g.keepClasses.includes("raid") || (g.raidIv != null && g.raidIv.percent >= 90)),
  "Froakie raid KEEP only at 90%+ IV",
);

const zero = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, familyKeep: 0 });
must(zero.familyKeep === 0, "echo familyKeep 0");
must(zero.keep.length === result.keep.length, "familyKeep 0 does not drop KEEP");
must(zero.dump.length >= result.dump.length, "familyKeep 0 dumps at least as much");
must(
  zero.dump.every((g) => !g.mon.shadow),
  "familyKeep 0 still never dumps shadows",
);
const zeroGibles = [...zero.keep, ...zero.look, ...zero.dump].filter((g) => g.mon.speciesId === "gible");
const zeroGibleKeep = zeroGibles.filter((g) => g.verdict === "KEEP");
if (zeroGibleKeep.length === 0) {
  must(
    zeroGibles.every((g) => g.verdict === "DUMP" || g.reasons.includes("dump-cap")),
    "familyKeep 0 dumps a no-keeper Gible family (dump-cap overflow stays LOOK)",
  );
}
must(
  result.dump.every((g) => g.mon.ivUnique),
  "this export has unique IVs on every dump",
);

const dumpPreview = dumpPreviewString(result.dump.map((g) => g.mon));
must(!/shadow/i.test(dumpPreview), "DUMP search must not list Shadow copies");

const cloakSeed = [parsed.mons[0]];
const dumpCloakOn = dumpExecuteString(cloakSeed);
must(dumpCloakOn.includes("!lucky"), "Transfer cloaks luckies while Lucky KEEPs");
const dumpCloakOff = dumpExecuteString(cloakSeed, { keepLucky: false });
must(!dumpCloakOff.includes("!lucky"), "Transfer drops !lucky when Lucky chip is faded");
must(dumpCloakOff.includes("!shiny") && dumpCloakOff.includes("!shadow"), "Transfer still cloaks shiny and shadow");

const alolaGraded = all.find((g) => g.mon.speciesId === "sandshrew_alolan_shadow");
must(alolaGraded?.glMeta != null, "alolan shadow sandshrew matches PvPoke GL id with underscore");

console.log(
  JSON.stringify(
    {
      dialect: parsed.dialect,
      scanned: parsed.mons.length,
      shadows: shadows.length,
      keep: result.keep.length,
      look: result.look.length,
      dump: result.dump.length,
      shadowIds,
    },
    null,
    2,
  ),
);
console.log("historyCalcy specs passed");
