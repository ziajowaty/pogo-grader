# Grading rules

The page has three piles, in scan order: **KEEP**, **LOOK**, **DUMP**. A copy lands in the first pile that claims it.

## Always keep

Bright chips KEEP that tag no matter the seats: Lucky, Shadow, Favorite. **All 4\*** starts faded, so one hundo per family stays and extras can leave. Brighten it to keep every hundo.

Fade Lucky, Shadow, or Favorite and that tag stops protecting the copy. Shiny, costume, background, legendary, mythical, Ultra Beast, Dynamax, Gigantamax, and a special move still never DUMP.

## Seats

A seat is one species in one bright league. Marowak in Great League and Cubone in Little Cup are different seats. Each family also has one raid seat, when that evolution is a raid attacker.

**Leagues.** Bright leagues have seats and fill from the top of the order. Default order is Great League, Ultra League, Master League, Little Cup. Ultra and Master start faded. One Pokémon takes the first seat it qualifies for. Inside a league, the better PvPoke species fills first.

**Who gets a seat.** This is the PvPoke species rank, not the IV rank.

- **Top list** at 500: a species at PvPoke rank 500 or better gets a seat. Cubone at Great League #945 does not. Marowak Shadow at #82 does.
- **Any species:** every evolution gets a seat, including Cubone itself in Great League. The IV rank below still decides KEEP.

## Who KEEPs

**PvP IV rank** is the spread rank out of 4096. 1 is best. Default 500 means a copy KEEPs a seat only at rank 500 or better. **Any** lets every IV KEEP.

**Copies per seat** is how many of those qualifiers KEEP. Default 1. It does not create LOOK copies.

**Raid IV** is `(Attack + Defense + Stamina) / 45`, default 90%. **Raid copies** is a separate count, default 1, and can go higher than the PvP copy count.

## Empty seat

If a seat got zero KEEPs, LOOK the best copy still available for that seat. The IV bar does not apply. The other copies DUMP.

That is why a Little Cup Cubone can KEEP while the best Marowak still LOOKs. Little Cup filled its seat. Great League Marowak did not, because every Marowak rank was worse than 500, so the best remaining Cubone stays on LOOK for Marowak.

A Pokémon already taken by another seat is not reused. If the best Marowak is the Little Cup KEEP, the Marowak seat LOOKs the next-best Cubone.

A species with no seat still LOOKs its one best copy, and dumps the extras. That is the lone Bidoof case.

## Evolutions

A copy is graded as what it can become, not as every form that shares a name.

Regular Cubone evolves into Marowak. It does not evolve into Alolan Marowak. There is no Alolan Cubone, and the Alolan branch is only switched on during events, so it is not a standing seat. The same split applies when a regional pre-evolution exists: Darumaka does not become Galarian Darmanitan, Zorua does not become Hisuian Zoroark, and Alolan Rattata does not become Kanto Raticate.

Branches with no regional pre-evolution stay open. Exeggcute can become Alolan Exeggutor, Koffing can become Galarian Weezing, and Pikachu can become Alolan Raichu.

The filter lives in `keepStandingEvolutionEdges` in `src/meta.ts`. PvPoke's family graph is the source list; that function drops edges the pre-evolution cannot actually take.
