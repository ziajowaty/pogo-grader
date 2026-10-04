/**
 * Extended core: Pokémon saved from a scan, merged with the core file for
 * seats, and exported as one Calcy-shaped CSV this app can load again.
 */
import { readFileSync } from "node:fs";
import { gradeBox } from "./grade";
import { loadMeta } from "./meta";
import { parseInventoryCsv } from "./parseCsv";
import { CORE_EXTENDED_KEY } from "./lastCsv";
import {
  coreExtendKey,
  coreFingerprint,
  coreifyScan,
  extendedDuplicates,
  formatCoreCsv,
  mergeCoreMons,
  readStoredExtended,
  removeExtended,
  splitCoreRows,
} from "./coreExtend";
import type { GradedMon, Mon } from "./types";

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
    form: "",
    gender: "unknown",
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

function shell(mon: Mon): GradedMon {
  return {
    mon,
    verdict: "LOOK",
    reasons: [],
    keepClasses: [],
    copiesInGroup: 1,
    copyRankInGroup: 1,
  };
}

function identity(mon: Mon): string {
  return JSON.stringify({
    speciesId: mon.speciesId,
    atk: mon.atk ?? null,
    def: mon.def ?? null,
    sta: mon.sta ?? null,
    cp: mon.cp,
    hp: mon.hp,
    level: mon.level ?? null,
    ivUnique: mon.ivUnique,
    shadow: mon.shadow,
    purified: mon.purified,
    nickname: mon.nickname ?? null,
    gender: mon.gender,
    lucky: mon.lucky ?? null,
    favorite: mon.favorite ?? null,
    shiny: mon.shiny ?? null,
    costume: mon.costume ?? null,
    background: mon.background ?? null,
    legendary: mon.legendary ?? null,
    mythical: mon.mythical ?? null,
    dynamax: mon.dynamax ?? null,
    fastMove: mon.fastMove ?? null,
    chargedMove: mon.chargedMove ?? null,
    chargedMove2: mon.chargedMove2 ?? null,
    hasSpecialMove: mon.hasSpecialMove === true ? true : null,
    dex: mon.dex ?? null,
  });
}

function roundTrip(mon: Mon, label: string): Mon {
  const file = formatCoreCsv([mon]);
  must(file.skipped.length === 0, `${label} skipped: ${file.skipped.join("; ")}`);
  const parsed = parseInventoryCsv(file.text);
  must(parsed.dialect === "calcyiv", `${label} dialect ${parsed.dialect}`);
  must(parsed.issues.length === 0, `${label} issues ${JSON.stringify(parsed.issues)}`);
  must(parsed.mons.length === 1, `${label} reimported ${parsed.mons.length}`);
  const back = parsed.mons[0];
  must(back != null, `${label} missing row`);
  must(identity(back) === identity(mon), `${label}\n${identity(mon)}\n${identity(back)}`);
  must(back.source === "calcyiv", `${label} export is read as Calcy`);
  return back;
}

must(CORE_EXTENDED_KEY === "coreExtended", "extended core uses its own IndexedDB key");
must(CORE_EXTENDED_KEY !== "current" && CORE_EXTENDED_KEY !== "core", "extended key is not the scan or the core file");

const ace = ivMon("machamp", "Machamp", 2, 15, 0, 0, { nickname: "Ace", gender: "male" });
const bulky = ivMon("machamp", "Machamp", 1, 0, 15, 15, { gender: "male" });
const mid = ivMon("machamp", "Machamp", 3, 8, 8, 8);
const twin = ivMon("machamp", "Machamp", 4, 15, 0, 0, { nickname: "Ext", gender: "male" });
const otherCp = ivMon("machamp", "Machamp", 5, 15, 0, 0, { cp: 900, nickname: "Bulk" });
const otherLevel = ivMon("machamp", "Machamp", 6, 15, 0, 0, { level: 40 });
const noLevel = ivMon("machamp", "Machamp", 7, 15, 0, 0, { level: undefined });
const shadow = ivMon("machamp_shadow", "Machamp", 8, 15, 0, 0, { shadow: true });
const fuzzy = ivMon("machamp", "Machamp", 9, 10, 10, 10, { ivUnique: false, nickname: "Maybe" });
const fuzzyShiny = ivMon("machamp", "Machamp", 10, 10, 10, 10, { ivUnique: false, shiny: true, nickname: "Maybe" });
const zeroAtk = ivMon("machamp", "Machamp", 11, 0, 15, 15);

