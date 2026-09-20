import type { Gender, Mon, ParseIssue, ParseResult } from "./types.ts";

/**
 * speciesId scheme (PvPoke-ish, no gamemaster lookup):
 * - ASCII-fold, lowercase; apostrophes dropped; other non [a-z0-9] -> `_`
 * - Regional adjectives on Name (Alolan/Galarian/Hisuian/Paldean) become suffixes
 *   `_alolan` / `_galarian` / `_hisuian` / `_paldean` (not `_alola`)
 * - Form "Normal"/"Standard"/empty omitted; "Alola"/"Alolan" -> `alolan` (same for galar/hisui/paldea)
 * - Mega X/Y -> `mega_x` / `mega_y`; other labelled forms slugified
 * - Numeric Calcy Form IDs are stored on `form` but not appended (unknown mapping)
 * - Shadow appends `_shadow` only (never `_purified`)
 * - Calcy Name suffixes (`Onix Shadow`, `Sandshrew Alolan Shadow`) peel like prefixes
 * - Calcy `ShadowForm`: 2 = this copy is shadow, 3 = purified; 1/7 mean the species
 *   can have a shadow, not that this row is one
 * Example: Alolan Ninetales shadow -> ninetales_alolan_shadow
 */

type Dialect = ParseResult["dialect"];

interface Cols {
  map: Map<string, number>;
  has(key: string): boolean;
  i(...keys: string[]): number | undefined;
}

/** Obvious @special / CD-or-elite charged names. Unlisted moves leave hasSpecialMove undefined. */
const SPECIAL_MOVES = new Set([
  "frustration",
  "return",
  "lastresort",
  "blastburn",
  "hydrocannon",
  "frenzyplant",
  "meteormash",
  "dragonascent",
  "sacredfire",
  "aeroblast",
  "psychoboost",
  "doomdesire",
  "originpulse",
  "precipiceblades",
  "roaroftime",
  "spatialrend",
  "technoblast",
  "relicsong",
  "obstruct",
  "aurawheel",
]);

const FORM_SLUG: Record<string, string | null> = {
  "": null,
  normal: null,
  none: null,
  standard: null,
  default: null,
  altered: null,
  alola: "alolan",
  alolan: "alolan",
  galar: "galarian",
  galarian: "galarian",
  hisui: "hisuian",
  hisuian: "hisuian",
  paldea: "paldean",
  paldean: "paldean",
  mega: "mega",
  megax: "mega_x",
  "mega x": "mega_x",
  megay: "mega_y",
  "mega y": "mega_y",
  rainy: "rainy",
  rain: "rainy",
  sunny: "sunny",
  sun: "sunny",
  snowy: "snowy",
  snow: "snowy",
  attack: "attack",
  defense: "defense",
  speed: "speed",
  origin: "origin",
  therian: "therian",
  incarnate: "incarnate",
  average: "average",
  small: "small",
  large: "large",
  super: "super",
  shadow: null,
  purified: null,
};

const HEADER_HINTS = new Set([
  "name",
  "cp",
  "hp",
  "atk iv",
  "def iv",
  "sta iv",
  "index",
  "pokemon",
  "nr",
  "unique",
  "oatt",
  "oatt iv",
  "gl rank",
  "gl rank min",
  "level min",
  "level max",
  "shadow purified",
  "shadowform",
  "ancestor",
  "possiblelevels",
  "nickname",
  "quick move",
  "fast move",
]);

export function parseInventoryCsv(text: string): ParseResult {
  try {
    return parseInner(typeof text === "string" ? text : String(text ?? ""));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unhandled parse error";
    return { dialect: "unknown", mons: [], issues: [{ row: 0, message }] };
  }
}

