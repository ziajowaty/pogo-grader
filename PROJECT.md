# pogo-grader

Browser grader for a **wide-minmax** Pokémon GO player (raids + Great League + Little Cup).
Not an overlay. Not a game client. CalcyIV / Poke Genie scan; this app decides.

## v1 behavior

1. User skip-scans museums in GO (`!shiny&!legendary&!mythical&!lucky&!costume&!4*` …), AutoScans the rest in Calcy, exports CSV.
2. Drop CSV here (local only, never uploaded).
3. App grades every row: **KEEP** | **LOOK** | **DUMP**.
4. Bright Shadow keeps every shadow off DUMP. Fade that chip and useless shadows can DUMP. Limited/legendaries and `@special` never go to DUMP.
5. Per `species+form+shadow`, show a leaderboard (the Seismitoad problem).
6. LOOK rows have human reasons.
7. DUMP execution: copy a conservative in-game search (allowlist + `#DUMP` instructions). Human taps Transfer.

## Module contract (do not invent extra packages)

| File | Owner | Exports |
|------|--------|---------|
| `src/types.ts` | orchestrator (locked) | shared types only |
| `src/parseCsv.ts` | csv agent | `parseInventoryCsv(text: string): ParseResult` |
| `src/rank.ts` | grade agent | `rankGreatLeague(mon, gm): { rank: number, of: number, statProduct: number } \| null` plus Little Cup |
| `src/dittobase.ts` | grade agent | parse Dittobase best-attackers pages and map slugs to species ids |
| `src/meta.ts` | grade agent | load PvPoke GL/LC lists + Dittobase raid attackers (24h `localStorage`) + vendored rank gates |
| `src/grade.ts` | grade agent | `gradeBox(mons: Mon[], meta: Meta): GradeResult` |
| `src/search.ts` | ui agent | `dumpPreviewString(mons: Mon[]): string` |
| `src/ui.ts` | ui agent | `mountApp(root: HTMLElement): void` |
| `src/main.ts` | scaffold agent | imports ui and css |
| `data/*.json` | grade agent | snapshots |
| `index.html`, `package.json`, vite/tsconfig | scaffold agent | |
| `.github/workflows/pages.yml` | scaffold agent | GitHub Pages from `dist/` |

## Grade law (wide-minmax)

KEEP if any class fires. DUMP only if every keep class fails and the copy is not held as LOOK.

- **KR-ID:** shiny, lucky, costume, background, 4\*, legendary, mythical, ultrabeast, dynamax, gigantamax, `@special` / special move, favorite. Missing flags → KEEP/LOOK, never DUMP.
- **KR-SHADOW:** `keepShadow` (default on) and `shadow === true` → KEEP. Off: shadow is not a keep class and is not dump-protected. Useless copies DUMP like other junk. Shiny, PvP, raids, and the other rules can still KEEP the copy.
- **KR-GL:** species (or its GL evo) in PvPoke GL overall top **500**. Keep copies with 4096-rank ≤ `pvpRankKeep`. Default cap **2** per species+form+shadow; `keepAllGood` keeps every floor copy. Extras DUMP if the group already has a KEEP. Limited / `@special` / non-unique IVs never DUMP. A bright Shadow chip also never DUMPs. A PvP family with **no** keeper stays LOOK.
- **KR-LC:** PvPoke Little Cup top **100**, unevolved rank. Same floor, default cap **2**, `keepAllGood` keeps all floor copies.
- **KR-RAID:** Limited → KEEP all. Default cap **6** non-limited raid copies; `keepAllGood` keeps every raid attacker. Extra 4\* are dupes unless `keepAllGood` (then keep all hundos). Always keep at least one hundo per species when any exist.
- **DUMP fuel:** extras of a `species+form+shadow` that already has a KEEP or a 4096-floor copy; plus ungated junk extras (not the last copy). **CSV stream order** (KEEP / LOOK / DUMP tracks are a partition of the export, never re-sorted).

Fetch the two PvPoke ranking JSON files (extract IDs) and Dittobase best-attackers pages (eDPS per move type; A tier and better are raid KEEP). 24h browser cache. Keep `data/base-stats.json`, CPM, `gl-evolution.json`, the Dittobase raid snapshot, and limited/legendary/mythical vendored. Fail closed: live → stale cache → bundled snapshot. Node tests skip fetch. Vite `/ditto` proxy for local CORS; GitHub Pages uses the CI-pinned snapshot.

## Forbidden

Unofficial GO APIs, ADB, overlays, Accessibility clickers, uploading inventory, auto-transfer.

## CSV

Support header-driven Calcy IV and Poke Genie. Detect dialect. Map to `Mon`. IVs not unique → `ivUnique: false` → cannot DUMP.
