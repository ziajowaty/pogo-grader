# pogo-grader

Local CSV grader for Pokémon GO inventory exports (Calcy IV / Poke Genie). It is **not** an overlay, game client, or unofficial API. Never log into Pokémon GO with this app. Inventory stays in the browser and is never uploaded.

**Live:** [https://ziajowaty.github.io/pogo-grader/](https://ziajowaty.github.io/pogo-grader/) (GitHub Pages, static files only).

## Run locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

Try `fixtures/sample-pokegenie.csv` if you do not have an export yet.

```bash
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Workflow

1. **Skip-scan in GO** (copy the search on the page). Do not add `!shadow`.
2. AutoScan the rest in Calcy IV or Poke Genie, export CSV.
3. Drop the CSV here. Nothing is uploaded.
4. Three tracks in CSV order: **KEEP**, **LOOK**, **DUMP** (DUMP cap 100; overflow goes to LOOK).
5. **KEEP PvP ≤** (default 500/4096). **DUMP extras** vs **KEEP all good** if you want every 4\* / raid / PvP-floor copy.
6. Favorite KEEP in GO, **Search** DUMP, tag `#DUMP`, **Transfer** search, you tap Transfer.

This app never talks to Scopely/Niantic and never taps Transfer.

## Data

The browser fetches **PvPoke ranking lists** (Great League overall 1500 → top 500 unique `speciesId`, Little Cup overall 500 → top 100) and **Pokébattler aggregated raid attacker rankings** (`/api/attackers.json`, unique species, unioned into the vendored KEEP set so new megas land without dropping Machamp). Those IDs are stored in `localStorage` for **24 hours**. Offline or a failed fetch uses a stale cache, then the vendored files under `data/`. Refresh the vendored raid snapshot with `npm run pin:raid`. GitHub Pages cannot fetch Pokébattler (no CORS); local `npm run dev` proxies `/pb-api`, and Pages deploys re-pin before build.

IV rank math, CPM, evolution remaps, and legendary / mythical / limited lists stay vendored. They do not move with weekly ranking churn, and we do not pull PvPoke's full gamemaster.