function parseInner(text: string): ParseResult {
  const issues: ParseIssue[] = [];
  const raw = text.replace(/^\uFEFF/, "");
  if (!raw.trim()) {
    return { dialect: "unknown", mons: [], issues: [{ row: 0, message: "empty CSV" }] };
  }

  const delimiter = detectDelimiter(raw);
  const records = parseCsvRecords(raw, delimiter);
  const headerAt = records.findIndex((row) => row.some((c) => c.trim() !== ""));
  if (headerAt < 0) {
    return { dialect: "unknown", mons: [], issues: [{ row: 0, message: "empty CSV" }] };
  }

  const headerRow = records[headerAt];
  const headerRowNumber = headerAt + 1;
  if (!looksLikeHeader(headerRow)) {
    return {
      dialect: "unknown",
      mons: [],
      issues: [{ row: headerRowNumber, message: "could not detect a header row" }],
    };
  }

  const cols = makeCols(headerRow);
  const dialect = detectDialect(cols);
  const mons: Mon[] = [];

  for (let r = headerAt + 1; r < records.length; r++) {
    const row = records[r];
    const sourceRow = r + 1;
    try {
      if (row.every((c) => !String(c ?? "").trim())) continue;
      if (isCalcyAncestor(cols, row)) continue;

      const parsed = rowToMon(row, sourceRow, cols, dialect, issues);
      if (parsed) mons.push(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "bad row";
      issues.push({ row: sourceRow, message });
    }
  }

  return { dialect, mons, issues };
}

function detectDelimiter(text: string): string {
  let quotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      quotes = !quotes;
      continue;
    }
    if (!quotes && (c === "\n" || c === "\r")) break;
    if (!quotes && c in counts) counts[c] += 1;
  }
  let best = ",";
  let n = -1;
  for (const [d, count] of Object.entries(counts)) {
    if (count > n) {
      best = d;
      n = count;
    }
  }
  return n > 0 ? best : ",";
}

function parseCsvRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (quoted) {
    row.push(field);
    rows.push(row);
  } else if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[øØ]/g, "o")
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => {
    const n = normHeader(c);
    if (HEADER_HINTS.has(n)) return true;
    if (n.startsWith("gl rank") || n.startsWith("rank g") || n.startsWith("oatt")) return true;
    return false;
  });
}

function makeCols(headerRow: string[]): Cols {
  const map = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = normHeader(h);
    if (key && !map.has(key)) map.set(key, i);
  });
  return {
    map,
    has(key: string) {
      return map.has(key);
    },
    i(...keys: string[]) {
      for (const key of keys) {
        const found = map.get(key);
        if (found !== undefined) return found;
      }
      return undefined;
    },
  };
}

function detectDialect(cols: Cols): Dialect {
  let genie = 0;
  let calcy = 0;
  if (cols.has("atk iv") && cols.has("def iv") && cols.has("sta iv")) genie += 4;
  if (cols.has("rank g") || cols.has("name g") || cols.has("stat product g")) genie += 3;
  if (cols.has("level min") && cols.has("level max")) genie += 2;
  if (cols.has("shadow purified")) genie += 2;
  if (cols.has("index") && cols.has("pokemon")) genie += 1;
  if (cols.has("quick move")) genie += 1;

  if (cols.has("unique")) calcy += 4;
  if (cols.has("oatt") || cols.has("oatt iv") || cols.has("odef iv") || cols.has("ohp iv")) calcy += 3;
  if (cols.has("gl rank") || cols.has("gl rank min") || cols.has("gl rank max")) calcy += 2;
  if (cols.has("ancestor")) calcy += 2;
  if (cols.has("possiblelevels")) calcy += 1;
  if (cols.has("nr") && cols.has("nickname")) calcy += 1;
  if (cols.has("fast move") && cols.has("special move")) calcy += 1;

  if (genie === 0 && calcy === 0) return "unknown";
  if (genie === calcy) return genie >= 3 ? "pokegenie" : "unknown";
  return genie > calcy ? "pokegenie" : "calcyiv";
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0 || idx >= row.length) return "";
  return String(row[idx] ?? "").trim();
}

function isCalcyAncestor(cols: Cols, row: string[]): boolean {
  const raw = cell(row, cols.i("ancestor"));
  if (!raw) return false;
  const flag = parseBool(raw);
  return flag === true;
}

