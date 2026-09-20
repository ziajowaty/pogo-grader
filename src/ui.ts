import type {
  GradeResult,
  GradedMon,
  Meta,
  ParseResult,
  PokemonType,
  PvpokeRankRow,
  RaidAttackerRow,
  Verdict,
} from "./types";
import {
  clampFamilyKeep,
  clampPvpListKeep,
  clampPvpRankKeep,
  clampRaidIvKeep,
  DEFAULT_FAMILY_KEEP,
  DEFAULT_KEEP_FAVORITE,
  DEFAULT_KEEP_LUCKY,
  DEFAULT_KEEP_SHADOW,
  DEFAULT_PVP_LIST_KEEP,
  DEFAULT_PVP_RANK_KEEP,
  DEFAULT_RAID_IV_KEEP,
  FAMILY_KEEP_MAX,
  FAMILY_KEEP_MIN,
  GL_LIST_CAP,
  isPokemonType,
  LC_LIST_CAP,
  POKEMON_TYPES,
  prettyPokemonType,
  prettySpeciesId,
  PVP_RANK_OF,
  RAID_IV_KEEP_MAX,
  RAID_IV_KEEP_MIN,
} from "./types";
import {
  dumpExecuteString,
  dumpPreviewString,
  dumpSearchPlan,
} from "./search";

function skipScanString(opts: { keepLucky?: boolean; keepFavorite?: boolean } = {}): string {
  const keepLucky = opts.keepLucky !== false;
  const keepFavorite = opts.keepFavorite !== false;
  return [
    "!shiny",
    "!legendary",
    "!mythical",
    "!ultrabeast",
    ...(keepLucky ? ["!lucky"] : []),
    "!costume",
    "!background",
    "!4*",
    "!dynamax",
    "!gigantamax",
    ...(keepFavorite ? ["!favorite"] : []),
    "!#",
  ].join("&");
}

const SKIP_SCAN = skipScanString();
const DUMP_LIST_MAX = 100;
const LIST_PAINT_MAX = 200;
const RANK_PRESETS = [50, 150, 500, 4096] as const;
const LIST_KEEP_PRESETS = [100, 200, 300, 500] as const;
const FAMILY_KEEP_PRESETS = [FAMILY_KEEP_MIN, 1, 2, 6, FAMILY_KEEP_MAX] as const;
const RAID_IV_PRESETS = [RAID_IV_KEEP_MIN, 80, 90, 95, RAID_IV_KEEP_MAX] as const;
const RANK_KEEP_KEY = "pogo-grader.pvpRankKeep";
const LIST_KEEP_KEY = "pogo-grader.pvpListKeep";
const FAMILY_KEEP_KEY = "pogo-grader.familyKeep";
const RAID_IV_KEEP_KEY = "pogo-grader.raidIvKeep";
const RAID_IV_KEEP_KEY_LEGACY = "pogo-grader.raidSpKeep";
const KEEP_ALL_GOOD_KEY = "pogo-grader.keepAllGood";
const KEEP_LUCKY_KEY = "pogo-grader.keepLucky";
const KEEP_FAVORITE_KEY = "pogo-grader.keepFavorite";
const KEEP_SHADOW_KEY = "pogo-grader.keepShadow";

type Tab = Verdict;
type RankingsTab = "gl" | "lc" | "raid";

interface Engine {
  parseInventoryCsv: (text: string) => ParseResult;
  gradeBox: (mons: ParseResult["mons"], meta: Meta) => GradeResult;
  loadMeta: () => Promise<Meta>;
}

interface AppState {
  tab: Tab;
  result: GradeResult | null;
  parse: ParseResult | null;
  fileName: string;
  error: string;
  busy: string;
  engine: Engine | null;
  meta: Meta | null;
  pvpRankKeep: number;
  pvpListKeep: number;
  familyKeep: number;
  raidIvKeep: number;
  keepAllGood: boolean;
  keepLucky: boolean;
  keepFavorite: boolean;
  keepShadow: boolean;
  rankingsTab: RankingsTab;
  rankingsFilter: string;
  rankingsRaidType: PokemonType | "";
}

function readStoredRankKeep(): number {
  try {
    const raw = localStorage.getItem(RANK_KEEP_KEY);
    if (raw == null || raw === "") return DEFAULT_PVP_RANK_KEEP;
    return clampPvpRankKeep(Number(raw));
  } catch {
    return DEFAULT_PVP_RANK_KEEP;
  }
}

function readStoredListKeep(): number {
  try {
    const raw = localStorage.getItem(LIST_KEEP_KEY);
    if (raw == null || raw === "") return DEFAULT_PVP_LIST_KEEP;
    return clampPvpListKeep(Number(raw));
  } catch {
    return DEFAULT_PVP_LIST_KEEP;
  }
}

function readStoredFamilyKeep(): number {
  try {
    const raw = localStorage.getItem(FAMILY_KEEP_KEY);
    if (raw == null || raw === "") return DEFAULT_FAMILY_KEEP;
    return clampFamilyKeep(Number(raw));
  } catch {
    return DEFAULT_FAMILY_KEEP;
  }
}

function readStoredRaidIvKeep(): number {
  try {
    const raw = localStorage.getItem(RAID_IV_KEEP_KEY) ?? localStorage.getItem(RAID_IV_KEEP_KEY_LEGACY);
    if (raw == null || raw === "") return DEFAULT_RAID_IV_KEEP;
    return clampRaidIvKeep(Number(raw));
  } catch {
    return DEFAULT_RAID_IV_KEEP;
  }
}

function readStoredKeepAllGood(): boolean {
  try {
    return localStorage.getItem(KEEP_ALL_GOOD_KEY) === "1";
  } catch {
    return false;
  }
}

function readStoredKeepLucky(): boolean {
  try {
    const raw = localStorage.getItem(KEEP_LUCKY_KEY);
    if (raw == null) return DEFAULT_KEEP_LUCKY;
    return raw !== "0";
  } catch {
    return DEFAULT_KEEP_LUCKY;
  }
}

function readStoredKeepFavorite(): boolean {
  try {
    const raw = localStorage.getItem(KEEP_FAVORITE_KEY);
    if (raw == null) return DEFAULT_KEEP_FAVORITE;
    return raw !== "0";
  } catch {
    return DEFAULT_KEEP_FAVORITE;
  }
}

function readStoredKeepShadow(): boolean {
  try {
    const raw = localStorage.getItem(KEEP_SHADOW_KEY);
    if (raw == null) return DEFAULT_KEEP_SHADOW;
    return raw !== "0";
  } catch {
    return DEFAULT_KEEP_SHADOW;
  }
}