must(coreFingerprint(ace) === "machamp|15|0|0|400|20", "fingerprint is species, IVs, CP, and level");
must(coreExtendKey(ace) === coreFingerprint(ace), "a unique copy uses the seat fingerprint");
must(coreFingerprint(zeroAtk) === "machamp|0|15|15|400|20", "attack 0 stays in the fingerprint");
must(coreFingerprint(noLevel) === "machamp|15|0|0|400|", "a missing level is an empty fingerprint field");
must(coreFingerprint(fuzzy) === null, "non-unique IVs have no seat fingerprint");
must(coreExtendKey(fuzzy).startsWith("loose|"), "a non-unique copy uses a loose key");
must(coreExtendKey(fuzzy) !== coreExtendKey(fuzzyShiny), "loose keys keep a shiny apart from an unknown twin");
must(
  coreExtendKey(fuzzy) !== coreExtendKey({ ...fuzzy, gender: "female" }),
  "loose keys keep cosmetic genders apart",
);
must(
  coreExtendKey(ace) !== coreExtendKey(shadow),
  "a shadow is a different key from the normal species",
);
must(coreExtendKey(ace) !== coreExtendKey(otherCp), "a different CP is a different Pokémon");
must(coreExtendKey(ace) !== coreExtendKey(otherLevel), "a different level is a different Pokémon");
must(coreExtendKey(ace) === coreExtendKey(twin), "nickname is not part of a unique fingerprint");
must(coreExtendKey(noLevel) === coreExtendKey({ ...noLevel, sourceRow: 99 }), "missing level matches missing level");

must(mergeCoreMons([], []).length === 0, "nothing to merge is an empty seat list");
must(mergeCoreMons([ace], []).length === 1 && mergeCoreMons([ace], [])[0] === ace, "a file alone is unchanged");
must(mergeCoreMons([], [bulky]).length === 1 && mergeCoreMons([], [bulky])[0] === bulky, "extended alone is the seat list");

const mergedNick = mergeCoreMons([ace], [twin]);
must(mergedNick.length === 1 && mergedNick[0] === ace, "the core file wins when the fingerprint matches");
must(mergedNick[0]?.nickname === "Ace", "the file nickname is kept");

const fileDupes = mergeCoreMons([ace, twin], []);
must(fileDupes.length === 1 && fileDupes[0] === ace, "a duplicated file row keeps the first");

const extDupes = mergeCoreMons([], [ace, twin]);
must(extDupes.length === 1 && extDupes[0] === ace, "a duplicated extended row keeps the first");

const bothSpecies = mergeCoreMons([ace], [shadow, otherCp]);
must(
  bothSpecies.map((mon) => mon.sourceRow).join(",") === "2,8,5",
  "file rows stay first, then extended rows that are actually new",
);

const fuzzyMerge = mergeCoreMons([fuzzy], [{ ...fuzzy, sourceRow: 40 }]);
must(fuzzyMerge.length === 1 && fuzzyMerge[0] === fuzzy, "matching non-unique rows collapse");
must(mergeCoreMons([fuzzy], [fuzzyShiny]).length === 2, "a shiny non-unique twin is kept");
must(mergeCoreMons([ace], [noLevel]).length === 2, "a copy with no level does not match a leveled copy");

const added = coreifyScan(bulky, [ace], [shadow]);
must(added.ok === true && added.mon !== bulky, "coreify stores a copy");
if (added.ok) {
  added.mon.nickname = "changed";
  must(bulky.nickname == null, "editing the stored copy does not edit the scan row");
  must(added.mon.speciesId === bulky.speciesId && added.mon.cp === bulky.cp, "the copy keeps the scan identity");
}

const padded = ivMon("machamp", "  Machamp  ", 12, 1, 2, 3, { nickname: "  Pad  " });
const paddedAdd = coreifyScan(padded, [], []);
must(paddedAdd.ok === true, "a padded name can be saved");
if (paddedAdd.ok) {
  must(paddedAdd.mon.speciesName === "Machamp" && paddedAdd.mon.nickname === "Pad", "stored names are trimmed");
  must(padded.speciesName === "  Machamp  ", "trimming does not change the scan row");
  const again = coreifyScan({ ...padded, sourceRow: 13 }, [], [paddedAdd.mon]);
  must(again.ok === false && again.reason === "in-extended", "a padded twin matches the trimmed extended row");
}

