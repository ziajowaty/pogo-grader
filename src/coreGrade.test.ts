import { gradeBox } from "./grade";
import { loadMeta } from "./meta";
import type { GradeResult, GradedMon, Mon } from "./types";

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

function inTracks(result: GradeResult, row: number): GradedMon | undefined {
  return [...result.keep, ...result.look, ...result.dump].find((g) => g.mon.sourceRow === row);
}

function hasReason(g: GradedMon | undefined, prefix: string): boolean {
  return g?.reasons.some((r) => r.toLowerCase().startsWith(prefix)) === true;
}

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

const bulky = ivMon("machamp", "Machamp", 1, 0, 15, 15);
const attack = ivMon("machamp", "Machamp", 2, 15, 0, 0, { nickname: "Ace" });
const mid = ivMon("machamp", "Machamp", 3, 8, 8, 8);
const attackTwin = ivMon("machamp", "Machamp", 4, 15, 0, 0, { cp: 500 });

const alone = gradeBox([bulky], pvpOnly);
must(alone.core.length === 0, "no core file leaves the core list empty");
must(alone.keep.some((g) => g.mon.sourceRow === 1), "machamp with no core still KEEPs");

const better = gradeBox([bulky, mid], pvpOnly, [attack]);
const upgrade = better.look.find((g) => hasReason(g, "core upgrade"));
must(upgrade != null, "strictly better scan copy is LOOK");
must(hasReason(upgrade, "core upgrade"), "LOOK chip names the core upgrade");
must(/ace cp 400/i.test(upgrade?.reasons.find((r) => r.toLowerCase().startsWith("core upgrade")) ?? ""), "upgrade chip names the core nickname and CP");
must(better.look.filter((g) => hasReason(g, "core upgrade")).length === 1, "one LOOK per occupied seat");
const other = inTracks(better, upgrade!.mon.sourceRow === 1 ? 3 : 1);
must(other?.verdict === "DUMP" && hasReason(other, "core holds"), "the other scan copy DUMPs because core holds the seat");
must(
  (upgrade!.gl?.rank ?? 9999) < (other?.gl?.rank ?? 9999),
  "the LOOK copy is the better GL rank",
);
must(better.core.length === 1 && better.core[0]?.mon.nickname === "Ace", "core tab is the core file");
must(hasReason(better.core[0], "holds"), "core row records the seat it holds");
must(hasReason(better.core[0], "scan upgrade"), "core row points at the better scan");
must(
  ![...better.keep, ...better.look, ...better.dump].some((g) => g.mon.nickname === "Ace"),
  "core Pokémon stays off the scan tracks",
);

const equal = gradeBox([attackTwin], pvpOnly, [attack]);
const equalRow = inTracks(equal, 4);
must(equalRow?.verdict === "DUMP" && hasReason(equalRow, "core holds"), "an equal scan copy DUMPs");
must(!equal.look.some((g) => hasReason(g, "core upgrade")), "a tie does not LOOK");

const open = gradeBox([bulky], { ...pvpOnly, pvpKeep: 2 }, [attack]);
must(open.keep.some((g) => g.mon.sourceRow === 1), "an open seat still KEEPs");
must(!open.look.some((g) => hasReason(g, "core upgrade")), "filling an open seat is not a core upgrade");

const shiny = gradeBox([ivMon("machamp", "Machamp", 5, 15, 0, 0, { shiny: true })], pvpOnly, [bulky]);
must(shiny.keep.some((g) => g.mon.sourceRow === 5), "a shiny scan copy still KEEPs");
must(!shiny.look.some((g) => hasReason(g, "core upgrade")), "shiny does not take the upgrade LOOK");

const shadow = gradeBox(
  [ivMon("machamp_shadow", "Machamp", 6, 15, 0, 0, { shadow: true })],
  pvpOnly,
  [bulky],
);
const shadowRow = inTracks(shadow, 6);
must(shadowRow?.verdict === "KEEP", "shadow is its own species and still KEEPs");
must(!hasReason(shadowRow, "core holds"), "a normal core Machamp does not hold the shadow seat");

const fuzzyCore = ivMon("machamp", "Machamp", 7, 0, 15, 15, { ivUnique: false });
const fuzzy = gradeBox([attack], pvpOnly, [fuzzyCore]);
must(fuzzy.keep.some((g) => g.mon.sourceRow === 2), "a core row with non-unique IVs holds no seat");
must(hasReason(fuzzy.core[0], "ivs not unique"), "core tab says those IVs do not hold a seat");

const echo = gradeBox([ivMon("machamp", "Machamp", 12, 15, 0, 0)], pvpOnly, [attack]);
const echoRow = inTracks(echo, 12);
must(echoRow?.verdict === "LOOK" && hasReason(echoRow, "same pokémon"), "same Pokémon in both files is LOOK, not an upgrade");
must(!echo.look.some((g) => hasReason(g, "core upgrade")), "a duplicated Pokémon does not compete with itself");

const hundo = ivMon("machamp", "Machamp", 8, 15, 15, 15, { cp: 2800, ivPercent: 100 });
const hundoScan = ivMon("machamp", "Machamp", 9, 15, 15, 15, { cp: 2500, ivPercent: 100 });
const hundoGrade = gradeBox([hundoScan], { ...pvpOnly, keepAllGood: false }, [hundo]);
const hundoRow = inTracks(hundoGrade, 9);
must(hundoRow?.verdict === "DUMP", "a tied 4* DUMPs when core holds that seat");
must(!hundoGrade.look.some((g) => hasReason(g, "core upgrade")), "tied 4* is not an upgrade");

const lowRaid = ivMon("bulbasaur", "Bulbasaur", 10, 15, 15, 13);
const highRaid = ivMon("bulbasaur", "Bulbasaur", 11, 14, 15, 15);
const bulbMeta = { ...meta, keepAllGood: false, pvpListKeep: 1, pvpRankKeep: 1, raidIvKeep: 90 };
const raidBetter = gradeBox([highRaid], bulbMeta, [lowRaid]);
const raidLook = inTracks(raidBetter, 11);
must(raidLook?.verdict === "LOOK" && hasReason(raidLook, "core upgrade"), "a better raid IV is LOOK when the seat is full");
const raidWorse = gradeBox([lowRaid], bulbMeta, [highRaid]);
const raidDump = inTracks(raidWorse, 10);
must(raidDump?.verdict === "DUMP" && hasReason(raidDump, "core holds"), "a worse raid copy DUMPs");
const raidOpen = gradeBox([lowRaid], { ...bulbMeta, raidKeep: 2 }, [highRaid]);
must(inTracks(raidOpen, 10)?.verdict === "KEEP", "raid cap with a free seat still KEEPs");

console.log("coreGrade passed");
