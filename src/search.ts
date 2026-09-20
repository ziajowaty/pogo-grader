import type { Mon } from "./types";

/** English GO client. Keep this list short enough to paste on a phone. */
export const DUMP_SPECIES_CAP = 24;

const CAPPED_INSTRUCTION = "Too many DUMP species — tag #DUMP on the DUMP track instead";

const EYEBALL_NOTE =
  "Favorite KEEP in GO, Search DUMP, tag those #DUMP, then Transfer. Never search !#keep on the whole box.";

export interface DumpSearchPlan {
  /** Species OR-list only. Empty / capped → instruction, never a whole-box dump. */
  preview: string;
  /** Same as preview plus the #DUMP fuse and safety cloak. */
  execute: string;
  instruction: string;
  speciesCapped: boolean;
  speciesCount: number;
}

/** Knobs that change the Transfer cloak. Omitted keys keep the conservative defaults. */
export interface DumpSearchOptions {
  /** When false, Transfer does not AND `!lucky` (Lucky chip faded). Default true. */
  keepLucky?: boolean;
}

function executeCloak(opts?: DumpSearchOptions): string {
  const bits = [
    "#DUMP",
    "!favorite",
    "!shiny",
    opts?.keepLucky === false ? "" : "!lucky",
    "!legendary",
    "!mythical",
    "!shadow",
    "!4*",
    "!costume",
  ].filter(Boolean);
  return bits.join("&");
}

function sanitizeToken(raw: string): string {
  return raw
    .trim()
    .replace(/[&,#!@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer English species name; fall back to dex, then speciesId. */
export function speciesSearchToken(mon: Mon): string {
  const name = sanitizeToken(mon.speciesName ?? "");
  if (name) return name;
  if (mon.dex != null && Number.isFinite(mon.dex) && mon.dex > 0) {
    return String(Math.trunc(mon.dex));
  }
  const fromId = sanitizeToken(
    (mon.speciesId ?? "").replace(/_shadow$/i, "").replace(/_/g, " "),
  );
  return fromId;
}

function uniqueSpeciesTokens(mons: Mon[]): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const mon of mons) {
    const token = speciesSearchToken(mon);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  tokens.sort((a, b) => {
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return Number(a) - Number(b);
    if (aNum !== bNum) return aNum ? -1 : 1;
    return a.localeCompare(b, "en");
  });
  return tokens;
}

function orList(tokens: string[]): string {
  return tokens.join(",");
}

/**
 * Conservative dump-card strings for the English GO client.
 * Never emits whole-box `!#keep`. Does not AND `0*` (dump IVs are mixed).
 */
export function dumpSearchPlan(mons: Mon[], opts?: DumpSearchOptions): DumpSearchPlan {
  if (mons.length === 0) {
    return {
      preview: "No DUMP. Nothing to Transfer.",
      execute: "No DUMP. Nothing to Transfer.",
      instruction: EYEBALL_NOTE,
      speciesCapped: false,
      speciesCount: 0,
    };
  }

  const tokens = uniqueSpeciesTokens(mons);
  const speciesCapped = tokens.length > DUMP_SPECIES_CAP;

  if (tokens.length === 0 || speciesCapped) {
    return {
      preview: CAPPED_INSTRUCTION,
      execute: CAPPED_INSTRUCTION,
      instruction: speciesCapped
        ? `DUMP has ${tokens.length} species (cap ${DUMP_SPECIES_CAP}). ${CAPPED_INSTRUCTION}. ${EYEBALL_NOTE}`
        : `DUMP has no species names. ${CAPPED_INSTRUCTION}. ${EYEBALL_NOTE}`,
      speciesCapped: true,
      speciesCount: tokens.length,
    };
  }

  const preview = orList(tokens);
  const execute = `${preview}&${executeCloak(opts)}`;
  return {
    preview,
    execute,
    instruction: EYEBALL_NOTE,
    speciesCapped: false,
    speciesCount: tokens.length,
  };
}

/** Copyable preview (no #DUMP). Capped sets return the tag-instead instruction. */
export function dumpPreviewString(mons: Mon[], opts?: DumpSearchOptions): string {
  return dumpSearchPlan(mons, opts).preview;
}

/** Preview plus &#DUMP and the safety cloak. Same cap behavior as preview. */
export function dumpExecuteString(mons: Mon[], opts?: DumpSearchOptions): string {
  return dumpSearchPlan(mons, opts).execute;
}

/** Full clipboard payload: instruction + preview + execute. */
export function dumpPreviewBundle(mons: Mon[], opts?: DumpSearchOptions): string {
  const plan = dumpSearchPlan(mons, opts);
  return [
    plan.instruction,
    "",
    "SEARCH (see DUMP in GO, then tag #DUMP):",
    plan.preview,
    "",
    "TRANSFER (after #DUMP tag):",
    plan.execute,
  ].join("\n");
}
