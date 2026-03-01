import { Sport } from "../types";
import {
  ensureInternalSportLoaded,
  getInternalHistoricalGamesBySport,
  getInternalTeamStatsBySport,
} from "./internalDbService";

export type IntegritySeverity = "warning" | "critical";

export interface IntegrityIssue {
  teamId: string;
  severity: IntegritySeverity;
  code:
    | "MISSING_TEAM_STATS"
    | "ZERO_GAMES_PLAYED"
    | "SCHEDULE_COVERAGE_LOW"
    | "POINTS_AVG_MISMATCH"
    | "OPP_POINTS_AVG_MISMATCH";
  message: string;
  expected?: number;
  actual?: number;
}

export interface SportIntegrityReport {
  sport: Sport;
  generatedAt: string;
  seasonYear?: number;
  teamsAudited: number;
  issues: IntegrityIssue[];
  averageCoverage: number;
}

const parseNumeric = (value: string | number | undefined | null): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(String(value).replace(/,/g, "").replace("%", "").replace("+", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const getStatNumeric = (stats: Array<{ label: string; value: string }>, labels: string[]): number | null => {
  for (const stat of stats) {
    const normalized = stat.label.toLowerCase().trim();
    if (labels.some((label) => normalized === label.toLowerCase().trim())) {
      return parseNumeric(stat.value);
    }
  }
  return null;
};

export const auditInternalSportData = async (sport: Sport): Promise<SportIntegrityReport> => {
  await ensureInternalSportLoaded(sport);
  const games = getInternalHistoricalGamesBySport(sport);
  const teamStatsByTeamId = getInternalTeamStatsBySport(sport);

  const finishedGames = games.filter((game) => {
    if (game.status !== "finished") return false;
    if (typeof game.seasonType === "number" && game.seasonType === 1) return false;
    const homeScore = parseNumeric(game.homeScore);
    const awayScore = parseNumeric(game.awayScore);
    return homeScore !== null && awayScore !== null;
  });

  const seasonYears = finishedGames
    .map((game) => Number(game.seasonYear))
    .filter((year) => Number.isFinite(year) && year > 1900) as number[];
  const seasonYear = seasonYears.length > 0 ? Math.max(...seasonYears) : undefined;
  const seasonGames = seasonYear
    ? finishedGames.filter((game) => Number(game.seasonYear) === seasonYear)
    : finishedGames;

  const byTeam = new Map<string, { gp: number; pf: number; pa: number }>();
  seasonGames.forEach((game) => {
    if (!game.homeTeamId || !game.awayTeamId) return;
    const homeScore = parseNumeric(game.homeScore);
    const awayScore = parseNumeric(game.awayScore);
    if (homeScore === null || awayScore === null) return;

    const homeId = String(game.homeTeamId);
    const awayId = String(game.awayTeamId);
    if (!byTeam.has(homeId)) byTeam.set(homeId, { gp: 0, pf: 0, pa: 0 });
    if (!byTeam.has(awayId)) byTeam.set(awayId, { gp: 0, pf: 0, pa: 0 });

    const home = byTeam.get(homeId)!;
    home.gp += 1;
    home.pf += homeScore;
    home.pa += awayScore;

    const away = byTeam.get(awayId)!;
    away.gp += 1;
    away.pf += awayScore;
    away.pa += homeScore;
  });

  const teamIds = new Set<string>([
    ...Object.keys(teamStatsByTeamId || {}),
    ...Array.from(byTeam.keys()),
  ]);

  const issues: IntegrityIssue[] = [];
  let coverageSum = 0;
  let coverageCount = 0;

  teamIds.forEach((teamId) => {
    const stats = teamStatsByTeamId[teamId] || [];
    const history = byTeam.get(teamId);
    if (!stats || stats.length === 0) {
      if (history && history.gp >= 2) {
        issues.push({
          teamId,
          severity: "critical",
          code: "MISSING_TEAM_STATS",
          message: "No team season stats found while historical games exist.",
          expected: history.gp,
          actual: 0,
        });
      }
      return;
    }

    const statsGp = getStatNumeric(stats, ["Games Played", "Games", "GP"]) ?? 0;
    const statsPoints = getStatNumeric(stats, ["Points", "Points Per Game"]);
    const statsOppPoints = getStatNumeric(stats, ["Opponent Points", "Points Allowed", "Opp Points"]);
    const historyGp = history?.gp ?? 0;

    if (historyGp > 0 && statsGp === 0) {
      issues.push({
        teamId,
        severity: "critical",
        code: "ZERO_GAMES_PLAYED",
        message: "Stats report zero games played despite historical finished games.",
        expected: historyGp,
        actual: statsGp,
      });
    }

    if (historyGp > 0 && statsGp > 0) {
      const coverage = historyGp / statsGp;
      coverageSum += coverage;
      coverageCount += 1;
      if (coverage < 0.75) {
        issues.push({
          teamId,
          severity: "warning",
          code: "SCHEDULE_COVERAGE_LOW",
          message: "Historical finished-game coverage is low versus season games played.",
          expected: statsGp,
          actual: historyGp,
        });
      }

      const historyPoints = history.pf / historyGp;
      const historyOppPoints = history.pa / historyGp;
      if (statsPoints !== null && Math.abs(statsPoints - historyPoints) > 6.0) {
        issues.push({
          teamId,
          severity: "warning",
          code: "POINTS_AVG_MISMATCH",
          message: "Team points average diverges from historical game aggregate.",
          expected: Number(historyPoints.toFixed(2)),
          actual: Number(statsPoints.toFixed(2)),
        });
      }
      if (statsOppPoints !== null && Math.abs(statsOppPoints - historyOppPoints) > 6.0) {
        issues.push({
          teamId,
          severity: "warning",
          code: "OPP_POINTS_AVG_MISMATCH",
          message: "Opponent points average diverges from historical game aggregate.",
          expected: Number(historyOppPoints.toFixed(2)),
          actual: Number(statsOppPoints.toFixed(2)),
        });
      }
    }
  });

  return {
    sport,
    generatedAt: new Date().toISOString(),
    seasonYear,
    teamsAudited: teamIds.size,
    issues,
    averageCoverage: coverageCount > 0 ? Number((coverageSum / coverageCount).toFixed(3)) : 1,
  };
};

