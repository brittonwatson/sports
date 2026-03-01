import { Sport } from "../types";

type CanonicalAliasEntry = {
  canonical: string;
  aliases: string[];
};

const SOCCER_SPORTS = new Set<Sport>([
  "Bundesliga",
  "EPL",
  "La Liga",
  "Ligue 1",
  "MLS",
  "Serie A",
  "UCL",
]);

const BASKETBALL_SPORTS = new Set<Sport>(["NBA", "WNBA", "NCAAM", "NCAAW"]);
const FOOTBALL_SPORTS = new Set<Sport>(["NFL", "NCAAF"]);
const HOCKEY_SPORTS = new Set<Sport>(["NHL"]);
const BASEBALL_SPORTS = new Set<Sport>(["MLB"]);

const GLOBAL_ALIASES: CanonicalAliasEntry[] = [
  { canonical: "Points", aliases: ["points", "pts", "ppg", "points per game", "scoring offense", "points for"] },
  { canonical: "Opponent Points", aliases: ["opponent points", "opp points", "points against", "points allowed", "scoring defense", "opp ppg"] },
  { canonical: "Points Differential", aliases: ["points differential", "point differential", "scoring margin", "margin"] },
  { canonical: "Games Played", aliases: ["games played", "games", "gp"] },
  { canonical: "Wins", aliases: ["wins", "w"] },
  { canonical: "Losses", aliases: ["losses", "l"] },
  { canonical: "Ties", aliases: ["ties", "t"] },
];

const SPORT_ALIASES: Partial<Record<Sport, CanonicalAliasEntry[]>> = {
  NBA: [
    { canonical: "Field Goal %", aliases: ["fg%", "field goal %", "field goal percentage", "fg percentage"] },
    { canonical: "Opponent Field Goal %", aliases: ["opp fg%", "opponent field goal %", "defensive field goal %"] },
    { canonical: "3-Point %", aliases: ["3p%", "3pt%", "three point %", "three-point %", "3-point %"] },
    { canonical: "Rebounds", aliases: ["reb", "rpg", "rebounds", "total rebounds"] },
    { canonical: "Opponent Rebounds", aliases: ["opp reb", "opponent rebounds", "rebounds allowed", "opp rpg"] },
    { canonical: "Assists", aliases: ["ast", "apg", "assists"] },
    { canonical: "Steals", aliases: ["stl", "spg", "steals"] },
    { canonical: "Blocks", aliases: ["blk", "bpg", "blocks"] },
    { canonical: "Turnovers", aliases: ["to", "topg", "turnover", "turnovers"] },
    { canonical: "Offensive Rebounds", aliases: ["oreb", "off reb", "offensive rebounds"] },
    { canonical: "Defensive Rebounds", aliases: ["dreb", "def reb", "defensive rebounds"] },
    { canonical: "Field Goals Made", aliases: ["fgm", "field goals made"] },
    { canonical: "Field Goals Attempted", aliases: ["fga", "field goals attempted"] },
    { canonical: "3-Pointers Made", aliases: ["3pm", "3-pointers made"] },
    { canonical: "3-Pointers Attempted", aliases: ["3pa", "3-pointers attempted"] },
    { canonical: "Free Throws Made", aliases: ["ftm", "free throws made"] },
    { canonical: "Free Throws Attempted", aliases: ["fta", "free throws attempted"] },
  ],
  WNBA: [],
  NCAAM: [],
  NCAAW: [],
  NFL: [
    { canonical: "First Downs", aliases: ["1st downs", "first downs"] },
    { canonical: "Total Yards", aliases: ["total yards", "yds/g"] },
    { canonical: "Passing Yards", aliases: ["passing average", "passing avg", "passing yds", "pass yds", "net passing yards"] },
    { canonical: "Rushing Yards", aliases: ["rushing average", "rushing avg", "rushing yds", "rush yds"] },
    { canonical: "Passing Yards Allowed", aliases: ["passing yards allowed", "opponent pass", "opp pass yds"] },
    { canonical: "Rushing Yards Allowed", aliases: ["rushing yards allowed", "opponent rush", "opp rush yds"] },
    { canonical: "Total Yards Allowed", aliases: ["total yards allowed"] },
    { canonical: "Turnover Differential", aliases: ["turnover margin", "turnover diff", "turnover differential"] },
    { canonical: "Sacks", aliases: ["sacks"] },
    { canonical: "Interceptions", aliases: ["interceptions", "int"] },
    { canonical: "Field Goal %", aliases: ["fg%", "field goal %"] },
    { canonical: "Punting Average", aliases: ["punting average", "punt avg"] },
    { canonical: "Kick Return Average", aliases: ["kick return average", "kick return avg"] },
    { canonical: "Punt Return Average", aliases: ["punt return average", "punt return avg"] },
  ],
  NCAAF: [],
  NHL: [
    { canonical: "Goals", aliases: ["goals", "goals for", "gf/gp"] },
    { canonical: "Goals Against", aliases: ["goals against", "ga/gp", "goals allowed"] },
    { canonical: "Power Play %", aliases: ["power play %", "pp%", "power play percentage"] },
    { canonical: "Penalty Kill %", aliases: ["penalty kill %", "pk%"] },
    { canonical: "Save %", aliases: ["save %", "sv%"] },
  ],
  MLB: [
    { canonical: "Runs", aliases: ["runs", "runs per game", "r"] },
    { canonical: "Runs Allowed", aliases: ["runs allowed", "opponent runs", "ra"] },
    { canonical: "ERA", aliases: ["era"] },
    { canonical: "WHIP", aliases: ["whip"] },
    { canonical: "Home Runs", aliases: ["home runs", "hr"] },
    { canonical: "Batting Avg", aliases: ["batting avg", "batting average", "avg"] },
    { canonical: "On Base %", aliases: ["obp", "on base %", "on-base %"] },
    { canonical: "Slugging %", aliases: ["slg", "slugging %"] },
    { canonical: "OPS", aliases: ["ops"] },
  ],
  EPL: [
    { canonical: "Goals", aliases: ["goals", "goals for", "gf/gp"] },
    { canonical: "Goals Against", aliases: ["goals against", "ga/gp", "goals allowed"] },
    { canonical: "Shots On Target", aliases: ["shots on target", "on goal"] },
    { canonical: "Pass Completion %", aliases: ["pass completion %", "pass %"] },
    { canonical: "Possession %", aliases: ["possession", "possession %"] },
  ],
  Bundesliga: [],
  "La Liga": [],
  "Ligue 1": [],
  "Serie A": [],
  MLS: [],
  UCL: [],
  UFC: [],
};