must(coreifyScan(twin, [ace], []).ok === false && coreifyScan(twin, [ace], []).reason === "in-file", "already in the file");
const inBoth = coreifyScan(twin, [ace], [ace]);
must(inBoth.ok === false && inBoth.reason === "in-file", "the file wins the refusal when it is in both collections");
must(coreifyScan(ace, [], [twin]).ok === false && coreifyScan(ace, [], [twin]).reason === "in-extended", "already extended");

const nameless = coreifyScan({ ...ace, speciesName: "  ", speciesId: "" }, [], []);
must(nameless.ok === false && nameless.reason === "no-species", "a blank species is refused");
const noId = coreifyScan({ ...ace, speciesId: " " }, [ace], []);
must(noId.ok === false && noId.reason === "no-species", "a blank species id is refused before the duplicate check");
must(coreifyScan({ ...ace, cp: 0 }, [], []).reason === "bad-cp", "CP 0 is refused");
must(coreifyScan({ ...ace, cp: Number.NaN }, [], []).reason === "bad-cp", "a non-finite CP is refused");
must(coreifyScan({ ...ace, hp: 0 }, [], []).reason === "bad-hp", "HP 0 is refused");
must(coreifyScan({ ...ace, hp: Number.POSITIVE_INFINITY }, [], []).reason === "bad-hp", "a non-finite HP is refused");
const fuzzyAdd = coreifyScan(fuzzy, [], []);
must(fuzzyAdd.ok === true, "non-unique IVs can still be saved");

const kept = [ace, bulky, shadow];
const removed = removeExtended(kept, coreExtendKey(bulky));
must(removed.map((mon) => mon.sourceRow).join(",") === "2,8", "remove drops the matching key");
must(kept.length === 3, "remove does not mutate the stored list");
must(removeExtended(kept, "missing").length === 3, "an unknown key removes nothing");
const doubled = [fuzzy, { ...fuzzy, sourceRow: 50 }];
must(removeExtended(doubled, coreExtendKey(fuzzy)).length === 0, "remove drops every row with that key");

const fileRow = shell(ace);
const extRow = shell(shadow);
const split = splitCoreRows([fileRow, extRow, shell(twin)], [ace]);
must(split.file.length === 2 && split.file[0] === fileRow && split.file[1]?.mon.nickname === "Ext", "graded rows whose key is in the file stay on the file side");
must(
  split.extended.map((row) => row.mon.sourceRow).join(",") === "8",
  "a graded twin of the file is not listed as extended",
);
must(splitCoreRows([shell({ ...ace, nickname: "Other" })], [ace]).file.length === 1, "file match uses the fingerprint");
must(splitCoreRows([extRow], []).extended.length === 1, "with no file, graded core rows are extended");
must(extendedDuplicates([twin, shadow], [ace]).map((mon) => mon.nickname).join(",") === "Ext", "duplicates are extended rows the file already has");
must(extendedDuplicates([shadow], [ace]).length === 0, "a new species is not a file duplicate");

const emptyFile = formatCoreCsv([]);
must(!emptyFile.text.startsWith("\uFEFF"), "export has no byte-order mark");
must(emptyFile.skipped.length === 0, "an empty list skips nothing");
const emptyParsed = parseInventoryCsv(emptyFile.text);
must(emptyParsed.dialect === "calcyiv" && emptyParsed.mons.length === 0, "an empty export is a Calcy header with no rows");
const header = emptyFile.text.split(/\r?\n/, 1)[0] ?? "";
must(header.includes("Unique?"), "export uses Calcy's unique flag");
must(header.includes("ØATT IV") && header.includes("ØDEF IV") && header.includes("ØHP IV"), "export uses Calcy IV columns");
must(header.includes("ShadowForm") && header.includes("Nickname") && header.includes("Level"), "export keeps nickname, level, and shadow form");
for (const banned of ["Atk IV", "Level Min", "Level Max", "Shadow/Purified"]) {
  must(!header.includes(banned), `export header must not include ${banned}`);
}