const state: AppState = {
  tab: "DUMP",
  result: null,
  parse: null,
  fileName: "",
  error: "",
  busy: "",
  engine: null,
  meta: null,
  pvpRankKeep: readStoredRankKeep(),
  pvpListKeep: readStoredListKeep(),
  familyKeep: readStoredFamilyKeep(),
  raidIvKeep: readStoredRaidIvKeep(),
  keepAllGood: readStoredKeepAllGood(),
  keepLucky: readStoredKeepLucky(),
  keepFavorite: readStoredKeepFavorite(),
  keepShadow: readStoredKeepShadow(),
  rankingsTab: "gl",
  rankingsFilter: "",
  rankingsRaidType: "",
};

function errMsg(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function raidTypeFilterButtons(): string {
  const all = `<button type="button" class="type-chip type-chip--all is-active" data-raid-type="all" aria-pressed="true">All types</button>`;
  const types = POKEMON_TYPES.map(
    (type) =>
      `<button type="button" class="type-chip type-chip--${type}" data-raid-type="${type}" aria-pressed="false">${prettyPokemonType(type)}</button>`,
  ).join("");
  return `${all}${types}`;
}

function raidRowHasType(row: RaidAttackerRow, type: PokemonType): boolean {
  return row.types.includes(type) || Boolean(row.asTypes?.includes(type));
}

function typeChipMarkup(type: PokemonType): string {
  return `<span class="type-chip type-chip--tag type-chip--${type}">${prettyPokemonType(type)}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function markCopied(button: HTMLButtonElement): void {
  const prev = button.textContent;
  button.classList.add("is-copied");
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.classList.remove("is-copied");
    button.textContent = prev;
  }, 1400);
}

async function loadEngine(): Promise<Engine> {
  let parseMod: Record<string, unknown>;
  let gradeMod: Record<string, unknown>;
  let metaMod: Record<string, unknown>;
  try {
    // @ts-ignore csv agent owns parseCsv; runtime error is shown in the UI
    parseMod = (await import("./parseCsv")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not load parseCsv: ${errMsg(err)}`);
  }
  try {
    // @ts-ignore grade agent owns grade.ts
    gradeMod = (await import("./grade")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not load grade: ${errMsg(err)}`);
  }
  try {
    // @ts-ignore grade agent owns meta.ts
    metaMod = (await import("./meta")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not load meta: ${errMsg(err)}`);
  }

  const parseInventoryCsv = parseMod.parseInventoryCsv;
  const gradeBox = gradeMod.gradeBox;
  const loadMeta = metaMod.loadMeta;
  if (typeof parseInventoryCsv !== "function") {
    throw new Error("parseInventoryCsv is missing from parseCsv.");
  }
  if (typeof gradeBox !== "function") {
    throw new Error("gradeBox is missing from grade.");
  }
  if (typeof loadMeta !== "function") {
    throw new Error("loadMeta is missing from meta.");
  }

  return {
    parseInventoryCsv: parseInventoryCsv as Engine["parseInventoryCsv"],
    gradeBox: gradeBox as Engine["gradeBox"],
    loadMeta: loadMeta as Engine["loadMeta"],
  };
}

function formatIvs(mon: GradedMon["mon"]): string {
  const { atk, def, sta, ivPercent, ivUnique } = mon;
  if (atk != null && def != null && sta != null) {
    const star = ivUnique ? "" : " (not unique)";
    return `${atk}/${def}/${sta}${star}`;
  }
  if (ivPercent != null) return `${ivPercent}% IV`;
  return ivUnique ? "IVs known" : "IVs unknown";
}

function formatLeagueBits(
  kind: "GL" | "LC",
  metaRank: GradedMon["glMeta"],
  iv: GradedMon["gl"],
  asSpeciesId?: string,
): string {
  const as =
    asSpeciesId && asSpeciesId !== ""
      ? ` as ${prettySpeciesId(asSpeciesId)}`
      : "";
  if (metaRank && iv) {
    return `${kind}${as} #${metaRank.rank}/${metaRank.of} (${iv.rank}/${iv.of})`;
  }
  if (metaRank) return `${kind}${as} #${metaRank.rank}/${metaRank.of}`;
  if (iv) return `${kind}${as} ${iv.rank}/${iv.of}`;
  return "";
}

function formatRanks(item: GradedMon): string {
  const glRanks = item.glAs?.length ? item.glAs : item.gl ? [item.gl] : [];
  const glBits =
    glRanks.length > 0
      ? glRanks.map((iv) => {
          const metaRank =
            item.glMetaAs?.find((m) => m.speciesId === iv.evoSpeciesId) ??
            (item.glMeta?.speciesId === iv.evoSpeciesId ? item.glMeta : null);
          const as =
            iv.evoSpeciesId && iv.evoSpeciesId !== item.mon.speciesId ? iv.evoSpeciesId : "";
          return formatLeagueBits("GL", metaRank, iv, as);
        })
      : [formatLeagueBits("GL", item.glMeta, item.gl)];
  const raid = item.raidIv
    ? `Raid${item.raidIv.evoSpeciesId !== item.mon.speciesId ? ` as ${prettySpeciesId(item.raidIv.evoSpeciesId)}` : ""} ${item.raidIv.percent}% IV`
    : "";
  return [...glBits, formatLeagueBits("LC", item.lcMeta, item.lc), raid].filter(Boolean).join(" · ");
}

function reasonClass(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("dump-cap") || r.includes("dump cap")) return "chip chip--halt";
  if (r.includes("shiny")) return "chip chip--shiny";
  if (r.includes("lucky")) return "chip chip--lucky";
  if (r.includes("costume")) return "chip chip--costume";
  if (r.includes("background")) return "chip chip--background";
  if (r.includes("4*") || r.includes("hundo")) return "chip chip--hundo";
  if (r.includes("favorite")) return "chip chip--favorite";
  if (r.includes("special") || r.includes("legacy")) return "chip chip--special";
  if (r.includes("shadow")) return "chip chip--shadow";
  if (r.includes("dynamax") || r.includes("gigantamax")) return "chip chip--max";
  if (r.includes("legendary")) return "chip chip--legendary";
  if (r.includes("mythical")) return "chip chip--mythical";
  if (r.includes("raid attacker")) return "chip chip--raid";
  if (r.includes("% iv worse") || r.includes("raid iv unavailable")) return "chip chip--miss";
  if (r.includes("not gl/lc/raid")) return "chip chip--junk";
  if (r.includes("limited")) return "chip chip--limited";
  if (r.includes("great league") || r.includes("better as")) return "chip chip--gl";
  if (r.includes("little cup")) return "chip chip--lc";
  if (r.includes("rank unknown") || r.includes("ivs not unique") || r.includes("unavailable")) {
    return "chip chip--unknown";
  }
  if (r.includes("never dump") || r.includes("cannot dump")) return "chip chip--lock";
  if (r.includes("worse than keep")) return "chip chip--miss";
  if (r.includes("pvp/raid family")) return "chip chip--family";
  if (r.includes("useless for pvp") || r.includes("keep 0 per family")) return "chip chip--junk";
  if (r.includes("only copy") || r.includes("best junk")) return "chip chip--solo";
  if (r.includes("not gl/lc/raid")) return "chip chip--junk";
  if (
    r.includes("duplicate") ||
    r.includes("extra") ||
    r.includes("copies") ||
    r.includes("copy")
  ) {
    return "chip chip--dupe";
  }
  return "chip chip--loud";
}

