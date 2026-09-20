import { readFileSync } from "node:fs";
import { parseInventoryCsv } from "./parseCsv";
import { loadMeta } from "./meta";
import { gradeBox } from "./grade";
import { dumpPreviewString } from "./search";

/**
 * Comprehensive specs against a real Calcy IV history export
 * (fixtures/history-calcy.csv — 2026-09-18 box scan).
 */

function must(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function streamOrder(rows: { mon: { sourceRow: number } }[], label: string): void {
  for (let i = 1; i < rows.length; i++) {
    must(
      rows[i].mon.sourceRow >= rows[i - 1].mon.sourceRow,
      `${label} must stay in CSV order (${rows[i - 1].mon.sourceRow} then ${rows[i].mon.sourceRow})`,
    );
  }
}

const EXPECTED_SHADOW_IDS = [
  "bagon_shadow",
  "drowzee_shadow",
  "litwick_shadow",
  "noibat_shadow",
  "onix_shadow",
  "pinsir_shadow",
  "porygon_shadow",
  "qwilfish_shadow",
  "sandshrew_alolan_shadow",
  "spheal_shadow",
  "taillow_shadow",
  "tentacool_shadow",
  "timburr_shadow",
  "tyrunt_shadow",
  "venonat_shadow",
  "voltorb_shadow",
  "yamask_shadow",
] as const;

const csv = readFileSync(new URL("../fixtures/history-calcy.csv", import.meta.url), "utf8");
const header = csv.split(/\r?\n/, 1)[0] ?? "";

must(header.includes("ShadowForm"), "fixture is a Calcy history export with ShadowForm");
must(header.includes("Lucky?"), "fixture has Lucky?");
must(header.includes("Dynamax"), "fixture has Dynamax");
must(header.includes("Ancestor?"), "fixture has Ancestor?");

const parsed = parseInventoryCsv(csv);
must(parsed.dialect === "calcyiv", `expected calcyiv, got ${parsed.dialect}`);
must(parsed.issues.length === 0, `parse issues: ${parsed.issues.map((i) => i.message).join("; ")}`);
must(parsed.mons.length === 134, `expected 134 scanned mons (ancestor skipped), got ${parsed.mons.length}`);
must(
  parsed.mons.every((m) => m.ivUnique),
  "every history row in this export is Unique?=1",
);
must(
  parsed.mons.every((m) => m.source === "calcyiv"),
  "all rows tagged calcyiv",
);

const shadows = parsed.mons.filter((m) => m.shadow);
const namedShadow = parsed.mons.filter((m) => /\bshadow\b/i.test(m.speciesName));
must(shadows.length === 20, `expected 20 shadows, got ${shadows.length}`);
must(namedShadow.length === 20, "Name suffix 'Shadow' matches ShadowForm=2 count");
must(
  namedShadow.every((m) => m.shadow),
  "Calcy 'Onix Shadow' / 'Sandshrew Alolan Shadow' names must set shadow=true",
);
must(
  shadows.every((m) => /_shadow$/.test(m.speciesId) && !m.speciesId.includes("shadow_shadow")),
  "shadow speciesId is PvPoke-style foo_shadow, never foo_shadow_shadow",
);
must(
  shadows.every((m) => !/\s/.test(m.speciesId)),
  "speciesId uses underscores, not spaces (PvPoke GL lists are onix_shadow)",
);

const shadowIds = [...new Set(shadows.map((m) => m.speciesId))].sort();
must(
  shadowIds.join(",") === EXPECTED_SHADOW_IDS.join(","),
  `shadow ids drifted: ${shadowIds.join(",")}`,
);

const alolaSand = parsed.mons.find((m) => /sandshrew/i.test(m.speciesName));
must(alolaSand?.speciesId === "sandshrew_alolan_shadow", "regional + shadow peels to sandshrew_alolan_shadow");
must(alolaSand?.shadow === true, "alolan shadow flag");
must(/^\d+$/.test(alolaSand?.form ?? ""), "numeric Calcy Form stays on form, not speciesId");

const shadowFormSeven = parsed.mons.filter((m) => !m.shadow && !/_shadow$/.test(m.speciesId));
must(shadowFormSeven.length === 114, "ShadowForm 1/7 rows are not this-copy shadows");

const luckies = parsed.mons.filter((m) => m.lucky);
must(luckies.length === 4, `expected 4 Lucky?=1, got ${luckies.length}`);
must(
  luckies.map((m) => m.speciesId).sort().join(",") === "aerodactyl,drilbur,machop,sableye",
  "lucky species",
);

const favorites = parsed.mons.filter((m) => m.favorite);
must(favorites.length === 1 && favorites[0].speciesId === "machop", "one favorite Machop");
must(favorites[0].nickname === "Mac♂93", "favorite nickname");

const dmax = parsed.mons.filter((m) => m.dynamax);
must(dmax.length === 1 && dmax[0].speciesId === "ralts", "one Dynamax=D Ralts");
must(dmax[0].nickname === "GL 19", "dynamax nickname");

const gibleMons = parsed.mons.filter((m) => m.speciesId === "gible");
must(gibleMons.length === 17, `expected 17 Gible, got ${gibleMons.length}`);

const meta = await loadMeta();
must(meta.pvpokeSource === "bundled", "Node loadMeta must stay on vendored PvPoke lists");
must(meta.glTop500.has("sandshrew_alolan_shadow"), "PvPoke GL list uses sandshrew_alolan_shadow");
must(meta.glTop500.has("qwilfish_shadow"), "PvPoke GL list uses qwilfish_shadow");
must(meta.lcTop100.has("onix_shadow"), "PvPoke LC list uses onix_shadow");

const result = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500 });
const all = [...result.keep, ...result.look, ...result.dump];
must(all.length === 134, "KEEP/LOOK/DUMP partition the box");
must(result.keep.length + result.look.length + result.dump.length === 134, "no dropped rows");
must(result.dump.length <= result.dumpCap, "dump cap respected");
must(result.dumpCapped === false, "134-row box should not hit dump-cap 100");
must(
  result.keep.length === 69 && result.look.length === 29 && result.dump.length === 36,
  `verdict snapshot keep/look/dump 69/29/36, got ${result.keep.length}/${result.look.length}/${result.dump.length}`,
);