const quoted = ivMon("machamp", "Machamp", 1, 15, 15, 15, { nickname: 'Ace, "the" champ\nGL' });
roundTrip(quoted, "quoted nickname");
roundTrip(ivMon("mr_mime", "Mr. Mime", 1, 10, 10, 10, { fastMove: "Zen Headbutt", chargedMove: "Psybeam" }), "apostrophe species");
roundTrip(
  ivMon("nidoran_female", "Nidoran", 1, 15, 15, 15, { gender: "female", level: 15, cp: 300, hp: 70 }),
  "female Nidoran",
);
roundTrip(
  ivMon("nidoran_female_shadow", "Nidoran", 1, 15, 15, 14, { gender: "female", shadow: true }),
  "shadow female Nidoran",
);
roundTrip(ivMon("indeedee_male", "Indeedee", 1, 1, 15, 15, { gender: "male" }), "male Indeedee");
roundTrip(ivMon("oinkologne", "Oinkologne", 1, 0, 15, 15, { gender: "male" }), "male Oinkologne keeps the unsuffixed id");
roundTrip(
  ivMon("oinkologne_female", "Oinkologne", 1, 0, 15, 14, { gender: "female" }),
  "female Oinkologne",
);
roundTrip(ivMon("pyroar", "Pyroar", 1, 15, 10, 10, { gender: "male" }), "cosmetic gender stays on the species");
roundTrip(
  ivMon("ninetales_alolan_shadow", "Ninetales", 1, 0, 15, 15, { form: "Alola", shadow: true, gender: "female", dex: 38 }),
  "Alolan shadow",
);
roundTrip(ivMon("venusaur_mega", "Venusaur", 1, 15, 15, 14, { form: "Mega" }), "mega form");
roundTrip(shadow, "shadow species id is not doubled");
{
  const both = ivMon("machamp", "Machamp", 1, 15, 15, 15, { purified: true, shadow: true });
  const file = formatCoreCsv([both]);
  const back = parseInventoryCsv(file.text).mons[0];
  must(back?.shadow === true && back.purified === false && back.speciesId === "machamp_shadow", "shadow wins when both flags are set");
}
roundTrip(
  ivMon("venusaur", "Venusaur", 1, 14, 15, 15, { purified: true, chargedMove: "Frenzy Plant", hasSpecialMove: true }),
  "purified legacy move",
);
roundTrip(noLevel, "unique IVs with no level");
roundTrip(fuzzy, "non-unique IVs stay non-unique");
roundTrip(zeroAtk, "attack 0 round-trips");
roundTrip(
  ivMon("machamp", "Machamp", 1, 15, 14, 15, {
    level: 22.5,
    shiny: true,
    costume: false,
    background: false,
    legendary: false,
    mythical: false,
    dynamax: false,
    lucky: false,
    favorite: false,
  }),
  "half level and explicit false flags",
);
roundTrip(
  ivMon("ralts", "Ralts", 1, 15, 14, 12, { dynamax: true, lucky: true, favorite: true, shiny: false, costume: true }),
  "dynamax lucky favorite shiny costume",
);
roundTrip(
  ivMon("mew", "Mew", 1, 15, 15, 15, { legendary: true, mythical: true, background: true, chargedMove2: "Psyshock" }),
  "legendary mythical background and a second charge move",
);

const missingIv = ivMon("machamp", "Machamp", 1, 15, 15, 15, { atk: undefined, ivUnique: true });
{
  const file = formatCoreCsv([missingIv]);
  const parsed = parseInventoryCsv(file.text);
  must(parsed.mons.length === 1 && parsed.mons[0]?.ivUnique === false, "unique without all three IVs reimports as not unique");
}

const skipped = formatCoreCsv([
  ace,
  { ...bulky, cp: 0 },
  { ...mid, speciesName: " ", speciesId: "machamp" },
  { ...shadow, hp: -1 },
  otherCp,
]);
must(skipped.skipped.length === 3, "three unwritable rows are reported");
must(skipped.skipped.some((line) => /bad cp/i.test(line) && /machamp/i.test(line)), "bad CP names the species");
must(skipped.skipped.some((line) => /missing species/i.test(line)), "a blank name is reported");
must(skipped.skipped.some((line) => /bad hp/i.test(line)), "bad HP is reported");
const skippedParsed = parseInventoryCsv(skipped.text);
must(
  skippedParsed.mons.map((mon) => mon.cp).join(",") === "400,900",
  "skips leave the writable rows in order",
);