function isNegativeReason(reason: string): boolean {
  const cls = reasonClass(reason);
  if (
    cls.includes("chip--miss") ||
    cls.includes("chip--dupe") ||
    cls.includes("chip--junk") ||
    cls.includes("chip--halt")
  ) {
    return true;
  }
  const r = reason.toLowerCase();
  return /^(gl|lc) rank unknown/.test(r);
}

function isBetterAsReason(reason: string): boolean {
  return reason.toLowerCase().includes("better as");
}

function reasonChips(reasons: string[], loud: boolean, hideNegative = false, hideBetterAs = false): string {
  const shown = reasons.filter((reason) => {
    if (hideNegative && isNegativeReason(reason)) return false;
    if (hideBetterAs && isBetterAsReason(reason)) return false;
    return true;
  });
  if (shown.length === 0) return "";
  const extra = loud ? " look-lead" : "";
  return `<div class="reasons${extra}">${shown
    .map((reason) => `<span class="${reasonClass(reason)}">${escapeHtml(reason)}</span>`)
    .join("")}</div>`;
}

function renderRow(item: GradedMon, verdict: Tab): string {
  const { mon, reasons, copiesInGroup, copyRankInGroup } = item;
  const crowd = copiesInGroup > 2;
  const flags = [
    mon.shadow ? "shadow" : "",
    mon.purified ? "purified" : "",
    mon.form && mon.form.toLowerCase() !== "normal" ? mon.form : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const nick = mon.nickname?.trim();
  const species = mon.speciesName || mon.speciesId;
  const title = nick || species;
  const speciesBit = nick && species && nick !== species ? species : "";
  const crowdBadge = crowd
    ? `<span class="badge-crowd" title="Family copy rank (best first). Rows stay in scan order (first scanned at top).">${copyRankInGroup}/${copiesInGroup}</span>`
    : "";
  const line = [speciesBit, `IVs ${formatIvs(mon)}`, flags, formatRanks(item)].filter(Boolean).join(" · ");

  return `<article class="row row--${verdict.toLowerCase()}${crowd ? " row--crowd" : ""}">
    <div class="row-top">
      <div class="species">${escapeHtml(title)}${crowdBadge}</div>
      <div class="cp">${mon.cp}</div>
    </div>
    <div class="meta">${escapeHtml(line)}</div>
    ${reasonChips(reasons, false, verdict === "KEEP", verdict === "DUMP")}
  </article>`;
}

function paintTrack(listEl: HTMLElement, rows: GradedMon[], verdict: Tab, cap: number): void {
  if (rows.length === 0) {
    listEl.innerHTML = `<p class="empty">None</p>`;
    return;
  }
  const shown = rows.slice(0, cap);
  const extra = rows.length - shown.length;
  listEl.innerHTML =
    shown.map((row) => renderRow(row, verdict)).join("") +
    (extra > 0 ? `<p class="list-more">${extra} more in scan order</p>` : "");
}

function pvpokeStatus(meta: Meta | null): string {
  if (!meta?.pvpokeSource || meta.pvpokeSource === "bundled") return "PvPoke bundled";
  const at = meta.pvpokeFetchedAt ?? 0;
  const hours = Math.max(0, Math.floor((Date.now() - at) / 3_600_000));
  const age = hours < 1 ? "<1h" : `${hours}h`;
  return meta.pvpokeSource === "live" ? "PvPoke live" : `PvPoke ${age}`;
}

function pickDefaultTab(result: GradeResult): Tab {
  if (result.dumpCapped) return "LOOK";
  if (result.dump.length > 0) return "DUMP";
  if (result.look.length > 0) return "LOOK";
  return "KEEP";
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app">
      <header class="app-header">
        <div>
          <h1>pogo-grader</h1>
          <p class="lede">Grade a Calcy / Poke Genie CSV into KEEP, LOOK, and DUMP. Stays on this device.</p>
        </div>
      </header>

      <div class="setup">
        <section class="card card--csv" aria-labelledby="csv-title">
          <h2 id="csv-title">CSV</h2>
          <label class="file-label" for="csv-file">Calcy IV or Poke Genie export</label>
          <input id="csv-file" type="file" accept=".csv,text/csv" />
          <p class="note">Not uploaded. Skip-scan KEEP museum first — Calcy often omits shiny.</p>
        </section>

        <section class="card card--skip" aria-labelledby="skip-title">
          <h2 id="skip-title">Skip-scan in GO</h2>
          <pre class="search-block" id="skip-scan">${escapeHtml(SKIP_SCAN)}</pre>
          <button type="button" class="btn btn--primary" data-copy="skip">Copy search</button>
          <p class="note">Hides KEEP museum so you scan the rest. Do not add <code>!shadow</code>. Fade Lucky or Favorite and those tags stay in this search.</p>
        </section>
      </div>

      <details class="card rankings-card">
        <summary class="rankings-head">
          <h2 id="rankings-title">Rankings</h2>
          <p class="note rankings-status" id="rankings-status">Loading lists…</p>
        </summary>
        <nav class="rankings-tabs" aria-label="Rankings lists">
          <button type="button" class="btn btn--preset" data-rankings-tab="gl">Great League</button>
          <button type="button" class="btn btn--preset" data-rankings-tab="lc">Little Cup</button>
          <button type="button" class="btn btn--preset" data-rankings-tab="raid">Raids</button>
        </nav>
        <div class="rankings-panes">
          <div class="rankings-pane is-active" data-rankings-pane="gl">
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--gl">Great League</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-gl">Filter</label>
              <input id="rankings-filter-gl" class="rankings-filter" type="search" placeholder="Species name or id" autocomplete="off" aria-label="Filter Great League rankings" data-rankings-filter />
            </div>
            <div id="rankings-gl" class="rankings-table-wrap"></div>
          </div>
          <div class="rankings-pane" data-rankings-pane="lc">
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--lc">Little Cup</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-lc">Filter</label>
              <input id="rankings-filter-lc" class="rankings-filter" type="search" placeholder="Species name or id" autocomplete="off" aria-label="Filter Little Cup rankings" data-rankings-filter />
            </div>
            <div id="rankings-lc" class="rankings-table-wrap"></div>
          </div>
          <div class="rankings-pane" data-rankings-pane="raid">
            <div class="rankings-pane-head">
              <h3 class="rankings-pane-title rankings-pane-title--raid" id="rankings-raid-title">Raid attackers</h3>
              <label class="file-label rankings-filter-label" for="rankings-filter-raid">Filter</label>
              <input id="rankings-filter-raid" class="rankings-filter" type="search" placeholder="Species, id, or tag" autocomplete="off" aria-label="Filter raid attackers" data-rankings-filter />
            </div>
            <nav class="rankings-types" aria-label="Filter raid attackers by type">${raidTypeFilterButtons()}</nav>
            <p class="note rankings-raid-note" id="rankings-raid-note">KEEP list the grader uses. Pre-evolutions count toward the same family cap unless a stage is independently listed. Not a DPS ranking.</p>
            <div id="rankings-raid" class="rankings-table-wrap"></div>
          </div>
        </div>
      </details>

      <div id="error" class="banner banner--error hidden" role="alert"></div>
      <p id="busy" class="status-line hidden"></p>

      <div id="results" class="hidden">
        <div class="status-bar">
          <p id="status" class="status-line"></p>
        </div>
        <ul id="issues" class="issues hidden"></ul>
        <p class="banner banner--lock">Favorite KEEP in GO first. This page never taps Transfer.</p>
        <div id="dump-cap" class="banner banner--warn hidden"></div>

        <section class="card dump-card" id="dump-card">
          <h2>DUMP in GO</h2>
          <div class="search-grid">
            <div>
              <p class="search-label">Search</p>
              <p class="note search-hint">Paste in GO to see DUMP. Tag those #DUMP.</p>
              <pre class="search-block" id="dump-preview"></pre>
              <button type="button" class="btn" data-copy="dump-preview">Copy search</button>
            </div>
            <div>
              <p class="search-label">Transfer</p>
              <p class="note search-hint">Paste after #DUMP. Locks KEEP (!favorite, !shiny…).</p>
              <pre class="search-block search-block--dump" id="dump-execute"></pre>
              <button type="button" class="btn btn--dump" data-copy="dump-execute">Copy transfer</button>
            </div>
          </div>
          <p class="note" id="dump-note"></p>
        </section>
      </div>

      <section class="card card--rules" aria-labelledby="rank-title">
        <h2 id="rank-title">KEEP rules</h2>
        <div class="rules-grid">
          <div class="rules-block rules-block--chips">
            <p class="file-label" id="keep-chips-label">KEEP tags</p>
            <div class="keep-chips" role="group" aria-labelledby="keep-chips-label">
              <button type="button" class="chip chip--lucky keep-chip" data-keep-chip="lucky" aria-pressed="true" title="KEEP luckies. Click to fade — luckies must earn KEEP another way.">Lucky</button>
              <button type="button" class="chip chip--favorite keep-chip" data-keep-chip="favorite" aria-pressed="true" title="KEEP starred copies. Click to fade — favorites LOOK, never dump.">Favorite</button>
              <button type="button" class="chip chip--shadow keep-chip" data-keep-chip="shadow" aria-pressed="true" title="KEEP every shadow. Click to fade — shadows LOOK, never dump.">Shadow</button>
            </div>
            <p class="note">Same colors as KEEP-table chips. Bright = that tag KEEPs. Fade Lucky to dump junk luckies. Fade Favorite or Shadow to LOOK them (never dump).</p>
          </div>
          <div class="rules-block">
            <div class="rank-row">
              <label class="file-label" for="rank-keep">KEEP PvP ≤</label>
              <input id="rank-keep" type="number" inputmode="numeric" min="1" max="${PVP_RANK_OF}" step="1" value="${state.pvpRankKeep}" />
              <span class="rank-suffix">/ ${PVP_RANK_OF}</span>
            </div>
            <div class="rank-presets" role="group" aria-label="KEEP PvP rank">
              ${RANK_PRESETS.map(
                (n) =>
                  `<button type="button" class="btn btn--preset" data-rank="${n}">${n === PVP_RANK_OF ? "any" : String(n)}</button>`,
              ).join("")}
            </div>
            <p class="note">IV floor among 4096 Great League / Little Cup spreads.</p>
          </div>
          <div class="rules-block">
            <div class="rank-row">
              <label class="file-label" for="pvp-list-keep">PvPoke GL top</label>
              <input id="pvp-list-keep" type="number" inputmode="numeric" min="1" max="${GL_LIST_CAP}" step="1" value="${state.pvpListKeep}" />
              <span class="rank-suffix">/ ${GL_LIST_CAP}</span>
            </div>
            <div class="rank-presets" role="group" aria-label="PvPoke GL species cutoff">
              ${LIST_KEEP_PRESETS.map(
                (n) =>
                  `<button type="button" class="btn btn--preset" data-list-keep="${n}">${n}</button>`,
              ).join("")}
            </div>
            <p class="note">Only species this high on PvPoke Great League overall count as PvP. Little Cup stays top ${LC_LIST_CAP}.</p>
          </div>
          <div class="rules-block">
            <div class="rank-row">
              <label class="file-label" for="family-keep">Keep</label>
              <input id="family-keep" type="number" inputmode="numeric" min="${FAMILY_KEEP_MIN}" max="${FAMILY_KEEP_MAX}" step="1" value="${state.familyKeep}" />
              <span class="rank-suffix">per family</span>
            </div>
            <div class="rank-presets" role="group" aria-label="Keep copies per family">
              ${FAMILY_KEEP_PRESETS.map(
                (n) =>
                  `<button type="button" class="btn btn--preset" data-family-keep="${n}">${n === FAMILY_KEEP_MAX ? "all" : String(n)}</button>`,
              ).join("")}
            </div>
            <p class="note">PvP/raid species with no KEEP: LOOK the best this many, DUMP extras. 0 DUMPs anything useless for PvP and raids.</p>
          </div>
          <div class="rules-block">
            <div class="rank-row">
              <label class="file-label" for="raid-iv-keep">KEEP raid ≥</label>
              <input id="raid-iv-keep" type="number" inputmode="numeric" min="${RAID_IV_KEEP_MIN}" max="${RAID_IV_KEEP_MAX}" step="1" value="${state.raidIvKeep}" />
              <span class="rank-suffix">% IV</span>
            </div>
            <div class="rank-presets" role="group" aria-label="KEEP raid IV percent">
              ${RAID_IV_PRESETS.map(
                (n) =>
                  `<button type="button" class="btn btn--preset" data-raid-iv="${n}">${n === RAID_IV_KEEP_MIN ? "any" : String(n)}</button>`,
              ).join("")}
            </div>
            <p class="note">Raid copies need this IV% (Atk+Def+Sta out of 45). 0 keeps any IV.</p>
          </div>
          <div class="rules-block">
            <div class="mode-row" role="group" aria-label="DUMP extras">
              <button type="button" class="btn btn--preset" data-keep-all="0">DUMP extras</button>
              <button type="button" class="btn btn--preset" data-keep-all="1">KEEP all good</button>
            </div>
            <p class="note">KEEP all good keeps every 4* / raid / PvP-floor copy. DUMP extras still never dumps shadows.</p>
          </div>
        </div>
      </section>

      <div id="grade-tables" class="hidden">
        <nav class="tabs" aria-label="Grade piles">
          <button type="button" class="tab" data-tab="KEEP">KEEP <span class="count" id="count-keep-tab">0</span></button>
          <button type="button" class="tab" data-tab="LOOK">LOOK <span class="count" id="count-look-tab">0</span></button>
          <button type="button" class="tab" data-tab="DUMP">DUMP <span class="count" id="count-dump-tab">0</span></button>
        </nav>

        <div class="tracks">
          <section class="track track--keep" data-track="KEEP">
            <header class="track-head">KEEP <span class="count" id="count-keep">0</span></header>
            <div id="list-keep" class="list"></div>
          </section>
          <section class="track track--look" data-track="LOOK">
            <header class="track-head">LOOK <span class="count" id="count-look">0</span></header>
            <div id="list-look" class="list"></div>
          </section>
          <section class="track track--dump" data-track="DUMP">
            <header class="track-head">DUMP <span class="count" id="count-dump">0</span></header>
            <div id="list-dump" class="list"></div>
          </section>
        </div>
      </div>
    </div>
  `;

  const errorEl = root.querySelector("#error") as HTMLElement;
  const busyEl = root.querySelector("#busy") as HTMLElement;
  const resultsEl = root.querySelector("#results") as HTMLElement;
  const gradeTablesEl = root.querySelector("#grade-tables") as HTMLElement;
  const statusEl = root.querySelector("#status") as HTMLElement;
  const issuesEl = root.querySelector("#issues") as HTMLElement;
  const dumpCapEl = root.querySelector("#dump-cap") as HTMLElement;
  const dumpPreviewEl = root.querySelector("#dump-preview") as HTMLElement;
  const dumpExecuteEl = root.querySelector("#dump-execute") as HTMLElement;
  const dumpNoteEl = root.querySelector("#dump-note") as HTMLElement;
  const listKeepEl = root.querySelector("#list-keep") as HTMLElement;
  const listLookEl = root.querySelector("#list-look") as HTMLElement;
  const listDumpEl = root.querySelector("#list-dump") as HTMLElement;
  const fileInput = root.querySelector("#csv-file") as HTMLInputElement;
  const rankInput = root.querySelector("#rank-keep") as HTMLInputElement;
  const listKeepInput = root.querySelector("#pvp-list-keep") as HTMLInputElement;
  const familyKeepInput = root.querySelector("#family-keep") as HTMLInputElement;
  const raidIvKeepInput = root.querySelector("#raid-iv-keep") as HTMLInputElement;
  const skipScanEl = root.querySelector("#skip-scan") as HTMLElement;
  const rankingsStatusEl = root.querySelector("#rankings-status") as HTMLElement;
  const rankingsGlEl = root.querySelector("#rankings-gl") as HTMLElement;
  const rankingsLcEl = root.querySelector("#rankings-lc") as HTMLElement;
  const rankingsRaidEl = root.querySelector("#rankings-raid") as HTMLElement;
  const rankingsRaidTitleEl = root.querySelector("#rankings-raid-title") as HTMLElement;
  const rankingsRaidNoteEl = root.querySelector("#rankings-raid-note") as HTMLElement;
  const rankingsFilterInputs = [
    ...root.querySelectorAll("[data-rankings-filter]"),
  ] as HTMLInputElement[];

  function gradeKnobs(meta: Meta): Meta {
    return {
      ...meta,
      pvpRankKeep: state.pvpRankKeep,
      pvpListKeep: state.pvpListKeep,
      familyKeep: state.familyKeep,
      raidIvKeep: state.raidIvKeep,
      keepAllGood: state.keepAllGood,
      keepLucky: state.keepLucky,
      keepFavorite: state.keepFavorite,
      keepShadow: state.keepShadow,
    };
  }

  function persistRankKeep(n: number): void {
    try {
      localStorage.setItem(RANK_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistListKeep(n: number): void {
    try {
      localStorage.setItem(LIST_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistFamilyKeep(n: number): void {
    try {
      localStorage.setItem(FAMILY_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistRaidIvKeep(n: number): void {
    try {
      localStorage.setItem(RAID_IV_KEEP_KEY, String(n));
    } catch {
      /* private mode */
    }
  }

  function persistKeepAllGood(on: boolean): void {
    try {
      localStorage.setItem(KEEP_ALL_GOOD_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistKeepLucky(on: boolean): void {
    try {
      localStorage.setItem(KEEP_LUCKY_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistKeepFavorite(on: boolean): void {
    try {
      localStorage.setItem(KEEP_FAVORITE_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function persistKeepShadow(on: boolean): void {
    try {
      localStorage.setItem(KEEP_SHADOW_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function paintRankControls(): void {
    rankInput.value = String(state.pvpRankKeep);
    listKeepInput.value = String(state.pvpListKeep);
    familyKeepInput.value = String(state.familyKeep);
    raidIvKeepInput.value = String(state.raidIvKeep);
    root.querySelectorAll("[data-rank]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-rank"));
      btn.classList.toggle("is-active", n === state.pvpRankKeep);
    });
    root.querySelectorAll("[data-list-keep]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-list-keep"));
      btn.classList.toggle("is-active", n === state.pvpListKeep);
    });
    root.querySelectorAll("[data-family-keep]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-family-keep"));
      btn.classList.toggle("is-active", n === state.familyKeep);
    });
    root.querySelectorAll("[data-raid-iv]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-raid-iv"));
      btn.classList.toggle("is-active", n === state.raidIvKeep);
    });
    root.querySelectorAll("[data-keep-all]").forEach((btn) => {
      const on = btn.getAttribute("data-keep-all") === "1";
      btn.classList.toggle("is-active", on === state.keepAllGood);
    });
    root.querySelectorAll("[data-keep-chip]").forEach((btn) => {
      const chip = btn.getAttribute("data-keep-chip");
      const on =
        chip === "lucky"
          ? state.keepLucky
          : chip === "favorite"
            ? state.keepFavorite
            : chip === "shadow"
              ? state.keepShadow
              : true;
      btn.classList.toggle("is-off", !on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    skipScanEl.textContent = skipScanString({
      keepLucky: state.keepLucky,
      keepFavorite: state.keepFavorite,
    });
    rankingsFilterInputs.forEach((input) => {
      if (input.value !== state.rankingsFilter) input.value = state.rankingsFilter;
    });
    root.querySelectorAll("[data-rankings-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-rankings-tab") === state.rankingsTab);
    });
    root.querySelectorAll("[data-rankings-pane]").forEach((pane) => {
      pane.classList.toggle("is-active", pane.getAttribute("data-rankings-pane") === state.rankingsTab);
    });
    root.querySelectorAll("[data-raid-type]").forEach((btn) => {
      const value = (btn as HTMLElement).dataset.raidType ?? "";
      const on = value === "all" ? !state.rankingsRaidType : value === state.rankingsRaidType;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintRankings();
  }

  function rankingMatches(
    row: {
      speciesId: string;
      speciesName: string;
      tags?: string[];
      asSpeciesId?: string;
      asSpeciesName?: string;
      types?: string[];
      asTypes?: string[];
    },
    q: string,
  ): boolean {
    if (!q) return true;
    if (
      row.speciesName.toLowerCase().includes(q) ||
      row.speciesId.includes(q) ||
      prettySpeciesId(row.speciesId).toLowerCase().includes(q)
    ) {
      return true;
    }
    if (row.asSpeciesId?.includes(q) || row.asSpeciesName?.toLowerCase().includes(q)) return true;
    if (row.types?.some((type) => type.includes(q))) return true;
    if (row.asTypes?.some((type) => type.includes(q))) return true;
    return Boolean(row.tags?.some((tag) => tag.toLowerCase().includes(q)));
  }

  function raidTagClass(tag: string): string {
    if (tag === "Shadow") return "chip chip--shadow";
    if (tag === "Mega") return "chip chip--max";
    if (tag === "Primal") return "chip chip--raid";
    if (tag === "Legendary") return "chip chip--legendary";
    if (tag === "Mythical") return "chip chip--mythical";
    if (tag === "Limited") return "chip chip--limited";
    return "chip";
  }

  function renderRankingTable(
    rows: PvpokeRankRow[] | undefined,
    cutoff: number | null,
    empty: string,
  ): string {
    if (!rows || rows.length === 0) {
      return `<p class="empty">${escapeHtml(empty)}</p>`;
    }
    const q = state.rankingsFilter.trim().toLowerCase();
    const shown = rows.filter((row) => rankingMatches(row, q));
    if (shown.length === 0) {
      return `<p class="empty">No species match “${escapeHtml(state.rankingsFilter.trim())}”</p>`;
    }
    const hasScore = shown.some((row) => row.score != null);
    const body = shown
      .map((row) => {
        const cut = cutoff != null && row.rank > cutoff;
        const name = row.speciesName || prettySpeciesId(row.speciesId);
        const score =
          hasScore && row.score != null ? row.score.toFixed(1) : hasScore ? "—" : "";
        return `<tr class="${cut ? "is-cut" : ""}">
          <td class="rankings-num">${row.rank}</td>
          <td>${escapeHtml(name)}</td>
          ${hasScore ? `<td class="rankings-num">${score}</td>` : ""}
        </tr>`;
      })
      .join("");
    return `<table class="rankings-table">
      <thead><tr><th>#</th><th>Species</th>${hasScore ? "<th>Score</th>" : ""}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function renderRaidTable(rows: RaidAttackerRow[] | undefined, empty: string): string {
    if (!rows || rows.length === 0) {
      return `<p class="empty">${escapeHtml(empty)}</p>`;
    }
    const type = state.rankingsRaidType;
    const typed = type ? rows.filter((row) => raidRowHasType(row, type)) : rows;
    const q = state.rankingsFilter.trim().toLowerCase();
    const shown = typed.filter((row) => rankingMatches(row, q));
    if (shown.length === 0) {
      const typeLabel = type ? prettyPokemonType(type) : "";
      if (q) {
        const inType = typeLabel ? ` in ${typeLabel}` : "";
        return `<p class="empty">No species match “${escapeHtml(state.rankingsFilter.trim())}”${inType}</p>`;
      }
      return `<p class="empty">No ${escapeHtml(typeLabel || "raid")} KEEP attackers</p>`;
    }
    const body = shown
      .map((row) => {
        const chips = [
          ...row.types.map((pokeType) => typeChipMarkup(pokeType)),
          ...row.tags.map((tag) => `<span class="${raidTagClass(tag)}">${escapeHtml(tag)}</span>`),
        ];
        if (row.asSpeciesName) {
          chips.push(`<span class="chip chip--raid">as ${escapeHtml(row.asSpeciesName)}</span>`);
        }
        const tags = chips.length === 0 ? "" : `<div class="rankings-tags">${chips.join("")}</div>`;
        return `<tr>
          <td>${escapeHtml(row.speciesName)}</td>
          <td>${tags}</td>
        </tr>`;
      })
      .join("");
    return `<table class="rankings-table">
      <thead><tr><th>Species</th><th>Types / tags</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function paintRankings(): void {
    const meta = state.meta;
    if (!meta) {
      rankingsStatusEl.textContent = "Loading lists…";
      rankingsGlEl.innerHTML = `<p class="empty">Waiting for PvPoke lists</p>`;
      rankingsLcEl.innerHTML = `<p class="empty">Waiting for PvPoke lists</p>`;
      rankingsRaidEl.innerHTML = `<p class="empty">Waiting for raid list</p>`;
      return;
    }
    const gl = meta.glRankings ?? [];
    const lc = meta.lcRankings ?? [];
    const raid = meta.raidRankings ?? [];
    const raidFinals = raid.filter((row) => !row.asSpeciesId).length;
    const raidPre = raid.length - raidFinals;
    const glIn = gl.filter((row) => row.rank <= state.pvpListKeep).length;
    const raidType = state.rankingsRaidType;
    const raidTypeLabel = raidType ? prettyPokemonType(raidType) : "";
    const raidTyped = raidType ? raid.filter((row) => raidRowHasType(row, raidType)).length : 0;
    const typeStatus = raidType ? ` · ${raidTyped} ${raidTypeLabel}` : "";
    rankingsStatusEl.textContent = `${pvpokeStatus(meta)} · GL ${glIn}/${gl.length || GL_LIST_CAP} in play · LC top ${lc.length || LC_LIST_CAP} · ${raidFinals} raid attackers · ${raidPre} pre-evos${typeStatus}`;
    rankingsRaidTitleEl.textContent = raidType ? `${raidTypeLabel} raid attackers` : "Raid attackers";
    rankingsRaidNoteEl.textContent = raidType
      ? `${raidTypeLabel}-type KEEP attackers, including pre-evos that become ${raidTypeLabel}. Not a DPS ranking.`
      : "KEEP list the grader uses. Pre-evolutions count toward the same family cap unless a stage is independently listed. Not a DPS ranking.";
    rankingsGlEl.innerHTML = renderRankingTable(
      gl,
      state.pvpListKeep,
      "Great League list missing",
    );
    rankingsLcEl.innerHTML = renderRankingTable(lc, null, "Little Cup list missing");
    rankingsRaidEl.innerHTML = renderRaidTable(raid, "Raid attacker list missing");
  }

  function showError(message: string): void {
    state.error = message;
    errorEl.textContent = message;
    errorEl.classList.toggle("hidden", !message);
  }

  function showBusy(message: string): void {
    state.busy = message;
    busyEl.textContent = message;
    busyEl.classList.toggle("hidden", !message);
  }

  function paintList(): void {
    const result = state.result;
    if (!result) return;
    root.querySelectorAll(".tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === state.tab);
    });
    root.querySelectorAll(".track").forEach((track) => {
      track.classList.toggle("is-active", track.getAttribute("data-track") === state.tab);
    });
    paintTrack(listKeepEl, result.keep, "KEEP", LIST_PAINT_MAX);
    paintTrack(listLookEl, result.look, "LOOK", LIST_PAINT_MAX);
    paintTrack(listDumpEl, result.dump, "DUMP", DUMP_LIST_MAX);
  }

  function paintResults(): void {
    const result = state.result;
    const parse = state.parse;
    if (!result || !parse) {
      resultsEl.classList.add("hidden");
      gradeTablesEl.classList.add("hidden");
      return;
    }
    resultsEl.classList.remove("hidden");
    gradeTablesEl.classList.remove("hidden");
    statusEl.textContent = `${state.fileName} · ${parse.dialect} · ${parse.mons.length} scanned · KEEP PvP ≤${result.pvpRankKeep}/${PVP_RANK_OF} · PvPoke GL top ${result.pvpListKeep}/${GL_LIST_CAP} · Keep ${result.familyKeep}/family · KEEP raid ≥${result.raidIvKeep}% IV · ${result.keepAllGood ? "KEEP all good" : "DUMP extras"} · ${result.keepLucky ? "KEEP lucky" : "Lucky off"} · ${result.keepFavorite ? "KEEP favorite" : "LOOK favorite"} · ${result.keepShadow ? "KEEP shadow" : "LOOK shadow"} · ${pvpokeStatus(state.meta)}`;
    const counts: Array<[string, number]> = [
      ["keep", result.keep.length],
      ["look", result.look.length],
      ["dump", result.dump.length],
    ];
    for (const [id, n] of counts) {
      const main = root.querySelector(`#count-${id}`) as HTMLElement | null;
      const tab = root.querySelector(`#count-${id}-tab`) as HTMLElement | null;
      if (main) main.textContent = String(n);
      if (tab) tab.textContent = String(n);
    }

    if (parse.issues.length > 0) {
      issuesEl.classList.remove("hidden");
      issuesEl.innerHTML = parse.issues
        .slice(0, 12)
        .map((issue) => `<li>Row ${issue.row}: ${escapeHtml(issue.message)}</li>`)
        .join("");
      if (parse.issues.length > 12) {
        issuesEl.insertAdjacentHTML(
          "beforeend",
          `<li>…and ${parse.issues.length - 12} more parse notes</li>`,
        );
      }
    } else {
      issuesEl.classList.add("hidden");
      issuesEl.innerHTML = "";
    }

    if (result.dumpCapped) {
      dumpCapEl.classList.remove("hidden");
      dumpCapEl.innerHTML = `<p><strong>DUMP cap ${result.dumpCap}.</strong> Later candy moved to LOOK (dump-cap). Stop Transfer and read LOOK.</p>`;
    } else {
      dumpCapEl.classList.add("hidden");
      dumpCapEl.textContent = "";
    }

    const dumpMons = result.dump.map((row) => row.mon);
    const plan = dumpSearchPlan(dumpMons, { keepLucky: state.keepLucky });
    dumpPreviewEl.textContent = plan.preview;
    dumpExecuteEl.textContent = plan.execute;
    dumpNoteEl.textContent = plan.instruction;
    paintList();
  }

  async function gradeFile(file: File): Promise<void> {
    showError("");
    showBusy("Reading CSV on this device…");
    resultsEl.classList.add("hidden");
    gradeTablesEl.classList.add("hidden");

    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsText(file);
    });

    let engine: Engine;
    try {
      engine = await loadEngine();
    } catch (err) {
      showBusy("");
      showError(errMsg(err));
      return;
    }

    let parsed: ParseResult;
    try {
      showBusy("Parsing inventory…");
      parsed = engine.parseInventoryCsv(text);
    } catch (err) {
      showBusy("");
      showError(`CSV parse failed: ${errMsg(err)}`);
      return;
    }

    let meta: Meta;
    try {
      showBusy("Loading meta gates…");
      meta = await engine.loadMeta();
    } catch (err) {
      showBusy("");
      showError(`loadMeta failed: ${errMsg(err)}`);
      return;
    }

    let graded: GradeResult;
    try {
      showBusy("Grading box…");
      graded = engine.gradeBox(parsed.mons, gradeKnobs(meta));
    } catch (err) {
      showBusy("");
      showError(`gradeBox failed: ${errMsg(err)}`);
      return;
    }

    state.engine = engine;
    state.meta = meta;
    state.parse = parsed;
    state.result = graded;
    state.fileName = file.name;
    state.tab = pickDefaultTab(graded);
    showBusy("");
    paintRankings();
    paintResults();
  }

  function regradeLive(): void {
    const parsed = state.parse;
    const engine = state.engine;
    const meta = state.meta;
    if (!parsed || !engine || !meta) return;
    try {
      state.result = engine.gradeBox(parsed.mons, gradeKnobs(meta));
      paintResults();
    } catch (err) {
      showError(`gradeBox failed: ${errMsg(err)}`);
    }
  }

  function applyRankKeep(raw: unknown): void {
    const next = clampPvpRankKeep(raw);
    state.pvpRankKeep = next;
    persistRankKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyListKeep(raw: unknown): void {
    const next = clampPvpListKeep(raw);
    state.pvpListKeep = next;
    persistListKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyFamilyKeep(raw: unknown): void {
    const next = clampFamilyKeep(raw);
    state.familyKeep = next;
    persistFamilyKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyRaidIvKeep(raw: unknown): void {
    const next = clampRaidIvKeep(raw);
    state.raidIvKeep = next;
    persistRaidIvKeep(next);
    paintRankControls();
    regradeLive();
  }

  function applyKeepAllGood(on: boolean): void {
    state.keepAllGood = on;
    persistKeepAllGood(on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepLucky(on: boolean): void {
    state.keepLucky = on;
    persistKeepLucky(on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepFavorite(on: boolean): void {
    state.keepFavorite = on;
    persistKeepFavorite(on);
    paintRankControls();
    regradeLive();
  }

  function applyKeepShadow(on: boolean): void {
    state.keepShadow = on;
    persistKeepShadow(on);
    paintRankControls();
    regradeLive();
  }

  paintRankControls();

  rankInput.addEventListener("change", () => {
    applyRankKeep(rankInput.value);
  });
  rankInput.addEventListener("blur", () => {
    applyRankKeep(rankInput.value);
  });
  listKeepInput.addEventListener("change", () => {
    applyListKeep(listKeepInput.value);
  });
  listKeepInput.addEventListener("blur", () => {
    applyListKeep(listKeepInput.value);
  });
  familyKeepInput.addEventListener("change", () => {
    applyFamilyKeep(familyKeepInput.value);
  });
  familyKeepInput.addEventListener("blur", () => {
    applyFamilyKeep(familyKeepInput.value);
  });
  raidIvKeepInput.addEventListener("change", () => {
    applyRaidIvKeep(raidIvKeepInput.value);
  });
  raidIvKeepInput.addEventListener("blur", () => {
    applyRaidIvKeep(raidIvKeepInput.value);
  });
  rankingsFilterInputs.forEach((input) => {
    input.addEventListener("input", () => {
      state.rankingsFilter = input.value;
      rankingsFilterInputs.forEach((other) => {
        if (other !== input) other.value = input.value;
      });
      paintRankings();
    });
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void gradeFile(file).catch((err) => {
      showBusy("");
      showError(errMsg(err));
    });
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const rankBtn = target.closest("[data-rank]") as HTMLElement | null;
    if (rankBtn?.dataset.rank) {
      applyRankKeep(rankBtn.dataset.rank);
      return;
    }

    const listKeepBtn = target.closest("[data-list-keep]") as HTMLElement | null;
    if (listKeepBtn?.dataset.listKeep) {
      applyListKeep(listKeepBtn.dataset.listKeep);
      return;
    }

    const rankingsTabBtn = target.closest("[data-rankings-tab]") as HTMLElement | null;
    if (
      rankingsTabBtn?.dataset.rankingsTab === "gl" ||
      rankingsTabBtn?.dataset.rankingsTab === "lc" ||
      rankingsTabBtn?.dataset.rankingsTab === "raid"
    ) {
      state.rankingsTab = rankingsTabBtn.dataset.rankingsTab;
      paintRankControls();
      return;
    }

    const raidTypeBtn = target.closest("[data-raid-type]") as HTMLElement | null;
    if (raidTypeBtn?.dataset.raidType != null) {
      const next = raidTypeBtn.dataset.raidType;
      if (next === "all") state.rankingsRaidType = "";
      else if (isPokemonType(next)) {
        state.rankingsRaidType = state.rankingsRaidType === next ? "" : next;
      }
      paintRankControls();
      return;
    }

    const familyKeepBtn = target.closest("[data-family-keep]") as HTMLElement | null;
    if (familyKeepBtn?.dataset.familyKeep) {
      applyFamilyKeep(familyKeepBtn.dataset.familyKeep);
      return;
    }

    const raidIvBtn = target.closest("[data-raid-iv]") as HTMLElement | null;
    if (raidIvBtn?.dataset.raidIv) {
      applyRaidIvKeep(raidIvBtn.dataset.raidIv);
      return;
    }

    const keepAllBtn = target.closest("[data-keep-all]") as HTMLElement | null;
    if (keepAllBtn?.dataset.keepAll != null) {
      applyKeepAllGood(keepAllBtn.dataset.keepAll === "1");
      return;
    }

    const keepChipBtn = target.closest("[data-keep-chip]") as HTMLElement | null;
    if (keepChipBtn?.dataset.keepChip === "lucky") {
      applyKeepLucky(!state.keepLucky);
      return;
    }
    if (keepChipBtn?.dataset.keepChip === "favorite") {
      applyKeepFavorite(!state.keepFavorite);
      return;
    }
    if (keepChipBtn?.dataset.keepChip === "shadow") {
      applyKeepShadow(!state.keepShadow);
      return;
    }

    const tabBtn = target.closest("[data-tab]") as HTMLElement | null;
    if (tabBtn?.dataset.tab && state.result) {
      const next = tabBtn.dataset.tab as Tab;
      if (next === "KEEP" || next === "LOOK" || next === "DUMP") {
        state.tab = next;
        paintList();
      }
      return;
    }

    const copyBtn = target.closest("[data-copy]") as HTMLButtonElement | null;
    if (!copyBtn) return;
    const kind = copyBtn.dataset.copy;
    const dumpMons = state.result?.dump.map((row) => row.mon) ?? [];
    const dumpOpts = { keepLucky: state.keepLucky };
    let payload = "";
    if (kind === "skip") payload = skipScanString({ keepLucky: state.keepLucky, keepFavorite: state.keepFavorite });
    else if (kind === "dump-preview") payload = dumpPreviewString(dumpMons, dumpOpts);
    else if (kind === "dump-execute") payload = dumpExecuteString(dumpMons, dumpOpts);
    if (!payload) return;
    void copyText(payload).then((ok) => {
      if (ok) markCopied(copyBtn);
      else showError("Copy failed — select the search text manually.");
    });
  });

  void loadEngine()
    .then((engine) => engine.loadMeta())
    .then((fresh) => {
      state.meta = fresh;
      paintRankControls();
      if (state.parse) regradeLive();
    })
    .catch(() => {
      rankingsStatusEl.textContent = "Bundled lists load on grade";
    });
}
