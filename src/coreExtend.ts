import type { GradedMon, Mon } from "./types";

/**
 * Same species, IVs, CP, and level. Missing or non-unique IVs do not match.
 * Seat identity for the core file and for Pokémon saved from a scan.
 */
export function coreFingerprint(mon: Mon): string | null {
  if (mon.ivUnique === false) return null;
  if (mon.atk == null || mon.def == null || mon.sta == null) return null;
  return `${mon.speciesId}|${mon.atk}|${mon.def}|${mon.sta}|${mon.cp}|${mon.level ?? ""}`;
}

/** Unique copies use the seat fingerprint. Other copies use a looser saved-row key. */
export function coreExtendKey(mon: Mon): string {
  const seat = coreFingerprint(mon);
  if (seat) return seat;
  const flag = (value: boolean | undefined) => (value === true ? "1" : value === false ? "0" : "");
  return [
    "loose",
    mon.speciesId,
    mon.atk ?? "",
    mon.def ?? "",
    mon.sta ?? "",
    mon.cp,
    mon.level ?? "",
    mon.hp,
    mon.shadow ? "1" : "0",
    mon.purified ? "1" : "0",
    mon.gender,
    flag(mon.shiny),
    flag(mon.lucky),
    flag(mon.favorite),
    mon.nickname?.trim() ?? "",
  ].join("|");
}

/** File rows stay in front. The first row for a key wins, so the file beats extended. */
export function mergeCoreMons(fileCore: Mon[], extended: Mon[]): Mon[] {
  const out: Mon[] = [];
  const seen = new Set<string>();
  for (const mon of [...fileCore, ...extended]) {
    const key = coreExtendKey(mon);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mon);
  }
  return out;
}

export type CoreifyRefusal = "no-species" | "bad-cp" | "bad-hp" | "in-file" | "in-extended";

export type CoreifyResult = { ok: true; mon: Mon } | { ok: false; reason: CoreifyRefusal };

function savedCopy(mon: Mon): Mon {
  const next: Mon = { ...mon, speciesName: mon.speciesName.trim(), speciesId: mon.speciesId.trim() };
  if (mon.nickname != null) {
    const nick = mon.nickname.trim();
    if (nick) next.nickname = nick;
    else delete next.nickname;
  }
  return next;
}

/** Copy a scan row into the extended collection, or say why it was refused. */
export function coreifyScan(mon: Mon, fileCore: Mon[], extended: Mon[]): CoreifyResult {
  const next = savedCopy(mon);
  if (!next.speciesName || !next.speciesId) return { ok: false, reason: "no-species" };
  if (!Number.isFinite(next.cp) || next.cp <= 0) return { ok: false, reason: "bad-cp" };
  if (!Number.isFinite(next.hp) || next.hp <= 0) return { ok: false, reason: "bad-hp" };
  const key = coreExtendKey(next);
  if (fileCore.some((row) => coreExtendKey(row) === key)) return { ok: false, reason: "in-file" };
  if (extended.some((row) => coreExtendKey(row) === key)) return { ok: false, reason: "in-extended" };
  return { ok: true, mon: next };
}

export function removeExtended(extended: Mon[], key: string): Mon[] {
  return extended.filter((mon) => coreExtendKey(mon) !== key);
}

export function splitCoreRows(
  graded: GradedMon[],
  fileCore: Mon[],
): { file: GradedMon[]; extended: GradedMon[] } {
  const fileKeys = new Set(fileCore.map((mon) => coreExtendKey(mon)));
  const file: GradedMon[] = [];
  const extended: GradedMon[] = [];
  for (const row of graded) {
    if (fileKeys.has(coreExtendKey(row.mon))) file.push(row);
    else extended.push(row);
  }
  return { file, extended };
}

/** Extended rows whose key is already in the core file. They do not take a second seat. */
export function extendedDuplicates(extended: Mon[], fileCore: Mon[]): Mon[] {
  const fileKeys = new Set(fileCore.map((mon) => coreExtendKey(mon)));
  return extended.filter((mon) => fileKeys.has(coreExtendKey(mon)));
}