streamOrder(result.keep, "KEEP");
streamOrder(result.look, "LOOK");
streamOrder(result.dump, "DUMP");

must(
  result.dump.every((g) => !g.mon.shadow),
  "KR-SHADOW: shadows never DUMP",
);
must(
  shadows.every((m) => {
    const g = all.find((row) => row.mon.sourceRow === m.sourceRow);
    return g?.verdict === "KEEP" && g.keepClasses.includes("shadow");
  }),
  "every history shadow KEEPs with keep class shadow",
);

const lookShadow = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, keepShadow: false });
must(lookShadow.keepShadow === false, "echo keepShadow false");
must(
  lookShadow.dump.every((g) => !g.mon.shadow),
  "LOOK shadow still never dumps history shadows",
);
must(
  shadows.every((m) => {
    const g = [...lookShadow.keep, ...lookShadow.look, ...lookShadow.dump].find(
      (row) => row.mon.sourceRow === m.sourceRow,
    );
    return g != null && g.verdict !== "DUMP" && !g.keepClasses.includes("shadow");
  }),
  "LOOK shadow drops the shadow keep class and still never dumps",
);

for (const lucky of luckies) {
  const g = all.find((row) => row.mon.sourceRow === lucky.sourceRow);
  must(g?.verdict === "KEEP" && g.keepClasses.includes("lucky"), `${lucky.speciesId} lucky KEEP`);
}

const fav = all.find((g) => g.mon.favorite);
must(fav?.verdict === "KEEP" && fav.keepClasses.includes("favorite"), "favorite Machop KEEP");

const maxRalts = all.find((g) => g.mon.dynamax);
must(maxRalts?.verdict === "KEEP" && maxRalts.keepClasses.includes("max"), "dynamax Ralts KEEP");

const gibles = all.filter((g) => g.mon.speciesId === "gible");
must(gibles.length === 17, "graded 17 Gible");
const gibleKeep = gibles.filter((g) => g.verdict === "KEEP");
const gibleLook = gibles.filter((g) => g.verdict === "LOOK");
const gibleDump = gibles.filter((g) => g.verdict === "DUMP");
if (gibleKeep.length === 0) {
  must(gibleLook.length === result.familyKeep, "no-keeper Gible family LOOKs familyKeep best");
  must(gibleDump.length === 17 - result.familyKeep, "Gible extras beyond familyKeep DUMP");
  must(
    gibleLook.every((g) => g.copyRankInGroup <= result.familyKeep),
    "LOOK Gible are the best copies",
  );
} else {
  must(
    gibleDump.length === 17 - gibleKeep.length,
    "if a Gible KEEPs, remaining copies DUMP",
  );
}

const froakies = all.filter((g) => g.mon.speciesId === "froakie");
must(froakies.length > 0, "fixture has Froakie");
must(
  froakies.some((g) => g.verdict === "KEEP" && g.keepClasses.includes("raid") && g.reasons.some((r) => /as Greninja/i.test(r))),
  "Froakie KEEPs as Greninja raid pre-evo",
);

const zero = gradeBox(parsed.mons, { ...meta, pvpRankKeep: 500, familyKeep: 0 });
must(zero.familyKeep === 0, "echo familyKeep 0");
must(zero.keep.length === result.keep.length, "familyKeep 0 does not drop KEEP");
must(zero.dump.length >= result.dump.length, "familyKeep 0 dumps at least as much");
must(
  zero.dump.every((g) => !g.mon.shadow),
  "familyKeep 0 still never dumps shadows",
);
const zeroGibles = [...zero.keep, ...zero.look, ...zero.dump].filter((g) => g.mon.speciesId === "gible");
const zeroGibleKeep = zeroGibles.filter((g) => g.verdict === "KEEP");
if (zeroGibleKeep.length === 0) {
  must(
    zeroGibles.every((g) => g.verdict === "DUMP" || g.reasons.includes("dump-cap")),
    "familyKeep 0 dumps a no-keeper Gible family (dump-cap overflow stays LOOK)",
  );
}
must(
  result.dump.every((g) => g.mon.ivUnique),
  "this export has unique IVs on every dump",
);

const dumpPreview = dumpPreviewString(result.dump.map((g) => g.mon));
must(!/shadow/i.test(dumpPreview), "DUMP search must not list Shadow copies");

const alolaGraded = all.find((g) => g.mon.speciesId === "sandshrew_alolan_shadow");
must(alolaGraded?.glMeta != null, "alolan shadow sandshrew matches PvPoke GL id with underscore");

console.log(
  JSON.stringify(
    {
      dialect: parsed.dialect,
      scanned: parsed.mons.length,
      shadows: shadows.length,
      keep: result.keep.length,
      look: result.look.length,
      dump: result.dump.length,
      shadowIds,
    },
    null,
    2,
  ),
);
console.log("historyCalcy specs passed");