function rowToMon(
  row: string[],
  sourceRow: number,
  cols: Cols,
  dialect: Dialect,
  issues: ParseIssue[],
): Mon | null {
  const nameRaw = cell(row, cols.i("name", "pokemon name"));
  const pokemonCol = cell(row, cols.i("pokemon"));
  const speciesName = nameRaw || (pokemonCol && !isNumericToken(pokemonCol) ? pokemonCol : "");
  const cp = parseFinite(cell(row, cols.i("cp", "combat power")));
  const hp = parseFinite(cell(row, cols.i("hp")));

  if (!speciesName) {
    issues.push({ row: sourceRow, message: "skip: missing species name" });
    return null;
  }
  if (cp === undefined || cp <= 0) {
    issues.push({ row: sourceRow, message: `skip: bad CP (${speciesName})` });
    return null;
  }
  if (hp === undefined || hp <= 0) {
    issues.push({ row: sourceRow, message: `skip: bad HP (${speciesName})` });
    return null;
  }

  const formRaw = cell(row, cols.i("form"));
  const peeled = peelName(speciesName);
  const formSlug = formToSlug(formRaw);
  if (formRaw && /^\s*shadow\s*$/i.test(formRaw)) peeled.shadow = true;
  if (formRaw && /^\s*purified\s*$/i.test(formRaw)) peeled.purified = true;

  const sp = parseShadowPurified(
    cell(row, cols.i("shadow purified")),
    cell(row, cols.i("shadow")),
    cell(row, cols.i("purified")),
  );
  const formShadow = parseCalcyShadowForm(cell(row, cols.i("shadowform", "shadow form")));
  const shadow = peeled.shadow || sp.shadow || formShadow.shadow;
  const purified = !shadow && (peeled.purified || sp.purified || formShadow.purified);

  const atk = parseExactIv(
    cell(row, cols.i("atk iv", "attack iv", "oatt iv", "oatt", "att iv", "atk", "att", "attack")),
  );
  const def = parseExactIv(
    cell(row, cols.i("def iv", "defense iv", "odef iv", "odef", "def", "defense")),
  );
  const sta = parseExactIv(
    cell(row, cols.i("sta iv", "stamina iv", "ohp iv", "ohp", "hp iv", "sta", "stamina")),
  );

  const levelMin = parseFinite(cell(row, cols.i("level min")));
  const levelMax = parseFinite(cell(row, cols.i("level max")));
  const levelSingle = parseFinite(cell(row, cols.i("level")));
  const uniqueFlag = parseBool(cell(row, cols.i("unique")));

  const exactIvs = atk !== undefined && def !== undefined && sta !== undefined;
  const genieUnique =
    levelMin !== undefined && levelMax !== undefined && Math.abs(levelMin - levelMax) < 1e-6;
  const calcyUnique = uniqueFlag === true;
  let ivUnique = false;
  if (exactIvs) {
    if (dialect === "pokegenie") ivUnique = genieUnique;
    else if (dialect === "calcyiv") ivUnique = calcyUnique;
    else ivUnique = calcyUnique || genieUnique;
  }

  let level: number | undefined;
  if (genieUnique) level = levelMin;
  else if (levelSingle !== undefined && (dialect !== "pokegenie" || !cols.has("level min"))) {
    level = levelSingle;
  }

  const fastMove = parseMove(cell(row, cols.i("quick move", "fast move", "fast")));
  const chargedMove = parseMove(
    cell(row, cols.i("charge move", "charged move", "special move", "charge")),
  );
  const chargedMove2 = parseMove(cell(row, cols.i("charge move 2", "charged move 2", "charge 2")));
  const hasSpecialMove = specialMoveFlag(fastMove, chargedMove, chargedMove2);

  const ivPercent = parsePercent(cell(row, cols.i("iv avg", "oiv", "iv percent")));

  const dex = parseDex(pokemonCol) ?? parseDex(cell(row, cols.i("nr", "dex", "pokedex", "no")));
  const nicknameRaw = cell(row, cols.i("nickname"));
  const nickname = nicknameRaw && nicknameRaw !== "-" ? nicknameRaw : undefined;

  const formParts: string[] = [];
  const addForm = (slug: string | null | undefined) => {
    if (!slug || formParts.includes(slug)) return;
    formParts.push(slug);
  };
  for (const f of peeled.forms) addForm(f);
  addForm(formSlug);

  const baseSlug = slugToken(peeled.base) || slugToken(speciesName);
  if (!baseSlug) {
    issues.push({ row: sourceRow, message: `skip: could not slugify (${speciesName})` });
    return null;
  }
  const shadowBit = shadow && !baseSlug.endsWith("_shadow") ? "shadow" : "";
  const speciesId = [baseSlug, ...formParts, shadowBit].filter(Boolean).join("_");

  const form =
    formRaw && !/^(normal|standard|none|default)$/i.test(formRaw)
      ? formRaw
      : peeled.forms[0]
        ? peeled.forms[0]
        : formSlug ?? "";

  const lucky = parseBool(cell(row, cols.i("lucky")));

  const mon: Mon = {
    source: dialect,
    sourceRow,
    speciesName,
    speciesId,
    form,
    gender: parseGender(cell(row, cols.i("gender"))),
    cp,
    hp,
    ivUnique,
    shadow,
    purified,
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
  if (hasSpecialMove) mon.hasSpecialMove = true;
  if (lucky !== undefined) mon.lucky = lucky;

  const favorite = parseBool(cell(row, cols.i("favorite", "favourite", "star")));
  if (favorite !== undefined) mon.favorite = favorite;

  const dynamax = parseDynamaxFlag(cell(row, cols.i("dynamax", "dmax", "gigantamax", "gmax")));
  if (dynamax !== undefined) mon.dynamax = dynamax;

  assignOptionalFlag(mon, "shiny", cols, row, ["shiny", "is shiny"]);
  assignOptionalFlag(mon, "costume", cols, row, ["costume", "is costume"]);
  assignOptionalFlag(mon, "background", cols, row, ["background"]);
  assignOptionalFlag(mon, "legendary", cols, row, ["legendary"]);
  assignOptionalFlag(mon, "mythical", cols, row, ["mythical"]);

  const catchDate = cell(row, cols.i("catch date", "caught"));
  const scanDate = cell(row, cols.i("scan date", "scanned"));
  if (catchDate) mon.catchDate = catchDate;
  if (scanDate) mon.scanDate = scanDate;

  return mon;
}

function assignOptionalFlag(
  mon: Mon,
  key: "shiny" | "costume" | "background" | "legendary" | "mythical",
  cols: Cols,
  row: string[],
  aliases: string[],
): void {
  const present = aliases.some((a) => cols.has(a));
  if (!present) return;
  const raw = cell(row, cols.i(...aliases));
  if (!raw) {
    mon[key] = false;
    return;
  }
  if (key === "costume") {
    const n = raw.toLowerCase();
    mon.costume = !(n === "0" || n === "false" || n === "no" || n === "none" || n === "normal");
    return;
  }
  const flag = parseBool(raw);
  if (flag !== undefined) mon[key] = flag;
}

function parseFinite(raw: string): number | undefined {
  if (!raw || raw === "-" || raw === "?") return undefined;
  const n = Number(raw.replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseExactIv(raw: string): number | undefined {
  if (!raw || raw === "-" || raw === "?" || raw === "-1") return undefined;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 15) return undefined;
  if (Math.abs(n - Math.round(n)) > 1e-9) return undefined;
  return Math.round(n);
}

function parsePercent(raw: string): number | undefined {
  const n = parseFinite(raw);
  if (n === undefined || n < 0 || n > 100) return undefined;
  return n;
}

function parseDex(raw: string): number | undefined {
  if (!raw || !isNumericToken(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function isNumericToken(raw: string): boolean {
  return /^\d+(\.0+)?$/.test(raw.trim());
}

function parseBool(raw: string): boolean | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (["1", "true", "yes", "y", "x"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return undefined;
}

function parseGender(raw: string): Gender {
  const s = raw.trim().toLowerCase();
  if (!s || s === "-" || s === "?" || s === "0") return "unknown";
  if (s === "2" || s === "f" || s === "female" || s === "♀" || s.includes("female")) return "female";
  if (s === "1" || s === "m" || s === "male" || s === "♂" || /(^|[^a-z])male([^a-z]|$)/.test(s)) {
    return "male";
  }
  return "unknown";
}

/**
 * Calcy `ShadowForm` on recent history exports:
 * 2 = this copy is shadow, 3 = purified.
 * 1 and 7 are species-level "has a shadow form in GO", not this row.
 */
function parseCalcyShadowForm(raw: string): { shadow: boolean; purified: boolean } {
  const s = raw.trim().toLowerCase();
  if (!s) return { shadow: false, purified: false };
  if (s === "2" || s === "shadow" || s === "s") return { shadow: true, purified: false };
  if (s === "3" || s === "purified" || s === "p") return { shadow: false, purified: true };
  return { shadow: false, purified: false };
}

function parseDynamaxFlag(raw: string): boolean | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (s === "?" || s === "-") return undefined;
  if (["0", "false", "no", "n", "none"].includes(s)) return false;
  if (
    ["1", "true", "yes", "y", "d", "dmax", "dynamax", "g", "gmax", "gigantamax", "giganta", "x"].includes(
      s,
    )
  ) {
    return true;
  }
  return undefined;
}

function parseShadowPurified(
  combined: string,
  shadowCol: string,
  purifiedCol: string,
): { shadow: boolean; purified: boolean } {
  const c = combined.trim().toLowerCase();
  if (c) {
    if (c === "2" || c === "purified" || c === "p") return { shadow: false, purified: true };
    if (c === "1" || c === "shadow" || c === "s" || c === "true" || c === "yes") {
      return { shadow: true, purified: false };
    }
    if (c === "0" || c === "normal" || c === "none" || c === "false" || c === "no") {
      return { shadow: false, purified: false };
    }
  }
  const shadow = parseBool(shadowCol) === true || /^\s*shadow\s*$/i.test(shadowCol);
  const purified = parseBool(purifiedCol) === true || /^\s*purified\s*$/i.test(purifiedCol);
  if (shadow && purified) return { shadow: false, purified: true };
  return { shadow, purified };
}

function parseMove(raw: string): string | undefined {
  const s = raw.trim();
  if (!s || s === "-" || s === "—") return undefined;
  if (/^-?\d+$/.test(s)) return undefined;
  return s.replace(/\*$/, "").trim() || undefined;
}

function specialMoveFlag(...moves: Array<string | undefined>): true | undefined {
  for (const move of moves) {
    if (!move) continue;
    const key = foldAscii(move)
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, "");
    if (SPECIAL_MOVES.has(key)) return true;
  }
  return undefined;
}

function peelName(name: string): { base: string; forms: string[]; shadow: boolean; purified: boolean } {
  let base = name.trim();
  const forms: string[] = [];
  let shadow = false;
  let purified = false;

  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/;
  const pm = base.match(paren);
  if (pm) {
    base = pm[1].trim();
    const inner = formToSlug(pm[2]);
    if (inner) forms.push(inner);
    if (/shadow/i.test(pm[2])) shadow = true;
    if (/purified/i.test(pm[2])) purified = true;
  }

  let looping = true;
  while (looping) {
    looping = false;
    const affixes: Array<{ re: RegExp; apply: () => void }> = [
      { re: /^(alolan|alola)\s+/i, apply: () => forms.push("alolan") },
      { re: /^(galarian|galar)\s+/i, apply: () => forms.push("galarian") },
      { re: /^(hisuian|hisui)\s+/i, apply: () => forms.push("hisuian") },
      { re: /^(paldean|paldea)\s+/i, apply: () => forms.push("paldean") },
      { re: /^shadow\s+/i, apply: () => { shadow = true; } },
      { re: /^purified\s+/i, apply: () => { purified = true; } },
      { re: /^mega\s+/i, apply: () => forms.push("mega") },
      // Calcy history: "Onix Shadow", "Sandshrew Alolan Shadow"
      { re: /\s+shadow$/i, apply: () => { shadow = true; } },
      { re: /\s+purified$/i, apply: () => { purified = true; } },
      { re: /\s+(alolan|alola)$/i, apply: () => forms.push("alolan") },
      { re: /\s+(galarian|galar)$/i, apply: () => forms.push("galarian") },
      { re: /\s+(hisuian|hisui)$/i, apply: () => forms.push("hisuian") },
      { re: /\s+(paldean|paldea)$/i, apply: () => forms.push("paldean") },
    ];
    for (const p of affixes) {
      if (p.re.test(base)) {
        base = base.replace(p.re, "");
        p.apply();
        looping = true;
        break;
      }
    }
  }

  if (forms.includes("mega")) {
    const xy = base.match(/^(.*?)\s+([xy])$/i);
    if (xy) {
      base = xy[1].trim();
      const slot = forms.indexOf("mega");
      forms.splice(slot, 1, xy[2].toLowerCase() === "x" ? "mega_x" : "mega_y");
    }
  }

  return { base: base.trim() || name.trim(), forms: uniq(forms), shadow, purified };
}

function formToSlug(formRaw: string): string | null {
  const trimmed = formRaw.trim();
  if (!trimmed || isNumericToken(trimmed)) return null;
  let key = foldAscii(trimmed)
    .toLowerCase()
    .replace(/forme?$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (key in FORM_SLUG) return FORM_SLUG[key];
  key = key.replace(/\s+/g, "");
  if (key in FORM_SLUG) return FORM_SLUG[key];
  if (!key || key === "shadow" || key === "purified") return null;
  return slugToken(trimmed) || null;
}

function slugToken(name: string): string {
  let s = foldAscii(name).toLowerCase();
  s = s.replace(/♀/g, "_female_");
  s = s.replace(/♂/g, "_male_");
  s = s.replace(/['’`]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (s === "nidoran_f" || s === "nidoranf") return "nidoran_female";
  if (s === "nidoran_m" || s === "nidoranm") return "nidoran_male";
  return s;
}

function foldAscii(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function uniq(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}