const GENIE = `Index,Name,Form,Pokemon,Gender,CP,HP,Atk IV,Def IV,Sta IV,IV Avg,Level Min,Level Max,Quick Move,Charge Move,Charge Move 2,Lucky,Shadow/Purified,Favorite,Rank # (G),Name (G)
1,Ninetales,Alola,38,♀,1500,127,0,15,15,66.7,20.0,20.0,Powder Snow,Weather Ball,Psyshock,0,1,0,12,Ninetales
2,Seismitoad,Normal,537,♂,1498,162,1,15,14,66.7,22.5,22.5,Mud Shot,Earth Power,Sludge Bomb,0,0,1,80,Seismitoad
3,Machamp,Normal,68,♂,2500,163,15,15,15,100.0,30.0,35.0,Counter,Dynamic Punch,Rock Slide,1,0,0,,
4,Venusaur,Normal,3,♀,1489,140,0,14,15,64.4,21.0,21.0,Vine Whip,Frenzy Plant,Sludge Bomb,0,2,0,,
6,Alolan Ninetales,Normal,38,♀,1200,110,1,14,15,66.7,18.0,18.0,Charm,Psyshock,,0,0,0,,
`;
const CALCY = `Ancestor?,Scan date,Nr,Name,Nickname,Gender,Level,possibleLevels,CP,HP,ØATT IV,ØDEF IV,ØHP IV,ØIV%,Unique?,Fast move,Special move,Star,Form,Lucky,Shadow,GL Rank
0,1/1/2020 00:00:00,194,Wooper,box1,♂,20,20,500,85,0,15,15,66.7,1,Water Gun,Frustration,0,0,1,1,40
0,1/2/2020 00:00:00,38,Ninetales,box2,♀,20,20,1500,127,12,12,12,80.0,0,Charm,Psyshock,1,61,0,0,90
0,1/3/2020 00:00:00,68,Machamp,box3,♂,30,30,2500,163,15.0,15.0,15.0,100.0,1,Counter,Dynamic Punch,0,0,1,0,200
`;
const HISTORY = `Ancestor?,Nr,Name,Nickname,CP,HP,ØATT IV,ØDEF IV,ØHP IV,Unique?,Lucky?,Favorite,Form,ShadowForm,Dynamax
0,95,Onix Shadow,Oni♀62,223,45,8,11,9,1,0,0,1065,2,?
0,27,Sandshrew Alolan Shadow,San♂76,278,53,13,15,6,1,0,0,403,2,?
0,532,Timburr,NotShadow,200,50,10,10,10,1,0,0,2252,7,?
0,280,Ralts,GL 19,301,72,15,14,12,1,0,0,687,1,D
0,529,Drilbur,GL 69,428,78,13,12,15,1,1,0,2249,7,?
0,68,Machop,Mac♂93,724,90,15,15,12,1,0,1,66,7,?
`;

for (const [label, text] of [
  ["genie", GENIE],
  ["calcy", CALCY],
  ["history", HISTORY],
] as const) {
  const parsed = parseInventoryCsv(text);
  must(parsed.mons.length > 0, `${label} fixture parsed`);
  parsed.mons.forEach((mon, index) => roundTrip(mon, `${label} row ${index + 1} ${mon.speciesId}`));
}

const mixed = formatCoreCsv(mergeCoreMons(parseInventoryCsv(GENIE).mons, parseInventoryCsv(HISTORY).mons));
const mixedParsed = parseInventoryCsv(mixed.text);
must(mixedParsed.dialect === "calcyiv", "a Poke Genie file plus a Calcy file exports as one Calcy CSV");
must(mixed.skipped.length === 0, "fixture rows are writable");
must(mixedParsed.mons.length === parseInventoryCsv(GENIE).mons.length + parseInventoryCsv(HISTORY).mons.length, "both dialects survive in one file");
must(
  mixedParsed.mons.some((mon) => mon.speciesId === "ninetales_alolan_shadow") &&
    mixedParsed.mons.some((mon) => mon.speciesId === "sandshrew_alolan_shadow"),
  "the merged file keeps both species ids",
);