const CORE_CSV_HEADERS = [
  "Name",
  "Form",
  "Gender",
  "Nickname",
  "CP",
  "HP",
  "Level",
  "Unique?",
  "ØATT IV",
  "ØDEF IV",
  "ØHP IV",
  "ØIV%",
  "ShadowForm",
  "Lucky?",
  "Favorite",
  "Shiny",
  "Costume",
  "Background",
  "Legendary",
  "Mythical",
  "Dynamax",
  "Fast move",
  "Special move",
  "Special move 2",
  "Nr",
] as const;

export interface CoreCsvFile {
  text: string;
  skipped: string[];
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function numCell(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function ivCell(value: number | undefined): string {
  return typeof value === "number" && Number.isInteger(value) ? String(value) : "";
}

/** True, false, or unknown. Unknown stays unknown on the way back through the parser. */
function tri(value: boolean | undefined): string {
  if (value === true) return "1";
  if (value === false) return "0";
  return "?";
}

function yn(value: boolean | undefined): string {
  if (value === true) return "1";
  if (value === false) return "0";
  return "";
}

function genderCell(mon: Mon): string {
  if (mon.gender === "female") return "♀";
  if (mon.gender === "male") return "♂";
  return "";
}

/**
 * One Calcy-shaped CSV. Poke Genie and Calcy rows both become this header so
 * the file can be loaded again as the core. Extra columns from the original
 * export are not kept.
 */
export function formatCoreCsv(mons: Mon[]): CoreCsvFile {
  const skipped: string[] = [];
  const lines = [CORE_CSV_HEADERS.join(",")];
  for (const mon of mons) {
    const name = mon.speciesName.trim();
    if (!name || !mon.speciesId.trim()) {
      skipped.push("missing species");
      continue;
    }
    if (!Number.isFinite(mon.cp) || mon.cp <= 0) {
      skipped.push(`bad CP (${name})`);
      continue;
    }
    if (!Number.isFinite(mon.hp) || mon.hp <= 0) {
      skipped.push(`bad HP (${name})`);
      continue;
    }
    const cells = [
      name,
      mon.form ?? "",
      genderCell(mon),
      mon.nickname?.trim() ?? "",
      String(mon.cp),
      String(mon.hp),
      numCell(mon.level),
      mon.ivUnique ? "1" : "0",
      ivCell(mon.atk),
      ivCell(mon.def),
      ivCell(mon.sta),
      numCell(mon.ivPercent),
      mon.shadow ? "2" : mon.purified ? "3" : "",
      yn(mon.lucky),
      yn(mon.favorite),
      tri(mon.shiny),
      tri(mon.costume),
      tri(mon.background),
      tri(mon.legendary),
      tri(mon.mythical),
      tri(mon.dynamax),
      mon.fastMove?.trim() ?? "",
      mon.chargedMove?.trim() ?? "",
      mon.chargedMove2?.trim() ?? "",
      mon.dex != null && Number.isInteger(mon.dex) && mon.dex > 0 ? String(mon.dex) : "",
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return { text: `${lines.join("\n")}\n`, skipped };
}

export type StoredExtendedRead = { ok: true; mons: Mon[]; dirty: boolean } | { ok: false };

function optString(value: unknown): string | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optBool(value: unknown): boolean | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== "boolean") return null;
  return value;
}

function optIv(value: unknown): number | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 15) return null;
  return value;
}

