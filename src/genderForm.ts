import type { Gender } from "./types.ts";

/**
 * PvPoke ids where gender is a different species. Male Oinkologne and male
 * Meowstic keep the unsuffixed id. Other splits use an explicit suffix.
 * Cosmetic genders (Pyroar, Frillish, Hippowdon, …) are not listed.
 */
const GENDERED_SPECIES: Record<string, Partial<Record<"male" | "female", string>>> = {
  oinkologne: { female: "oinkologne_female" },
  meowstic: { female: "meowstic_female" },
  indeedee: { male: "indeedee_male", female: "indeedee_female" },
  basculegion: { male: "basculegion_male", female: "basculegion_female" },
  nidoran: { male: "nidoran_male", female: "nidoran_female" },
};

const ALREADY_GENDERED = new Set<string>([
  "oinkologne_female",
  "meowstic_female",
  "indeedee_male",
  "indeedee_female",
  "basculegion_male",
  "basculegion_female",
  "nidoran_male",
  "nidoran_female",
]);

/**
 * Evolution targets only one gender can become. Unsuffixed `oinkologne` and
 * `meowstic` are the male forms. Gardevoir and Glalie stay off this list:
 * both genders can become them.
 */
const MALE_ONLY_EVO = new Set([
  "oinkologne",
  "meowstic",
  "basculegion_male",
  "gallade",
  "mothim",
]);

const FEMALE_ONLY_EVO = new Set([
  "oinkologne_female",
  "meowstic_female",
  "basculegion_female",
  "froslass",
  "salazzle",
  "vespiquen",
  "wormadam_plant",
  "wormadam_sandy",
  "wormadam_trash",
]);

function evolutionCore(speciesId: string): string {
  let id = speciesId.trim().toLowerCase();
  if (id.endsWith("_shadow")) id = id.slice(0, -7);
  id = id.replace(/_mega(?:_[xy])?$/, "").replace(/_primal$/, "");
  return id;
}

/** Rewrite a base species id when gender selects the PvPoke form. */
export function applyGenderedSpecies(speciesId: string, gender: Gender): string {
  if (gender !== "male" && gender !== "female") return speciesId;
  const shadow = speciesId.endsWith("_shadow");
  const core = shadow ? speciesId.slice(0, -7) : speciesId;
  if (ALREADY_GENDERED.has(core)) return speciesId;
  const next = GENDERED_SPECIES[core]?.[gender];
  if (!next) return speciesId;
  return shadow ? `${next}_shadow` : next;
}

/**
 * False when `target` is a gendered evolution this mon cannot become.
 * A mon that already is that species is not checked here.
 */
export function evolutionGenderOk(target: string, gender: Gender): boolean {
  const core = evolutionCore(target);
  const lock = MALE_ONLY_EVO.has(core) ? "male" : FEMALE_ONLY_EVO.has(core) ? "female" : null;
  if (!lock) return true;
  return gender === lock;
}