// Share alias sets across sibling leagues.
SPORT_ALIASES.WNBA = [...(SPORT_ALIASES.NBA || [])];
SPORT_ALIASES.NCAAM = [...(SPORT_ALIASES.NBA || [])];
SPORT_ALIASES.NCAAW = [...(SPORT_ALIASES.NBA || [])];
SPORT_ALIASES.NCAAF = [...(SPORT_ALIASES.NFL || [])];
SPORT_ALIASES.Bundesliga = [...(SPORT_ALIASES.EPL || [])];
SPORT_ALIASES["La Liga"] = [...(SPORT_ALIASES.EPL || [])];
SPORT_ALIASES["Ligue 1"] = [...(SPORT_ALIASES.EPL || [])];
SPORT_ALIASES["Serie A"] = [...(SPORT_ALIASES.EPL || [])];
SPORT_ALIASES.MLS = [...(SPORT_ALIASES.EPL || [])];
SPORT_ALIASES.UCL = [...(SPORT_ALIASES.EPL || [])];

export const normalizeStatToken = (label: string): string =>
  String(label || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const aliasMatches = (normalizedLabel: string, alias: string): number => {
  const normalizedAlias = normalizeStatToken(alias);
  if (!normalizedAlias) return 0;
  if (normalizedLabel === normalizedAlias) return 100 + normalizedAlias.length;
  if (normalizedLabel.startsWith(`${normalizedAlias} `)) return 70 + normalizedAlias.length;
  if (normalizedLabel.includes(normalizedAlias)) return 50 + normalizedAlias.length;
  if (normalizedAlias.includes(normalizedLabel) && normalizedLabel.length >= 5) return 25 + normalizedLabel.length;
  return 0;
};

export const canonicalizeStatLabel = (
  sport: Sport,
  rawLabel: string,
  _categoryHint?: string,
): string => {
  const normalizedLabel = normalizeStatToken(rawLabel);
  if (!normalizedLabel) return String(rawLabel || "").trim();

  const candidates = [...GLOBAL_ALIASES, ...(SPORT_ALIASES[sport] || [])];
  let best: { canonical: string; score: number } | null = null;
  candidates.forEach((entry) => {
    entry.aliases.forEach((alias) => {
      const score = aliasMatches(normalizedLabel, alias);
      if (score <= 0) return;
      if (!best || score > best.score) best = { canonical: entry.canonical, score };
    });
  });

  return best ? best.canonical : String(rawLabel || "").trim();
};

export const inferCanonicalCategory = (
  sport: Sport,
  label: string,
  sourceCategory?: string,
): string => {
  const src = String(sourceCategory || "").trim();
  const l = normalizeStatToken(label);
  const s = normalizeStatToken(src);

  const isRecordLikeLabel =
    l === "wins" ||
    l === "losses" ||
    l === "ties" ||
    l === "games played" ||
    l === "games" ||
    l === "gp" ||
    l === "record" ||
    l === "overall record";

  if (isRecordLikeLabel) return "General";

  if (l.includes("opponent") || l.includes("allowed") || l.includes("against")) return "Opponent";
  if (l.includes("differential") || l.includes("margin")) return "Differential";

  if (s) {
    if (s.includes("opponent")) return "Opponent";
    if (s.includes("differential") || s.includes("margin")) return "Differential";
    if (s.includes("offense")) return "Offense";
    if (s.includes("defense")) return "Defense";
    if (s.includes("shoot")) return "Shooting";
    if (s.includes("rebound")) return "Rebounding";
    if (s.includes("ball control") || s.includes("assist") || s.includes("turnover")) return "Ball Control";
    if (s.includes("special")) return "Special Teams";
    if (s.includes("passing")) return "Passing";
    if (s.includes("rushing")) return "Rushing";
    if (s.includes("efficiency")) {
      if (l.includes("3rd down") || l.includes("4th down") || l.includes("red zone") || l.includes("yards per") || l.includes("turnover") || l.includes("efficiency") || l.includes("rate") || l.includes("ratio")) {
        return "Efficiency";
      }
      // Source bucket says "efficiency", but label does not.
      // Fall through to label-based inference to avoid misclassifying record/volume stats.
    }
    if (s.includes("batting")) return "Batting";
    if (s.includes("pitching")) return "Pitching";
    if (s.includes("fielding")) return "Fielding";
    if (s.includes("other")) return "Other";
    if (s.includes("general")) return "General";
  }

  if (BASKETBALL_SPORTS.has(sport)) {
    if (l.includes("field goal") || l.includes("three point") || l.includes("free throw")) return "Shooting";
    if (l.includes("rebound")) return "Rebounding";
    if (l.includes("assist") || l.includes("turnover")) return "Ball Control";
    if (l.includes("steal") || l.includes("block") || l.includes("foul")) return "Defense";
    return "Team";
  }
  if (FOOTBALL_SPORTS.has(sport)) {
    if (l.includes("pass")) return "Passing";
    if (l.includes("rush")) return "Rushing";
    if (l.includes("kick") || l.includes("punt") || l.includes("return")) return "Special Teams";
    if (l.includes("interception") || l.includes("sack") || l.includes("fumble")) return "Defense";
    if (l.includes("3rd down") || l.includes("4th down") || l.includes("red zone") || l.includes("yards per") || l.includes("turnover")) return "Efficiency";
    return "Offense";
  }
  if (BASEBALL_SPORTS.has(sport)) {
    if (l.includes("era") || l.includes("whip") || l.includes("pitch") || l.includes("save")) return "Pitching";
    if (l.includes("field") || l.includes("error") || l.includes("assist") || l.includes("putout")) return "Fielding";
    return "Batting";
  }
  if (HOCKEY_SPORTS.has(sport)) {
    if (l.includes("power play") || l.includes("penalty")) return "Special Teams";
    if (l.includes("save") || l.includes("blocked")) return "Defense";
    return "Offense";
  }
  if (SOCCER_SPORTS.has(sport)) {
    if (l.includes("possession") || l.includes("pass") || l.includes("cross")) return "Ball Control";
    if (l.includes("tackle") || l.includes("interception") || l.includes("clearance") || l.includes("save") || l.includes("card") || l.includes("foul")) return "Defense";
    return "Offense";
  }

  return "General";
};

export const isRateLikeStatLabel = (label: string): boolean => {
  const l = normalizeStatToken(label);
  return (
    l.includes("%") ||
    l.includes("pct") ||
    l.includes("percent") ||
    l.includes("rate") ||
    l.includes("avg") ||
    l.includes("average") ||
    l.includes(" per ") ||
    l.includes(" per") ||
    l.includes("rating") ||
    l.includes("ratio") ||
    l.includes("/g") ||
    l === "era" ||
    l === "whip" ||
    l === "ops" ||
    l === "obp"
  );
};

export const isInverseMetricLabel = (label: string): boolean => {
  const l = normalizeStatToken(label);
  if (l.includes("differential") || l.includes("margin")) return false;
  if (l.includes("turnover differential") || l.includes("turnover margin")) return false;
  if (l.includes("assist") && l.includes("turnover") && (l.includes("ratio") || l.includes("/"))) return false;
  if (l.includes("allowed") || l.includes("against") || l.includes("opponent")) return true;
  if (l.includes("turnover") || l.includes("interception")) return true;
  if (l.includes("foul") || l.includes("penalt") || l.includes("card")) return true;
  if (l.includes("giveaway") || l.includes("error") || l.includes("sack yards lost")) return true;
  if (l === "era") return true;
  if (l.includes("loss")) return true;
  return false;
};
