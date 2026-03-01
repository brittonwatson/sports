import {
    CalculationDetailItem,
    ConfidenceBreakdown,
    FactorComparison,
    Game,
    GameDetails,
    SOCCER_LEAGUES,
    Sport,
    TeamStat,
} from "../../types";
import { clamp, normalCDF, parseClockToMinutes, poissonProbability } from "./math";
import { getWeatherImpact, parseComplexStat, parseOverUnder } from "./utils";
import {
    getInternalHistoricalGamesBySport,
    getInternalLiveScoringTeamProfile,
} from "../internalDbService";
import { getGameTeamAbbreviation } from "../teamAbbreviation";
import { canonicalizeStatLabel, normalizeStatToken } from "../statDictionary";

type SportFamily = "football" | "basketball" | "baseball" | "soccer" | "hockey" | "other";

interface MatchupPair {
    label: string;
    offenseAliases: string[];
    defenseAllowAliases: string[];
    weight: number;
    scale: number;
}

interface DirectAxis {
    label: string;
    aliases: string[];
    better: "high" | "low";
    weight: number;
    scale: number;
}

interface SportProfile {
    family: SportFamily;
    baseTotal: number;
    minTotal: number;
    maxTotal: number;
    maxTeamScore: number;
    homeAdvantage: number;
    marginStdDev: number;
    regulationMinutes: number;
    regulationPeriods: number;
    clockMode: "countdown" | "countup" | "inning" | "none";
    hasDraw: boolean;
    matchupPairs: MatchupPair[];
    directAxes: DirectAxis[];
    liveAxes: DirectAxis[];
    rankWeight: number;
    marketWeight: number;
}

interface MetricMatch {
    label: string;
    displayHome: string;
    displayAway: string;
    home: number;
    away: number;
}

interface WeightedFinding {
    label: string;
    value: string;
    impact: "positive" | "negative" | "neutral";
    description: string;
    magnitude: number;
}

interface ModelOutcome {
    winProbabilityHome: number;
    winProbabilityAway: number;
    drawProbability: number;
    predictedScoreHome: number;
    predictedScoreAway: number;
    confidence: number;
    confidenceBreakdown: ConfidenceBreakdown;
    keyFactors: string[];
    factorBreakdown: FactorComparison[];
    calculationBreakdown: CalculationDetailItem[];
}

interface TeamGameLog {
    gameId: string;
    dateMs: number;
    seasonYear?: number;
    seasonType?: number;
    teamId: string;
    opponentId: string;
    pointsFor: number;
    pointsAgainst: number;
    isHome: boolean;
}

interface TeamHistoryPrior {
    homeExpected: number;
    awayExpected: number;
    total: number;
    margin: number;
    homeGames: number;
    awayGames: number;
    headToHeadGames: number;
    homeOffense: number;
    awayOffense: number;
    homeDefense: number;
    awayDefense: number;
    homeAdjustedOffense: number;
    awayAdjustedOffense: number;
    homeAdjustedDefense: number;
    awayAdjustedDefense: number;
    headToHeadMargin: number;
    headToHeadHomeWins: number;
    headToHeadAwayWins: number;
    headToHeadDraws: number;
    marginVolatility: number;
    scoringVolatility: number;
}

interface OpponentAdjustedContext {
    basePoints: number;
    homeEdgeHalf: number;
    homeOffenseRating: number;
    awayOffenseRating: number;
    homeDefenseRating: number;
    awayDefenseRating: number;
    homeExpected: number;
    awayExpected: number;
}

interface SideObservation {
    teamId: string;
    opponentId: string;
    pointsFor: number;
    pointsAgainst: number;
    isHome: boolean;
    weight: number;
    dateMs: number;
}

interface LiveTrajectoryProjection {
    homeProjectedFinal: number;
    awayProjectedFinal: number;
    confidence: number;
    binIndex: number;
    homeShare: number;
    awayShare: number;
}

interface SoccerLiveStatSignals {
    homeShotsOnTarget: number | null;
    awayShotsOnTarget: number | null;
    homeShots: number | null;
    awayShots: number | null;
    homePossession: number | null;
    awayPossession: number | null;
    homeRedCards: number | null;
    awayRedCards: number | null;
}

interface SoccerDrawPrior {
    teamDrawRate: number;
    h2hDrawRate: number;
    weightedDrawRate: number;
    sampleWeight: number;
    sampleGames: number;
}

const FOOTBALL_PROFILE: SportProfile = {
    family: "football",
    baseTotal: 45,
    minTotal: 20,
    maxTotal: 80,
    maxTeamScore: 70,
    homeAdvantage: 2.25,
    marginStdDev: 13.5,
    regulationMinutes: 60,
    regulationPeriods: 4,
    clockMode: "countdown",
    hasDraw: false,
    rankWeight: 1.8,
    marketWeight: 2.4,
    matchupPairs: [
        {
            label: "Scoring Matchup",
            offenseAliases: ["points per game", "points", "scoring offense", "pts"],
            defenseAllowAliases: ["opponent points", "points allowed", "opp points", "scoring defense"],
            weight: 2.0,
            scale: 6.0,
        },
        {
            label: "Passing Matchup",
            offenseAliases: ["passing average", "passing avg", "yards per pass", "net passing yards", "pass yds"],
            defenseAllowAliases: ["opponent pass", "passing yards allowed", "pass defense", "opp pass yds"],
            weight: 1.2,
            scale: 35,
        },
        {
            label: "Rushing Matchup",
            offenseAliases: ["rushing average", "rushing avg", "rush yds", "rushing yards"],
            defenseAllowAliases: ["opponent rush", "rushing yards allowed", "rush defense", "opp rush yds"],
            weight: 1.1,
            scale: 30,
        },
    ],
    directAxes: [
        { label: "Turnover Control", aliases: ["turnovers", "giveaways"], better: "low", weight: 1.9, scale: 1.2 },
        { label: "Third Down Efficiency", aliases: ["3rd down", "third down"], better: "high", weight: 1.0, scale: 8 },
        { label: "Red Zone Efficiency", aliases: ["red zone"], better: "high", weight: 0.9, scale: 10 },
        { label: "Sack Pressure", aliases: ["sacks"], better: "high", weight: 0.8, scale: 1.5 },
        { label: "Penalty Discipline", aliases: ["penalties"], better: "low", weight: 0.6, scale: 2 },
        { label: "Yards Per Play", aliases: ["yards per play", "ypp"], better: "high", weight: 1.0, scale: 0.8 },
    ],
    liveAxes: [
        { label: "Live Turnover Edge", aliases: ["turnovers", "total turnovers"], better: "low", weight: 1.6, scale: 1.0 },
        { label: "Live Passing Edge", aliases: ["passing yards", "net passing yards"], better: "high", weight: 0.9, scale: 35 },
        { label: "Live Rush Edge", aliases: ["rushing yards"], better: "high", weight: 0.75, scale: 30 },
    ],
};

const BASKETBALL_PROFILE: SportProfile = {
    family: "basketball",
    baseTotal: 220,
    minTotal: 130,
    maxTotal: 290,
    maxTeamScore: 170,
    homeAdvantage: 2.9,
    marginStdDev: 11.8,
    regulationMinutes: 48,
    regulationPeriods: 4,
    clockMode: "countdown",
    hasDraw: false,
    rankWeight: 1.5,
    marketWeight: 2.0,
    matchupPairs: [
        {
            label: "Scoring Efficiency",
            offenseAliases: ["points per game", "points", "ppg", "pts"],
            defenseAllowAliases: ["opponent points", "points allowed", "opp points"],
            weight: 2.3,
            scale: 9,
        },
        {
            label: "Perimeter Matchup",
            offenseAliases: ["three point %", "3pt %", "3p%", "three-point %"],
            defenseAllowAliases: ["opponent three point %", "opponent 3pt %", "opponent 3p%"],
            weight: 1.0,
            scale: 5.5,
        },
    ],
    directAxes: [
        { label: "Shooting Efficiency", aliases: ["field goal %", "fg%", "effective fg"], better: "high", weight: 1.9, scale: 4.0 },
        { label: "Three Point Efficiency", aliases: ["three point %", "3pt %", "3p%"], better: "high", weight: 1.3, scale: 4.5 },
        { label: "Free Throw Efficiency", aliases: ["free throw %", "ft%"], better: "high", weight: 0.8, scale: 6.0 },
        { label: "Rebounding", aliases: ["rebounds", "total rebounds"], better: "high", weight: 1.1, scale: 6.0 },
        { label: "Assists", aliases: ["assists"], better: "high", weight: 0.7, scale: 5.0 },
        { label: "Ball Security", aliases: ["turnovers", "total turnovers"], better: "low", weight: 1.2, scale: 2.8 },
        { label: "Disruption", aliases: ["steals", "blocks"], better: "high", weight: 0.75, scale: 2.0 },
    ],
    liveAxes: [
        { label: "Live Shooting Edge", aliases: ["field goal %", "fg%"], better: "high", weight: 1.3, scale: 4.0 },
        { label: "Live Rebounding Edge", aliases: ["rebounds"], better: "high", weight: 0.8, scale: 5.0 },
        { label: "Live Ball Security", aliases: ["turnovers", "total turnovers"], better: "low", weight: 1.0, scale: 2.5 },
    ],
};

const BASEBALL_PROFILE: SportProfile = {
    family: "baseball",
    baseTotal: 8.7,
    minTotal: 4.5,
    maxTotal: 16,
    maxTeamScore: 18,
    homeAdvantage: 0.22,
    marginStdDev: 2.7,
    regulationMinutes: 0,
    regulationPeriods: 9,
    clockMode: "inning",
    hasDraw: false,
    rankWeight: 0.45,
    marketWeight: 0.9,
    matchupPairs: [
        {
            label: "Run Production",
            offenseAliases: ["runs", "runs per game", "r"],
            defenseAllowAliases: ["runs allowed", "opponent runs", "era"],
            weight: 1.6,
            scale: 1.1,
        },
    ],
    directAxes: [
        { label: "Plate Discipline", aliases: ["on base %", "obp"], better: "high", weight: 0.8, scale: 0.020 },
        { label: "Power Output", aliases: ["slugging", "slg", "home runs", "hr"], better: "high", weight: 0.8, scale: 0.055 },
        { label: "Pitching Run Prevention", aliases: ["era", "earned run average"], better: "low", weight: 1.2, scale: 0.6 },
        { label: "Pitching Traffic Control", aliases: ["whip"], better: "low", weight: 1.0, scale: 0.15 },
    ],
    liveAxes: [
        { label: "Live Base Traffic", aliases: ["hits", "walks"], better: "high", weight: 0.5, scale: 2.5 },
        { label: "Live Strikeout Edge", aliases: ["strikeouts", "k"], better: "high", weight: 0.6, scale: 3.0 },
    ],
};

const SOCCER_PROFILE: SportProfile = {
    family: "soccer",
    baseTotal: 2.6,
    minTotal: 0.8,
    maxTotal: 6.5,
    maxTeamScore: 8,
    homeAdvantage: 0.22,
    marginStdDev: 1.45,
    regulationMinutes: 90,
    regulationPeriods: 2,
    clockMode: "countup",
    hasDraw: true,
    rankWeight: 0.3,
    marketWeight: 0.45,
    matchupPairs: [
        {
            label: "Goal Creation vs Concession",
            offenseAliases: ["points", "goals for", "goals", "gf", "goals per game"],
            defenseAllowAliases: ["opponent points", "goals against", "ga", "goals allowed"],
            weight: 1.25,
            scale: 1.15,
        },
        {
            label: "Shot Quality Matchup",
            offenseAliases: ["shots on target", "shots on goal", "sot"],
            defenseAllowAliases: ["shots on target allowed", "shots allowed", "opponent shots on target"],
            weight: 0.65,
            scale: 3.0,
        },
    ],
    directAxes: [
        { label: "Chance Creation", aliases: ["shots on target", "shots on goal", "sot"], better: "high", weight: 0.85, scale: 1.8 },
        { label: "Possession Control", aliases: ["possession"], better: "high", weight: 0.45, scale: 9.0 },
        { label: "Passing Security", aliases: ["pass %", "passing %", "pass completion"], better: "high", weight: 0.45, scale: 6.0 },
        { label: "Defensive Discipline", aliases: ["clean sheets"], better: "high", weight: 0.6, scale: 0.5 },
    ],
    liveAxes: [
        { label: "Live Shot Edge", aliases: ["shots on target", "shots on goal"], better: "high", weight: 1.0, scale: 1.7 },
        { label: "Live Shot Volume", aliases: ["total shots", "shots"], better: "high", weight: 0.55, scale: 3.5 },
        { label: "Live Possession Edge", aliases: ["possession"], better: "high", weight: 0.4, scale: 10.0 },
        { label: "Live Card Discipline", aliases: ["red cards"], better: "low", weight: 0.9, scale: 1.0 },
    ],
};

const HOCKEY_PROFILE: SportProfile = {
    family: "hockey",
    baseTotal: 6.1,
    minTotal: 2.5,
    maxTotal: 11,
    maxTeamScore: 10,
    homeAdvantage: 0.18,
    marginStdDev: 1.9,
    regulationMinutes: 60,
    regulationPeriods: 3,
    clockMode: "countdown",
    hasDraw: false,
    rankWeight: 0.35,
    marketWeight: 0.55,
    matchupPairs: [
        {
            label: "Goal Rate Matchup",
            offenseAliases: ["goals for", "goals", "gf/gp", "goals per game"],
            defenseAllowAliases: ["goals against", "ga/gp", "goals allowed"],
            weight: 1.7,
            scale: 0.55,
        },
    ],
    directAxes: [
        { label: "Power Play Edge", aliases: ["power play %", "pp%"], better: "high", weight: 0.9, scale: 6.0 },
        { label: "Penalty Kill Edge", aliases: ["penalty kill %", "pk%"], better: "high", weight: 0.8, scale: 6.0 },
        { label: "Save Percentage", aliases: ["save %", "sv%"], better: "high", weight: 1.0, scale: 2.8 },
        { label: "Shot Generation", aliases: ["shots", "shots per game"], better: "high", weight: 0.5, scale: 5.0 },
    ],
    liveAxes: [
        { label: "Live Shot Edge", aliases: ["shots on goal", "shots"], better: "high", weight: 0.7, scale: 4.0 },
        { label: "Live Special Teams", aliases: ["power play %", "pp%"], better: "high", weight: 0.5, scale: 6.0 },
    ],
};

const OTHER_PROFILE: SportProfile = {
    family: "other",
    baseTotal: 100,
    minTotal: 0,
    maxTotal: 300,
    maxTeamScore: 200,
    homeAdvantage: 0,
    marginStdDev: 12,
    regulationMinutes: 0,
    regulationPeriods: 0,
    clockMode: "none",
    hasDraw: false,
    rankWeight: 1.0,
    marketWeight: 1.0,
    matchupPairs: [],
    directAxes: [],
    liveAxes: [],
};

const STRICT_TEAM_HISTORY_MODE = true;

const normalizeLabel = (label: string): string => normalizeStatToken(label);