const samplePath = new URL("../fixtures/sample-pokegenie.csv", import.meta.url);
const sample = parseInventoryCsv(readFileSync(samplePath, "utf8"));
must(sample.mons.length > 0, "sample pokegenie fixture parsed");
sample.mons.forEach((mon, index) => roundTrip(mon, `sample row ${index + 1} ${mon.speciesId}`));

const validMon = ivMon("ralts", "Ralts", 1, 15, 14, 12, { dynamax: true });
const storedOk = readStoredExtended({ mons: [validMon, { nope: true }, validMon] });
must(storedOk.ok === true && storedOk.mons.length === 2 && storedOk.dirty === true, "a bad entry is dropped and the blob is marked dirty");
must(readStoredExtended([validMon]).ok === true && readStoredExtended([validMon]).dirty === false, "a bare array of mons is accepted");
must(readStoredExtended({ mons: [] }).ok === true && readStoredExtended({ mons: [] }).mons.length === 0, "an empty extended list is valid");
must(readStoredExtended(null).ok === false, "null is not an extended list");
must(readStoredExtended({ mons: "nope" }).ok === false, "a non-array payload is rejected");
must(readStoredExtended(4).ok === false, "a number is rejected");
must(readStoredExtended({ mons: [{ ...validMon, shadow: "yes" }] }).mons.length === 0, "a mistyped flag drops that row");
must(readStoredExtended({ mons: [{ ...validMon, atk: 15.5 }] }).mons.length === 0, "a fractional IV drops that row");
must(readStoredExtended({ mons: [{ ...validMon, atk: 16 }] }).mons.length === 0, "an IV above 15 drops that row");
must(readStoredExtended({ mons: [{ ...validMon, atk: 0 }] }).mons.length === 1, "attack 0 is stored");
must(readStoredExtended({ mons: [{ ...validMon, source: "scanner" }] }).mons.length === 0, "an unknown source drops that row");
must(readStoredExtended({ mons: [{ ...validMon, hp: 0 }] }).mons.length === 0, "HP 0 is not stored");
must(readStoredExtended({ extra: 1, mons: [validMon] }).ok === true, "unknown wrapper fields are ignored");

const meta = await loadMeta();
const pvpOnly = {
  ...meta,
  keepAllGood: false,
  raidAttackers: new Set<string>(),
  raidEvolution: {},
  pvpRankKeep: 4096,
  pvpListKeep: 500,
  keepShadow: true,
  keepLucky: true,
  keepFavorite: true,
};

function hasReason(rows: GradedMon[], prefix: string): GradedMon | undefined {
  return rows.find((row) => row.reasons.some((reason) => reason.toLowerCase().startsWith(prefix)));
}

const extendedSeat = mergeCoreMons([], [ace]);
const better = gradeBox([bulky, mid], pvpOnly, extendedSeat);
const upgrade = hasReason(better.look, "core upgrade");
must(upgrade != null, "a strictly better scan than an extended copy is LOOK");
must(/ace cp 400/i.test(upgrade?.reasons.find((reason) => reason.toLowerCase().startsWith("core upgrade")) ?? ""), "the upgrade chip names the extended nickname");
must(hasReason(better.dump, "core holds") != null, "a worse scan DUMPs because extended holds the seat");
must(better.core.length === 1 && better.core[0]?.reasons.some((reason) => reason.toLowerCase().startsWith("holds")), "the extended row records the seat");
must(![...better.keep, ...better.look, ...better.dump].some((row) => row.mon.nickname === "Ace"), "the extended Pokémon stays off the scan tracks");

const echo = gradeBox([ivMon("machamp", "Machamp", 12, 15, 0, 0)], pvpOnly, extendedSeat);
must(hasReason(echo.look, "same pokémon") != null, "a later scan of an extended Pokémon is the same-Pokémon LOOK");
must(hasReason(echo.look, "core upgrade") == null, "that scan does not upgrade itself");

const open = gradeBox([bulky], { ...pvpOnly, pvpKeep: 2 }, extendedSeat);
must(open.keep.some((row) => row.mon.sourceRow === 1), "an open seat still KEEPs when extended holds only one");

