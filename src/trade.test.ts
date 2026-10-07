import { gradeBox } from "./grade";
import { loadMeta } from "./meta";
import { isForTrade, splitDump } from "./trade";
import type { GradedMon, Mon } from "./types";

function must(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function mon(sourceRow: number, extra: Partial<Mon> = {}): Mon {
  return {
    source: "calcyiv",
    sourceRow,
    speciesName: extra.speciesId ?? "x",
    speciesId: "x",
    form: "",
    gender: "unknown",
    cp: 10,
    hp: 10,
    ivUnique: true,
    shadow: false,
    purified: false,
    ...extra,
  };
}

function dump(sourceRow: number, extra: Partial<GradedMon> = {}, monExtra: Partial<Mon> = {}): GradedMon {
  return {
    mon: mon(sourceRow, monExtra),
    verdict: "DUMP",
    reasons: [],
    keepClasses: [],
    copiesInGroup: 1,
    copyRankInGroup: 1,
    ...extra,
    mon: mon(sourceRow, { ...monExtra, ...(extra.mon ?? {}) }),
  };
}

const off = { tradeRaid: false, tradePvp: false };
const raidOnly = { tradeRaid: true, tradePvp: false };
const pvpOnly = { tradeRaid: false, tradePvp: true };
const both = { tradeRaid: true, tradePvp: true };

const junk = dump(1);
const raid = dump(2, { raidIv: { percent: 40, evoSpeciesId: "beedrill_mega" } });
const pvp = dump(3, { pvpFamily: true });
const bothKinds = dump(4, { raidIv: { percent: 80, evoSpeciesId: "dragonite" }, pvpFamily: true });
const shadowRaid = dump(5, { raidIv: { percent: 50, evoSpeciesId: "beedrill_mega" }, pvpFamily: true }, { shadow: true });
const rows = [junk, raid, pvp, bothKinds, shadowRaid];

const idle = splitDump(rows, off);
must(idle.trade.length === 0 && idle.transfer.map((g) => g.mon.sourceRow).join(",") === "1,2,3,4,5", "both switches off leaves DUMP in scan order");

const raidSplit = splitDump(rows, raidOnly);
must(raidSplit.trade.map((g) => g.mon.sourceRow).join(",") === "2,4", `raid switch trades raid copies, got ${raidSplit.trade.map((g) => g.mon.sourceRow)}`);
must(raidSplit.transfer.map((g) => g.mon.sourceRow).join(",") === "1,3,5", "raid switch leaves junk, pvp-only, and shadows in TRANSFER");

const pvpSplit = splitDump(rows, pvpOnly);
must(pvpSplit.trade.map((g) => g.mon.sourceRow).join(",") === "3,4", "pvp switch trades bright-league families");
must(pvpSplit.transfer.map((g) => g.mon.sourceRow).join(",") === "1,2,5", "pvp switch leaves raid-only and shadows in TRANSFER");

const bothSplit = splitDump(rows, both);
must(bothSplit.trade.map((g) => g.mon.sourceRow).join(",") === "2,3,4", "a copy that matches both switches appears once, in scan order");
must(bothSplit.transfer.map((g) => g.mon.sourceRow).join(",") === "1,5", "shadows stay in TRANSFER even when both switches are on");
must(isForTrade(shadowRaid, both) === false, "a shadow raid copy is not for trade");

function scanMon(speciesId: string, sourceRow: number, extra: Partial<Mon> = {}): Mon {
  return {
    source: "calcyiv",
    sourceRow,
    speciesName: speciesId,
    speciesId,
    form: "",
    gender: "male",
    cp: 100,
    hp: 40,
    atk: 0,
    def: 0,
    sta: 0,
    ivUnique: true,
    level: 5,
    shadow: false,
    purified: false,
    ...extra,
  };
}

const meta = await loadMeta();
const weedles = gradeBox([scanMon("weedle", 1), scanMon("weedle", 2)], meta);
const weedleDump = weedles.dump.find((g) => g.mon.speciesId === "weedle");
must(weedleDump?.raidIv != null, "extra weedle DUMP still counts as a raid attacker");
must(isForTrade(weedleDump!, raidOnly) === true, "raid switch marks the extra weedle");
must(isForTrade(weedleDump!, off) === false, "faded raid switch does not mark the weedle");

const bidoofs = gradeBox([scanMon("bidoof", 1), scanMon("bidoof", 2)], meta);
const bidoofDump = bidoofs.dump.find((g) => g.mon.speciesId === "bidoof");
must(bidoofDump != null && bidoofDump.pvpFamily !== true && bidoofDump.raidIv == null, "extra bidoof is not raid or PvP candy");
must(isForTrade(bidoofDump!, both) === false, "bidoof stays in TRANSFER");

const anyBidoof = gradeBox(
  [scanMon("bidoof", 1), scanMon("bidoof", 2), scanMon("bidoof", 3), scanMon("bidoof", 4)],
  { ...meta, pvpAny: true },
);
const anyDump = anyBidoof.dump.find((g) => g.mon.speciesId === "bidoof");
must(anyDump?.pvpFamily === true, "Any species gives the extra bidoof a PvP seat");
must(isForTrade(anyDump!, pvpOnly) === true, "PvP switch marks that bidoof when Any species is on");

const machamps = gradeBox(
  [scanMon("machamp", 1), scanMon("machamp", 2), scanMon("machamp", 3)],
  { ...meta, pvpRankKeep: 1 },
);
const machampDump = machamps.dump.find((g) => g.mon.speciesId === "machamp");
must(machampDump?.pvpFamily === true && machampDump.raidIv == null, "machamp DUMP is PvP candy and below raid A");
must(isForTrade(machampDump!, pvpOnly) === true && isForTrade(machampDump!, raidOnly) === false, "only the PvP switch marks machamp");

const shadowWeedles = gradeBox(
  [scanMon("weedle", 1, { shadow: true }), scanMon("weedle", 2, { shadow: true })],
  { ...meta, keepShadow: false },
);
const shadowDump = shadowWeedles.dump.find((g) => g.mon.shadow);
must(shadowDump?.raidIv != null, "faded Shadow still scores the weedle as raid candy");
must(isForTrade(shadowDump!, both) === false, "shadow weedle DUMP stays in TRANSFER");

console.log("trade tests ok");