const parseScore = (val: string | undefined): number => {
    if (!val) return 0;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

const mean = (values: number[]): number => {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stdDev = (values: number[]): number => {
    if (values.length < 2) return 0;
    const avg = mean(values);
    const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
    return Math.sqrt(Math.max(0, variance));
};

const weightedMean = (items: Array<{ value: number; weight: number }>, fallback: number): number => {
    const valid = items.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0);
    if (valid.length === 0) return fallback;
    const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return fallback;
    return valid.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight;
};

const weightedStdDev = (items: Array<{ value: number; weight: number }>, fallback: number): number => {
    const valid = items.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0);
    if (valid.length < 2) return fallback;
    const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return fallback;
    const avg = valid.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight;
    const variance = valid.reduce((sum, item) => sum + (item.weight * ((item.value - avg) ** 2)), 0) / totalWeight;
    return Math.sqrt(Math.max(0, variance));
};

const blend = (base: number, next: number, weight: number): number => (base * (1 - weight)) + (next * weight);

const isMissingValue = (value: string): boolean => {
    const trimmed = String(value || "").trim();
    return trimmed === "" || trimmed === "-" || trimmed === "--" || trimmed === "N/A";
};

const statCoverageWeight = (stat: TeamStat, alias: string, sport: Sport): number => {
    const canonicalStatLabel = canonicalizeStatLabel(sport, stat.label);
    const canonicalAlias = canonicalizeStatLabel(sport, alias);
    const label = normalizeLabel(canonicalStatLabel);
    const target = normalizeLabel(canonicalAlias);
    if (label === target) return 100 + target.length;
    if (label.startsWith(`${target} `)) return 75 + target.length;
    if (label.includes(target)) return 50 + target.length;
    if (target.length >= 5 && target.includes(label)) return 15 + label.length;
    return 0;
};

const findMetric = (stats: TeamStat[], aliases: string[], sport: Sport): MetricMatch | null => {
    let best: { stat: TeamStat; score: number } | null = null;

    stats.forEach((stat) => {
        aliases.forEach((alias) => {
            const score = statCoverageWeight(stat, alias, sport);
            if (score <= 0) return;
            if (!best || score > best.score) best = { stat, score };
        });
    });

    if (!best) return null;
    const home = parseComplexStat(best.stat.homeValue);
    const away = parseComplexStat(best.stat.awayValue);
    if (Number.isNaN(home) || Number.isNaN(away)) return null;

    const bothMissing = isMissingValue(best.stat.homeValue) && isMissingValue(best.stat.awayValue);
    if (bothMissing) return null;

    return {
        label: best.stat.label,
        displayHome: best.stat.homeValue,
        displayAway: best.stat.awayValue,
        home,
        away,
    };
};

const getSportProfile = (league: Sport | string): SportProfile => {
    if (league === "NFL" || league === "NCAAF") return FOOTBALL_PROFILE;
    if (league === "NBA" || league === "NCAAM" || league === "NCAAW" || league === "WNBA") return BASKETBALL_PROFILE;
    if (league === "MLB") return BASEBALL_PROFILE;
    if (league === "NHL") return HOCKEY_PROFILE;
    if (SOCCER_LEAGUES.includes(league as Sport)) return SOCCER_PROFILE;
    return OTHER_PROFILE;
};

const toTeamLogFromGame = (game: Game, teamId: string): TeamGameLog | null => {
    if (!game.homeTeamId || !game.awayTeamId) return null;
    const homeScore = parseScore(game.homeScore);
    const awayScore = parseScore(game.awayScore);
    const dateMs = new Date(game.dateTime).getTime();
    if (!Number.isFinite(dateMs)) return null;

    if (String(game.homeTeamId) === String(teamId)) {
        return {
            gameId: game.id,
            dateMs,
            seasonYear: game.seasonYear,
            seasonType: game.seasonType,
            teamId: String(game.homeTeamId),
            opponentId: String(game.awayTeamId),
            pointsFor: homeScore,
            pointsAgainst: awayScore,
            isHome: true,
        };
    }
    if (String(game.awayTeamId) === String(teamId)) {
        return {
            gameId: game.id,
            dateMs,
            seasonYear: game.seasonYear,
            seasonType: game.seasonType,
            teamId: String(game.awayTeamId),
            opponentId: String(game.homeTeamId),
            pointsFor: awayScore,
            pointsAgainst: homeScore,
            isHome: false,
        };
    }
    return null;
};

const buildTeamLogs = (
    game: Game,
    teamId: string,
    cutoffMs: number,
    allGames: Game[],
): TeamGameLog[] => {
    const seasonYear = game.seasonYear;
    const finished = allGames
        .filter((g) => g.status === "finished" && g.id !== game.id)
        .filter((g) => {
            const t = new Date(g.dateTime).getTime();
            return Number.isFinite(t) && t < cutoffMs;
        })
        .filter((g) => String(g.homeTeamId) === String(teamId) || String(g.awayTeamId) === String(teamId));

    const sameSeason = seasonYear
        ? finished.filter((g) => Number(g.seasonYear) === Number(seasonYear))
        : finished;
    const pool = sameSeason.length >= 6 ? sameSeason : finished;

    return pool
        .map((g) => toTeamLogFromGame(g, teamId))
        .filter((g): g is TeamGameLog => Boolean(g))
        .sort((a, b) => b.dateMs - a.dateMs)
        .slice(0, 80);
};

const logWeight = (cutoffMs: number, entry: TeamGameLog, targetSeasonYear?: number): number => {
    const ageDays = Math.max(0, (cutoffMs - entry.dateMs) / 86400000);
    const decay = Math.exp(-ageDays / 55);
    const seasonWeight = targetSeasonYear && entry.seasonYear && Number(entry.seasonYear) !== Number(targetSeasonYear) ? 0.6 : 1;
    const playoffWeight = entry.seasonType === 3 ? 1.1 : 1.0;
    return decay * seasonWeight * playoffWeight;
};

const toSideObservations = (
    games: Game[],
    gameIdToSkip: string,
    cutoffMs: number,
    targetSeasonYear?: number,
): SideObservation[] => {
    const observations: SideObservation[] = [];
    games.forEach((entry) => {
        if (entry.status !== "finished" || entry.id === gameIdToSkip) return;
        if (!entry.homeTeamId || !entry.awayTeamId) return;
        const dateMs = new Date(entry.dateTime).getTime();
        if (!Number.isFinite(dateMs) || dateMs >= cutoffMs) return;

        const homeScore = parseScore(entry.homeScore);
        const awayScore = parseScore(entry.awayScore);
        const homeLog: TeamGameLog = {
            gameId: entry.id,
            dateMs,
            seasonYear: entry.seasonYear,
            seasonType: entry.seasonType,
            teamId: String(entry.homeTeamId),
            opponentId: String(entry.awayTeamId),
            pointsFor: homeScore,
            pointsAgainst: awayScore,
            isHome: true,
        };
        const awayLog: TeamGameLog = {
            gameId: entry.id,
            dateMs,
            seasonYear: entry.seasonYear,
            seasonType: entry.seasonType,
            teamId: String(entry.awayTeamId),
            opponentId: String(entry.homeTeamId),
            pointsFor: awayScore,
            pointsAgainst: homeScore,
            isHome: false,
        };
        const homeWeight = logWeight(cutoffMs, homeLog, targetSeasonYear);
        const awayWeight = logWeight(cutoffMs, awayLog, targetSeasonYear);

        if (homeWeight > 0) {
            observations.push({
                teamId: homeLog.teamId,
                opponentId: homeLog.opponentId,
                pointsFor: homeLog.pointsFor,
                pointsAgainst: homeLog.pointsAgainst,
                isHome: true,
                weight: homeWeight,
                dateMs,
            });
        }
        if (awayWeight > 0) {
            observations.push({
                teamId: awayLog.teamId,
                opponentId: awayLog.opponentId,
                pointsFor: awayLog.pointsFor,
                pointsAgainst: awayLog.pointsAgainst,
                isHome: false,
                weight: awayWeight,
                dateMs,
            });
        }
    });
    return observations;
};

const buildRelevantObservationSlice = (
    observations: SideObservation[],
    homeId: string,
    awayId: string,
): SideObservation[] => {
    if (observations.length === 0) return [];
    const relevant = new Set<string>([homeId, awayId]);

    for (let depth = 0; depth < 2; depth += 1) {
        let added = false;
        observations.forEach((obs) => {
            if (!relevant.has(obs.teamId) && !relevant.has(obs.opponentId)) return;
            if (!relevant.has(obs.teamId)) {
                relevant.add(obs.teamId);
                added = true;
            }
            if (!relevant.has(obs.opponentId)) {
                relevant.add(obs.opponentId);
                added = true;
            }
        });
        if (!added) break;
    }

    const sliced = observations.filter((obs) => relevant.has(obs.teamId) && relevant.has(obs.opponentId));
    if (sliced.length >= 40) return sliced;
    return observations;
};

const buildOpponentAdjustedContext = (
    profile: SportProfile,
    observations: SideObservation[],
    homeId: string,
    awayId: string,
    isNeutral: boolean,
): OpponentAdjustedContext | null => {
    if (observations.length < 14) return null;

    const byTeam = new Map<string, SideObservation[]>();
    observations.forEach((obs) => {
        const list = byTeam.get(obs.teamId);
        if (list) list.push(obs);
        else byTeam.set(obs.teamId, [obs]);
    });

    const homeEntries = byTeam.get(homeId) || [];
    const awayEntries = byTeam.get(awayId) || [];
    if (homeEntries.length < 3 || awayEntries.length < 3) return null;

    const teamIds = Array.from(byTeam.keys());
    const totalWeight = observations.reduce((sum, obs) => sum + obs.weight, 0);
    if (totalWeight <= 0) return null;

    const basePoints = observations.reduce((sum, obs) => sum + (obs.pointsFor * obs.weight), 0) / totalWeight;
    const homeObservations = observations.filter((obs) => obs.isHome);
    const observedHomeHalfEdge = weightedMean(
        homeObservations.map((obs) => ({
            value: (obs.pointsFor - obs.pointsAgainst) / 2,
            weight: obs.weight,
        })),
        profile.homeAdvantage / 2,
    );
    const homeEdgeHalf = isNeutral
        ? 0
        : clamp(
            blend(profile.homeAdvantage / 2, observedHomeHalfEdge, homeObservations.length >= 20 ? 0.85 : 0.45),
            -Math.max(0.2, profile.maxTeamScore * 0.08),
            Math.max(0.2, profile.maxTeamScore * 0.08),
        );

    const teamSampleWeight = new Map<string, number>();
    let offense = new Map<string, number>();
    let defense = new Map<string, number>(); // Positive values indicate stronger run/goal/point suppression.

    teamIds.forEach((teamId) => {
        const entries = byTeam.get(teamId) || [];
        const weight = entries.reduce((sum, entry) => sum + entry.weight, 0);
        teamSampleWeight.set(teamId, weight);

        const offRaw = weightedMean(
            entries.map((entry) => ({ value: entry.pointsFor - basePoints, weight: entry.weight })),
            0,
        );
        const defRaw = weightedMean(
            entries.map((entry) => ({ value: basePoints - entry.pointsAgainst, weight: entry.weight })),
            0,
        );
        const shrink = clamp(weight / (weight + 10), 0.2, 1);
        offense.set(teamId, offRaw * shrink);
        defense.set(teamId, defRaw * shrink);
    });

    for (let iter = 0; iter < 18; iter += 1) {
        const nextOffense = new Map<string, number>();
        const nextDefense = new Map<string, number>();

        teamIds.forEach((teamId) => {
            const entries = byTeam.get(teamId) || [];
            if (entries.length === 0) {
                nextOffense.set(teamId, offense.get(teamId) || 0);
                nextDefense.set(teamId, defense.get(teamId) || 0);
                return;
            }

            const offSamples = entries.map((entry) => {
                const opponentDefense = defense.get(entry.opponentId) || 0;
                const contextEdge = entry.isHome ? homeEdgeHalf : -homeEdgeHalf;
                return {
                    value: entry.pointsFor - basePoints + opponentDefense - contextEdge,
                    weight: entry.weight,
                };
            });

            const defSamples = entries.map((entry) => {
                const opponentOffense = offense.get(entry.opponentId) || 0;
                const contextEdge = entry.isHome ? homeEdgeHalf : -homeEdgeHalf;
                return {
                    value: basePoints + opponentOffense - contextEdge - entry.pointsAgainst,
                    weight: entry.weight,
                };
            });

            const rawOff = weightedMean(offSamples, offense.get(teamId) || 0);
            const rawDef = weightedMean(defSamples, defense.get(teamId) || 0);
            const weight = teamSampleWeight.get(teamId) || entries.length;
            const shrink = clamp(weight / (weight + 8), 0.2, 1);
            nextOffense.set(teamId, blend(offense.get(teamId) || 0, rawOff * shrink, 0.62));
            nextDefense.set(teamId, blend(defense.get(teamId) || 0, rawDef * shrink, 0.62));
        });

        const centerWeight = teamIds.reduce((sum, teamId) => sum + (teamSampleWeight.get(teamId) || 1), 0);
        const offCenter = centerWeight > 0
            ? teamIds.reduce(
                (sum, teamId) => sum + ((nextOffense.get(teamId) || 0) * (teamSampleWeight.get(teamId) || 1)),
                0,
            ) / centerWeight
            : 0;
        const defCenter = centerWeight > 0
            ? teamIds.reduce(
                (sum, teamId) => sum + ((nextDefense.get(teamId) || 0) * (teamSampleWeight.get(teamId) || 1)),
                0,
            ) / centerWeight
            : 0;

        teamIds.forEach((teamId) => {
            nextOffense.set(teamId, (nextOffense.get(teamId) || 0) - offCenter);
            nextDefense.set(teamId, (nextDefense.get(teamId) || 0) - defCenter);
        });

        offense = nextOffense;
        defense = nextDefense;
    }

    const homeOffenseRating = offense.get(homeId) || 0;
    const awayOffenseRating = offense.get(awayId) || 0;
    const homeDefenseRating = defense.get(homeId) || 0;
    const awayDefenseRating = defense.get(awayId) || 0;
    const gameHomeEdge = isNeutral ? 0 : homeEdgeHalf;

    const homeExpected = clamp(basePoints + homeOffenseRating - awayDefenseRating + gameHomeEdge, 0, profile.maxTeamScore);
    const awayExpected = clamp(basePoints + awayOffenseRating - homeDefenseRating - gameHomeEdge, 0, profile.maxTeamScore);

    return {
        basePoints,
        homeEdgeHalf,
        homeOffenseRating,
        awayOffenseRating,
        homeDefenseRating,
        awayDefenseRating,
        homeExpected,
        awayExpected,
    };
};