const unmerged = gradeBox([bulky], { ...pvpOnly, pvpKeep: 2 }, [ace, twin]);
must(unmerged.core.length === 2, "without a merge both copies are seated");
must(unmerged.keep.length === 0, "two copies of one Pokémon fill a cap of two");
const mergedOpen = gradeBox([bulky], { ...pvpOnly, pvpKeep: 2 }, mergeCoreMons([ace], [twin]));
must(mergedOpen.core.length === 1, "merge leaves one copy on the seat list");
must(mergedOpen.keep.some((row) => row.mon.sourceRow === 1), "the freed seat still KEEPs");

const shiny = gradeBox([ivMon("machamp", "Machamp", 5, 15, 0, 0, { shiny: true })], pvpOnly, [bulky]);
must(shiny.keep.some((row) => row.mon.sourceRow === 5), "a shiny scan still KEEPs when extended holds the job");
must(hasReason(shiny.look, "core upgrade") == null, "shiny does not take the upgrade LOOK");

const shadowScan = gradeBox([shadow], pvpOnly, [bulky]);
must(shadowScan.keep.some((row) => row.mon.speciesId === "machamp_shadow"), "an extended normal Machamp does not hold the shadow seat");

const fuzzyGrade = gradeBox([ace], pvpOnly, mergeCoreMons([], [fuzzy]));
must(fuzzyGrade.keep.some((row) => row.mon.sourceRow === 2), "a non-unique extended row holds no seat");
must(fuzzyGrade.core[0]?.reasons.some((reason) => reason.toLowerCase().startsWith("ivs not unique")) === true, "the extended row says it holds no seat");

const twoExtended = mergeCoreMons([], [ace, bulky]);
const twoGrade = gradeBox([mid], pvpOnly, twoExtended);
const holds = twoGrade.core.filter((row) => row.reasons.some((reason) => reason.toLowerCase().startsWith("holds")));
must(holds.length === 1 && holds[0]?.mon.sourceRow === 1, "only the better extended copy holds the one seat");
must(hasReason(twoGrade.dump, "core holds") != null, "the other scan DUMPs");

const hundo = ivMon("machamp", "Machamp", 8, 15, 15, 15, { cp: 2800, ivPercent: 100 });
const hundoScan = ivMon("machamp", "Machamp", 9, 15, 15, 15, { cp: 2500, ivPercent: 100 });
const hundoGrade = gradeBox([hundoScan], pvpOnly, mergeCoreMons([], [hundo]));
must(hundoGrade.dump.some((row) => row.mon.sourceRow === 9), "a tied 4* DUMPs when extended holds that seat");
must(hasReason(hundoGrade.look, "core upgrade") == null, "a tied 4* is not an upgrade");

const lowRaid = ivMon("bulbasaur", "Bulbasaur", 10, 15, 15, 13);
const highRaid = ivMon("bulbasaur", "Bulbasaur", 11, 14, 15, 15);
const bulbMeta = { ...meta, keepAllGood: false, pvpListKeep: 1, pvpRankKeep: 1, raidIvKeep: 90 };
must(
  gradeBox([highRaid], bulbMeta, mergeCoreMons([], [lowRaid])).look.some((row) =>
    row.reasons.some((reason) => reason.toLowerCase().startsWith("core upgrade")),
  ),
  "a better raid IV is LOOK when the extended seat is full",
);
must(
  gradeBox([lowRaid], bulbMeta, mergeCoreMons([highRaid], [])).dump.some((row) =>
    row.reasons.some((reason) => reason.toLowerCase().startsWith("core holds")),
  ),
  "a worse raid copy DUMPs against the core file",
);

const exported = formatCoreCsv(mergeCoreMons([ace], [shadow]));
const reloaded = parseInventoryCsv(exported.text);
const reloadedGrade = gradeBox([bulky], pvpOnly, reloaded.mons);
must(reloaded.dialect === "calcyiv" && reloaded.mons.length === 2, "the portable file has the file row and the new shadow");
must(hasReason(reloadedGrade.look, "core upgrade") != null, "loading the export as core still upgrades a better scan");
must(
  reloadedGrade.core.some((row) => row.mon.speciesId === "machamp_shadow"),
  "the shadow saved from the scan is in the reloaded core",
);

console.log("coreExtend passed");
