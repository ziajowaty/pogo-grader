import { parseInventoryCsv } from "./parseCsv.ts";

const GENIE = `Index,Name,Form,Pokemon,Gender,CP,HP,Atk IV,Def IV,Sta IV,IV Avg,Level Min,Level Max,Quick Move,Charge Move,Charge Move 2,Lucky,Shadow/Purified,Favorite,Rank # (G),Name (G)
1,Ninetales,Alola,38,♀,1500,127,0,15,15,66.7,20.0,20.0,Powder Snow,Weather Ball,Psyshock,0,1,0,12,Ninetales
2,Seismitoad,Normal,537,♂,1498,162,1,15,14,66.7,22.5,22.5,Mud Shot,Earth Power,Sludge Bomb,0,0,1,80,Seismitoad
3,Machamp,Normal,68,♂,2500,163,15,15,15,100.0,30.0,35.0,Counter,Dynamic Punch,Rock Slide,1,0,0,,
4,Venusaur,Normal,3,♀,1489,140,0,14,15,64.4,21.0,21.0,Vine Whip,Frenzy Plant,Sludge Bomb,0,2,0,,
5,,Normal,,,not-a-cp,10,0,0,0,0,1,1,,,,,0,0,0,,
6,Alolan Ninetales,Normal,38,♀,1200,110,1,14,15,66.7,18.0,18.0,Charm,Psyshock,,0,0,0,,
`;

const CALCY = `Ancestor?,Scan date,Nr,Name,Nickname,Gender,Level,possibleLevels,CP,HP,ØATT IV,ØDEF IV,ØHP IV,ØIV%,Unique?,Fast move,Special move,Star,Form,Lucky,Shadow,GL Rank
0,1/1/2020 00:00:00,194,Wooper,box1,♂,20,20,500,85,0,15,15,66.7,1,Water Gun,Frustration,0,0,1,1,40
0,1/2/2020 00:00:00,38,Ninetales,box2,♀,20,20,1500,127,12,12,12,80.0,0,Charm,Psyshock,1,61,0,0,90
1,1/2/2020 00:00:00,38,Ninetales,-,-,18,18,1400,120,12,12,12,80.0,0,Charm,Psyshock,0,61,0,0,
0,1/3/2020 00:00:00,68,Machamp,box3,♂,30,30,2500,163,15.0,15.0,15.0,100.0,1,Counter,Dynamic Punch,0,0,1,0,200
0,1/4/2020 00:00:00,,,junk,,20,20,abc,0,-1,-1,-1,0,0,-,-,0,0,1,0,
`;

let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) return;
  failed += 1;
  console.error(`FAIL ${name}`);
}

const genie = parseInventoryCsv(GENIE);
check("genie dialect", genie.dialect === "pokegenie");
check("genie count", genie.mons.length === 5);
check("genie skip garbage", genie.issues.some((i) => i.message.includes("missing species")));

const shadowFox = genie.mons[0];
check("alolan shadow id", shadowFox.speciesId === "ninetales_alolan_shadow");
check("shadow flag", shadowFox.shadow === true && shadowFox.purified === false);
check("genie unique", shadowFox.ivUnique === true);
check("genie ivs", shadowFox.atk === 0 && shadowFox.def === 15 && shadowFox.sta === 15);
check("genie gender", shadowFox.gender === "female");
check("genie shiny omitted", shadowFox.shiny === undefined && shadowFox.costume === undefined);
check("genie lucky 0", shadowFox.lucky === false);

const toad = genie.mons[1];
check("toad id", toad.speciesId === "seismitoad");
check("toad favorite", toad.favorite === true);
check("toad earth power not special", toad.hasSpecialMove === undefined);

const champ = genie.mons[2];
check("machamp not unique", champ.ivUnique === false);
check("machamp lucky", champ.lucky === true);
check("machamp level omitted when ranged", champ.level === undefined);

const venus = genie.mons[3];
check("purified not shadow", venus.purified === true && venus.shadow === false);
check("frenzy plant special", venus.hasSpecialMove === true);

const namedAlola = genie.mons[4];
check("name prefix alolan", namedAlola.speciesId === "ninetales_alolan");
check("name prefix not shadow", namedAlola.shadow === false);

const calcy = parseInventoryCsv(CALCY);
check("calcy dialect", calcy.dialect === "calcyiv");
check("calcy skips ancestor and junk", calcy.mons.length === 3);
check("calcy junk issue", calcy.issues.some((i) => i.row === 6));

const wooper = calcy.mons[0];
check("wooper unique", wooper.ivUnique === true);
check("wooper shadow", wooper.shadow === true);
check("wooper frustration", wooper.hasSpecialMove === true);
check("calcy lucky unknown", wooper.lucky === undefined);
check("wooper id", wooper.speciesId === "wooper_shadow");
check("wooper nickname", wooper.nickname === "box1");

const calcyFox = calcy.mons[1];
check("calcy non-unique", calcyFox.ivUnique === false);
check("calcy numeric form kept", calcyFox.form === "61");
check("calcy numeric form not in id", calcyFox.speciesId === "ninetales");
check("calcy favorite from star", calcyFox.favorite === true);

const calcyChamp = calcy.mons[2];
check("calcy exact iv unique", calcyChamp.ivUnique === true);
check("calcy level", calcyChamp.level === 30);

const junk = parseInventoryCsv("this is not a csv at all\n???,###");
check("junk dialect unknown", junk.dialect === "unknown");
check("junk no throw", Array.isArray(junk.mons) && Array.isArray(junk.issues));

const empty = parseInventoryCsv("   ");
check("empty issue", empty.issues.length > 0 && empty.mons.length === 0);

const semi = parseInventoryCsv("Name;CP;HP;Atk IV;Def IV;Sta IV;Level Min;Level Max\nMr. Mime;400;50;10;10;10;15;15\n");
check("semicolon genie-ish", semi.dialect === "pokegenie" && semi.mons[0]?.speciesId === "mr_mime");

if (failed > 0) {
  throw new Error(`${failed} parseCsv checks failed`);
}

console.log("parseCsv tests passed");