const buildHistoryPrior = (game: Game, profile: SportProfile): TeamHistoryPrior | null => {
    const homeId = game.homeTeamId;
    const awayId = game.awayTeamId;
    if (!homeId || !awayId) return null;

    const allGames = getInternalHistoricalGamesBySport(game.league as Sport);
    if (!allGames || allGames.length === 0) return null;

    const historyGames = allGames.filter((entry) => {
        if (entry.status !== "finished") return true;
        if (profile.family !== "basketball" && profile.family !== "football") return true;
        const homeScore = parseScore(entry.homeScore);
        const awayScore = parseScore(entry.awayScore);
        return !(homeScore === 0 && awayScore === 0);
    });

    const cutoffMs = Number.isFinite(new Date(game.dateTime).getTime()) ? new Date(game.dateTime).getTime() : Date.now();
    const homeLogs = buildTeamLogs(game, homeId, cutoffMs, historyGames);
    const awayLogs = buildTeamLogs(game, awayId, cutoffMs, historyGames);
    if (homeLogs.length < 3 || awayLogs.length < 3) return null;

    const homeOverallOff = weightedMean(
        homeLogs.map((log) => ({ value: log.pointsFor, weight: logWeight(cutoffMs, log, game.seasonYear) })),
        mean(homeLogs.map((log) => log.pointsFor)),
    );
    const homeOverallDef = weightedMean(
        homeLogs.map((log) => ({ value: log.pointsAgainst, weight: logWeight(cutoffMs, log, game.seasonYear) })),
        mean(homeLogs.map((log) => log.pointsAgainst)),
    );
    const awayOverallOff = weightedMean(
        awayLogs.map((log) => ({ value: log.pointsFor, weight: logWeight(cutoffMs, log, game.seasonYear) })),
        mean(awayLogs.map((log) => log.pointsFor)),
    );
    const awayOverallDef = weightedMean(
        awayLogs.map((log) => ({ value: log.pointsAgainst, weight: logWeight(cutoffMs, log, game.seasonYear) })),
        mean(awayLogs.map((log) => log.pointsAgainst)),
    );

    const homeHomeLogs = homeLogs.filter((log) => log.isHome);
    const awayAwayLogs = awayLogs.filter((log) => !log.isHome);
    const homeCtxOff = homeHomeLogs.length >= 3
        ? weightedMean(
            homeHomeLogs.map((log) => ({ value: log.pointsFor, weight: logWeight(cutoffMs, log, game.seasonYear) * 1.15 })),
            homeOverallOff,
        )
        : homeOverallOff;
    const homeCtxDef = homeHomeLogs.length >= 3
        ? weightedMean(
            homeHomeLogs.map((log) => ({ value: log.pointsAgainst, weight: logWeight(cutoffMs, log, game.seasonYear) * 1.15 })),
            homeOverallDef,
        )
        : homeOverallDef;
    const awayCtxOff = awayAwayLogs.length >= 3
        ? weightedMean(
            awayAwayLogs.map((log) => ({ value: log.pointsFor, weight: logWeight(cutoffMs, log, game.seasonYear) * 1.15 })),
            awayOverallOff,
        )
        : awayOverallOff;
    const awayCtxDef = awayAwayLogs.length >= 3
        ? weightedMean(
            awayAwayLogs.map((log) => ({ value: log.pointsAgainst, weight: logWeight(cutoffMs, log, game.seasonYear) * 1.15 })),
            awayOverallDef,
        )
        : awayOverallDef;

    let homeExpected = (homeCtxOff + awayCtxDef) / 2;
    let awayExpected = (awayCtxOff + homeCtxDef) / 2;

    const allObservations = toSideObservations(historyGames, game.id, cutoffMs, game.seasonYear);
    const relevantObservations = buildRelevantObservationSlice(allObservations, String(homeId), String(awayId));
    const opponentAdjusted = buildOpponentAdjustedContext(
        profile,
        relevantObservations,
        String(homeId),
        String(awayId),
        Boolean(game.isNeutral),
    );
    if (opponentAdjusted) {
        const adjustedWeight = clamp(Math.min(homeLogs.length, awayLogs.length) / 18, 0.38, 0.74);
        homeExpected = blend(homeExpected, opponentAdjusted.homeExpected, adjustedWeight);
        awayExpected = blend(awayExpected, opponentAdjusted.awayExpected, adjustedWeight);
    }

    const h2hLogs = historyGames
        .filter((g) => g.status === "finished" && g.id !== game.id)
        .filter((g) => {
            const t = new Date(g.dateTime).getTime();
            if (!Number.isFinite(t) || t >= cutoffMs) return false;
            const ids = [String(g.homeTeamId || ""), String(g.awayTeamId || "")];
            return ids.includes(String(homeId)) && ids.includes(String(awayId));
        })
        .map((g) => {
            const t = new Date(g.dateTime).getTime();
            const homeScore = parseScore(g.homeScore);
            const awayScore = parseScore(g.awayScore);
            const isCurrentHomeAtHome = String(g.homeTeamId) === String(homeId);
            return {
                dateMs: t,
                homePoints: isCurrentHomeAtHome ? homeScore : awayScore,
                awayPoints: isCurrentHomeAtHome ? awayScore : homeScore,
            };
        })
        .sort((a, b) => b.dateMs - a.dateMs)
        .slice(0, 10);

    let h2hWeightedHome = 0;
    let h2hWeightedAway = 0;
    let h2hWeightedMargin = 0;
    let h2hHomeWins = 0;
    let h2hAwayWins = 0;
    let h2hDraws = 0;

    if (h2hLogs.length > 0) {
        h2hHomeWins = h2hLogs.filter((log) => log.homePoints > log.awayPoints).length;
        h2hAwayWins = h2hLogs.filter((log) => log.awayPoints > log.homePoints).length;
        h2hDraws = h2hLogs.length - h2hHomeWins - h2hAwayWins;

        h2hWeightedHome = weightedMean(
            h2hLogs.map((log) => ({
                value: log.homePoints,
                weight: Math.exp(-Math.max(0, (cutoffMs - log.dateMs) / 86400000) / 70) * 1.2,
            })),
            mean(h2hLogs.map((log) => log.homePoints)),
        );
        h2hWeightedAway = weightedMean(
            h2hLogs.map((log) => ({
                value: log.awayPoints,
                weight: Math.exp(-Math.max(0, (cutoffMs - log.dateMs) / 86400000) / 70) * 1.2,
            })),
            mean(h2hLogs.map((log) => log.awayPoints)),
        );
        h2hWeightedMargin = weightedMean(
            h2hLogs.map((log) => ({
                value: log.homePoints - log.awayPoints,
                weight: Math.exp(-Math.max(0, (cutoffMs - log.dateMs) / 86400000) / 70) * 1.2,
            })),
            mean(h2hLogs.map((log) => log.homePoints - log.awayPoints)),
        );
        let h2hWeight = clamp(0.12 + (h2hLogs.length * 0.035), 0.12, 0.32);
        let h2hHomeTarget = h2hWeightedHome;
        let h2hAwayTarget = h2hWeightedAway;

        // Soccer H2H can be sparse and noisy. Limit one-off blowouts from dominating team priors.
        if (profile.family === "soccer") {
            const maxShift = clamp(0.45 + (h2hLogs.length * 0.08), 0.45, 0.95);
            h2hHomeTarget = clamp(h2hWeightedHome, homeExpected - maxShift, homeExpected + maxShift);
            h2hAwayTarget = clamp(h2hWeightedAway, awayExpected - maxShift, awayExpected + maxShift);
            h2hWeight = clamp(h2hWeight * 0.58, 0.06, 0.18);
            h2hWeightedMargin = h2hHomeTarget - h2hAwayTarget;
        }

        homeExpected = blend(homeExpected, h2hHomeTarget, h2hWeight);
        awayExpected = blend(awayExpected, h2hAwayTarget, h2hWeight);
    }

    homeExpected = clamp(homeExpected, 0, profile.maxTeamScore);
    awayExpected = clamp(awayExpected, 0, profile.maxTeamScore);
    const expectedTotal = Math.max(1, homeExpected + awayExpected);

    const homeAdjustedOffense = opponentAdjusted
        ? clamp(opponentAdjusted.basePoints + opponentAdjusted.homeOffenseRating, 0, profile.maxTeamScore)
        : homeCtxOff;
    const awayAdjustedOffense = opponentAdjusted
        ? clamp(opponentAdjusted.basePoints + opponentAdjusted.awayOffenseRating, 0, profile.maxTeamScore)
        : awayCtxOff;
    const homeAdjustedDefense = opponentAdjusted
        ? clamp(opponentAdjusted.basePoints - opponentAdjusted.homeDefenseRating, 0, profile.maxTeamScore)
        : homeCtxDef;
    const awayAdjustedDefense = opponentAdjusted
        ? clamp(opponentAdjusted.basePoints - opponentAdjusted.awayDefenseRating, 0, profile.maxTeamScore)
        : awayCtxDef;

    const marginSamples: Array<{ value: number; weight: number }> = [
        ...homeLogs.map((log) => ({ value: log.pointsFor - log.pointsAgainst, weight: logWeight(cutoffMs, log, game.seasonYear) })),
        ...awayLogs.map((log) => ({ value: log.pointsFor - log.pointsAgainst, weight: logWeight(cutoffMs, log, game.seasonYear) })),
    ];
    const scoringSamples: Array<{ value: number; weight: number }> = [
        ...homeLogs.map((log) => ({ value: log.pointsFor, weight: logWeight(cutoffMs, log, game.seasonYear) })),
        ...awayLogs.map((log) => ({ value: log.pointsFor, weight: logWeight(cutoffMs, log, game.seasonYear) })),
    ];
    if (h2hLogs.length > 0) {
        h2hLogs.forEach((log) => {
            const ageWeight = Math.exp(-Math.max(0, (cutoffMs - log.dateMs) / 86400000) / 70) * 1.35;
            marginSamples.push({ value: log.homePoints - log.awayPoints, weight: ageWeight });
            scoringSamples.push({ value: log.homePoints, weight: ageWeight });
            scoringSamples.push({ value: log.awayPoints, weight: ageWeight });
        });
    }

    const marginFallback = stdDev(marginSamples.map((sample) => sample.value));
    const scoringFallback = stdDev(scoringSamples.map((sample) => sample.value));
    const rawMarginVolatility = weightedStdDev(marginSamples, marginFallback > 0 ? marginFallback : Math.sqrt(expectedTotal) * 0.5);
    const rawScoringVolatility = weightedStdDev(scoringSamples, scoringFallback > 0 ? scoringFallback : Math.sqrt(expectedTotal) * 0.25);
    const marginVolatility = clamp(
        rawMarginVolatility,
        Math.max(0.65, Math.sqrt(expectedTotal) * 0.18),
        Math.max(1.5, Math.sqrt(expectedTotal) * 2.2),
    );
    const scoringVolatility = clamp(
        rawScoringVolatility,
        Math.max(0.35, Math.sqrt(expectedTotal) * 0.10),
        Math.max(1.0, Math.sqrt(expectedTotal) * 1.35),
    );

    return {
        homeExpected,
        awayExpected,
        total: homeExpected + awayExpected,
        margin: homeExpected - awayExpected,
        homeGames: homeLogs.length,
        awayGames: awayLogs.length,
        headToHeadGames: h2hLogs.length,
        homeOffense: homeCtxOff,
        awayOffense: awayCtxOff,
        homeDefense: homeCtxDef,
        awayDefense: awayCtxDef,
        homeAdjustedOffense,
        awayAdjustedOffense,
        homeAdjustedDefense,
        awayAdjustedDefense,
        headToHeadMargin: h2hWeightedMargin,
        headToHeadHomeWins: h2hHomeWins,
        headToHeadAwayWins: h2hAwayWins,
        headToHeadDraws: h2hDraws,
        marginVolatility,
        scoringVolatility,
    };
};

const uniqueByLabel = <T extends { label: string }>(arr: T[], sport: Sport): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    arr.forEach((item) => {
        const key = normalizeLabel(canonicalizeStatLabel(sport, item.label));
        if (seen.has(key)) return;
        seen.add(key);
        out.push(item);
    });
    return out;
};

const upsertFactorComparison = (
    factorBreakdown: FactorComparison[],
    label: string,
    homeValue: number,
    awayValue: number,
    displayHome: string,
    displayAway: string,
): void => {
    if (factorBreakdown.some((f) => normalizeLabel(f.label) === normalizeLabel(label))) return;
    factorBreakdown.push({
        label,
        homeValue: Number.isFinite(homeValue) ? homeValue : 0,
        awayValue: Number.isFinite(awayValue) ? awayValue : 0,
        displayHome,
        displayAway,
    });
};

