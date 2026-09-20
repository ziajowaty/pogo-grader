# pogo-grader

Browser grader for a **wide-minmax** Pokémon GO player (raids + Great League + Little Cup).
Not an overlay. Not a game client. CalcyIV / Poke Genie scan; this app decides.

## v1 behavior

1. User skip-scans museums in GO (`!shiny&!legendary&!mythical&!lucky&!costume&!4*` …), AutoScans the rest in Calcy, exports CSV.
2. Drop CSV here (local only, never uploaded).
3. App grades every row: **KEEP** | **LOOK** | **DUMP**.
4. First DUMP list is capped at **100**. Then the UI forces LOOK.
5. Shadows, limited/legendaries, `@special` never go to DUMP.
6. Per `species+form+shadow`, show a leaderboard (the Seismitoad problem).
7. LOOK rows have human reasons.
8. DUMP execution: copy a conservative in-game search (allowlist + `#DUMP` instructions). Human taps Transfer.

## Module contract (do not invent extra packages)

| File | Owner | Exports |
|------|--------|---------|
| `src/types.ts` | orchestrator (locked) | shared types only |
| `src/parseCsv.ts` | csv agent | `parseInventoryCsv(text: string): ParseResult` |
| `src/rank.ts` | grade agent | `rankGreatLeague(mon, gm): { rank: number, of: number, statProduct: number } \| null` plus Little Cup |
| `src/meta.ts` | grade agent | load PvPoke GL/LC lists + Pokébattler raid attackers (24h `localStorage`) + vendored rank gates |
| `src/grade.ts` | grade agent | `gradeBox(mons: Mon[], meta: Meta): GradeResult` |
| `src/search.ts` | ui agent | `dumpPreviewString(mons: Mon[]): string` |
| `src/ui.ts` | ui agent | `mountApp(root: HTMLElement): void` |
| `src/main.ts` | scaffold agent | imports ui and css |
| `data/*.json` | grade agent | snapshots |
| `index.html`, `package.json`, vite/tsconfig | scaffold agent | |
| `.github/workflows/pages.yml` | scaffold agent | GitHub Pages from `dist/` |

## Grade law (wide-minmax)

KEEP if any class fires. DUMP only if all fail **and** dump cap not reached.

- **KR-ID:** shiny, lucky, costume, background, 4\*, legendary, mythical, ultrabeast, dynamax, gigantamax, `@special` / special move, favorite. Missing flags → KEEP/LOOK, never DUMP.
- **KR-SHADOW:** `shadow === true` → KEEP or LOOK, **never DUMP** in v1.
- **KR-GL:** species (or its GL evo) in PvPoke GL overall top **500**. Keep copies with 4096-rank ≤ `pvpRankKeep`. Default cap **2** per species+form+shadow; `keepAllGood` keeps every floor copy. Extras DUMP if the group already has a KEEP. Shadows / limited / `@special` / non-unique IVs never DUMP. A PvP family with **no** keeper stays LOOK.
- **KR-LC:** PvPoke Little Cup top **100**, unevolved rank. Same floor, default cap **2**, `keepAllGood` keeps all floor copies.
- **KR-RAID:** Limited → KEEP all. Default cap **6** non-limited raid copies; `keepAllGood` keeps every raid attacker. Extra 4\* are dupes unless `keepAllGood` (then keep all hundos). Always keep at least one hundo per species when any exist.
- **DUMP fuel:** extras of a `species+form+shadow` that already has a KEEP or a 4096-floor copy; plus ungated junk extras (not the last copy). Cap `100` in **CSV stream order** (KEEP / LOOK / DUMP tracks are a partition of the export, never re-sorted).

Dump cap: `100`. Remaining would-be dumps become LOOK with reason `dump-cap`.

Fetch the two PvPoke ranking JSON files (extract IDs) and Pokébattler aggregated attacker rankings (unique `speciesId`, union into the vendored raid KEEP set). 24h browser cache. Keep `data/base-stats.json`, CPM, `gl-evolution.json`, raid attackers snapshot, and limited/legendary/mythical vendored. Fail closed: live → stale cache → bundled snapshot. Node tests skip fetch. Vite `/pb-api` proxy for local CORS; GitHub Pages uses the CI-pinned snapshot.

## Forbidden

Unofficial GO APIs, ADB, overlays, Accessibility clickers, uploading inventory, auto-transfer.

## CSV

Support header-driven Calcy IV and Poke Genie. Detect dialect. Map to `Mon`. IVs not unique → `ivUnique: false` → cannot DUMP.
