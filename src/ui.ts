import type { GradeResult, GradedMon, Meta, ParseResult, Verdict } from "./types";
import { clampPvpRankKeep, DEFAULT_PVP_RANK_KEEP, PVP_RANK_OF } from "./types";
import {
  dumpExecuteString,
  dumpPreviewString,
  dumpSearchPlan,
} from "./search";

const SKIP_SCAN =
  "!shiny&!legendary&!mythical&!ultrabeast&!lucky&!costume&!background&!4*&!dynamax&!gigantamax&!favorite";

const DUMP_LIST_MAX = 100;
const LIST_PAINT_MAX = 200;
const RANK_PRESETS = [50, 150, 500, 4096] as const;
const RANK_KEEP_KEY = "pogo-grader.pvpRankKeep";
const KEEP_ALL_GOOD_KEY = "pogo-grader.keepAllGood";

type Tab = Verdict;

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
  keepAllGood: boolean;
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

function readStoredKeepAllGood(): boolean {
  try {
    return localStorage.getItem(KEEP_ALL_GOOD_KEY) === "1";
  } catch {
    return false;
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
  keepAllGood: readStoredKeepAllGood(),
};

function errMsg(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
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

function formatRanks(item: GradedMon): string {
  const bits: string[] = [];
  if (item.gl) bits.push(`GL ${item.gl.rank}/${item.gl.of}`);
  if (item.lc) bits.push(`LC ${item.lc.rank}/${item.lc.of}`);
  return bits.join(" · ");
}

function reasonClass(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("dump-cap") || r.includes("dump cap")) return "chip chip--halt";
  if (r.includes("worse than keep") || r.includes("rank unknown")) return "chip chip--halt";
  if (r.includes("shadow")) return "chip chip--shadow";
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

function reasonChips(reasons: string[], loud: boolean): string {
  if (reasons.length === 0) return "";
  const extra = loud ? " look-lead" : "";
  return `<div class="reasons${extra}">${reasons
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
  const crowdBadge = crowd
    ? `<span class="badge-crowd">${copyRankInGroup}/${copiesInGroup}</span>`
    : "";
  const line = [`IVs ${formatIvs(mon)}`, flags, formatRanks(item)].filter(Boolean).join(" · ");

  return `<article class="row row--${verdict.toLowerCase()}${crowd ? " row--crowd" : ""}">
    <div class="row-top">
      <div class="species">${escapeHtml(mon.speciesName || mon.speciesId)}${crowdBadge}</div>
      <div class="cp">${mon.cp}</div>
    </div>
    <div class="meta">${escapeHtml(line)}</div>
    ${reasonChips(reasons, false)}
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
    (extra > 0 ? `<p class="list-more">${extra} more in CSV order</p>` : "");
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
        <section class="card" aria-labelledby="csv-title">
          <h2 id="csv-title">CSV</h2>
          <label class="file-label" for="csv-file">Calcy IV or Poke Genie export</label>
          <input id="csv-file" type="file" accept=".csv,text/csv" />
          <p class="note">Not uploaded. Skip-scan KEEP museum first — Calcy often omits shiny.</p>
        </section>

        <section class="card" aria-labelledby="rank-title">
          <h2 id="rank-title">KEEP rules</h2>
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
          <div class="mode-row" role="group" aria-label="DUMP extras">
            <button type="button" class="btn btn--preset" data-keep-all="0">DUMP extras</button>
            <button type="button" class="btn btn--preset" data-keep-all="1">KEEP all good</button>
          </div>
        </section>

        <section class="card" aria-labelledby="skip-title">
          <h2 id="skip-title">Skip-scan in GO</h2>
          <pre class="search-block" id="skip-scan">${escapeHtml(SKIP_SCAN)}</pre>
          <button type="button" class="btn btn--primary" data-copy="skip">Copy search</button>
          <p class="note">Hides KEEP museum so you scan the rest. Do not add <code>!shadow</code>.</p>
        </section>
      </div>

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

  function gradeKnobs(meta: Meta): Meta {
    return {
      ...meta,
      pvpRankKeep: state.pvpRankKeep,
      keepAllGood: state.keepAllGood,
    };
  }

  function persistRankKeep(n: number): void {
    try {
      localStorage.setItem(RANK_KEEP_KEY, String(n));
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

  function paintRankControls(): void {
    rankInput.value = String(state.pvpRankKeep);
    root.querySelectorAll("[data-rank]").forEach((btn) => {
      const n = Number(btn.getAttribute("data-rank"));
      btn.classList.toggle("is-active", n === state.pvpRankKeep);
    });
    root.querySelectorAll("[data-keep-all]").forEach((btn) => {
      const on = btn.getAttribute("data-keep-all") === "1";
      btn.classList.toggle("is-active", on === state.keepAllGood);
    });
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
      return;
    }
    resultsEl.classList.remove("hidden");
    statusEl.textContent = `${state.fileName} · ${parse.dialect} · ${parse.mons.length} scanned · KEEP PvP ≤${result.pvpRankKeep}/${PVP_RANK_OF} · ${result.keepAllGood ? "KEEP all good" : "DUMP extras"} · ${pvpokeStatus(state.meta)}`;
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
    const plan = dumpSearchPlan(dumpMons);
    dumpPreviewEl.textContent = plan.preview;
    dumpExecuteEl.textContent = plan.execute;
    dumpNoteEl.textContent = plan.instruction;
    paintList();
  }

  async function gradeFile(file: File): Promise<void> {
    showError("");
    showBusy("Reading CSV on this device…");
    resultsEl.classList.add("hidden");

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

  function applyKeepAllGood(on: boolean): void {
    state.keepAllGood = on;
    persistKeepAllGood(on);
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

    const keepAllBtn = target.closest("[data-keep-all]") as HTMLElement | null;
    if (keepAllBtn?.dataset.keepAll != null) {
      applyKeepAllGood(keepAllBtn.dataset.keepAll === "1");
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
    let payload = "";
    if (kind === "skip") payload = SKIP_SCAN;
    else if (kind === "dump-preview") payload = dumpPreviewString(dumpMons);
    else if (kind === "dump-execute") payload = dumpExecuteString(dumpMons);
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
      if (state.parse) regradeLive();
    })
    .catch(() => {
      /* bundled lists load on grade */
    });
}