const parseMoneyline = (value: string | undefined): number | null => {
    if (!value) return null;
    const m = value.match(/-?\d+/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return Number.isFinite(n) ? n : null;
};

const moneylineToImpliedProb = (moneyline: number): number => {
    if (moneyline < 0) return (-moneyline) / ((-moneyline) + 100);
    return 100 / (moneyline + 100);
};

const hasToken = (haystack: string, token: string): boolean => {
    if (!token) return false;
    return normalizeLabel(haystack).includes(normalizeLabel(token));
};

const parseSpreadToHomeEdge = (spread: string | undefined, game: Game): number | null => {
    if (!spread) return null;
    const match = spread.match(/([+-]?\d+(\.\d+)?)/);
    if (!match) return null;
    const line = parseFloat(match[1]);
    if (!Number.isFinite(line)) return null;

    const teamPart = spread.slice(0, match.index || 0).trim();
    const homeAbbr = getGameTeamAbbreviation(game, "home");
    const awayAbbr = getGameTeamAbbreviation(game, "away");
    const homeTokens = [
        game.homeTeam,
        homeAbbr,
        game.homeTeam.split(" ").slice(-1)[0] || "",
    ].filter(Boolean);
    const awayTokens = [
        game.awayTeam,
        awayAbbr,
        game.awayTeam.split(" ").slice(-1)[0] || "",
    ].filter(Boolean);

    const mentionsHome = homeTokens.some((token) => hasToken(teamPart, token));
    const mentionsAway = awayTokens.some((token) => hasToken(teamPart, token));
    if (!mentionsHome && !mentionsAway) return null;

    const magnitude = Math.abs(line);
    if (mentionsHome) return line < 0 ? magnitude : -magnitude;
    return line < 0 ? -magnitude : magnitude;
};

const parseCountdownClockInPeriodMinutes = (clock: string, periodLength: number): number => {
    const parsed = parseClockToMinutes(clock);
    const raw = String(clock || "").trim();
    if (!raw) return parsed;
    if (raw.includes(":") || raw.includes("+")) return parsed;

    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return parsed;
    if (numeric >= 0 && numeric <= (periodLength + 0.01)) return numeric;
    return parsed;
};

const parseSoccerClockReading = (
    clock: string,
    fallbackStatus?: string,
): { elapsedMinutes: number; baseMinutes: number; extraMinutes: number; hasPlus: boolean } => {
    const rawClock = String(clock || "").trim();
    const rawFallback = String(fallbackStatus || "").trim();
    if (!rawClock && !rawFallback) return { elapsedMinutes: 0, baseMinutes: 0, extraMinutes: 0, hasPlus: false };

    const parseSingle = (
        source: string,
    ): { elapsedMinutes: number; baseMinutes: number; extraMinutes: number; hasPlus: boolean; hasValue: boolean } => {
        const normalized = String(source || "").trim().replace(/[’]/g, "'");
        if (!normalized) return { elapsedMinutes: 0, baseMinutes: 0, extraMinutes: 0, hasPlus: false, hasValue: false };

        const plusMatch = normalized.match(/(\d+(?:\.\d+)?)\s*'?\s*\+\s*(\d+(?:\.\d+)?)\s*'?/);
        if (plusMatch) {
            const base = parseFloat(plusMatch[1]);
            const extra = parseFloat(plusMatch[2]);
            if (Number.isFinite(base) && Number.isFinite(extra)) {
                return {
                    elapsedMinutes: base + extra,
                    baseMinutes: base,
                    extraMinutes: extra,
                    hasPlus: true,
                    hasValue: true,
                };
            }
        }

        const minuteMarker = normalized.match(/(\d+(?:\.\d+)?)\s*'/);
        if (minuteMarker) {
            const minutes = parseFloat(minuteMarker[1]);
            if (Number.isFinite(minutes)) {
                return { elapsedMinutes: minutes, baseMinutes: minutes, extraMinutes: 0, hasPlus: false, hasValue: true };
            }
        }

        // Soccer feeds can provide plain minute clocks like "72" with no apostrophe.
        const plainMinuteToken = normalized.match(/^\s*(\d+(?:\.\d+)?)\s*'?\s*$/);
        if (plainMinuteToken) {
            const numericMinutes = parseFloat(plainMinuteToken[1]);
            if (Number.isFinite(numericMinutes) && numericMinutes >= 0) {
                return {
                    elapsedMinutes: numericMinutes,
                    baseMinutes: numericMinutes,
                    extraMinutes: 0,
                    hasPlus: false,
                    hasValue: true,
                };
            }
        }

        const hasClockShape = normalized.includes(":") || normalized.includes("'") || normalized.includes("+");
        const parsed = hasClockShape ? parseClockToMinutes(normalized) : NaN;
        if (Number.isFinite(parsed) && (parsed > 0 || /[0-9]/.test(normalized))) {
            return { elapsedMinutes: parsed, baseMinutes: parsed, extraMinutes: 0, hasPlus: false, hasValue: true };
        }

        return { elapsedMinutes: 0, baseMinutes: 0, extraMinutes: 0, hasPlus: false, hasValue: false };
    };

    const clockReading = parseSingle(rawClock);
    const fallbackReading = parseSingle(rawFallback);
    if (!clockReading.hasValue && !fallbackReading.hasValue) {
        return { elapsedMinutes: 0, baseMinutes: 0, extraMinutes: 0, hasPlus: false };
    }

    let elapsed = clockReading.hasValue ? clockReading.elapsedMinutes : fallbackReading.elapsedMinutes;
    let base = clockReading.hasValue ? clockReading.baseMinutes : fallbackReading.baseMinutes;
    let extra = 0;
    let hasPlus = false;

    const plusSource = [clockReading, fallbackReading]
        .filter((reading) => reading.hasPlus)
        .sort((a, b) => b.elapsedMinutes - a.elapsedMinutes)[0];
    if (plusSource) {
        hasPlus = true;
        extra = plusSource.extraMinutes;
        base = plusSource.baseMinutes;
        elapsed = Math.max(elapsed, plusSource.elapsedMinutes);
    }

    return {
        elapsedMinutes: elapsed,
        baseMinutes: base,
        extraMinutes: extra,
        hasPlus,
    };
};

const getSoccerTimingContext = (
    game: Game,
    details: GameDetails | null,
): { elapsedMinutes: number; targetMinutes: number; remainingMinutes: number; declaredExtraMinutes: number } => {
    const period = details?.period || game.period || 1;
    const reading = parseSoccerClockReading(details?.clock || game.clock || "", game.gameStatus);
    let elapsed = reading.elapsedMinutes;
    let declaredExtra = reading.hasPlus ? reading.extraMinutes : 0;

    if (period >= 2 && elapsed < 45) elapsed += 45;
    if (period >= 3 && elapsed < 90) elapsed += 90;
    if (period >= 4 && elapsed < 105) elapsed += 105;

    let target = period >= 3 ? 120 : 90;
    const statusText = `${details?.clock || game.clock || ""} ${game.gameStatus || ""}`.toUpperCase();
    const isEndedState = statusText.includes("FT") || statusText.includes("FINAL") || statusText.includes("PEN");

    if (period === 1) {
        const firstHalfExtra = Math.max(0, elapsed - 45);
        target = 90 + firstHalfExtra;
    } else if (period === 2) {
        if (elapsed >= 90) {
            const activeExtra = Math.max(0, elapsed - 90);
            declaredExtra = Math.max(declaredExtra, activeExtra);
            // Keep a small live buffer so stoppage-time matches retain remaining-time signal.
            const liveBuffer = isEndedState ? 0 : 1;
            target = 90 + declaredExtra + liveBuffer;
        } else {
            target = 90;
        }
    } else {
        if (elapsed >= 120) {
            const activeExtra = Math.max(0, elapsed - 120);
            declaredExtra = Math.max(declaredExtra, activeExtra);
            const liveBuffer = isEndedState ? 0 : 1;
            target = 120 + declaredExtra + liveBuffer;
        } else {
            target = 120;
        }
    }

    target = Math.max(target, elapsed, period >= 3 ? 120 : 90);
    const remaining = Math.max(0, target - elapsed);
    return {
        elapsedMinutes: elapsed,
        targetMinutes: target,
        remainingMinutes: remaining,
        declaredExtraMinutes: declaredExtra,
    };
};

const getElapsedFraction = (game: Game, details: GameDetails | null, profile: SportProfile): number => {
    if (profile.clockMode === "none") return 0;

    if (profile.clockMode === "inning") {
        const inning = details?.period || game.period || 1;
        return clamp((inning - 1) / 9, 0, 1);
    }

    const clock = details?.clock || game.clock || "00:00";
    const period = details?.period || game.period || 1;

    if (profile.family === "basketball") {
        const isNcaam = game.league === "NCAAM";
        const isNcaaw = game.league === "NCAAW";
        const isWnba = game.league === "WNBA";
        const periodLength = isNcaam ? 20 : (isNcaaw || isWnba ? 10 : 12);
        const regulationPeriods = isNcaam ? 2 : 4;
        const regulationMinutes = periodLength * regulationPeriods;
        const parsedClock = parseCountdownClockInPeriodMinutes(clock, periodLength);
        let elapsed = 0;
        let targetDuration = regulationMinutes;

        if (period <= regulationPeriods) {
            elapsed = ((period - 1) * periodLength) + (periodLength - parsedClock);
        } else {
            const overtimeIndex = period - regulationPeriods;
            const overtimeLength = 5;
            elapsed = regulationMinutes + ((overtimeIndex - 1) * overtimeLength) + (overtimeLength - parsedClock);
            targetDuration = regulationMinutes + (overtimeIndex * overtimeLength);
        }
        return clamp(elapsed / Math.max(targetDuration, elapsed, 1), 0, 1);
    }

    if (profile.clockMode === "countup") {
        if (profile.family === "soccer") {
            const timing = getSoccerTimingContext(game, details);
            return clamp(timing.elapsedMinutes / Math.max(timing.targetMinutes, 1), 0, 1);
        }
        let elapsed = parseClockToMinutes(clock);
        if (game.league !== "NHL" && period >= 2 && elapsed < 45) elapsed += 45;
        return clamp(elapsed / profile.regulationMinutes, 0, 1);
    }

    // countdown
    const periods = profile.regulationPeriods > 0 ? profile.regulationPeriods : 4;
    const periodLength = profile.regulationMinutes / periods;
    const parsedClock = parseCountdownClockInPeriodMinutes(clock, periodLength);
    if (period <= periods) {
        const elapsed = ((period - 1) * periodLength) + (periodLength - parsedClock);
        return clamp(elapsed / Math.max(profile.regulationMinutes, 1), 0, 1);
    }

    const overtimeIndex = period - periods;
    let overtimeLength = periodLength;
    if (profile.family === "hockey") overtimeLength = 5;
    if (profile.family === "football") overtimeLength = game.league === "NCAAF" ? 15 : 10;
    const elapsed = profile.regulationMinutes + ((overtimeIndex - 1) * overtimeLength) + (overtimeLength - parsedClock);
    const targetDuration = profile.regulationMinutes + (overtimeIndex * overtimeLength);
    return clamp(elapsed / Math.max(targetDuration, elapsed, 1), 0, 1);
};

const getSoccerIntensityAtMinute = (minute: number): number => {
    if (minute < 15) return 0.88;
    if (minute < 30) return 0.95;
    if (minute < 45) return 1.0;
    if (minute < 60) return 1.03;
    if (minute < 75) return 1.1;
    if (minute < 90) return 1.2;
    if (minute < 105) return 1.26;
    return 1.34;
};

const getSoccerRemainingIntensityShare = (elapsedMinutes: number, targetMinutes: number): number => {
    const safeTarget = Math.max(1, targetMinutes);
    const safeElapsed = clamp(elapsedMinutes, 0, safeTarget);
    if (safeElapsed >= safeTarget) return 0;

    let fullIntensity = 0;
    let remainingIntensity = 0;
    for (let minute = 0; minute < safeTarget; minute += 1) {
        const centerMinute = minute + 0.5;
        const intensity = getSoccerIntensityAtMinute(centerMinute);
        fullIntensity += intensity;
        if (centerMinute >= safeElapsed) remainingIntensity += intensity;
    }

    if (fullIntensity <= 0) return clamp((safeTarget - safeElapsed) / safeTarget, 0, 1);
    return clamp(remainingIntensity / fullIntensity, 0, 1);
};

const extractSoccerLiveSignals = (stats: TeamStat[], sport: Sport): SoccerLiveStatSignals => {
    const signals: SoccerLiveStatSignals = {
        homeShotsOnTarget: null,
        awayShotsOnTarget: null,
        homeShots: null,
        awayShots: null,
        homePossession: null,
        awayPossession: null,
        homeRedCards: null,
        awayRedCards: null,
    };

    stats.forEach((stat) => {
        const label = normalizeLabel(canonicalizeStatLabel(sport, stat.label));
        const homeVal = parseComplexStat(stat.homeValue);
        const awayVal = parseComplexStat(stat.awayValue);
        if (!Number.isFinite(homeVal) || !Number.isFinite(awayVal)) return;

        if (signals.homeShotsOnTarget === null && (
            label.includes("shots on target") ||
            label.includes("shots on goal") ||
            label === "sot"
        )) {
            signals.homeShotsOnTarget = homeVal;
            signals.awayShotsOnTarget = awayVal;
            return;
        }

        const isGenericShots = label.includes("shots") && !label.includes("target") && !label.includes("goal");
        if (signals.homeShots === null && (label.includes("total shots") || isGenericShots)) {
            signals.homeShots = homeVal;
            signals.awayShots = awayVal;
            return;
        }

        if (signals.homePossession === null && label.includes("possession")) {
            signals.homePossession = homeVal;
            signals.awayPossession = awayVal;
            return;
        }

        if (signals.homeRedCards === null && label.includes("red card")) {
            signals.homeRedCards = homeVal;
            signals.awayRedCards = awayVal;
        }
    });

    return signals;
};

const getSoccerSignalShareDelta = (signals: SoccerLiveStatSignals): { delta: number; weight: number; detail: string } => {
    let delta = 0;
    let contributors = 0;
    const parts: string[] = [];

    if (signals.homeShotsOnTarget !== null && signals.awayShotsOnTarget !== null) {
        const diff = signals.homeShotsOnTarget - signals.awayShotsOnTarget;
        delta += diff * 0.028;
        contributors += 1;
        parts.push(`SOT ${signals.homeShotsOnTarget}-${signals.awayShotsOnTarget}`);
    }
    if (signals.homeShots !== null && signals.awayShots !== null) {
        const diff = signals.homeShots - signals.awayShots;
        delta += diff * 0.008;
        contributors += 1;
        parts.push(`Shots ${signals.homeShots}-${signals.awayShots}`);
    }
    if (signals.homePossession !== null && signals.awayPossession !== null) {
        const diff = signals.homePossession - signals.awayPossession;
        delta += diff * 0.0025;
        contributors += 1;
        parts.push(`Poss ${signals.homePossession.toFixed(0)}-${signals.awayPossession.toFixed(0)}`);
    }
    if (signals.homeRedCards !== null && signals.awayRedCards !== null) {
        const diff = signals.homeRedCards - signals.awayRedCards;
        delta -= diff * 0.12;
        contributors += 1;
        parts.push(`Red ${signals.homeRedCards}-${signals.awayRedCards}`);
    }

    const weight = clamp(contributors / 4, 0, 1);
    return {
        delta: clamp(delta, -0.28, 0.28),
        weight,
        detail: parts.join(" | "),
    };
};

const computeSoccerDrawPrior = (
    game: Game,
    cutoffMs: number,
): SoccerDrawPrior => {
    const homeId = String(game.homeTeamId || "");
    const awayId = String(game.awayTeamId || "");
    if (!homeId || !awayId) {
        return {
            teamDrawRate: 0.27,
            h2hDrawRate: 0.27,
            weightedDrawRate: 0.27,
            sampleWeight: 0,
            sampleGames: 0,
        };
    }

    const sport = game.league as Sport;
    const allGames = getInternalHistoricalGamesBySport(sport).filter((entry) => {
        if (entry.status !== "finished") return false;
        if (!entry.homeTeamId || !entry.awayTeamId) return false;
        const dateMs = new Date(entry.dateTime).getTime();
        return Number.isFinite(dateMs) && dateMs < cutoffMs && entry.id !== game.id;
    });

    const weightedDrawRateForTeam = (teamId: string): { rate: number; games: number } => {
        const teamGames = allGames
            .filter((entry) => String(entry.homeTeamId) === teamId || String(entry.awayTeamId) === teamId)
            .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
            .slice(0, 80);

        if (teamGames.length === 0) return { rate: 0.27, games: 0 };

        let weightedDraw = 0;
        let weightedTotal = 0;
        teamGames.forEach((entry) => {
            const dateMs = new Date(entry.dateTime).getTime();
            const ageDays = Math.max(0, (cutoffMs - dateMs) / 86400000);
            const recency = Math.exp(-ageDays / 150);
            const seasonWeight = game.seasonYear && entry.seasonYear && Number(entry.seasonYear) !== Number(game.seasonYear) ? 0.72 : 1;
            const weight = recency * seasonWeight;
            if (weight <= 0) return;
            const isDraw = parseScore(entry.homeScore) === parseScore(entry.awayScore);
            weightedDraw += (isDraw ? 1 : 0) * weight;
            weightedTotal += weight;
        });

        if (weightedTotal <= 0) return { rate: 0.27, games: teamGames.length };
        return { rate: clamp(weightedDraw / weightedTotal, 0.04, 0.72), games: teamGames.length };
    };

    const homeDraw = weightedDrawRateForTeam(homeId);
    const awayDraw = weightedDrawRateForTeam(awayId);
    const teamDrawRate = clamp((homeDraw.rate + awayDraw.rate) / 2, 0.04, 0.72);

    const h2hGames = allGames
        .filter((entry) => {
            const h = String(entry.homeTeamId);
            const a = String(entry.awayTeamId);
            return (h === homeId && a === awayId) || (h === awayId && a === homeId);
        })
        .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
        .slice(0, 18);

    let h2hDrawRate = teamDrawRate;
    if (h2hGames.length > 0) {
        let drawCount = 0;
        h2hGames.forEach((entry) => {
            if (parseScore(entry.homeScore) === parseScore(entry.awayScore)) drawCount += 1;
        });
        h2hDrawRate = clamp(drawCount / h2hGames.length, 0.02, 0.85);
    }

    const weightedDrawRate = clamp((teamDrawRate * 0.76) + (h2hDrawRate * 0.24), 0.04, 0.8);
    const sampleGames = homeDraw.games + awayDraw.games + h2hGames.length;
    const sampleWeight = clamp(
        ((homeDraw.games + awayDraw.games) / 90) + (h2hGames.length / 22),
        0,
        1,
    );

    return {
        teamDrawRate,
        h2hDrawRate,
        weightedDrawRate,
        sampleWeight,
        sampleGames,
    };
};

const resolveLiveProfileShare = (
    offenseShare: number[] | null,
    offenseCount: number[] | null,
    defenseShare: number[] | null,
    defenseCount: number[] | null,
    binIndex: number,
    elapsedFraction: number,
): { share: number; samples: number } => {
    const fallbackShare = clamp(elapsedFraction, 0.03, 0.98);
    const values: Array<{ value: number; weight: number; count: number }> = [];

    const offenseVal = offenseShare && binIndex < offenseShare.length ? offenseShare[binIndex] : null;
    const offenseN = offenseCount && binIndex < offenseCount.length ? offenseCount[binIndex] : 0;
    if (offenseVal !== null && Number.isFinite(offenseVal) && offenseVal > 0 && offenseVal < 1.2) {
        values.push({
            value: offenseVal,
            weight: Math.max(0.2, Math.sqrt(Math.max(0, offenseN))),
            count: Math.max(0, offenseN),
        });
    }

    const defenseVal = defenseShare && binIndex < defenseShare.length ? defenseShare[binIndex] : null;
    const defenseN = defenseCount && binIndex < defenseCount.length ? defenseCount[binIndex] : 0;
    if (defenseVal !== null && Number.isFinite(defenseVal) && defenseVal > 0 && defenseVal < 1.2) {
        values.push({
            value: defenseVal,
            weight: Math.max(0.2, Math.sqrt(Math.max(0, defenseN))),
            count: Math.max(0, defenseN),
        });
    }

    if (values.length === 0) return { share: fallbackShare, samples: 0 };

    const weighted = values.reduce((sum, entry) => sum + (entry.value * entry.weight), 0);
    const weight = values.reduce((sum, entry) => sum + entry.weight, 0);
    const rawShare = weight > 0 ? (weighted / weight) : fallbackShare;

    // Keep shares in a realistic band around current elapsed fraction.
    const minShare = clamp(elapsedFraction * 0.55, 0.03, 0.92);
    const maxShare = clamp((elapsedFraction * 1.35) + 0.05, 0.20, 0.985);
    const share = clamp(rawShare, minShare, maxShare);
    const samples = values.reduce((sum, entry) => sum + entry.count, 0);
    return { share, samples };
};

const computeLiveTrajectoryProjection = (
    game: Game,
    profile: SportProfile,
    elapsedFraction: number,
    currentHome: number,
    currentAway: number,
): LiveTrajectoryProjection | null => {
    if (!game.homeTeamId || !game.awayTeamId) return null;
    if (elapsedFraction <= 0.08 || elapsedFraction >= 0.985) return null;

    const sport = game.league as Sport;
    const homeProfile = getInternalLiveScoringTeamProfile(sport, String(game.homeTeamId));
    const awayProfile = getInternalLiveScoringTeamProfile(sport, String(game.awayTeamId));
    if (!homeProfile && !awayProfile) return null;

    const binCount = Math.max(homeProfile?.binCount || 0, awayProfile?.binCount || 0);
    if (binCount < 4) return null;
    const binIndex = Math.min(binCount - 1, Math.max(0, Math.round(elapsedFraction * (binCount - 1))));

    const homeResolved = resolveLiveProfileShare(
        homeProfile?.offenseShare || null,
        homeProfile?.offenseCount || null,
        awayProfile?.defenseShare || null,
        awayProfile?.defenseCount || null,
        binIndex,
        elapsedFraction,
    );
    const awayResolved = resolveLiveProfileShare(
        awayProfile?.offenseShare || null,
        awayProfile?.offenseCount || null,
        homeProfile?.defenseShare || null,
        homeProfile?.defenseCount || null,
        binIndex,
        elapsedFraction,
    );

    const homeProjectedFinal = currentHome > 0
        ? clamp(currentHome / Math.max(homeResolved.share, 0.03), currentHome, profile.maxTeamScore)
        : 0;
    const awayProjectedFinal = currentAway > 0
        ? clamp(currentAway / Math.max(awayResolved.share, 0.03), currentAway, profile.maxTeamScore)
        : 0;

    const sampleSignal = clamp((homeResolved.samples + awayResolved.samples) / 40, 0, 1);
    const timeSignal = clamp((elapsedFraction - 0.12) / 0.64, 0, 1);
    const confidence = sampleSignal * timeSignal;
    if (confidence <= 0.05) return null;

    return {
        homeProjectedFinal,
        awayProjectedFinal,
        confidence,
        binIndex,
        homeShare: homeResolved.share,
        awayShare: awayResolved.share,
    };
};

const formatImpact = (impact: number, unit: string): string => {
    if (Math.abs(impact) >= 10) return `${impact > 0 ? "+" : ""}${impact.toFixed(1)}${unit}`;
    return `${impact > 0 ? "+" : ""}${impact.toFixed(2)}${unit}`;
};

const computeDirectAxisImpact = (
    stats: TeamStat[],
    sport: Sport,
    axes: DirectAxis[],
    findings: WeightedFinding[],
    factorBreakdown: FactorComparison[],
    impactMultiplier: number,
): { marginImpact: number; found: number } => {
    let marginImpact = 0;
    let found = 0;

    axes.forEach((axis) => {
        const metric = findMetric(stats, axis.aliases, sport);
        if (!metric) return;
        found += 1;

        const rawDiff = metric.home - metric.away;
        const orientedDiff = axis.better === "high" ? rawDiff : -rawDiff;
        const impact = (orientedDiff / axis.scale) * axis.weight * impactMultiplier;
        marginImpact += impact;

        const absImpact = Math.abs(impact);
        if (absImpact >= 0.08) {
            findings.push({
                label: axis.label,
                value: formatImpact(impact, axis.weight >= 1 ? " pts" : ""),
                impact: impact > 0 ? "positive" : impact < 0 ? "negative" : "neutral",
                description: `${metric.label}: ${metric.displayHome} vs ${metric.displayAway}`,
                magnitude: absImpact,
            });
        }

        upsertFactorComparison(
            factorBreakdown,
            axis.label,
            metric.home,
            metric.away,
            metric.displayHome,
            metric.displayAway,
        );
    });

    return { marginImpact, found };
};

const computePregameModel = (
    game: Game,
    details: GameDetails | null,
    profile: SportProfile,
): {
    projectedTotal: number;
    projectedMargin: number;
    findings: WeightedFinding[];
    factorBreakdown: FactorComparison[];
    coverage: number;
    baseMarginStdDev: number;
    scoringVolatility: number;
} => {
    const findings: WeightedFinding[] = [];
    const factorBreakdown: FactorComparison[] = [];

    const hasSeasonStats = Boolean(details?.seasonStats && details.seasonStats.length > 0);
    const shouldFallbackToGameStats = game.status !== "scheduled";
    const sourceStats = uniqueByLabel(
        hasSeasonStats
            ? (details?.seasonStats || [])
            : (shouldFallbackToGameStats ? (details?.stats || []) : []),
        game.league as Sport,
    );
    let projectedMargin = 0;
    let projectedTotal = profile.baseTotal;
    let baseMarginStdDev = Math.max(0.75, Math.sqrt(Math.max(1, profile.baseTotal)) * 0.62);
    let scoringVolatility = Math.max(0.4, Math.sqrt(Math.max(1, profile.baseTotal)) * 0.28);
    let possibleSignals = profile.matchupPairs.length + profile.directAxes.length + 2; // history prior (total + margin)
    let foundSignals = 0;
    const historyPrior = buildHistoryPrior(game, profile);
    const historyCoverage = historyPrior ? Math.min(historyPrior.homeGames, historyPrior.awayGames) : 0;
    const shouldUseFallbackContext = !STRICT_TEAM_HISTORY_MODE || historyCoverage < 6;
    if (shouldUseFallbackContext) possibleSignals += 2; // rank + market fallback only
    if (historyPrior?.headToHeadGames) possibleSignals += 1;

    if (historyPrior) {
        projectedTotal = blend(projectedTotal, historyPrior.total, 0.82);
        projectedMargin = blend(projectedMargin, historyPrior.margin, 0.85);
        baseMarginStdDev = historyPrior.marginVolatility;
        scoringVolatility = historyPrior.scoringVolatility;
        foundSignals += 2;
        const scorePrecision = profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball" ? 2 : 1;
        findings.push({
            label: "Team History Matchup Prior",
            value: `${historyPrior.homeExpected.toFixed(scorePrecision)}-${historyPrior.awayExpected.toFixed(scorePrecision)}`,
            impact: historyPrior.margin > 0 ? "positive" : historyPrior.margin < 0 ? "negative" : "neutral",
            description: `From ${historyPrior.homeGames} ${game.homeTeam} games vs ${historyPrior.awayGames} ${game.awayTeam} games`,
            magnitude: Math.max(0.35, Math.abs(historyPrior.margin) / Math.max(1, profile.marginStdDev)),
        });
        const opponentAdjustedHomeNet = historyPrior.homeAdjustedOffense - historyPrior.awayAdjustedDefense;
        const opponentAdjustedAwayNet = historyPrior.awayAdjustedOffense - historyPrior.homeAdjustedDefense;
        const opponentAdjustedEdge = opponentAdjustedHomeNet - opponentAdjustedAwayNet;
        if (Math.abs(opponentAdjustedEdge) >= 0.02) {
            findings.push({
                label: "Opponent-Adjusted Team Form",
                value: formatImpact(
                    opponentAdjustedEdge,
                    profile.family === "baseball"
                        ? " runs"
                        : profile.family === "soccer" || profile.family === "hockey"
                            ? " xG"
                            : " pts",
                ),
                impact: opponentAdjustedEdge > 0 ? "positive" : "negative",
                description: "Weighted for opponent strength and recency",
                magnitude: Math.max(0.25, Math.abs(opponentAdjustedEdge) / Math.max(1, profile.marginStdDev)),
            });
        }
        upsertFactorComparison(
            factorBreakdown,
            "Recent Offense Form",
            historyPrior.homeOffense,
            historyPrior.awayOffense,
            historyPrior.homeOffense.toFixed(scorePrecision),
            historyPrior.awayOffense.toFixed(scorePrecision),
        );
        upsertFactorComparison(
            factorBreakdown,
            "Recent Defense Form (Lower Better)",
            historyPrior.homeDefense,
            historyPrior.awayDefense,
            historyPrior.homeDefense.toFixed(scorePrecision),
            historyPrior.awayDefense.toFixed(scorePrecision),
        );
        upsertFactorComparison(
            factorBreakdown,
            "Opponent-Adjusted Offense",
            historyPrior.homeAdjustedOffense,
            historyPrior.awayAdjustedOffense,
            historyPrior.homeAdjustedOffense.toFixed(scorePrecision),
            historyPrior.awayAdjustedOffense.toFixed(scorePrecision),
        );
        upsertFactorComparison(
            factorBreakdown,
            "Opponent-Adjusted Defense (Lower Better)",
            historyPrior.homeAdjustedDefense,
            historyPrior.awayAdjustedDefense,
            historyPrior.homeAdjustedDefense.toFixed(scorePrecision),
            historyPrior.awayAdjustedDefense.toFixed(scorePrecision),
        );
        if (historyPrior.headToHeadGames > 0) {
            foundSignals += 1;
            const h2hRecord = historyPrior.headToHeadDraws > 0
                ? `${historyPrior.headToHeadHomeWins}-${historyPrior.headToHeadAwayWins}-${historyPrior.headToHeadDraws}`
                : `${historyPrior.headToHeadHomeWins}-${historyPrior.headToHeadAwayWins}`;
            const h2hUnit = profile.family === "baseball"
                ? " runs"
                : profile.family === "soccer" || profile.family === "hockey"
                    ? " goals"
                    : " pts";
            const h2hThreshold = Math.max(0.05, profile.marginStdDev * 0.015);
            const h2hImpact = historyPrior.headToHeadMargin > h2hThreshold
                ? "positive"
                : historyPrior.headToHeadMargin < -h2hThreshold
                    ? "negative"
                    : "neutral";
            findings.push({
                label: "Head-to-Head Context",
                value: `${h2hRecord} (${formatImpact(historyPrior.headToHeadMargin, h2hUnit)})`,
                impact: h2hImpact,
                description: `Direct matchup edge across ${historyPrior.headToHeadGames} meetings`,
                magnitude: Math.min(
                    1.2,
                    (historyPrior.headToHeadGames * 0.11) +
                        (Math.abs(historyPrior.headToHeadMargin) / Math.max(1, profile.marginStdDev)),
                ),
            });
        }
    }

    if (shouldUseFallbackContext && !game.isNeutral && profile.homeAdvantage !== 0) {
        projectedMargin += profile.homeAdvantage;
        findings.push({
            label: profile.family === "basketball" ? "Home Court Advantage" : "Home Advantage",
            value: formatImpact(profile.homeAdvantage, profile.homeAdvantage >= 1 ? " pts" : ""),
            impact: "positive",
            description: "Baseline location adjustment",
            magnitude: Math.abs(profile.homeAdvantage),
        });
    }

    if (shouldUseFallbackContext) {
        const homeRank = game.homeTeamRank;
        const awayRank = game.awayTeamRank;
        if (homeRank && awayRank) {
            const rankEdge = ((awayRank - homeRank) / 10) * profile.rankWeight;
            if (Math.abs(rankEdge) > 0.01) {
                projectedMargin += rankEdge;
                foundSignals += 1;
                findings.push({
                    label: "Ranking Differential",
                    value: formatImpact(rankEdge, profile.rankWeight >= 1 ? " pts" : ""),
                    impact: rankEdge > 0 ? "positive" : "negative",
                    description: `Rank ${homeRank} vs ${awayRank}`,
                    magnitude: Math.abs(rankEdge),
                });
            }
        }
    }

    let hasMoneylineSignal = false;
    if (shouldUseFallbackContext && (game.odds?.moneyLineHome || game.odds?.moneyLineAway)) {
        const homeMl = parseMoneyline(game.odds.moneyLineHome);
        const awayMl = parseMoneyline(game.odds.moneyLineAway);
        if (homeMl !== null && awayMl !== null) {
            hasMoneylineSignal = true;
            let homeProb = moneylineToImpliedProb(homeMl);
            let awayProb = moneylineToImpliedProb(awayMl);
            const norm = homeProb + awayProb;
            if (norm > 0) {
                homeProb /= norm;
                awayProb /= norm;
                const edge = (homeProb - awayProb) * profile.marketWeight;
                projectedMargin += edge;
                foundSignals += 1;
                findings.push({
                    label: "Market Pricing",
                    value: formatImpact(edge, profile.marketWeight >= 1 ? " pts" : ""),
                    impact: edge > 0 ? "positive" : "negative",
                    description: `Moneyline implied edge ${Math.round(homeProb * 100)}% vs ${Math.round(awayProb * 100)}%`,
                    magnitude: Math.abs(edge),
                });
            }
        }
    }

    if (shouldUseFallbackContext && !hasMoneylineSignal) {
        const spreadEdge = parseSpreadToHomeEdge(game.odds?.spread, game);
        if (spreadEdge !== null) {
            const scaled = spreadEdge * (profile.marketWeight * 0.28);
            projectedMargin += scaled;
            foundSignals += 1;
            findings.push({
                label: "Market Spread Signal",
                value: formatImpact(scaled, profile.family === "soccer" ? " xG" : " pts"),
                impact: scaled > 0 ? "positive" : scaled < 0 ? "negative" : "neutral",
                description: `Spread input ${game.odds?.spread}`,
                magnitude: Math.abs(scaled),
            });
        }
    }

    const matchupTotals: number[] = [];
    profile.matchupPairs.forEach((pair) => {
            const offenseMetric = findMetric(sourceStats, pair.offenseAliases, game.league as Sport);
            const defenseMetric = findMetric(sourceStats, pair.defenseAllowAliases, game.league as Sport);
        if (!offenseMetric || !defenseMetric) return;
        foundSignals += 1;

        const homeExpected = (offenseMetric.home + defenseMetric.away) / 2;
        const awayExpected = (offenseMetric.away + defenseMetric.home) / 2;
        matchupTotals.push(homeExpected + awayExpected);

        const edge = ((homeExpected - awayExpected) / pair.scale) * pair.weight;
        projectedMargin += edge;

        findings.push({
            label: pair.label,
            value: formatImpact(
                edge,
                profile.family === "baseball"
                    ? " runs"
                    : profile.family === "soccer" || profile.family === "hockey"
                        ? " xG"
                        : " pts",
            ),
            impact: edge > 0 ? "positive" : edge < 0 ? "negative" : "neutral",
            description: `${offenseMetric.label} vs ${defenseMetric.label}`,
            magnitude: Math.abs(edge),
        });

        upsertFactorComparison(
            factorBreakdown,
            pair.label,
            homeExpected,
            awayExpected,
            homeExpected.toFixed(profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball" ? 2 : 1),
            awayExpected.toFixed(profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball" ? 2 : 1),
        );
    });

    if (matchupTotals.length > 0) {
        const meanMatchupTotal = matchupTotals.reduce((sum, v) => sum + v, 0) / matchupTotals.length;
        const referenceTotal = historyPrior ? historyPrior.total : profile.baseTotal;
        const ratioToReference = referenceTotal > 0 ? (meanMatchupTotal / referenceTotal) : 1;
        let minRatio = 0.4;
        let maxRatio = 1.9;
        if (profile.family === "basketball") {
            minRatio = 0.62;
            maxRatio = 1.45;
        } else if (profile.family === "football") {
            minRatio = 0.5;
            maxRatio = 1.6;
        } else if (profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball") {
            minRatio = 0.28;
            maxRatio = 2.4;
        }

        const isPlausible = Number.isFinite(meanMatchupTotal) &&
            meanMatchupTotal > 0 &&
            ratioToReference >= minRatio &&
            ratioToReference <= maxRatio;

        if (isPlausible) {
            projectedTotal = (meanMatchupTotal * 0.8) + (profile.baseTotal * 0.2);
        } else {
            findings.push({
                label: "Matchup Total Guardrail",
                value: `Ignored ${meanMatchupTotal.toFixed(profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball" ? 2 : 1)}`,
                impact: "neutral",
                description: `Outlier matchup total vs reference ${referenceTotal.toFixed(profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball" ? 2 : 1)}`,
                magnitude: 0.32,
            });
        }
    }

    const directAxisResult = computeDirectAxisImpact(sourceStats, game.league as Sport, profile.directAxes, findings, factorBreakdown, 1.0);
    projectedMargin += directAxisResult.marginImpact;
    foundSignals += directAxisResult.found;

    const marketTotal = shouldUseFallbackContext ? parseOverUnder(game.odds?.overUnder) : null;
    if (marketTotal && marketTotal > 0) {
        projectedTotal = (projectedTotal * 0.75) + (marketTotal * 0.25);
    }

    if (profile.family === "football") {
        const weather = getWeatherImpact(details?.gameInfo?.weather);
        if (weather.impactScore !== 0) {
            projectedTotal += weather.impactScore;
            findings.push({
                label: "Weather Adjustment",
                value: `${weather.impactScore > 0 ? "+" : ""}${weather.impactScore.toFixed(1)} total`,
                impact: "neutral",
                description: details?.gameInfo?.weather || "Weather conditions",
                magnitude: Math.abs(weather.impactScore) * 0.4,
            });
        }
    }

    if (profile.family === "basketball" && game.status === "scheduled" && historyPrior) {
        const pointsMetric = findMetric(sourceStats, ["points per game", "points", "ppg", "pts"], game.league as Sport);
        const oppPointsMetric = findMetric(sourceStats, ["opponent points", "points allowed", "opp points"], game.league as Sport);
        const statExpectedTotal = pointsMetric && oppPointsMetric
            ? (((pointsMetric.home + oppPointsMetric.away) / 2) + ((pointsMetric.away + oppPointsMetric.home) / 2))
            : historyPrior.total;

        const matchupFloor = Math.max(
            profile.minTotal,
            historyPrior.total * 0.82,
            statExpectedTotal * 0.76,
        );

        if (projectedTotal < matchupFloor) {
            projectedTotal = matchupFloor;
            findings.push({
                label: "Basketball Total Guardrail",
                value: `${projectedTotal.toFixed(1)}`,
                impact: "neutral",
                description: "Floor enforced from team-scoring history and opponent-adjusted matchup context",
                magnitude: 0.52,
            });
        }

        const historyHomeBaseline = (historyPrior.homeOffense + historyPrior.awayDefense) / 2;
        const historyAwayBaseline = (historyPrior.awayOffense + historyPrior.homeDefense) / 2;
        let projectedHome = (projectedTotal + projectedMargin) / 2;
        let projectedAway = (projectedTotal - projectedMargin) / 2;

        const floorHome = Math.max(1, historyHomeBaseline * 0.78);
        const floorAway = Math.max(1, historyAwayBaseline * 0.78);
        const ceilHome = Math.max(floorHome + 1, historyHomeBaseline * 1.34);
        const ceilAway = Math.max(floorAway + 1, historyAwayBaseline * 1.34);

        const originalHome = projectedHome;
        const originalAway = projectedAway;
        projectedHome = clamp(projectedHome, floorHome, ceilHome);
        projectedAway = clamp(projectedAway, floorAway, ceilAway);
        if (Math.abs(projectedHome - originalHome) > 0.25 || Math.abs(projectedAway - originalAway) > 0.25) {
            findings.push({
                label: "Basketball Matchup Side Floors",
                value: `${projectedHome.toFixed(1)}-${projectedAway.toFixed(1)}`,
                impact: "neutral",
                description: "Side projections anchored to opponent-adjusted team scoring history",
                magnitude: 0.58,
            });
        }
        projectedTotal = projectedHome + projectedAway;
        projectedMargin = projectedHome - projectedAway;
    }

    if (profile.family === "soccer" && game.status === "scheduled" && historyPrior) {
        const sampleDepth = Math.max(1, Math.min(historyPrior.homeGames, historyPrior.awayGames));
        const homeRaw = (projectedTotal + projectedMargin) / 2;
        const awayRaw = (projectedTotal - projectedMargin) / 2;

        // Anchor hard to opponent-adjusted team-history rates to avoid volatile pre-game spikes.
        const anchorWeight = clamp(0.58 + ((sampleDepth - 8) * 0.02), 0.58, 0.9);
        const anchoredHome = blend(homeRaw, historyPrior.homeExpected, anchorWeight);
        const anchoredAway = blend(awayRaw, historyPrior.awayExpected, anchorWeight);

        const scoreBand = clamp(historyPrior.scoringVolatility * 1.7, 0.5, 1.75);
        const homeFloor = Math.max(0, historyPrior.homeExpected - scoreBand);
        const homeCeil = Math.min(profile.maxTeamScore, historyPrior.homeExpected + scoreBand);
        const awayFloor = Math.max(0, historyPrior.awayExpected - scoreBand);
        const awayCeil = Math.min(profile.maxTeamScore, historyPrior.awayExpected + scoreBand);
        const boundedHome = clamp(anchoredHome, homeFloor, homeCeil);
        const boundedAway = clamp(anchoredAway, awayFloor, awayCeil);

        const baselineMargin = historyPrior.homeExpected - historyPrior.awayExpected;
        const marginBand = clamp((historyPrior.marginVolatility * 1.05) + 0.3, 0.6, 1.85);
        const boundedMargin = clamp(boundedHome - boundedAway, baselineMargin - marginBand, baselineMargin + marginBand);
        const boundedTotal = clamp(
            boundedHome + boundedAway,
            Math.max(profile.minTotal, historyPrior.total * 0.7),
            Math.min(profile.maxTotal, historyPrior.total * 1.35),
        );

        projectedTotal = boundedTotal;
        projectedMargin = boundedMargin;

        findings.push({
            label: "Soccer Matchup Envelope",
            value: `${boundedHome.toFixed(2)}-${boundedAway.toFixed(2)}`,
            impact: "neutral",
            description: "Pregame projection constrained by opponent-adjusted team history and matchup volatility",
            magnitude: 0.56,
        });
    }

    projectedTotal = clamp(projectedTotal, profile.minTotal, profile.maxTotal);
    if (!Number.isFinite(projectedMargin)) projectedMargin = 0;
    if (!historyPrior) {
        baseMarginStdDev = Math.max(0.75, Math.sqrt(Math.max(1, projectedTotal)) * 0.62);
        scoringVolatility = Math.max(0.4, Math.sqrt(Math.max(1, projectedTotal)) * 0.28);
    }
    baseMarginStdDev = clamp(baseMarginStdDev, 0.6, Math.max(1.5, Math.sqrt(Math.max(1, projectedTotal)) * 2.4));
    scoringVolatility = clamp(scoringVolatility, 0.25, Math.max(1.0, Math.sqrt(Math.max(1, projectedTotal)) * 1.6));

    const coverage = possibleSignals > 0 ? clamp(foundSignals / possibleSignals, 0, 1) : 0;
    return {
        projectedTotal,
        projectedMargin,
        findings,
        factorBreakdown,
        coverage,
        baseMarginStdDev,
        scoringVolatility,
    };
};

const applyLiveAdjustments = (
    game: Game,
    details: GameDetails | null,
    profile: SportProfile,
    baseProjectedTotal: number,
    baseProjectedMargin: number,
    findings: WeightedFinding[],
    factorBreakdown: FactorComparison[],
): {
    projectedTotal: number;
    projectedMargin: number;
    projectedHome: number;
    projectedAway: number;
    elapsedFraction: number;
} => {
    const currentHome = parseScore(game.homeScore);
    const currentAway = parseScore(game.awayScore);
    const currentTotal = currentHome + currentAway;
    const currentMargin = currentHome - currentAway;

    const elapsedFraction = getElapsedFraction(game, details, profile);
    const remainingFraction = clamp(1 - elapsedFraction, 0, 1);
    const soccerTiming = profile.family === "soccer" ? getSoccerTimingContext(game, details) : null;
    let paceTotal = elapsedFraction > 0.08 ? currentTotal / elapsedFraction : baseProjectedTotal;
    let paceWeight = clamp(Math.pow(elapsedFraction, 1.35), 0, 1);
    if (profile.family === "soccer" && soccerTiming) {
        const intensityRemainingShare = getSoccerRemainingIntensityShare(
            soccerTiming.elapsedMinutes,
            soccerTiming.targetMinutes,
        );
        const intensityElapsedShare = clamp(1 - intensityRemainingShare, 0.06, 0.99);
        paceTotal = currentTotal / intensityElapsedShare;
        paceWeight = clamp((elapsedFraction - 0.18) / 0.78, 0, 0.42);
    }
    let projectedTotal = (baseProjectedTotal * (1 - paceWeight)) + (paceTotal * paceWeight);
    projectedTotal = clamp(projectedTotal, currentTotal, profile.maxTotal);
    const remainingTotal = Math.max(0, projectedTotal - currentTotal);

    const liveSourceStats = uniqueByLabel(details?.stats || [], game.league as Sport);
    const liveAxisResult = computeDirectAxisImpact(
        liveSourceStats,
        game.league as Sport,
        profile.liveAxes,
        findings,
        factorBreakdown,
        clamp(0.35 + (elapsedFraction * 0.95), 0.35, 1.2),
    );

    let situationalBoost = 0;
    if ((profile.family === "football" || profile.family === "baseball") && details?.situation?.possession) {
        const possession = String(details.situation.possession);
        if (possession === String(game.homeTeamId)) situationalBoost += profile.family === "football" ? 0.7 : 0.25;
        if (possession === String(game.awayTeamId)) situationalBoost -= profile.family === "football" ? 0.7 : 0.25;
        if (Math.abs(situationalBoost) > 0) {
            findings.push({
                label: "Possession Leverage",
                value: formatImpact(situationalBoost, profile.family === "football" ? " pts" : ""),
                impact: situationalBoost > 0 ? "positive" : "negative",
                description: details.situation.possessionText || "Current possession context",
                magnitude: Math.abs(situationalBoost),
            });
        }
    }

    const futureMargin = (baseProjectedMargin + liveAxisResult.marginImpact + situationalBoost) * remainingFraction;
    let projectedMargin = currentMargin + futureMargin;

    let projectedHome = clamp(
        currentHome + (remainingTotal / 2) + (futureMargin / 2),
        currentHome,
        profile.maxTeamScore,
    );
    let projectedAway = clamp(
        currentAway + (remainingTotal / 2) - (futureMargin / 2),
        currentAway,
        profile.maxTeamScore,
    );

    // Blend toward each side's observed live pace so hot first halves are carried forward.
    if (profile.clockMode !== "none" && profile.clockMode !== "inning" && elapsedFraction > 0.06) {
        const safeElapsed = Math.max(elapsedFraction, 0.06);
        const paceHomeFinal = clamp(currentHome / safeElapsed, currentHome, profile.maxTeamScore);
        const paceAwayFinal = clamp(currentAway / safeElapsed, currentAway, profile.maxTeamScore);
        const paceWeight = clamp(
            (profile.family === "basketball" ? 0.18 : 0.12) + (Math.pow(elapsedFraction, 1.08) * (profile.family === "basketball" ? 0.68 : 0.5)),
            0,
            profile.family === "basketball" ? 0.86 : 0.7,
        );
        projectedHome = blend(projectedHome, paceHomeFinal, paceWeight);
        projectedAway = blend(projectedAway, paceAwayFinal, paceWeight);
    }

    const trajectoryProjection = computeLiveTrajectoryProjection(
        game,
        profile,
        elapsedFraction,
        currentHome,
        currentAway,
    );
    if (trajectoryProjection) {
        const maxWeight = profile.family === "basketball" ? 0.8 : 0.66;
        const trajectoryWeight = clamp(trajectoryProjection.confidence * maxWeight, 0.06, maxWeight);
        projectedHome = blend(projectedHome, trajectoryProjection.homeProjectedFinal, trajectoryWeight);
        projectedAway = blend(projectedAway, trajectoryProjection.awayProjectedFinal, trajectoryWeight);
        findings.push({
            label: "Historical In-Game Trajectory",
            value: `bin ${trajectoryProjection.binIndex + 1}`,
            impact: "neutral",
            description: `Team checkpoint curves imply share ${trajectoryProjection.homeShare.toFixed(3)}-${trajectoryProjection.awayShare.toFixed(3)} at ${(elapsedFraction * 100).toFixed(0)}% elapsed`,
            magnitude: 0.5 + (trajectoryProjection.confidence * 0.8),
        });
    }

    if (profile.family === "basketball" && elapsedFraction >= 0.28) {
        const baseHomeFinal = Math.max(1, (baseProjectedTotal + baseProjectedMargin) / 2);
        const baseAwayFinal = Math.max(1, (baseProjectedTotal - baseProjectedMargin) / 2);
        const homeOverPace = currentHome / Math.max(1, baseHomeFinal * Math.max(elapsedFraction, 0.12));
        const awayOverPace = currentAway / Math.max(1, baseAwayFinal * Math.max(elapsedFraction, 0.12));
        const aggressiveShareCap = clamp(elapsedFraction + 0.03, 0.22, 0.82);
        let floorApplied = false;

        if (homeOverPace > 1.08 && currentHome > 0) {
            const floorHome = clamp(currentHome / aggressiveShareCap, currentHome, profile.maxTeamScore);
            if (floorHome > projectedHome) {
                projectedHome = floorHome;
                floorApplied = true;
            }
        }
        if (awayOverPace > 1.08 && currentAway > 0) {
            const floorAway = clamp(currentAway / aggressiveShareCap, currentAway, profile.maxTeamScore);
            if (floorAway > projectedAway) {
                projectedAway = floorAway;
                floorApplied = true;
            }
        }

        if (floorApplied) {
            findings.push({
                label: "Basketball Pace Persistence",
                value: `share cap ${aggressiveShareCap.toFixed(3)}`,
                impact: "neutral",
                description: "High first-half scoring pace anchored against historical under-projection",
                magnitude: 0.65,
            });
        }
    }

    projectedHome = clamp(projectedHome, currentHome, profile.maxTeamScore);
    projectedAway = clamp(projectedAway, currentAway, profile.maxTeamScore);
    projectedTotal = clamp(projectedHome + projectedAway, currentTotal, profile.maxTotal);
    projectedMargin = projectedHome - projectedAway;

    findings.push({
        label: "Live Pace Blend",
        value: `${(elapsedFraction * 100).toFixed(0)}% elapsed`,
        impact: "neutral",
        description: `Projected total ${projectedTotal.toFixed(profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball" ? 2 : 1)}`,
        magnitude: Math.max(0.2, elapsedFraction * 1.5),
    });
    if (soccerTiming && soccerTiming.declaredExtraMinutes > 0 && soccerTiming.elapsedMinutes >= 90) {
        findings.push({
            label: "Declared Stoppage Time",
            value: `+${soccerTiming.declaredExtraMinutes.toFixed(0)} min`,
            impact: "neutral",
            description: `${soccerTiming.remainingMinutes.toFixed(1)} minute(s) modeled as remaining`,
            magnitude: 0.5,
        });
    }

    return {
        projectedTotal,
        projectedMargin,
        projectedHome,
        projectedAway,
        elapsedFraction,
    };
};

const computePoissonOutcome = (homeLambda: number, awayLambda: number): { home: number; draw: number; away: number } => {
    const maxGoals = 12;
    let home = 0;
    let draw = 0;
    let away = 0;
    const safeHome = clamp(homeLambda, 0.05, 10);
    const safeAway = clamp(awayLambda, 0.05, 10);

    for (let h = 0; h <= maxGoals; h += 1) {
        for (let a = 0; a <= maxGoals; a += 1) {
            const p = poissonProbability(h, safeHome) * poissonProbability(a, safeAway);
            if (h > a) home += p;
            else if (h === a) draw += p;
            else away += p;
        }
    }

    const total = home + draw + away;
    if (total <= 0) return { home: 33.3, draw: 33.4, away: 33.3 };
    return {
        home: (home / total) * 100,
        draw: (draw / total) * 100,
        away: (away / total) * 100,
    };
};

const computePoissonOutcomeFromCurrent = (
    currentHome: number,
    currentAway: number,
    homeRemainingLambda: number,
    awayRemainingLambda: number,
): { home: number; draw: number; away: number } => {
    const safeHome = clamp(homeRemainingLambda, 0, 8);
    const safeAway = clamp(awayRemainingLambda, 0, 8);
    const maxAdds = Math.max(8, Math.ceil((safeHome + safeAway) * 3.5));
    let home = 0;
    let draw = 0;
    let away = 0;

    for (let hAdd = 0; hAdd <= maxAdds; hAdd += 1) {
        for (let aAdd = 0; aAdd <= maxAdds; aAdd += 1) {
            const p = poissonProbability(hAdd, safeHome) * poissonProbability(aAdd, safeAway);
            const finalHome = currentHome + hAdd;
            const finalAway = currentAway + aAdd;
            if (finalHome > finalAway) home += p;
            else if (finalHome === finalAway) draw += p;
            else away += p;
        }
    }

    const total = home + draw + away;
    if (total <= 0) return { home: 33.3, draw: 33.4, away: 33.3 };
    return {
        home: (home / total) * 100,
        draw: (draw / total) * 100,
        away: (away / total) * 100,
    };
};

const computeSoccerLiveRemainingLambdas = (
    game: Game,
    details: GameDetails | null,
    baseProjectedTotal: number,
    projectedHome: number,
    projectedAway: number,
    baseProjectedMargin: number,
    elapsedFraction: number,
    liveStats: TeamStat[],
): {
    homeRemainingLambda: number;
    awayRemainingLambda: number;
    timing: { elapsedMinutes: number; targetMinutes: number; remainingMinutes: number; declaredExtraMinutes: number };
    signalSummary: string;
    shareDelta: number;
    totalRemaining: number;
} => {
    const timing = getSoccerTimingContext(game, details);
    const currentHome = parseScore(game.homeScore);
    const currentAway = parseScore(game.awayScore);
    const currentTotal = currentHome + currentAway;
    const goalDiff = currentHome - currentAway;

    const baseProjectedHome = Math.max(projectedHome, currentHome);
    const baseProjectedAway = Math.max(projectedAway, currentAway);
    const baseRemainingHome = Math.max(0, baseProjectedHome - currentHome);
    const baseRemainingAway = Math.max(0, baseProjectedAway - currentAway);
    const projectionRemainingTotal = baseRemainingHome + baseRemainingAway;

    const intensityRemainingShare = getSoccerRemainingIntensityShare(
        timing.elapsedMinutes,
        timing.targetMinutes,
    );
    const baselineRemainingTotal = Math.max(0, baseProjectedTotal * intensityRemainingShare);

    let totalRemaining = blend(baselineRemainingTotal, projectionRemainingTotal, 0.57);
    if (elapsedFraction > 0.08) {
        const paceProjectedTotal = currentTotal / Math.max(elapsedFraction, 0.08);
        const paceRemaining = Math.max(0, paceProjectedTotal - currentTotal);
        const paceWeight = clamp((elapsedFraction - 0.2) / 0.75, 0, 0.32);
        totalRemaining = blend(totalRemaining, paceRemaining, paceWeight);
    }

    if (goalDiff === 0 && timing.remainingMinutes <= 18) {
        const lateTieConsolidation = clamp((18 - timing.remainingMinutes) / 18, 0, 1);
        totalRemaining *= (1 - (lateTieConsolidation * 0.14));
    }
    if (Math.abs(goalDiff) >= 2) {
        totalRemaining *= clamp(1 - ((Math.abs(goalDiff) - 1) * 0.08), 0.72, 1);
    }

    const minuteFloor = Math.max(0, timing.remainingMinutes * 0.0045);
    const minuteCap = Math.max(
        0.09,
        ((timing.remainingMinutes / Math.max(1, timing.targetMinutes)) * 5.3) + 0.14,
    );
    totalRemaining = clamp(totalRemaining, minuteFloor, minuteCap);

    const baseShare = projectionRemainingTotal > 0
        ? clamp(baseRemainingHome / projectionRemainingTotal, 0.1, 0.9)
        : clamp(0.5 + ((baseProjectedMargin / Math.max(1, baseProjectedTotal)) * 0.38), 0.12, 0.88);

    const signals = extractSoccerLiveSignals(liveStats, game.league as Sport);
    const shareSignal = getSoccerSignalShareDelta(signals);
    let homeShare = clamp(baseShare + (shareSignal.delta * shareSignal.weight), 0.08, 0.92);

    const urgency = clamp(1 - (timing.remainingMinutes / 36), 0, 1);
    if (goalDiff > 0) {
        const awayChase = Math.min(3, goalDiff) * (0.05 + (0.06 * urgency));
        homeShare -= awayChase;
    } else if (goalDiff < 0) {
        const homeChase = Math.min(3, Math.abs(goalDiff)) * (0.05 + (0.06 * urgency));
        homeShare += homeChase;
    }
    homeShare = clamp(homeShare, 0.06, 0.94);

    const homeRemainingLambda = clamp(totalRemaining * homeShare, 0, 7.5);
    const awayRemainingLambda = clamp(totalRemaining * (1 - homeShare), 0, 7.5);

    return {
        homeRemainingLambda,
        awayRemainingLambda,
        timing,
        signalSummary: shareSignal.detail,
        shareDelta: shareSignal.delta * shareSignal.weight,
        totalRemaining,
    };
};

const renormalizeOutcomes = (
    home: number,
    away: number,
    draw: number,
): { home: number; away: number; draw: number } => {
    const safeHome = Math.max(0, Number.isFinite(home) ? home : 0);
    const safeAway = Math.max(0, Number.isFinite(away) ? away : 0);
    const safeDraw = Math.max(0, Number.isFinite(draw) ? draw : 0);
    const total = safeHome + safeAway + safeDraw;
    if (total <= 0) return { home: 50, away: 50, draw: 0 };
    return {
        home: (safeHome / total) * 100,
        away: (safeAway / total) * 100,
        draw: (safeDraw / total) * 100,
    };
};

const applyOutcomeCertaintyCap = (
    home: number,
    away: number,
    draw: number,
    cap: number,
): { home: number; away: number; draw: number } => {
    const normalized = renormalizeOutcomes(home, away, draw);
    const outcomes = [
        { key: "home" as const, value: normalized.home },
        { key: "away" as const, value: normalized.away },
        { key: "draw" as const, value: normalized.draw },
    ];
    const maxIndex = outcomes.reduce((best, entry, idx) => (entry.value > outcomes[best].value ? idx : best), 0);
    if (outcomes[maxIndex].value <= cap) return normalized;

    const overflow = outcomes[maxIndex].value - cap;
    outcomes[maxIndex].value = cap;

    const otherIndices = outcomes.map((_, idx) => idx).filter((idx) => idx !== maxIndex);
    const otherTotal = otherIndices.reduce((sum, idx) => sum + outcomes[idx].value, 0);
    if (otherTotal <= 0) {
        const split = overflow / otherIndices.length;
        otherIndices.forEach((idx) => {
            outcomes[idx].value = Math.max(0, outcomes[idx].value + split);
        });
    } else {
        otherIndices.forEach((idx) => {
            outcomes[idx].value += overflow * (outcomes[idx].value / otherTotal);
        });
    }

    return renormalizeOutcomes(outcomes[0].value, outcomes[1].value, outcomes[2].value);
};

const finalizeConfidence = (
    game: Game,
    homeWinProb: number,
    awayWinProb: number,
    drawProb: number,
    coverage: number,
    elapsedFraction: number,
    findings: WeightedFinding[],
): { value: number; breakdown: ConfidenceBreakdown } => {
    const outcomes: Array<{ key: "home" | "away" | "draw"; value: number }> = [
        { key: "home", value: homeWinProb },
        { key: "away", value: awayWinProb },
    ];
    if (drawProb > 0.01) outcomes.push({ key: "draw", value: drawProb });
    outcomes.sort((a, b) => b.value - a.value);

    const topOutcome = outcomes[0] || { key: "home" as const, value: 50 };
    const runnerUpOutcome = outcomes[1] || { key: topOutcome.key, value: topOutcome.value };
    const decisiveness = clamp(topOutcome.value - runnerUpOutcome.value, 0, 100);
    const coverageSignal = clamp(coverage, 0, 1);
    const decisivenessSignal = clamp(decisiveness / 60, 0, 1);
    const strongestFindings = [...findings]
        .sort((a, b) => b.magnitude - a.magnitude)
        .slice(0, 4);
    const evidenceMean = strongestFindings.length > 0
        ? strongestFindings.reduce((sum, finding) => sum + finding.magnitude, 0) / strongestFindings.length
        : 0;
    const evidenceStrength = clamp(evidenceMean / 1.25, 0, 1);
    const liveProgress = game.status === "in_progress" ? clamp(elapsedFraction, 0, 1) : 0;

    const base = 34;
    const coveragePoints = coverageSignal * 30;
    const decisivenessPoints = decisivenessSignal * 24;
    const evidencePoints = evidenceStrength * 8;
    const livePoints = liveProgress * 20;

    let confidence = base + coveragePoints + decisivenessPoints + evidencePoints + livePoints;
    if (game.status === "finished") confidence = 99;
    else confidence = game.status === "in_progress"
        ? clamp(confidence, 35, 98)
        : clamp(confidence, 32, 96);
    const confidenceRounded = Math.round(confidence);

    const summary = game.status === "finished"
        ? "Final game result is deterministic."
        : `Confidence is ${confidenceRounded}%. We found ${Math.round(coverageSignal * 100)}% of key matchup signals. The top result leads by ${decisiveness.toFixed(1)} points (${topOutcome.value.toFixed(1)}% vs ${runnerUpOutcome.value.toFixed(1)}%). Signal strength is ${Math.round(evidenceStrength * 100)}%${game.status === "in_progress" ? `, with ${Math.round(liveProgress * 100)}% game progress already reflected.` : "."}`;

    return {
        value: confidence,
        breakdown: {
            base,
            coverage: coverageSignal,
            coveragePoints,
            decisiveness,
            decisivenessPoints,
            evidenceStrength,
            evidencePoints,
            liveProgress,
            livePoints,
            topOutcome: topOutcome.key,
            topOutcomeProbability: topOutcome.value,
            runnerUpProbability: runnerUpOutcome.value,
            formula: "34 + coverage*30 + decisiveness*24 + evidence*8 + liveProgress*20",
            summary,
        },
    };
};

const toTopBreakdowns = (findings: WeightedFinding[]): {
    calculationBreakdown: CalculationDetailItem[];
    keyFactors: string[];
} => {
    const sorted = [...findings].sort((a, b) => b.magnitude - a.magnitude);
    const calculationBreakdown = sorted.slice(0, 8).map((f) => ({
        label: f.label,
        value: f.value,
        impact: f.impact,
        description: f.description,
    }));
    const keyFactors = sorted
        .filter((f) => f.magnitude >= 0.3)
        .slice(0, 3)
        .map((f) => f.label);

    return {
        calculationBreakdown,
        keyFactors: keyFactors.length > 0 ? keyFactors : ["Statistical Baseline"],
    };
};

const roundProjectedScore = (value: number, profile: SportProfile): number => {
    if (profile.family === "soccer" || profile.family === "hockey" || profile.family === "baseball") {
        return Math.max(0, Math.round(value));
    }
    return Math.max(0, Math.round(value));
};

export const runProbabilityModel = (game: Game, details: GameDetails | null): ModelOutcome => {
    const profile = getSportProfile(game.league);
    const {
        projectedTotal: baseProjectedTotal,
        projectedMargin: baseProjectedMargin,
        findings,
        factorBreakdown,
        coverage,
        baseMarginStdDev,
        scoringVolatility,
    } = computePregameModel(game, details, profile);

    let projectedHome = (baseProjectedTotal / 2) + (baseProjectedMargin / 2);
    let projectedAway = (baseProjectedTotal / 2) - (baseProjectedMargin / 2);
    let projectedMargin = baseProjectedMargin;
    let elapsedFraction = 0;

    if (game.status === "in_progress") {
        const live = applyLiveAdjustments(
            game,
            details,
            profile,
            baseProjectedTotal,
            baseProjectedMargin,
            findings,
            factorBreakdown,
        );
        projectedHome = live.projectedHome;
        projectedAway = live.projectedAway;
        projectedMargin = live.projectedMargin;
        elapsedFraction = live.elapsedFraction;
    } else {
        projectedHome = clamp(projectedHome, parseScore(game.homeScore), profile.maxTeamScore);
        projectedAway = clamp(projectedAway, parseScore(game.awayScore), profile.maxTeamScore);
    }

    let winProbabilityHome = 50;
    let winProbabilityAway = 50;
    let drawProbability = 0;

    if (game.status === "finished") {
        const homeScore = parseScore(game.homeScore);
        const awayScore = parseScore(game.awayScore);
        projectedHome = homeScore;
        projectedAway = awayScore;
        if (homeScore > awayScore) {
            winProbabilityHome = 100;
            winProbabilityAway = 0;
            drawProbability = 0;
        } else if (awayScore > homeScore) {
            winProbabilityHome = 0;
            winProbabilityAway = 100;
            drawProbability = 0;
        } else if (profile.hasDraw) {
            winProbabilityHome = 0;
            winProbabilityAway = 0;
            drawProbability = 100;
        } else {
            winProbabilityHome = 50;
            winProbabilityAway = 50;
            drawProbability = 0;
        }
    } else if (profile.hasDraw) {
        if (game.status === "in_progress") {
            const currentHome = parseScore(game.homeScore);
            const currentAway = parseScore(game.awayScore);
            const liveSourceStats = uniqueByLabel(details?.stats || [], game.league as Sport);
            if (profile.family === "soccer") {
                const soccerLive = computeSoccerLiveRemainingLambdas(
                    game,
                    details,
                    baseProjectedTotal,
                    projectedHome,
                    projectedAway,
                    baseProjectedMargin,
                    elapsedFraction,
                    liveSourceStats,
                );

                const poisson = computePoissonOutcomeFromCurrent(
                    currentHome,
                    currentAway,
                    soccerLive.homeRemainingLambda,
                    soccerLive.awayRemainingLambda,
                );

                const cutoffMs = Number.isFinite(new Date(game.dateTime).getTime())
                    ? new Date(game.dateTime).getTime()
                    : Date.now();
                const drawPrior = computeSoccerDrawPrior(game, cutoffMs);
                const goalDiff = Math.abs(currentHome - currentAway);
                let drawPriorPct = clamp(drawPrior.weightedDrawRate * 100, 2, 82);
                if (goalDiff > 0) {
                    drawPriorPct *= clamp(1 - (goalDiff * 0.18), 0.45, 1);
                }
                if (goalDiff === 0 && soccerLive.timing.remainingMinutes <= 25) {
                    drawPriorPct += clamp((25 - soccerLive.timing.remainingMinutes) * 0.45, 0, 10);
                }
                const stateDrawCap = goalDiff >= 2
                    ? clamp(soccerLive.timing.remainingMinutes * 4.6, 0, 22)
                    : goalDiff === 1
                        ? clamp(8 + (soccerLive.timing.remainingMinutes * 2.8), 8, 58)
                        : 94.5;
                const drawBlendWeight = clamp(0.08 + (drawPrior.sampleWeight * 0.26), 0.08, 0.34);
                let adjustedDraw = blend(poisson.draw, drawPriorPct, drawBlendWeight);
                adjustedDraw = clamp(adjustedDraw, 0.1, stateDrawCap);

                const nonDrawPoisson = Math.max(0.0001, poisson.home + poisson.away);
                const nonDrawTarget = Math.max(0, 100 - adjustedDraw);
                winProbabilityHome = nonDrawTarget * (poisson.home / nonDrawPoisson);
                winProbabilityAway = nonDrawTarget * (poisson.away / nonDrawPoisson);
                drawProbability = adjustedDraw;

                findings.push({
                    label: "Soccer Remaining Goal Intensity",
                    value: `lambda ${soccerLive.homeRemainingLambda.toFixed(2)}-${soccerLive.awayRemainingLambda.toFixed(2)}`,
                    impact: "neutral",
                    description: `${soccerLive.timing.remainingMinutes.toFixed(1)} minute(s) remaining, modeled total ${soccerLive.totalRemaining.toFixed(2)} goals`,
                    magnitude: 0.62,
                });
                findings.push({
                    label: "Soccer Draw Prior Calibration",
                    value: `${drawProbability.toFixed(1)}% draw`,
                    impact: "neutral",
                    description: `Team draw profile ${(drawPrior.teamDrawRate * 100).toFixed(1)}%, H2H ${(drawPrior.h2hDrawRate * 100).toFixed(1)}% across ${drawPrior.sampleGames} sampled games`,
                    magnitude: 0.58,
                });
                if (soccerLive.signalSummary) {
                    findings.push({
                        label: "Soccer Live Stat Pressure",
                        value: `${soccerLive.shareDelta > 0 ? "+" : ""}${(soccerLive.shareDelta * 100).toFixed(1)} share pts`,
                        impact: soccerLive.shareDelta > 0 ? "positive" : soccerLive.shareDelta < 0 ? "negative" : "neutral",
                        description: soccerLive.signalSummary,
                        magnitude: 0.42,
                    });
                }
            } else {
                let homeRemainingLambda = Math.max(0, projectedHome - currentHome);
                let awayRemainingLambda = Math.max(0, projectedAway - currentAway);
                const timing = profile.family === "soccer" ? getSoccerTimingContext(game, details) : null;
                const remainingFraction = clamp(1 - elapsedFraction, 0, 1);
                const matchupRatePerMinute = Math.max(0.0001, baseProjectedTotal / Math.max(profile.regulationMinutes, 1));
                const expectedRemainingTotal = matchupRatePerMinute * (timing
                    ? timing.remainingMinutes
                    : (profile.regulationMinutes * remainingFraction));
                const conservativeFloor = Math.max(0, expectedRemainingTotal * 0.4);
                const currentRemainingTotal = homeRemainingLambda + awayRemainingLambda;

                if (currentRemainingTotal < conservativeFloor) {
                    const homeShare = currentRemainingTotal > 0
                        ? clamp(homeRemainingLambda / currentRemainingTotal, 0.2, 0.8)
                        : clamp(0.5 + ((baseProjectedMargin / Math.max(1, baseProjectedTotal)) * 0.35), 0.2, 0.8);
                    const topUp = conservativeFloor - currentRemainingTotal;
                    homeRemainingLambda += topUp * homeShare;
                    awayRemainingLambda += topUp * (1 - homeShare);
                }

                const poisson = computePoissonOutcomeFromCurrent(
                    currentHome,
                    currentAway,
                    homeRemainingLambda,
                    awayRemainingLambda,
                );
                winProbabilityHome = poisson.home;
                winProbabilityAway = poisson.away;
                drawProbability = poisson.draw;

                findings.push({
                    label: "Live Remaining Goal Model",
                    value: `lambda ${homeRemainingLambda.toFixed(2)}-${awayRemainingLambda.toFixed(2)}`,
                    impact: "neutral",
                    description: `${Math.round(remainingFraction * 100)}% match time remaining`,
                    magnitude: 0.55,
                });
            }
        } else {
            const poisson = computePoissonOutcome(projectedHome, projectedAway);
            if (profile.family === "soccer") {
                const cutoffMs = Number.isFinite(new Date(game.dateTime).getTime())
                    ? new Date(game.dateTime).getTime()
                    : Date.now();
                const drawPrior = computeSoccerDrawPrior(game, cutoffMs);
                const drawPriorPct = clamp(drawPrior.weightedDrawRate * 100, 7, 68);
                const drawBlendWeight = clamp(0.1 + (drawPrior.sampleWeight * 0.22), 0.1, 0.32);
                const adjustedDraw = clamp(blend(poisson.draw, drawPriorPct, drawBlendWeight), 2, 70);
                const nonDrawPoisson = Math.max(0.0001, poisson.home + poisson.away);
                const nonDrawTarget = Math.max(0, 100 - adjustedDraw);
                winProbabilityHome = nonDrawTarget * (poisson.home / nonDrawPoisson);
                winProbabilityAway = nonDrawTarget * (poisson.away / nonDrawPoisson);
                drawProbability = adjustedDraw;

                findings.push({
                    label: "Soccer Draw Propensity",
                    value: `${drawProbability.toFixed(1)}%`,
                    impact: "neutral",
                    description: `Draw profile from team + matchup history (${drawPrior.sampleGames} games sampled)`,
                    magnitude: 0.44,
                });
            } else {
                winProbabilityHome = poisson.home;
                winProbabilityAway = poisson.away;
                drawProbability = poisson.draw;
            }
        }
    } else {
        const remainingFraction = game.status === "in_progress" ? clamp(1 - elapsedFraction, 0.04, 1) : 1;
        const currentTotal = parseScore(game.homeScore) + parseScore(game.awayScore);
        const projectedFinalTotal = Math.max(1, projectedHome + projectedAway);
        const remainingScoring = game.status === "in_progress"
            ? clamp(projectedFinalTotal - currentTotal, 0, projectedFinalTotal)
            : projectedFinalTotal;

        const primaryStdDev = Math.max(0.65, baseMarginStdDev * Math.sqrt(remainingFraction));
        const paceUncertainty = game.status === "in_progress"
            ? Math.sqrt(Math.max(0.25, remainingScoring)) * (0.16 + ((scoringVolatility / projectedFinalTotal) * 0.28))
            : 0;
        const tailStdDev = Math.max(
            primaryStdDev * 1.55,
            primaryStdDev + (scoringVolatility * Math.sqrt(remainingFraction) * 0.95) + paceUncertainty,
        );

        const baseHomeWinProb = normalCDF(projectedMargin, 0, primaryStdDev);
        const tailHomeWinProb = normalCDF(projectedMargin, 0, tailStdDev);
        winProbabilityHome = ((baseHomeWinProb * 0.84) + (tailHomeWinProb * 0.16)) * 100;

        if (game.status === "in_progress") {
            const certaintyCap = clamp(99.4 - (remainingFraction * 6.6), 92, 99.4);
            winProbabilityHome = clamp(winProbabilityHome, 100 - certaintyCap, certaintyCap);
            findings.push({
                label: "Live Uncertainty Envelope",
                value: `Cap ${certaintyCap.toFixed(1)}%`,
                impact: "neutral",
                description: `Matchup-specific volatility (sigma ${primaryStdDev.toFixed(2)}) with ${Math.round(remainingFraction * 100)}% game time left`,
                magnitude: 0.45,
            });
        } else {
            const pregameCap = 97.4;
            winProbabilityHome = clamp(winProbabilityHome, 100 - pregameCap, pregameCap);
        }

        winProbabilityAway = 100 - winProbabilityHome;
        drawProbability = 0;
    }

    if (game.status !== "finished") {
        const remainingFraction = game.status === "in_progress" ? clamp(1 - elapsedFraction, 0, 1) : 1;
        const certaintyCap = game.status === "in_progress"
            ? (profile.family === "soccer"
                ? clamp(96.4 - (remainingFraction * 22.5), 74, 96.4)
                : clamp(99.1 - (remainingFraction * 10.8), 90.5, 99.1))
            : (profile.family === "soccer"
                ? clamp(89.5 + (coverage * 4.0), 88, 92.5)
                : clamp(95.2 + (coverage * 1.8), 93.5, 97.4));
        const capped = applyOutcomeCertaintyCap(
            winProbabilityHome,
            winProbabilityAway,
            drawProbability,
            certaintyCap,
        );
        winProbabilityHome = capped.home;
        winProbabilityAway = capped.away;
        drawProbability = capped.draw;
        findings.push({
            label: "Non-Terminal Certainty Cap",
            value: `${certaintyCap.toFixed(1)}%`,
            impact: "neutral",
            description: game.status === "in_progress"
                ? `${Math.round(remainingFraction * 100)}% time remaining`
                : "Pre-game uncertainty guardrail applied",
            magnitude: 0.4,
        });
    }

    winProbabilityHome = clamp(winProbabilityHome, 0, 100);
    winProbabilityAway = clamp(winProbabilityAway, 0, 100);
    drawProbability = clamp(drawProbability, 0, 100);

    const probSum = winProbabilityHome + winProbabilityAway + drawProbability;
    if (probSum > 0) {
        winProbabilityHome = (winProbabilityHome / probSum) * 100;
        winProbabilityAway = (winProbabilityAway / probSum) * 100;
        drawProbability = (drawProbability / probSum) * 100;
    }

    const confidenceResult = finalizeConfidence(
        game,
        winProbabilityHome,
        winProbabilityAway,
        drawProbability,
        coverage,
        elapsedFraction,
        findings,
    );
    const { calculationBreakdown, keyFactors } = toTopBreakdowns(findings);
    const sortedFactorBreakdown = [...factorBreakdown]
        .sort((a, b) => Math.abs(b.homeValue - b.awayValue) - Math.abs(a.homeValue - a.awayValue))
        .slice(0, 10);

    return {
        winProbabilityHome,
        winProbabilityAway,
        drawProbability,
        predictedScoreHome: roundProjectedScore(projectedHome, profile),
        predictedScoreAway: roundProjectedScore(projectedAway, profile),
        confidence: confidenceResult.value,
        confidenceBreakdown: confidenceResult.breakdown,
        keyFactors,
        factorBreakdown: sortedFactorBreakdown,
        calculationBreakdown,
    };
};
