import { gradeBox } from "./grade";
import { loadMeta } from "./meta";
import type { Gender, Mon } from "./types";

function must(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

let row = 0;
function mon(speciesId: string, gender: Gender, ivs: { atk: number; def: number; sta: number } = { atk: 0, def: 15, sta: 15 }): Mon {
  row += 1;
  return {
    source: "calcyiv",
    sourceRow: row,
    speciesName: speciesId,
    speciesId,
    form: "",
    gender,
    cp: 120,
    hp: 50,
    atk: ivs.atk,
    def: ivs.def,
    sta: ivs.sta,
    ivUnique: true,
    level: 10,
    shadow: false,
    purified: false,
  };
}

function evoIds(speciesId: string, gender: Gender, pvpAny = false): string[] {
  const meta = { ...base, pvpAny, pvpRankKeep: 4096 };
  const graded = gradeBox([mon(speciesId, gender)], meta);
  const g = [...graded.keep, ...graded.look, ...graded.dump][0];
  return (g?.glAs ?? []).map((r) => r.evoSpeciesId).sort();
}

const base = await loadMeta();

const ivs = { atk: 0, def: 13, sta: 15 };
const pair = gradeBox(
  [mon("lechonk", "female", ivs), mon("lechonk", "male", ivs)],
  { ...base, pvpRankKeep: 4096, pvpKeep: 1 },
);
const both = [...pair.keep, ...pair.look, ...pair.dump];
const female = both.find((g) => g.mon.gender === "female");
const male = both.find((g) => g.mon.gender === "male");
must(female?.gl?.evoSpeciesId === "oinkologne_female", `female GL evo ${female?.gl?.evoSpeciesId}`);
must(male?.gl?.evoSpeciesId === "oinkologne", `male GL evo ${male?.gl?.evoSpeciesId}`);
must(
  (female?.glAs ?? []).every((r) => r.evoSpeciesId !== "oinkologne"),
  "female is not ranked as male Oinkologne",
);
must(
  (male?.glAs ?? []).every((r) => r.evoSpeciesId !== "oinkologne_female"),
  "male is not ranked as female Oinkologne",
);
must(female?.gl?.rank !== male?.gl?.rank, "same IVs rank differently on the two Oinkologne");
must(female?.pvpJob?.speciesId === "oinkologne_female", `female job ${female?.pvpJob?.speciesId}`);
must(male?.pvpJob?.speciesId === "oinkologne", `male job ${male?.pvpJob?.speciesId}`);

const anyFemale = evoIds("lechonk", "female", true);
const anyMale = evoIds("lechonk", "male", true);
must(anyFemale.includes("lechonk") && anyFemale.includes("oinkologne_female"), `female any-species ${anyFemale}`);
must(!anyFemale.includes("oinkologne"), "female any-species excludes male Oinkologne");
must(anyMale.includes("lechonk") && anyMale.includes("oinkologne"), `male any-species ${anyMale}`);
must(!anyMale.includes("oinkologne_female"), "male any-species excludes female Oinkologne");

must(evoIds("salandit", "male").join(",") === "", "male Salandit does not evolve");
must(evoIds("salandit", "female").join(",") === "salazzle", `female Salandit → ${evoIds("salandit", "female")}`);
must(evoIds("combee", "male").join(",") === "", "male Combee does not evolve");
must(evoIds("combee", "female").join(",") === "vespiquen", `female Combee → ${evoIds("combee", "female")}`);

const snoruntMale = evoIds("snorunt", "male");
const snoruntFemale = evoIds("snorunt", "female");
must(snoruntMale.join(",") === "glalie", `male Snorunt GL ${snoruntMale}`);
must(snoruntFemale.includes("froslass") && snoruntFemale.includes("glalie"), `female Snorunt GL ${snoruntFemale}`);

must(evoIds("kirlia", "female").join(",") === "", "female Kirlia is not Gallade");
must(evoIds("kirlia", "male").join(",") === "gallade", `male Kirlia GL ${evoIds("kirlia", "male")}`);
must(evoIds("ralts", "female").join(",") === "", "female Ralts is not Gallade");
must(evoIds("ralts", "male").includes("gallade"), `male Ralts GL ${evoIds("ralts", "male")}`);

must(!evoIds("burmy_trash", "male").includes("wormadam_trash"), "male Burmy is not Wormadam");
must(evoIds("burmy_trash", "female").includes("wormadam_trash"), "female Burmy Trash is Wormadam");

const espurrFemale = evoIds("espurr", "female", true);
const espurrMale = evoIds("espurr", "male", true);
must(espurrFemale.includes("meowstic_female") && !espurrFemale.includes("meowstic"), `female Espurr ${espurrFemale}`);
must(espurrMale.includes("meowstic") && !espurrMale.includes("meowstic_female"), `male Espurr ${espurrMale}`);

const basculinMale = evoIds("basculin", "male", true);
const basculinFemale = evoIds("basculin", "female", true);
must(basculinMale.includes("basculegion_male") && !basculinMale.includes("basculegion_female"), `male Basculin ${basculinMale}`);
must(basculinFemale.includes("basculegion_female") && !basculinFemale.includes("basculegion_male"), `female Basculin ${basculinFemale}`);

const raid = gradeBox([mon("ralts", "female"), mon("ralts", "male")], { ...base, pvpRankKeep: 4096 });
const raidRows = [...raid.keep, ...raid.look, ...raid.dump];
const raidFemale = raidRows.find((g) => g.mon.gender === "female");
const raidMale = raidRows.find((g) => g.mon.gender === "male");
must(raidFemale?.raidIv?.evoSpeciesId === "gardevoir", `female Ralts raid ${raidFemale?.raidIv?.evoSpeciesId}`);
must(!raidFemale?.raidIv?.evoSpeciesId?.startsWith("gallade"), "female Ralts raid is not a Gallade form");
must(raidMale?.raidIv?.evoSpeciesId === "gardevoir", `male Ralts raid ${raidMale?.raidIv?.evoSpeciesId}`);

console.log("genderGrade tests passed");