function coerceMon(value: unknown): Mon | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Mon>;
  const speciesName = typeof row.speciesName === "string" ? row.speciesName.trim() : "";
  const speciesId = typeof row.speciesId === "string" ? row.speciesId.trim() : "";
  if (!speciesName || !speciesId) return null;
  if (row.source !== "calcyiv" && row.source !== "pokegenie" && row.source !== "unknown") return null;
  if (typeof row.sourceRow !== "number" || !Number.isFinite(row.sourceRow)) return null;
  if (typeof row.form !== "string") return null;
  if (row.gender !== "male" && row.gender !== "female" && row.gender !== "unknown") return null;
  if (typeof row.cp !== "number" || !Number.isFinite(row.cp) || row.cp <= 0) return null;
  if (typeof row.hp !== "number" || !Number.isFinite(row.hp) || row.hp <= 0) return null;
  if (typeof row.ivUnique !== "boolean") return null;
  if (typeof row.shadow !== "boolean" || typeof row.purified !== "boolean") return null;

  const atk = optIv(row.atk);
  const def = optIv(row.def);
  const sta = optIv(row.sta);
  if (atk === null || def === null || sta === null) return null;

  let level: number | undefined;
  if (row.level != null) {
    if (typeof row.level !== "number" || !Number.isFinite(row.level) || row.level < 0) return null;
    level = row.level;
  }
  let ivPercent: number | undefined;
  if (row.ivPercent != null) {
    if (typeof row.ivPercent !== "number" || !Number.isFinite(row.ivPercent) || row.ivPercent < 0 || row.ivPercent > 100) {
      return null;
    }
    ivPercent = row.ivPercent;
  }
  let dex: number | undefined;
  if (row.dex != null) {
    if (typeof row.dex !== "number" || !Number.isInteger(row.dex) || row.dex <= 0) return null;
    dex = row.dex;
  }

  const nickname = optString(row.nickname);
  const fastMove = optString(row.fastMove);
  const chargedMove = optString(row.chargedMove);
  const chargedMove2 = optString(row.chargedMove2);
  const catchDate = optString(row.catchDate);
  const scanDate = optString(row.scanDate);
  if (
    nickname === null ||
    fastMove === null ||
    chargedMove === null ||
    chargedMove2 === null ||
    catchDate === null ||
    scanDate === null
  ) {
    return null;
  }

  const shiny = optBool(row.shiny);
  const lucky = optBool(row.lucky);
  const favorite = optBool(row.favorite);
  const costume = optBool(row.costume);
  const background = optBool(row.background);
  const legendary = optBool(row.legendary);
  const mythical = optBool(row.mythical);
  const dynamax = optBool(row.dynamax);
  const hasSpecialMove = optBool(row.hasSpecialMove);
  if (
    shiny === null ||
    lucky === null ||
    favorite === null ||
    costume === null ||
    background === null ||
    legendary === null ||
    mythical === null ||
    dynamax === null ||
    hasSpecialMove === null
  ) {
    return null;
  }

  const mon: Mon = {
    source: row.source,
    sourceRow: row.sourceRow,
    speciesName,
    speciesId,
    form: row.form,
    gender: row.gender,
    cp: row.cp,
    hp: row.hp,
    ivUnique: row.ivUnique,
    shadow: row.shadow,
    purified: row.purified,
  };
  if (dex !== undefined) mon.dex = dex;
  if (atk !== undefined) mon.atk = atk;
  if (def !== undefined) mon.def = def;
  if (sta !== undefined) mon.sta = sta;
  if (ivPercent !== undefined) mon.ivPercent = ivPercent;
  if (level !== undefined) mon.level = level;
  if (nickname) mon.nickname = nickname;
  if (fastMove) mon.fastMove = fastMove;
  if (chargedMove) mon.chargedMove = chargedMove;
  if (chargedMove2) mon.chargedMove2 = chargedMove2;
  if (hasSpecialMove === true) mon.hasSpecialMove = true;
  if (lucky !== undefined) mon.lucky = lucky;
  if (favorite !== undefined) mon.favorite = favorite;
  if (shiny !== undefined) mon.shiny = shiny;
  if (costume !== undefined) mon.costume = costume;
  if (background !== undefined) mon.background = background;
  if (legendary !== undefined) mon.legendary = legendary;
  if (mythical !== undefined) mon.mythical = mythical;
  if (dynamax !== undefined) mon.dynamax = dynamax;
  if (catchDate) mon.catchDate = catchDate;
  if (scanDate) mon.scanDate = scanDate;
  return mon;
}

/** IndexedDB payload. A bare array is accepted. Anything else is unusable. */
export function readStoredExtended(value: unknown): StoredExtendedRead {
  let rows: unknown[] | null = null;
  if (Array.isArray(value)) rows = value;
  else if (value && typeof value === "object" && "mons" in value) {
    const mons = (value as { mons?: unknown }).mons;
    if (!Array.isArray(mons)) return { ok: false };
    rows = mons;
  }
  if (!rows) return { ok: false };
  const mons: Mon[] = [];
  for (const row of rows) {
    const mon = coerceMon(row);
    if (mon) mons.push(mon);
  }
  return { ok: true, mons, dirty: mons.length !== rows.length };
}
