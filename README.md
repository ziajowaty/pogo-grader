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
4. Three tracks in CSV order: **KEEP**, **LOOK**, **DUMP**.
5. **KEEP PvP ≤** (default 500/4096). Bright **Lucky**, **Shadow**, and **Favorite** keep those tags. Fade a chip and that tag no longer protects the copy. **All 4\*** starts faded: one 4\* per family. Brighten it to keep every 4\*.
6. Read the DUMP grid, then transfer those copies yourself in GO.

This app never talks to Scopely/Niantic and never taps Transfer.

## Data

The browser fetches **PvPoke ranking lists** (Great League overall 1500 → top 500 unique `speciesId`, Little Cup overall 500 → top 100) and **Dittobase raid attackers** (eDPS per attacking type, A tier and better are raid KEEP). Those lists are stored in `localStorage` for **24 hours**. Offline or a failed fetch uses a stale cache, then the vendored files under `data/`. Refresh the vendored raid snapshot with `npm run pin:raid`. GitHub Pages cannot fetch Dittobase (no CORS); local `npm run dev` proxies `/ditto`, and Pages deploys re-pin before build.

IV rank math, CPM, evolution remaps, and legendary / mythical / limited lists stay vendored. They do not move with weekly ranking churn, and we do not pull PvPoke's full gamemaster.
