#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "public", "internal-db");
const manifestPath = path.join(outputDir, "manifest.json");

const ESPN_ENDPOINTS = {
  F1: "racing/f1",
  NBA: "basketball/nba",
  NFL: "football/nfl",
  INDYCAR: "racing/irl",
  MLB: "baseball/mlb",
  NASCAR: "racing/nascar-premier",
  NHL: "hockey/nhl",
  EPL: "soccer/eng.1",
  Bundesliga: "soccer/ger.1",
  "La Liga": "soccer/esp.1",
  "Ligue 1": "soccer/fra.1",
  "Serie A": "soccer/ita.1",
  MLS: "soccer/usa.1",
  UCL: "soccer/uefa.champions",
  NCAAF: "football/college-football",
  NCAAM: "basketball/mens-college-basketball",
  NCAAW: "basketball/womens-college-basketball",
  WNBA: "basketball/wnba",
  UFC: "mma/ufc",
};

const ALL_SPORTS = Object.keys(ESPN_ENDPOINTS);
const HIGH_VOLUME_SPORTS = new Set(["NCAAM", "NCAAW"]);
const SOCCER_LEAGUES = new Set([
  "Bundesliga",
  "EPL",
  "La Liga",
  "Ligue 1",
  "MLS",
  "Serie A",
  "UCL",
]);

const formatEspnDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const parseArgs = (argv) => {
  const now = new Date();
  const args = {
    sports: ALL_SPORTS,
    fromYear: now.getFullYear() - 12,
    toYear: now.getFullYear() + 1,
    daysBack: null,
    daysForward: null,
    includeSchedules: true,
    includeGameStats: true,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--sports=")) {
      args.sports = arg
        .slice("--sports=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--daysBack=")) {
      const daysBack = Number(arg.slice("--daysBack=".length));
      if (!Number.isNaN(daysBack) && daysBack >= 0) args.daysBack = daysBack;
    } else if (arg.startsWith("--daysForward=")) {
      const daysForward = Number(arg.slice("--daysForward=".length));
      if (!Number.isNaN(daysForward) && daysForward >= 0) {
        args.daysForward = daysForward;
      }
    } else if (arg.startsWith("--monthsBack=")) {
      const monthsBack = Number(arg.slice("--monthsBack=".length));
      if (!Number.isNaN(monthsBack) && monthsBack > 0) {
        args.daysBack = Math.ceil(monthsBack * 31);
      }
    } else if (arg.startsWith("--monthsForward=")) {
      const monthsForward = Number(arg.slice("--monthsForward=".length));
      if (!Number.isNaN(monthsForward) && monthsForward > 0) {
        args.daysForward = Math.ceil(monthsForward * 31);
      }
    } else if (arg.startsWith("--fromYear=")) {
      const fromYear = Number(arg.slice("--fromYear=".length));
      if (!Number.isNaN(fromYear) && fromYear > 1900) args.fromYear = fromYear;
    } else if (arg.startsWith("--toYear=")) {
      const toYear = Number(arg.slice("--toYear=".length));
      if (!Number.isNaN(toYear) && toYear > 1900) args.toYear = toYear;
    } else if (arg === "--no-schedules") {
      args.includeSchedules = false;
    } else if (arg === "--no-game-stats") {
      args.includeGameStats = false;
    }
  });

  args.sports = args.sports.filter((sport) => ESPN_ENDPOINTS[sport]);
  if (args.sports.length === 0) args.sports = ALL_SPORTS;
  if (args.toYear < args.fromYear) {
    const swap = args.fromYear;
    args.fromYear = args.toYear;
    args.toYear = swap;
  }
  return args;
};

const monthStartOf = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthEndOf = (date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0);

const rangeToString = (start, end) =>
  `${formatEspnDate(start)}-${formatEspnDate(end)}`;

const splitRangeForHighVolume = (sport, start, end) => {
  if (!HIGH_VOLUME_SPORTS.has(sport)) return [[start, end]];

  const chunks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 6);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push([new Date(cursor), chunkEnd]);
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
};

const buildMonthlyRangesAroundNow = (sport, start, end, now = new Date()) => {
  const minMonth = monthStartOf(start);
  const maxMonth = monthStartOf(end);
  const orderedMonths = [];
  const seenMonths = new Set();

  let cursor = monthStartOf(now);
  while (cursor >= minMonth) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    if (!seenMonths.has(key)) {
      orderedMonths.push(new Date(cursor));
      seenMonths.add(key);
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  }

  cursor = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  while (cursor <= maxMonth) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    if (!seenMonths.has(key)) {
      orderedMonths.push(new Date(cursor));
      seenMonths.add(key);
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const ranges = [];
  orderedMonths.forEach((monthAnchor) => {
    if (monthAnchor < minMonth || monthAnchor > maxMonth) return;
    const monthStart = monthStartOf(monthAnchor);
    const monthEnd = monthEndOf(monthAnchor);
    const effectiveStart = monthStart < start ? start : monthStart;
    const effectiveEnd = monthEnd > end ? end : monthEnd;
    splitRangeForHighVolume(sport, effectiveStart, effectiveEnd).forEach(
      ([sliceStart, sliceEnd]) => ranges.push(rangeToString(sliceStart, sliceEnd)),
    );
  });

  return ranges;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, retries = 3) => {
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(300 * (i + 1));
  }
  throw lastError;
};

const normalizeStat = (val) => {
  if (val === null || val === undefined) return "-";
  if (typeof val === "object") {
    if (val.displayValue) return String(val.displayValue);
    if (val.value !== undefined) return String(val.value);
    return "-";
  }
  return String(val);
};

const extractNumber = (val) => {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object") {
    if (val.value !== undefined) return parseFloat(val.value) || 0;
    if (val.displayValue !== undefined) return parseFloat(val.displayValue) || 0;
  }
  return 0;
};

const formatTeamName = (team, sport) => {
  if (!team) return "Unknown Team";
  if (["NCAAF", "NCAAM", "NCAAW"].includes(sport)) {
    return team.location || team.shortDisplayName || team.displayName || "";
  }
  if (["NFL", "NBA", "NHL", "MLB", "WNBA", "MLS", "NASCAR", "INDYCAR", "F1"].includes(sport)) {
    if (team.name) return team.name;
    if (team.shortDisplayName) return team.shortDisplayName;
  }
  let name = team.displayName;
  if (!name && team.location && team.name) name = `${team.location} ${team.name}`;
  return (name || team.location || "").replace(" AFC", "").replace(" NFC", "");
};

const mapEventToGame = (event, sport, leagueLogo) => {
  const competition = event.competitions?.[0];
  const isRacing = RACING_SPORTS.has(sport);
  const statusState = event.status?.type?.state;
  let homeComp = competition?.competitors?.find((c) => c.homeAway === "home");
  let awayComp = competition?.competitors?.find((c) => c.homeAway === "away");
  if ((!homeComp || !awayComp) && isRacing) {
    const ranked = [...(competition?.competitors || [])].sort((a, b) => {
      const rankValue = (entry) => {
        const order = extractNumber(entry?.order);
        if (order > 0) return order;
        const curated = extractNumber(entry?.curatedRank?.current);
        if (curated > 0) return curated;
        const score = extractNumber(entry?.score);
        if (score > 0) return score;
        return Number.MAX_SAFE_INTEGER;
      };
      return rankValue(a) - rankValue(b);
    });
    homeComp = homeComp || ranked[0];
    awayComp = awayComp || ranked[1] || ranked[0];
  }
  const homeRank = extractNumber(homeComp?.curatedRank?.current);
  const awayRank = extractNumber(awayComp?.curatedRank?.current);
  const isPostseason = event.season?.type === 3;
  const headline = competition?.notes?.[0]?.headline;

  let context;
  if (isPostseason) {
    if (headline) context = headline;
    else if (
      event.status?.type?.detail &&
      !event.status.type.detail.includes(":") &&
      event.status.type.detail !== "Final"
    ) {
      context = event.status.type.detail;
    } else {
      context = "Playoffs";
    }
  }

  const venue = competition?.venue;
  const city = venue?.address?.city;
  const state = venue?.address?.state;
  const location = city ? (state ? `${city}, ${state}` : city) : undefined;

  const odds = competition?.odds?.[0];
  const displayName = (comp) => {
    if (!comp) return "TBD";
    if (isRacing) return comp?.athlete?.displayName || comp?.athlete?.name || formatTeamName(comp?.team, sport);
    return formatTeamName(comp?.team, sport);
  };
  const displayAbbreviation = (comp) => {
    if (!comp) return undefined;
    if (!isRacing) return comp?.team?.abbreviation;
    const direct = String(comp?.athlete?.abbreviation || comp?.athlete?.shortName || "").trim();
    if (direct) return direct.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    const words = String(displayName(comp)).split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return `${words[0][0] || ""}${words[words.length - 1][0] || ""}${words[words.length - 1][1] || ""}`.toUpperCase();
  };
  const displayId = (comp) => {
    if (!comp) return undefined;
    if (isRacing) return comp?.athlete?.id || comp?.team?.id;
    return comp?.team?.id;
  };
  const displayLogo = (comp) => {
    if (!comp) return undefined;
    if (!isRacing) return comp?.team?.logo || comp?.team?.logos?.[0]?.href;
    return comp?.athlete?.flag?.href || comp?.athlete?.headshot?.href || comp?.team?.logo || comp?.team?.logos?.[0]?.href;
  };
  const displayScore = (comp) => {
    const normalized = normalizeStat(comp?.score);
    if (normalized && normalized !== "-") return normalized;
    if (isRacing && statusState !== "pre") {
      const order = Math.trunc(extractNumber(comp?.order));
      if (Number.isFinite(order) && order > 0) return String(order);
    }
    return undefined;
  };

  return {
    id: event.id,
    homeTeam: displayName(homeComp),
    homeTeamAbbreviation: displayAbbreviation(homeComp),
    homeTeamId: displayId(homeComp),
    homeTeamLogo: displayLogo(homeComp),
    homeTeamRank: homeRank > 0 && homeRank !== 99 ? homeRank : undefined,
    homeScore: displayScore(homeComp),
    awayTeam: displayName(awayComp),
    awayTeamAbbreviation: displayAbbreviation(awayComp),
    awayTeamId: displayId(awayComp),
    awayTeamLogo: displayLogo(awayComp),
    awayTeamRank: awayRank > 0 && awayRank !== 99 ? awayRank : undefined,
    awayScore: displayScore(awayComp),
    date: new Date(event.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    time: new Date(event.date).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
    dateTime: event.date,
    league: sport,
    leagueName: event.league?.name,
    leagueLogo,
    context: context || (isRacing ? competition?.type?.text || event.name : undefined),
    gameStatus: event.status?.type?.detail,
    status:
      statusState === "in"
        ? "in_progress"
        : statusState === "post"
          ? "finished"
          : "scheduled",
    clock: event.status?.displayClock,
    period: event.status?.period,
    isPlayoff: isPostseason,
    seriesSummary: competition?.series?.summary,
    broadcast: competition?.broadcasts?.[0]?.names?.[0],
    venue: venue?.fullName,
    location,
    weather: event.weather?.displayValue,
    temperature: event.weather?.temperature
      ? `${event.weather.temperature}°`
      : undefined,
    seasonYear: event.season?.year,
    seasonType: event.season?.type,
    odds: odds
      ? {
          spread: odds.details,
          overUnder: odds.overUnder ? `O/U ${odds.overUnder}` : undefined,
          moneyLineAway:
            odds.awayTeamOdds?.moneyLine !== undefined
              ? String(odds.awayTeamOdds.moneyLine)
              : undefined,
          moneyLineHome:
            odds.homeTeamOdds?.moneyLine !== undefined
              ? String(odds.homeTeamOdds.moneyLine)
              : undefined,
          provider: odds.provider?.name,
        }
      : undefined,
  };
};

const convertStandingsToStats = (data, sport) => {
  const items = [];
  const str = (v) => (v === undefined || v === null ? "0" : String(v));
  const num = (v) => {
    const parsed = parseFloat(String(v ?? "0").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const wins = num(data.wins);
  const losses = num(data.losses);
  const ties = num(data.ties ?? data.otLosses);
  const gp = wins + losses + ties;
  const toPerGame = (value, signed = false) => {
    const raw = num(value);
    if (gp <= 0) {
      if (signed && raw > 0) return `+${raw.toFixed(1)}`;
      return raw.toFixed(1);
    }
    const avg = raw / gp;
    if (signed && avg > 0) return `+${avg.toFixed(1)}`;
    return avg.toFixed(1);
  };

  if (data.wins !== undefined) items.push({ label: "Wins", value: str(data.wins), category: "General" });
  if (data.losses !== undefined) items.push({ label: "Losses", value: str(data.losses), category: "General" });

  if (data.pointsFor !== undefined) {
    items.push({ label: "Points", value: toPerGame(data.pointsFor), category: "Team" });
  } else if (
    data.points !== undefined &&
    !SOCCER_LEAGUES.has(sport)
  ) {
    items.push({ label: "Points", value: toPerGame(data.points), category: "Team" });
  }

  if (data.pointsAgainst !== undefined) {
    items.push({
      label: "Opponent Points",
      value: toPerGame(data.pointsAgainst),
      category: "Opponent",
    });
  }

  if (data.pointDifferential !== undefined) {
    items.push({
      label: "Points Differential",
      value: toPerGame(data.pointDifferential, true),
      category: "Differential",
    });
  } else if (data.pointsFor !== undefined && data.pointsAgainst !== undefined) {
    const diff = num(data.pointsFor) - num(data.pointsAgainst);
    items.push({
      label: "Points Differential",
      value: toPerGame(diff, true),
      category: "Differential",
    });
  }

  return items;
};

const parseStandings = (data, sport) => {
  const groups = [];
  const teamStatsMap = {};

  const process = (g) => {
    if (g.standings?.entries) {
      const standings = g.standings.entries.map((entry) => {
        const entity = entry.team || entry.athlete;
        const entityId = String(entity?.id || "");
        const entityName = entry.team
          ? formatTeamName(entry.team, sport)
          : String(entity?.displayName || entity?.name || "Unknown");
        const entityAbbreviation = String(entity?.abbreviation || entity?.shortName || "");
        const entityLogo =
          entry.team?.logos?.[0]?.href || entity?.flag?.href || entity?.headshot?.href;

        let racingStarts = 0;
        let racingWins = 0;
        const stats = (entry.stats || []).reduce((acc, curr) => {
          const val = extractNumber(curr.value);
          const name = curr.name || "";
          if (name === "wins") acc.wins = val;
          if (name === "losses") acc.losses = val;
          if (name === "ties") acc.ties = val;
          if (name === "otLosses") acc.ties = val;
          if (name === "winPercent") acc.pct = `${(val * 100).toFixed(1)}%`;
          if (name === "points") acc.points = val;
          if (name === "pointsFor") acc.pointsFor = val;
          if (name === "pointsAgainst") acc.pointsAgainst = val;
          if (name === "gamesBehind") acc.gamesBehind = normalizeStat(curr);
          if (name === "streak") acc.streak = normalizeStat(curr);
          if (name === "pointDifferential") acc.pointDifferential = val;
          if (RACING_SPORTS.has(sport) && curr?.played) {
            racingStarts += 1;
            if (String(curr?.displayValue || "").trim() === "1" || val === 1) racingWins += 1;
          }
          return acc;
        }, {});

        if (RACING_SPORTS.has(sport) && stats.points === undefined) {
          const championshipPts = entry.stats?.find((s) => s.name === "championshipPts");
          if (championshipPts) stats.points = extractNumber(championshipPts.value);
          if (!stats.overallRecord && racingStarts > 0) {
            stats.overallRecord = `${racingWins}-${Math.max(0, racingStarts - racingWins)}`;
          }
          if (stats.wins === undefined && racingWins > 0) stats.wins = racingWins;
          if (stats.losses === undefined && racingStarts > 0) stats.losses = Math.max(0, racingStarts - racingWins);
        }

        const teamId = entityId;
        if (teamId) {
          teamStatsMap[`${sport}-${teamId}`] = convertStandingsToStats(stats, sport);
        }

        const fallbackId = entityName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 32);

        return {
          team: {
            id: entityId || `entry-${fallbackId || "unknown"}`,
            name: entityName,
            abbreviation: entityAbbreviation,
            logo: entityLogo,
          },
          stats,
          rank:
            extractNumber(entry.stats?.find((s) => s.name === "playoffSeed")?.value) ||
            extractNumber(entry.stats?.find((s) => s.name === "rank")?.value) ||
            0,
          clincher: entry.stats?.find((s) => s.name === "clincher")?.displayValue,
          note: entry.note?.description,
        };
      });

      groups.push({
        name: g.name || g.header || "Standings",
        standings,
      });
    }
    if (g.children) g.children.forEach(process);
  };

  if (data.children) data.children.forEach(process);
  else if (data.standings) process(data);

  return { groups, teamStatsMap };
};

const BASKETBALL_SPORTS = new Set(["NBA", "WNBA", "NCAAM", "NCAAW"]);
const FOOTBALL_SPORTS = new Set(["NFL", "NCAAF"]);
const HOCKEY_SPORTS = new Set(["NHL"]);
const BASEBALL_SPORTS = new Set(["MLB"]);
const RACING_SPORTS = new Set(["F1", "INDYCAR", "NASCAR"]);
const SOCCER_SPORTS = new Set([
  "Bundesliga",
  "EPL",
  "La Liga",
  "Ligue 1",
  "MLS",
  "Serie A",
  "UCL",
]);

const normalizeStatCategory = (rawCategory, sport, label = "") => {
  const source = String(rawCategory || "General").trim();
  if (!source) return "General";
  const lower = source.toLowerCase();
  const labelLower = String(label || "").toLowerCase();

  if (lower.includes("offens")) return "Offense";
  if (lower.includes("defens")) return "Defense";
  if (lower.includes("shoot")) return "Shooting";
  if (lower.includes("rebound")) return "Rebounding";
  if (lower.includes("assist") || lower.includes("turnover")) return "Ball Control";
  if (lower.includes("special")) return "Special Teams";
  if (lower.includes("batting")) return "Batting";
  if (lower.includes("pitching")) return "Pitching";
  if (lower.includes("fielding")) return "Fielding";
  if (lower.includes("other") || lower.includes("misc")) return "Other";
  if (lower === "general") return "General";

  if (BASKETBALL_SPORTS.has(sport)) {
    if (labelLower.includes("field goal") || labelLower.includes("three point") || labelLower.includes("free throw")) return "Shooting";
    if (labelLower.includes("rebound")) return "Rebounding";
    if (labelLower.includes("assist") || labelLower.includes("turnover")) return "Ball Control";
    if (labelLower.includes("steal") || labelLower.includes("block") || labelLower.includes("foul")) return "Defense";
    if (labelLower.includes("point")) return "Offense";
  }

  if (FOOTBALL_SPORTS.has(sport)) {
    if (labelLower.includes("pass") || labelLower.includes("comp/att") || labelLower.includes("completion")) return "Passing";
    if (labelLower.includes("rush")) return "Rushing";
    if (labelLower.includes("kick") || labelLower.includes("punt") || labelLower.includes("return")) return "Special Teams";
    if (labelLower.includes("interception") || labelLower.includes("sack") || labelLower.includes("fumble")) return "Defense";
    if (
      labelLower.includes("3rd down") ||
      labelLower.includes("4th down") ||
      labelLower.includes("red zone") ||
      labelLower.includes("yards per") ||
      labelLower.includes("possession") ||
      labelLower.includes("penalt") ||
      labelLower.includes("turnover")
    ) {
      return "Efficiency";
    }
    return "Offense";
  }

  if (HOCKEY_SPORTS.has(sport)) {
    if (labelLower.includes("power play") || labelLower.includes("short handed") || labelLower.includes("penalty")) return "Special Teams";
    if (labelLower.includes("faceoff") || labelLower.includes("giveaway") || labelLower.includes("takeaway")) return "Ball Control";
    if (labelLower.includes("blocked") || labelLower.includes("save")) return "Defense";
    return "Offense";
  }

  if (SOCCER_SPORTS.has(sport)) {
    if (
      labelLower.includes("possession") ||
      labelLower.includes("pass") ||
      labelLower.includes("cross") ||
      labelLower.includes("long ball")
    ) {
      return "Ball Control";
    }
    if (
      labelLower.includes("tackle") ||
      labelLower.includes("clearance") ||
      labelLower.includes("interception") ||
      labelLower.includes("save") ||
      labelLower.includes("card") ||
      labelLower.includes("foul")
    ) {
      return "Defense";
    }
    return "Offense";
  }

  if (BASEBALL_SPORTS.has(sport)) {
    if (
      labelLower.includes("era") ||
      labelLower.includes("pitch") ||
      labelLower.includes("strikeout") ||
      labelLower.includes("walks") ||
      labelLower.includes("save") ||
      labelLower.includes("whip")
    ) {
      return "Pitching";
    }
    if (
      labelLower.includes("field") ||
      labelLower.includes("assist") ||
      labelLower.includes("error") ||
      labelLower.includes("putout")
    ) {
      return "Fielding";
    }
    return "Batting";
  }

  const looksMachineToken =
    /^[a-z0-9]+(?:[A-Z][a-z0-9]+)+$/.test(source) ||
    /^[a-z0-9_]+$/.test(source);
  if (looksMachineToken) return "General";

  return source;
};

const normalizeBoxscoreLabel = (sport, rawLabel) => {
  const label = String(rawLabel || "").trim();
  if (!label) return "";
  const lower = label.toLowerCase();

  if (BASKETBALL_SPORTS.has(sport)) {
    if (lower === "fg") return "FG";
    if (lower === "3pt" || lower === "3pt." || lower === "3-point" || lower === "3 point") return "3PT";
    if (lower === "ft") return "FT";
    if (lower === "field goal %" || lower === "fg%" || (lower.includes("field goal") && lower.includes("%"))) return "Field Goal %";
    if (lower === "three point %" || lower === "3 point %" || lower === "3pt %" || (lower.includes("three point") && lower.includes("%")) || (lower.includes("3-point") && lower.includes("%"))) return "Three Point %";
    if (lower === "free throw %" || lower === "ft%" || (lower.includes("free throw") && lower.includes("%"))) return "Free Throw %";
    if (lower === "defensive rebounds" || lower === "def reb") return "Defensive Rebounds";
    if (lower === "offensive rebounds" || lower === "off reb") return "Offensive Rebounds";
    if (lower === "points in paint" || lower === "points in the paint") return "Points in Paint";
    if (lower === "total rebounds" || lower === "tot reb") return "Rebounds";
    if (lower === "fast break points") return "Fast Break Points";
    if (lower === "team turnovers") return "Team Turnovers";
    if (lower === "total turnovers") return "Total Turnovers";
    if (lower === "points off turnovers") return "Points Conceded Off Turnovers";
    if (lower === "technical fouls") return "Technical Fouls";
    if (lower === "total technical fouls") return "Total Technical Fouls";
    if (lower === "flagrant fouls") return "Flagrant Fouls";
    if (lower === "fouls" || lower === "personal fouls") return "Fouls";
    if (lower === "largest lead") return "Largest Lead";
    if (lower === "lead changes") return "Lead Changes";
    if (lower === "percent led" || lower === "pct led") return "Percent Led";
    if (lower === "three point percentage" || lower === "3-point %") return "Three Point %";
  }

  if (FOOTBALL_SPORTS.has(sport)) {
    if (lower === "comp/att" || lower.includes("completion") && lower.includes("attempt")) return "Comp/Att";
    if (lower === "passing") return "Passing Yards";
    if (lower === "rushing") return "Rushing Yards";
    if (lower === "3rd down efficiency") return "3rd Down Efficiency";
    if (lower === "4th down efficiency") return "4th Down Efficiency";
    if (lower.includes("red zone")) return "Red Zone Efficiency";
    if (lower === "sacks-yards lost") return "Sacks-Yards Lost";
    if (lower === "penalties") return "Penalties";
    if (lower === "possession") return "Possession";
    if (lower === "interceptions thrown") return "Interceptions Thrown";
    if (lower === "fumbles lost") return "Fumbles Lost";
    if (lower === "total plays") return "Total Plays";
    if (lower === "total yards") return "Total Yards";
    if (lower === "1st downs") return "1st Downs";
    if (lower === "passing 1st downs") return "Passing 1st Downs";
    if (lower === "rushing 1st downs") return "Rushing 1st Downs";
    if (lower === "1st downs from penalties") return "Penalty 1st Downs";
    if (lower === "yards per pass") return "Yards per Pass";
    if (lower === "yards per play") return "Yards per Play";
    if (lower === "yards per rush") return "Yards per Rush";
  }

  if (HOCKEY_SPORTS.has(sport)) {
    if (lower === "faceoff win percent") return "Faceoff Win %";
    if (lower === "power play percentage") return "Power Play %";
    if (lower === "total penalties") return "Penalties";
    if (lower === "short handed goals") return "Short-Handed Goals";
  }

  if (SOCCER_SPORTS.has(sport)) {
    if (lower === "on goal") return "Shots On Target";
    if (lower === "shots") return "Shots";
    if (lower === "pass completion %") return "Pass Completion %";
    if (lower === "cross %") return "Cross %";
    if (lower === "long balls %") return "Long Balls %";
    if (lower === "on target %") return "On Target %";
    if (lower === "tackle %") return "Tackle %";
    if (lower === "possession") return "Possession %";
  }

  return label;
};

const shouldIgnoreDetailedStatLabel = (label) => {
  const lower = String(label || "").toLowerCase().trim();
  if (!lower) return true;
  if (lower === "w" || lower === "l" || lower === "t") return true;
  const blocklist = ["rank", "record", "seed", "streak", "clinch"];
  return blocklist.some((term) => lower.includes(term));
};

const isRateLikeLabel = (label) => {
  const lower = String(label || "").toLowerCase();
  return (
    lower.includes("%") ||
    lower.includes("pct") ||
    lower.includes("percent") ||
    lower.includes("avg") ||
    lower.includes("average") ||
    lower.includes("rate") ||
    lower.includes("per ")
  );
};

const parseNumericValue = (value) => {
  const parsed = parseFloat(
    String(value ?? "")
      .replace(/,/g, "")
      .replace("%", "")
      .replace("+", "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : null;
};

const LIVE_TRAJECTORY_BIN_COUNT = 20;

const getRegulationClockProfile = (sport) => {
  if (BASKETBALL_SPORTS.has(sport)) {
    if (sport === "NCAAM") return { regulationPeriods: 2, periodLengthMinutes: 20, regulationMinutes: 40 };
    if (sport === "NCAAW" || sport === "WNBA") return { regulationPeriods: 4, periodLengthMinutes: 10, regulationMinutes: 40 };
    return { regulationPeriods: 4, periodLengthMinutes: 12, regulationMinutes: 48 };
  }
  if (FOOTBALL_SPORTS.has(sport)) return { regulationPeriods: 4, periodLengthMinutes: 15, regulationMinutes: 60 };
  if (HOCKEY_SPORTS.has(sport)) return { regulationPeriods: 3, periodLengthMinutes: 20, regulationMinutes: 60 };
  if (SOCCER_SPORTS.has(sport)) return { regulationPeriods: 2, periodLengthMinutes: 45, regulationMinutes: 90 };
  return null;
};

const toRegulationLinescores = (competitor, regulationPeriods) => {
  const raw = Array.isArray(competitor?.linescores) ? competitor.linescores : [];
  const out = [];
  for (let i = 0; i < regulationPeriods; i += 1) {
    const entry = raw[i];
    const points = parseNumericValue(
      entry?.value ?? entry?.displayValue ?? entry?.score ?? entry?.points,
    );
    out.push(Number.isFinite(points) ? points : 0);
  }
  return out;
};

const cumulativeFromPeriodScores = (periodScores, periodLengthMinutes, elapsedMinutes) => {
  if (!Array.isArray(periodScores) || periodScores.length === 0) return 0;
  let remaining = Math.max(0, elapsedMinutes);
  let cumulative = 0;
  for (let i = 0; i < periodScores.length; i += 1) {
    if (remaining <= 0) break;
    const periodPoints = Number(periodScores[i]) || 0;
    const consumed = Math.min(periodLengthMinutes, remaining);
    cumulative += periodPoints * (consumed / periodLengthMinutes);
    remaining -= consumed;
  }
  return cumulative;
};

const extractGameTrajectoryShares = (summaryData, sport, game, binCount = LIVE_TRAJECTORY_BIN_COUNT) => {
  const profile = getRegulationClockProfile(sport);
  if (!profile) return null;
  if (!game?.homeTeamId || !game?.awayTeamId) return null;

  const period = Number(game?.period || 0);
  if (Number.isFinite(period) && period > profile.regulationPeriods) {
    // Exclude overtime/extra-time games to keep calibration on regulation flow.
    return null;
  }

  const competition = summaryData?.header?.competitions?.[0];
  const homeComp = competition?.competitors?.find((c) => c.homeAway === "home");
  const awayComp = competition?.competitors?.find((c) => c.homeAway === "away");
  if (!homeComp || !awayComp) return null;

  const homeFinal = parseNumericValue(game.homeScore);
  const awayFinal = parseNumericValue(game.awayScore);
  if (!Number.isFinite(homeFinal) || !Number.isFinite(awayFinal) || homeFinal <= 0 || awayFinal <= 0) {
    return null;
  }

  const homeLinescores = toRegulationLinescores(homeComp, profile.regulationPeriods);
  const awayLinescores = toRegulationLinescores(awayComp, profile.regulationPeriods);
  const hasSignal = homeLinescores.some((v) => v > 0) || awayLinescores.some((v) => v > 0);
  if (!hasSignal) return null;

  const homeOffenseShare = [];
  const awayOffenseShare = [];
  for (let idx = 0; idx < binCount; idx += 1) {
    const fraction = (idx + 1) / binCount;
    const elapsed = profile.regulationMinutes * fraction;
    const homeCurrent = cumulativeFromPeriodScores(homeLinescores, profile.periodLengthMinutes, elapsed);
    const awayCurrent = cumulativeFromPeriodScores(awayLinescores, profile.periodLengthMinutes, elapsed);
    homeOffenseShare.push(Math.min(1, Math.max(0, homeCurrent / homeFinal)));
    awayOffenseShare.push(Math.min(1, Math.max(0, awayCurrent / awayFinal)));
  }

  return {
    homeTeamId: String(game.homeTeamId),
    awayTeamId: String(game.awayTeamId),
    homeOffenseShare,
    awayOffenseShare,
  };
};

const parseMadeAttemptPair = (value) => {
  const match = String(value || "").match(/^\s*(-?\d+(?:\.\d+)?)\s*([\-\/])\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const made = parseFloat(match[1]);
  const attempted = parseFloat(match[3]);
  if (!Number.isFinite(made) || !Number.isFinite(attempted)) return null;
  return { made, attempted };
};

const parseTimeToMinutes = (value) => {
  const match = String(value || "").match(/^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] ? Number(match[3]) : 0;
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(third)) return null;
  if (match[3]) return (first * 60) + second + (third / 60);
  return first + (second / 60);
};

const expandCompositeStat = (sport, label, value, category) => {
  if (label === "Possession" && FOOTBALL_SPORTS.has(sport)) {
    const minutes = parseTimeToMinutes(value);
    if (minutes !== null) {
      return [{ label: "Possession Minutes", value: minutes.toFixed(2), category: "Efficiency" }];
    }
  }

  const parsed = parseMadeAttemptPair(value);
  if (!parsed) return [];

  if (BASKETBALL_SPORTS.has(sport) && label === "FG") {
    return [
      { label: "Field Goals Made", value: String(parsed.made), category },
      { label: "Field Goals Attempted", value: String(parsed.attempted), category },
    ];
  }
  if (BASKETBALL_SPORTS.has(sport) && label === "3PT") {
    return [
      { label: "3-Pointers Made", value: String(parsed.made), category },
      { label: "3-Pointers Attempted", value: String(parsed.attempted), category },
    ];
  }
  if (BASKETBALL_SPORTS.has(sport) && label === "FT") {
    return [
      { label: "Free Throws Made", value: String(parsed.made), category },
      { label: "Free Throws Attempted", value: String(parsed.attempted), category },
    ];
  }

  if (FOOTBALL_SPORTS.has(sport)) {
    if (label === "Comp/Att") {
      return [
        { label: "Pass Completions", value: String(parsed.made), category: "Passing" },
        { label: "Pass Attempts", value: String(parsed.attempted), category: "Passing" },
      ];
    }
    if (label === "3rd Down Efficiency") {
      return [
        { label: "3rd Down Conversions", value: String(parsed.made), category: "Efficiency" },
        { label: "3rd Down Attempts", value: String(parsed.attempted), category: "Efficiency" },
      ];
    }
    if (label === "4th Down Efficiency") {
      return [
        { label: "4th Down Conversions", value: String(parsed.made), category: "Efficiency" },
        { label: "4th Down Attempts", value: String(parsed.attempted), category: "Efficiency" },
      ];
    }
    if (label === "Red Zone Efficiency" || label === "Red Zone (Made-Att)") {
      return [
        { label: "Red Zone Conversions", value: String(parsed.made), category: "Efficiency" },
        { label: "Red Zone Attempts", value: String(parsed.attempted), category: "Efficiency" },
      ];
    }
    if (label === "Penalties") {
      return [
        { label: "Penalties", value: String(parsed.made), category: "Efficiency" },
        { label: "Penalty Yards", value: String(parsed.attempted), category: "Efficiency" },
      ];
    }
    if (label === "Sacks-Yards Lost") {
      return [
        { label: "Sacks Allowed", value: String(parsed.made), category: "Passing" },
        { label: "Sack Yards Lost", value: String(parsed.attempted), category: "Passing" },
      ];
    }
  }

  if (HOCKEY_SPORTS.has(sport) && label === "Power Play") {
    return [
      { label: "Power Play Goals", value: String(parsed.made), category: "Special Teams" },
      { label: "Power Play Opportunities", value: String(parsed.attempted), category: "Special Teams" },
    ];
  }

  return [];
};

const mergeStatItemLists = (primary = [], fallback = []) => {
  const merged = new Map();
  [...primary, ...fallback].forEach((item) => {
    if (!item || !item.label) return;
    const category = item.category || "General";
    const key = `${category}|${item.label.toLowerCase()}`;
    if (!merged.has(key)) {
      merged.set(key, { label: item.label, value: String(item.value), category });
    }
  });
  return Array.from(merged.values());
};

const toTitleCase = (value) =>
  String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const normalizePlayerGroupLabel = (sport, rawLabel) => {
  const label = String(rawLabel || "").trim();
  if (!label) return "General";
  const lower = label.toLowerCase();

  if (BASKETBALL_SPORTS.has(sport)) return "Box Score";

  if (FOOTBALL_SPORTS.has(sport)) {
    if (lower.includes("pass")) return "Passing";
    if (lower.includes("rush")) return "Rushing";
    if (lower.includes("receiv")) return "Receiving";
    if (lower.includes("defens") || lower.includes("tack")) return "Defense";
    if (lower.includes("kick")) return "Kicking";
    if (lower.includes("punt")) return "Punting";
    if (lower.includes("return")) return "Returns";
    return "General";
  }

  if (BASEBALL_SPORTS.has(sport)) {
    if (lower.includes("pitch")) return "Pitching";
    if (lower.includes("field")) return "Fielding";
    return "Batting";
  }

  if (HOCKEY_SPORTS.has(sport)) {
    if (lower.includes("goalie")) return "Goalies";
    if (lower.includes("defense")) return "Defensemen";
    return "Skaters";
  }

  if (SOCCER_SPORTS.has(sport)) return "Match";

  return toTitleCase(label);
};

const normalizePlayerStatLabel = (rawLabel, index) => {
  const label = String(rawLabel || "").trim();
  if (!label) return `Stat ${index + 1}`;
  return label;
};

const parseClockToSeconds = (value) => {
  const match = String(value || "").match(/^\s*(\d{1,3}):(\d{2})(?::(\d{2}))?\s*$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] ? Number(match[3]) : null;
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  if (third !== null && !Number.isFinite(third)) return null;
  if (third !== null) return (first * 3600) + (second * 60) + third;
  return (first * 60) + second;
};

const formatSecondsAsClock = (seconds) => {
  const rounded = Math.max(0, Math.round(seconds));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const isPlayerRateLabel = (label) => {
  const lower = String(label || "").toLowerCase();
  return (
    lower.includes("%") ||
    lower.includes("pct") ||
    lower.includes("avg") ||
    lower.includes("average") ||
    lower.includes("rate") ||
    lower.includes("rating") ||
    lower === "era" ||
    lower === "whip" ||
    lower === "ops" ||
    lower === "obp" ||
    lower === "slg"
  );
};

const shouldTrackPlayerValue = (value) => {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "--") return false;
  if (/^dnp$/i.test(text) || /^did not play$/i.test(text)) return false;
  if (/^inactive$/i.test(text)) return false;
  if (parseMadeAttemptPair(text)) return true;
  if (parseClockToSeconds(text) !== null) return true;
  if (parseNumericValue(text) !== null) return true;
  return false;
};

const extractPlayerStatsFromSummary = (summaryData, sport) => {
  const out = {};
  const playerBlocks = Array.isArray(summaryData?.boxscore?.players)
    ? summaryData.boxscore.players
    : [];

  playerBlocks.forEach((teamBlock) => {
    const teamId = String(teamBlock?.team?.id || "");
    if (!teamId) return;

    const groups = (Array.isArray(teamBlock?.statistics) ? teamBlock.statistics : []).map((group) => {
      const groupLabel = group?.displayName || group?.label || group?.name || "General";
      const labels = Array.isArray(group?.labels) ? group.labels : (Array.isArray(group?.names) ? group.names : []);
      const athletes = (Array.isArray(group?.athletes) ? group.athletes : []).map((entry) => ({
        player: {
          id: String(entry?.athlete?.id || ""),
          displayName: entry?.athlete?.displayName || entry?.athlete?.shortName || "Unknown Player",
          shortName: entry?.athlete?.shortName,
          jersey: entry?.athlete?.jersey,
          position: entry?.athlete?.position?.abbreviation,
          headshot: entry?.athlete?.headshot?.href,
        },
        stats: Array.isArray(entry?.stats) ? entry.stats.map(normalizeStat) : [],
      })).filter((athlete) => athlete.player.id);
      const maxLabelCount = athletes.reduce((max, athlete) => Math.max(max, athlete.stats.length), 0);
      const labelSeed = labels.length > 0
        ? labels
        : Array.from({ length: maxLabelCount }, (_, idx) => `Stat ${idx + 1}`);

      return {
        label: normalizePlayerGroupLabel(sport, groupLabel),
        labels: labelSeed.map((label, idx) => normalizePlayerStatLabel(label, idx)),
        athletes,
      };
    }).filter((group) => group.athletes.length > 0);

    if (groups.length > 0) {
      out[teamId] = groups;
    }
  });

  return out;
};

const getPlayerGroupPriority = (sport) => {
  if (BASKETBALL_SPORTS.has(sport)) {
    return ["Box Score"];
  }
  if (FOOTBALL_SPORTS.has(sport)) {
    return ["Passing", "Rushing", "Receiving", "Defense", "Kicking", "Punting", "Returns", "General"];
  }
  if (BASEBALL_SPORTS.has(sport)) {
    return ["Batting", "Pitching", "Fielding", "General"];
  }
  if (HOCKEY_SPORTS.has(sport)) {
    return ["Skaters", "Defensemen", "Goalies", "General"];
  }
  if (SOCCER_SPORTS.has(sport)) {
    return ["Match", "General"];
  }
  return ["General"];
};

const formatPlayerStatAverage = (accumulator, gamesPlayed, label) => {
  if (!accumulator || gamesPlayed <= 0) return "-";

  if (accumulator.kind === "pair") {
    const made = accumulator.sumMade / gamesPlayed;
    const attempts = accumulator.sumAttempted / gamesPlayed;
    return `${made.toFixed(1)}-${attempts.toFixed(1)}`;
  }

  if (accumulator.kind === "clock") {
    return formatSecondsAsClock(accumulator.sumSeconds / gamesPlayed);
  }

  if (accumulator.kind === "number") {
    const denom = accumulator.isRate ? Math.max(1, accumulator.count) : gamesPlayed;
    const avg = accumulator.sum / denom;
    if (accumulator.isPercent || String(label || "").includes("%")) {
      return `${avg.toFixed(1)}%`;
    }
    if (String(label || "").trim() === "+/-") {
      return avg > 0 ? `+${avg.toFixed(1)}` : avg.toFixed(1);
    }
    const abs = Math.abs(avg);
    const precision = accumulator.isRate ? (abs < 1 ? 3 : (abs < 10 ? 2 : 1)) : 1;
    return avg.toFixed(precision);
  }

  if (accumulator.kind === "text") {
    return accumulator.mostFrequent || "-";
  }

  return "-";
};

const extractTeamStatsFromSummary = (summaryData, sport) => {
  const out = {};
  const teamBlocks = Array.isArray(summaryData?.boxscore?.teams)
    ? summaryData.boxscore.teams
    : [];

  teamBlocks.forEach((teamBlock) => {
    const teamId = String(teamBlock?.team?.id || "");
    if (!teamId) return;

    const deduped = new Map();
    const pushItem = (label, value, category) => {
      const normalizedLabel = normalizeBoxscoreLabel(sport, label);
      if (!normalizedLabel || shouldIgnoreDetailedStatLabel(normalizedLabel)) return;
      const normalizedCategory = normalizeStatCategory(category, sport, normalizedLabel);
      const expanded = expandCompositeStat(sport, normalizedLabel, value, normalizedCategory);
      if (expanded.length > 0) {
        expanded.forEach((item) => {
          const key = `${item.category}|${item.label.toLowerCase()}`;
          if (!deduped.has(key)) deduped.set(key, item);
        });
        return;
      }

      const key = `${normalizedCategory}|${normalizedLabel.toLowerCase()}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          label: normalizedLabel,
          value: String(value),
          category: normalizedCategory,
        });
      }
    };

    const statsBlocks = Array.isArray(teamBlock?.statistics) ? teamBlock.statistics : [];
    statsBlocks.forEach((block) => {
      if (Array.isArray(block?.stats)) {
        const category = block.displayName || block.label || block.name || "General";
        block.stats.forEach((stat) => {
          const label = stat?.label || stat?.displayName || stat?.name || stat?.abbreviation;
          if (!label) return;
          pushItem(label, normalizeStat(stat), category);
        });
      } else {
        const label = block?.label || block?.displayName || block?.name || block?.abbreviation;
        if (!label) return;
        const category = block?.category || block?.group || block?.displayName || block?.name || "General";
        pushItem(label, normalizeStat(block), category);
      }
    });

    out[teamId] = Array.from(deduped.values());
  });

  return out;
};

const aggregateTeamStatsFromFinishedGames = async ({
  sport,
  endpoint,
  gamesHistory,
  standingsTeamStatsMap,
  includeGameStats,
}) => {
  const accumulators = new Map();
  const liveTrajectoryAccumulators = new Map();
  const playerStatAccumulators = new Map();
  const ensureTeam = (teamId) => {
    if (!accumulators.has(teamId)) {
      accumulators.set(teamId, {
        games: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        stats: new Map(),
      });
    }
    return accumulators.get(teamId);
  };

  const ensureLiveTrajectoryTeam = (teamId) => {
    if (!liveTrajectoryAccumulators.has(teamId)) {
      liveTrajectoryAccumulators.set(teamId, {
        offenseShareSum: Array.from({ length: LIVE_TRAJECTORY_BIN_COUNT }, () => 0),
        offenseCount: Array.from({ length: LIVE_TRAJECTORY_BIN_COUNT }, () => 0),
        defenseShareSum: Array.from({ length: LIVE_TRAJECTORY_BIN_COUNT }, () => 0),
        defenseCount: Array.from({ length: LIVE_TRAJECTORY_BIN_COUNT }, () => 0),
      });
    }
    return liveTrajectoryAccumulators.get(teamId);
  };

  const ensurePlayerTeam = (teamId) => {
    if (!playerStatAccumulators.has(teamId)) {
      playerStatAccumulators.set(teamId, {
        players: new Map(),
        groups: new Map(),
      });
    }
    return playerStatAccumulators.get(teamId);
  };

  const ensurePlayerMeta = (teamAcc, player) => {
    const playerId = String(player?.id || "");
    if (!playerId) return null;
    if (!teamAcc.players.has(playerId)) {
      teamAcc.players.set(playerId, {
        player: {
          id: playerId,
          displayName: player?.displayName || player?.shortName || "Unknown Player",
          shortName: player?.shortName,
          jersey: player?.jersey,
          position: player?.position,
          headshot: player?.headshot,
        },
        games: new Set(),
      });
    } else {
      const existing = teamAcc.players.get(playerId);
      existing.player = {
        ...existing.player,
        displayName: player?.displayName || existing.player.displayName,
        shortName: player?.shortName || existing.player.shortName,
        jersey: player?.jersey || existing.player.jersey,
        position: player?.position || existing.player.position,
        headshot: player?.headshot || existing.player.headshot,
      };
    }
    return teamAcc.players.get(playerId);
  };

  const ensurePlayerGroup = (teamAcc, groupLabel) => {
    if (!teamAcc.groups.has(groupLabel)) {
      teamAcc.groups.set(groupLabel, {
        displayName: groupLabel,
        labels: [],
        players: new Map(),
      });
    }
    return teamAcc.groups.get(groupLabel);
  };

  const ensurePlayerGroupRow = (groupAcc, playerId, player) => {
    if (!groupAcc.players.has(playerId)) {
      groupAcc.players.set(playerId, {
        player: {
          id: playerId,
          displayName: player?.displayName || player?.shortName || "Unknown Player",
          shortName: player?.shortName,
          jersey: player?.jersey,
          position: player?.position,
          headshot: player?.headshot,
        },
        stats: new Map(),
      });
    }
    return groupAcc.players.get(playerId);
  };

  const applyPlayerStats = (gameId, teamId, groups) => {
    if (!teamId || !Array.isArray(groups) || groups.length === 0) return;
    const teamAcc = ensurePlayerTeam(teamId);
    groups.forEach((group) => {
      const groupLabel = normalizePlayerGroupLabel(sport, group?.label || group?.displayName || group?.name || "General");
      const groupAcc = ensurePlayerGroup(teamAcc, groupLabel);
      const labels = Array.isArray(group?.labels) ? group.labels : [];
      const normalizedLabels = labels.map((label, idx) => normalizePlayerStatLabel(label, idx));
      normalizedLabels.forEach((normalized) => {
        if (!groupAcc.labels.includes(normalized)) {
          groupAcc.labels.push(normalized);
        }
      });

      const athletes = Array.isArray(group?.athletes) ? group.athletes : [];
      athletes.forEach((athlete) => {
        const player = athlete?.player || {};
        const playerId = String(player?.id || "");
        if (!playerId) return;
        const playerMeta = ensurePlayerMeta(teamAcc, player);
        if (!playerMeta) return;

        const rowAcc = ensurePlayerGroupRow(groupAcc, playerId, player);
        const stats = Array.isArray(athlete?.stats) ? athlete.stats : [];
        const trackableCount = stats.filter((value) => shouldTrackPlayerValue(value)).length;
        if (trackableCount > 0) {
          playerMeta.games.add(String(gameId));
        }

        normalizedLabels.forEach((label, idx) => {
          const rawValue = stats[idx];
          if (!shouldTrackPlayerValue(rawValue)) return;

          if (!rowAcc.stats.has(label)) {
            rowAcc.stats.set(label, {
              kind: "number",
              sum: 0,
              count: 0,
              isPercent: false,
              isRate: false,
            });
          }

          const accumulator = rowAcc.stats.get(label);
          const valueText = String(rawValue ?? "").trim();
          const pair = parseMadeAttemptPair(valueText);
          if (pair) {
            if (accumulator.kind !== "pair") {
              accumulator.kind = "pair";
              accumulator.sumMade = 0;
              accumulator.sumAttempted = 0;
              accumulator.count = 0;
            }
            accumulator.sumMade += pair.made;
            accumulator.sumAttempted += pair.attempted;
            accumulator.count += 1;
            return;
          }

          const clockSeconds = parseClockToSeconds(valueText);
          if (clockSeconds !== null && /(^min$|minutes|time|toi|ip)/i.test(label)) {
            if (accumulator.kind !== "clock") {
              accumulator.kind = "clock";
              accumulator.sumSeconds = 0;
              accumulator.count = 0;
            }
            accumulator.sumSeconds += clockSeconds;
            accumulator.count += 1;
            return;
          }

          const numeric = parseNumericValue(valueText);
          if (numeric !== null) {
            if (accumulator.kind !== "number") {
              accumulator.kind = "number";
              accumulator.sum = 0;
              accumulator.count = 0;
              accumulator.isPercent = false;
              accumulator.isRate = false;
            }
            let normalizedNumeric = numeric;
            if (valueText.includes("%") && Math.abs(normalizedNumeric) <= 1) {
              normalizedNumeric *= 100;
            }
            accumulator.sum += normalizedNumeric;
            accumulator.count += 1;
            accumulator.isPercent = accumulator.isPercent || valueText.includes("%");
            accumulator.isRate = accumulator.isRate || isPlayerRateLabel(label);
            return;
          }

          if (accumulator.kind !== "text") {
            accumulator.kind = "text";
            accumulator.values = new Map();
          }
          const nextCount = (accumulator.values.get(valueText) || 0) + 1;
          accumulator.values.set(valueText, nextCount);
          if (!accumulator.mostFrequent || nextCount > (accumulator.values.get(accumulator.mostFrequent) || 0)) {
            accumulator.mostFrequent = valueText;
          }
        });
      });
    });
  };

  const applyTrajectorySample = (teamId, offenseShares, defenseShares) => {
    if (!teamId) return;
    const acc = ensureLiveTrajectoryTeam(teamId);
    for (let idx = 0; idx < LIVE_TRAJECTORY_BIN_COUNT; idx += 1) {
      const offense = Number(offenseShares?.[idx]);
      if (Number.isFinite(offense) && offense >= 0 && offense <= 1.2) {
        acc.offenseShareSum[idx] += offense;
        acc.offenseCount[idx] += 1;
      }
      const defense = Number(defenseShares?.[idx]);
      if (Number.isFinite(defense) && defense >= 0 && defense <= 1.2) {
        acc.defenseShareSum[idx] += defense;
        acc.defenseCount[idx] += 1;
      }
    }
  };

  const finishedGames = gamesHistory.filter((game) => {
    if (game.status !== "finished") return false;
    if (!game.homeTeamId || !game.awayTeamId) return false;
    if (typeof game.seasonType === "number" && game.seasonType === 1) return false;
    return true;
  });

  const seasonYears = finishedGames
    .map((game) => Number(game.seasonYear))
    .filter((year) => Number.isFinite(year) && year > 1900);
  const targetSeasonYear = seasonYears.length > 0 ? Math.max(...seasonYears) : null;
  const seasonGames = targetSeasonYear
    ? finishedGames.filter((game) => Number(game.seasonYear) === targetSeasonYear)
    : finishedGames;

  seasonGames.forEach((game) => {
    const homeScore = parseNumericValue(game.homeScore);
    const awayScore = parseNumericValue(game.awayScore);
    if (homeScore === null || awayScore === null) return;

    const home = ensureTeam(game.homeTeamId);
    const away = ensureTeam(game.awayTeamId);

    home.games += 1;
    away.games += 1;
    home.pointsFor += homeScore;
    home.pointsAgainst += awayScore;
    away.pointsFor += awayScore;
    away.pointsAgainst += homeScore;

    if (homeScore > awayScore) {
      home.wins += 1;
      away.losses += 1;
    } else if (homeScore < awayScore) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.ties += 1;
      away.ties += 1;
    }
  });

  let gamesWithBoxStats = 0;

  const applyTeamStats = (teamId, statItems) => {
    const acc = ensureTeam(teamId);
    statItems.forEach((item) => {
      const valueString = String(item.value ?? "");
      let numeric = parseNumericValue(valueString);
      if (numeric === null) return;
      const lowerLabel = item.label.toLowerCase();
      const labelImpliesPercent =
        lowerLabel.includes("%") ||
        lowerLabel.includes("percent") ||
        lowerLabel.includes("pct");
      const valueIncludesPercentSymbol = valueString.includes("%");
      if (labelImpliesPercent && !valueIncludesPercentSymbol && Math.abs(numeric) <= 1) {
        numeric *= 100;
      }
      const key = `${item.category || "General"}|${item.label.toLowerCase()}`;
      const existing = acc.stats.get(key) || {
        label: item.label,
        category: item.category || "General",
        sum: 0,
        count: 0,
        isPercent: false,
        isRate: false,
      };

      existing.sum += numeric;
      existing.count += 1;
      existing.isPercent =
        existing.isPercent ||
        valueIncludesPercentSymbol ||
        labelImpliesPercent;
      existing.isRate = existing.isRate || isRateLikeLabel(item.label);
      acc.stats.set(key, existing);
    });
  };

  if (includeGameStats && seasonGames.length > 0) {
    const chunkSize = HIGH_VOLUME_SPORTS.has(sport) ? 6 : 10;
    for (let i = 0; i < seasonGames.length; i += chunkSize) {
      const chunk = seasonGames.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(async (game) => {
          try {
            const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary?event=${game.id}`;
            const summary = await fetchJson(summaryUrl, 2);
            const teamStats = extractTeamStatsFromSummary(summary, sport);
            const playerStats = extractPlayerStatsFromSummary(summary, sport);
            const liveTrajectory = extractGameTrajectoryShares(summary, sport, game);
            return { game, teamStats, playerStats, liveTrajectory };
          } catch {
            return { game, teamStats: {}, playerStats: {}, liveTrajectory: null };
          }
        }),
      );

      results.forEach(({ game, teamStats, playerStats, liveTrajectory }) => {
        const homeStats = teamStats[game.homeTeamId] || [];
        const awayStats = teamStats[game.awayTeamId] || [];
        if (homeStats.length > 0 || awayStats.length > 0) {
          gamesWithBoxStats += 1;
        }
        if (homeStats.length > 0) applyTeamStats(game.homeTeamId, homeStats);
        if (awayStats.length > 0) applyTeamStats(game.awayTeamId, awayStats);

        const homePlayerGroups = playerStats[game.homeTeamId] || [];
        const awayPlayerGroups = playerStats[game.awayTeamId] || [];
        if (homePlayerGroups.length > 0) applyPlayerStats(game.id, game.homeTeamId, homePlayerGroups);
        if (awayPlayerGroups.length > 0) applyPlayerStats(game.id, game.awayTeamId, awayPlayerGroups);

        if (liveTrajectory) {
          applyTrajectorySample(
            liveTrajectory.homeTeamId,
            liveTrajectory.homeOffenseShare,
            liveTrajectory.awayOffenseShare,
          );
          applyTrajectorySample(
            liveTrajectory.awayTeamId,
            liveTrajectory.awayOffenseShare,
            liveTrajectory.homeOffenseShare,
          );
        }
      });

      await sleep(90);
    }
  }

  const perTeamStatsMap = {};
  accumulators.forEach((acc, teamId) => {
    if (acc.games <= 0) return;
    const gp = acc.games;
    const pfPerGame = acc.pointsFor / gp;
    const paPerGame = acc.pointsAgainst / gp;
    const diffPerGame = pfPerGame - paPerGame;

    const items = [
      { label: "Wins", value: String(acc.wins), category: "General" },
      { label: "Losses", value: String(acc.losses), category: "General" },
      { label: "Games Played", value: String(gp), category: "General" },
      { label: "Points", value: pfPerGame.toFixed(1), category: "Team" },
      { label: "Opponent Points", value: paPerGame.toFixed(1), category: "Opponent" },
      {
        label: "Points Differential",
        value: diffPerGame > 0 ? `+${diffPerGame.toFixed(1)}` : diffPerGame.toFixed(1),
        category: "Differential",
      },
    ];
    if (acc.ties > 0) {
      items.push({ label: "Ties", value: String(acc.ties), category: "General" });
    }

    const trackedStats = Array.from(acc.stats.values()).sort((a, b) => {
      const catCmp = a.category.localeCompare(b.category);
      if (catCmp !== 0) return catCmp;
      return a.label.localeCompare(b.label);
    });

    trackedStats.forEach((stat) => {
      const lower = stat.label.toLowerCase();
      if (
        lower === "wins" ||
        lower === "losses" ||
        lower === "ties" ||
        lower === "games played" ||
        lower === "games" ||
        lower === "points" ||
        lower === "opponent points" ||
        lower === "points differential"
      ) {
        return;
      }

      const denominator = stat.isRate ? Math.max(1, stat.count) : gp;
      const averaged = stat.sum / denominator;
      const value = stat.isPercent
        ? `${averaged.toFixed(1)}%`
        : lower.includes("differential") && averaged > 0
          ? `+${averaged.toFixed(1)}`
          : averaged.toFixed(1);
      items.push({
        label: stat.label,
        value,
        category: stat.category,
      });
    });

    perTeamStatsMap[`${sport}-${teamId}`] = items;
  });

  const groupPriority = getPlayerGroupPriority(sport);
  const teamPlayerStatsMap = {};
  playerStatAccumulators.forEach((teamAcc, teamId) => {
    const categories = Array.from(teamAcc.groups.values())
      .map((groupAcc) => {
        const labels = Array.isArray(groupAcc.labels) ? groupAcc.labels : [];
        if (labels.length === 0) return null;

        const athletes = Array.from(groupAcc.players.values())
          .map((playerRow) => {
            const playerId = String(playerRow.player?.id || "");
            if (!playerId) return null;
            const meta = teamAcc.players.get(playerId);
            const gamesPlayed = meta?.games?.size || 0;
            if (gamesPlayed <= 0) return null;

            const values = [
              String(gamesPlayed),
              ...labels.map((label) =>
                formatPlayerStatAverage(playerRow.stats.get(label), gamesPlayed, label),
              ),
            ];

            return {
              player: playerRow.player,
              stats: values,
              __sortKey: gamesPlayed,
            };
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.__sortKey !== a.__sortKey) return b.__sortKey - a.__sortKey;
            return String(a.player?.displayName || "").localeCompare(String(b.player?.displayName || ""));
          })
          .map(({ __sortKey, ...rest }) => rest);

        if (athletes.length === 0) return null;

        return {
          name: groupAcc.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "general",
          displayName: groupAcc.displayName,
          shortDisplayName: groupAcc.displayName,
          labels: ["GP", ...labels],
          athletes,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const idxA = groupPriority.indexOf(a.displayName);
        const idxB = groupPriority.indexOf(b.displayName);
        if (idxA === -1 && idxB === -1) return a.displayName.localeCompare(b.displayName);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });

    if (categories.length > 0) {
      teamPlayerStatsMap[`${sport}-${teamId}`] = categories;
    }
  });

  const mergedTeamStatsMap = {};
  const allKeys = new Set([
    ...Object.keys(standingsTeamStatsMap || {}),
    ...Object.keys(perTeamStatsMap),
  ]);
  allKeys.forEach((teamKey) => {
    mergedTeamStatsMap[teamKey] = mergeStatItemLists(
      perTeamStatsMap[teamKey] || [],
      standingsTeamStatsMap?.[teamKey] || [],
    );
  });

  const liveScoringTeamProfiles = {};
  liveTrajectoryAccumulators.forEach((acc, teamId) => {
    const offenseSamples = acc.offenseCount.reduce((sum, v) => sum + v, 0);
    const defenseSamples = acc.defenseCount.reduce((sum, v) => sum + v, 0);
    if (offenseSamples + defenseSamples < 8) return;

    liveScoringTeamProfiles[`${sport}-${teamId}`] = {
      offenseShare: acc.offenseShareSum.map((sum, idx) => {
        const count = acc.offenseCount[idx];
        return count > 0 ? Number((sum / count).toFixed(4)) : 0;
      }),
      offenseCount: acc.offenseCount,
      defenseShare: acc.defenseShareSum.map((sum, idx) => {
        const count = acc.defenseCount[idx];
        return count > 0 ? Number((sum / count).toFixed(4)) : 0;
      }),
      defenseCount: acc.defenseCount,
    };
  });

  return {
    teamStatsMap: mergedTeamStatsMap,
    teamPlayerStatsMap,
    liveScoringModel: {
      binCount: LIVE_TRAJECTORY_BIN_COUNT,
      teamProfiles: liveScoringTeamProfiles,
    },
    finishedGamesCount: seasonGames.length,
    gamesWithBoxStats,
    statsSeasonYear: targetSeasonYear,
  };
};

const getTeamStatNumeric = (stats = [], aliases = []) => {
  const aliasSet = new Set((aliases || []).map((alias) => String(alias || "").toLowerCase().trim()));
  for (const stat of stats) {
    const label = String(stat?.label || "").toLowerCase().trim();
    if (!aliasSet.has(label)) continue;
    const numeric = parseNumericValue(stat?.value);
    if (numeric !== null) return numeric;
  }
  return null;
};

const buildIntegritySummary = ({ sport, gamesHistory, teamStatsMap, seasonYear }) => {
  const finished = gamesHistory.filter((game) => {
    if (game.status !== "finished") return false;
    if (typeof game.seasonType === "number" && game.seasonType === 1) return false;
    if (seasonYear && Number(game.seasonYear) !== Number(seasonYear)) return false;
    const homeScore = parseNumericValue(game.homeScore);
    const awayScore = parseNumericValue(game.awayScore);
    return homeScore !== null && awayScore !== null;
  });

  const byTeam = new Map();
  finished.forEach((game) => {
    const homeId = String(game.homeTeamId || "");
    const awayId = String(game.awayTeamId || "");
    if (!homeId || !awayId) return;
    const homeScore = parseNumericValue(game.homeScore);
    const awayScore = parseNumericValue(game.awayScore);
    if (homeScore === null || awayScore === null) return;

    if (!byTeam.has(homeId)) byTeam.set(homeId, { gp: 0, pf: 0, pa: 0 });
    if (!byTeam.has(awayId)) byTeam.set(awayId, { gp: 0, pf: 0, pa: 0 });

    const home = byTeam.get(homeId);
    home.gp += 1;
    home.pf += homeScore;
    home.pa += awayScore;

    const away = byTeam.get(awayId);
    away.gp += 1;
    away.pf += awayScore;
    away.pa += homeScore;
  });

  const issues = [];
  let coverageSum = 0;
  let coverageCount = 0;
  const teamIds = new Set([
    ...Object.keys(teamStatsMap || {}).map((key) => key.replace(`${sport}-`, "")),
    ...Array.from(byTeam.keys()),
  ]);

  teamIds.forEach((teamId) => {
    const stats = teamStatsMap?.[`${sport}-${teamId}`] || [];
    const history = byTeam.get(teamId) || { gp: 0, pf: 0, pa: 0 };

    if (!stats.length) {
      if (history.gp >= 2) {
        issues.push({
          severity: "critical",
          code: "MISSING_TEAM_STATS",
          teamId,
          expected: history.gp,
          actual: 0,
          message: "Missing team stats while finished games are present",
        });
      }
      return;
    }

    const gp = getTeamStatNumeric(stats, ["games played", "games", "gp"]) || 0;
    const points = getTeamStatNumeric(stats, ["points", "points per game"]);
    const oppPoints = getTeamStatNumeric(stats, ["opponent points", "points allowed", "opp points"]);

    if (history.gp > 0 && gp === 0) {
      issues.push({
        severity: "critical",
        code: "ZERO_GAMES_PLAYED",
        teamId,
        expected: history.gp,
        actual: gp,
        message: "Games played is zero despite finished games in history",
      });
    }

    if (gp > 0 && history.gp > 0) {
      const coverage = history.gp / gp;
      coverageSum += coverage;
      coverageCount += 1;
      if (coverage < 0.75) {
        issues.push({
          severity: "warning",
          code: "SCHEDULE_COVERAGE_LOW",
          teamId,
          expected: gp,
          actual: history.gp,
          message: "Finished-game coverage is materially below reported games played",
        });
      }

      const historyPoints = history.pf / history.gp;
      const historyOppPoints = history.pa / history.gp;
      if (points !== null && Math.abs(points - historyPoints) > 6) {
        issues.push({
          severity: "warning",
          code: "POINTS_AVG_MISMATCH",
          teamId,
          expected: Number(historyPoints.toFixed(2)),
          actual: Number(points.toFixed(2)),
          message: "Points average diverges from historical game aggregate",
        });
      }
      if (oppPoints !== null && Math.abs(oppPoints - historyOppPoints) > 6) {
        issues.push({
          severity: "warning",
          code: "OPP_POINTS_AVG_MISMATCH",
          teamId,
          expected: Number(historyOppPoints.toFixed(2)),
          actual: Number(oppPoints.toFixed(2)),
          message: "Opponent points average diverges from historical game aggregate",
        });
      }
    }
  });

  const severityCounts = issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, { warning: 0, critical: 0 });

  return {
    seasonYear,
    teamsAudited: teamIds.size,
    issues,
    severityCounts,
    averageCoverage: coverageCount > 0 ? Number((coverageSum / coverageCount).toFixed(3)) : 1,
  };
};

const computePregameBacktestMetrics = ({ gamesHistory, seasonYear }) => {
  const finished = gamesHistory
    .filter((game) => {
      if (game.status !== "finished") return false;
      if (typeof game.seasonType === "number" && game.seasonType === 1) return false;
      if (seasonYear && Number(game.seasonYear) !== Number(seasonYear)) return false;
      const homeScore = parseNumericValue(game.homeScore);
      const awayScore = parseNumericValue(game.awayScore);
      return homeScore !== null && awayScore !== null && game.homeTeamId && game.awayTeamId;
    })
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

  const priors = new Map();
  const ensureTeam = (teamId) => {
    if (!priors.has(teamId)) priors.set(teamId, { gp: 0, pf: 0, pa: 0 });
    return priors.get(teamId);
  };

  let evaluatedGames = 0;
  let maeHome = 0;
  let maeAway = 0;
  let maeTotal = 0;
  let maeMargin = 0;
  let brier = 0;
  let logLoss = 0;
  const calibrationBuckets = Array.from({ length: 10 }, () => ({ n: 0, pred: 0, actual: 0 }));

  finished.forEach((game) => {
    const homeId = String(game.homeTeamId);
    const awayId = String(game.awayTeamId);
    const homeActual = parseNumericValue(game.homeScore);
    const awayActual = parseNumericValue(game.awayScore);
    if (homeActual === null || awayActual === null) return;

    const homePrior = ensureTeam(homeId);
    const awayPrior = ensureTeam(awayId);

    if (homePrior.gp >= 5 && awayPrior.gp >= 5) {
      const homeOff = homePrior.pf / homePrior.gp;
      const homeDef = homePrior.pa / homePrior.gp;
      const awayOff = awayPrior.pf / awayPrior.gp;
      const awayDef = awayPrior.pa / awayPrior.gp;

      const homePred = (homeOff + awayDef) / 2;
      const awayPred = (awayOff + homeDef) / 2;
      const predMargin = homePred - awayPred;
      const predTotal = homePred + awayPred;
      const actualMargin = homeActual - awayActual;
      const actualTotal = homeActual + awayActual;

      const homeWinProb = 1 / (1 + Math.exp(-predMargin / 7.5));
      const actualHome = homeActual > awayActual ? 1 : homeActual < awayActual ? 0 : 0.5;
      const clampedProb = Math.max(0.001, Math.min(0.999, homeWinProb));
      const bernoulliActual = actualHome >= 0.5 ? 1 : 0;
      const bernoulliProb = actualHome === 0.5 ? 0.5 : clampedProb;

      evaluatedGames += 1;
      maeHome += Math.abs(homePred - homeActual);
      maeAway += Math.abs(awayPred - awayActual);
      maeTotal += Math.abs(predTotal - actualTotal);
      maeMargin += Math.abs(predMargin - actualMargin);
      brier += (homeWinProb - actualHome) ** 2;
      logLoss += -(bernoulliActual * Math.log(bernoulliProb) + ((1 - bernoulliActual) * Math.log(1 - bernoulliProb)));

      const bucketIdx = Math.max(0, Math.min(9, Math.floor(homeWinProb * 10)));
      const bucket = calibrationBuckets[bucketIdx];
      bucket.n += 1;
      bucket.pred += homeWinProb;
      bucket.actual += actualHome;
    }

    homePrior.gp += 1;
    homePrior.pf += homeActual;
    homePrior.pa += awayActual;
    awayPrior.gp += 1;
    awayPrior.pf += awayActual;
    awayPrior.pa += homeActual;
  });

  const metrics = {
    seasonYear,
    evaluatedGames,
    maeHome: evaluatedGames > 0 ? Number((maeHome / evaluatedGames).toFixed(3)) : null,
    maeAway: evaluatedGames > 0 ? Number((maeAway / evaluatedGames).toFixed(3)) : null,
    maeTotal: evaluatedGames > 0 ? Number((maeTotal / evaluatedGames).toFixed(3)) : null,
    maeMargin: evaluatedGames > 0 ? Number((maeMargin / evaluatedGames).toFixed(3)) : null,
    brier: evaluatedGames > 0 ? Number((brier / evaluatedGames).toFixed(5)) : null,
    logLoss: evaluatedGames > 0 ? Number((logLoss / evaluatedGames).toFixed(5)) : null,
    calibrationError: null,
    calibration: [],
  };

  if (evaluatedGames > 0) {
    const calibration = calibrationBuckets
      .map((bucket, idx) => {
        if (bucket.n <= 0) return null;
        return {
          bucket: `${idx * 10}-${(idx + 1) * 10}%`,
          n: bucket.n,
          predicted: bucket.pred / bucket.n,
          actual: bucket.actual / bucket.n,
        };
      })
      .filter(Boolean);

    const calibrationError = calibration.reduce(
      (sum, bucket) => sum + ((bucket.n / evaluatedGames) * Math.abs(bucket.predicted - bucket.actual)),
      0,
    );
    metrics.calibrationError = Number(calibrationError.toFixed(5));
    metrics.calibration = calibration.map((bucket) => ({
      ...bucket,
      predicted: Number(bucket.predicted.toFixed(4)),
      actual: Number(bucket.actual.toFixed(4)),
    }));
  }

  return metrics;
};

const fetchSportSnapshot = async ({
  sport,
  fromYear,
  toYear,
  daysBack,
  daysForward,
  includeSchedules,
  includeGameStats,
}) => {
  const endpoint = ESPN_ENDPOINTS[sport];
  const scoreboardBase = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
  const standingsBase = `https://site.api.espn.com/apis/v2/sports/${endpoint}/standings`;

  const now = new Date();
  let start;
  let end;
  if (daysBack !== null || daysForward !== null) {
    start = new Date(now);
    end = new Date(now);
    start.setDate(start.getDate() - (daysBack ?? 0));
    end.setDate(end.getDate() + (daysForward ?? 0));
  } else {
    start = new Date(fromYear, 0, 1);
    end = new Date(toYear, 11, 31);
  }
  const dateRanges = buildMonthlyRangesAroundNow(sport, start, end, now);

  const standingsUrl = new URL(standingsBase);
  if (!SOCCER_LEAGUES.has(sport)) standingsUrl.searchParams.set("seasontype", "2");

  const scoreboardEvents = new Map();
  let leagueLogo;
  for (const dates of dateRanges) {
    const scoreboardUrl = new URL(scoreboardBase);
    scoreboardUrl.searchParams.set("limit", "1000");
    scoreboardUrl.searchParams.set("dates", dates);
    if (sport === "NCAAF") scoreboardUrl.searchParams.set("groups", "80");
    if (sport === "NCAAM" || sport === "NCAAW") {
      scoreboardUrl.searchParams.set("groups", "50");
    }

    try {
      const scoreboardData = await fetchJson(scoreboardUrl.toString());
      if (!leagueLogo) leagueLogo = scoreboardData.leagues?.[0]?.logos?.[0]?.href;
      (scoreboardData.events || []).forEach((event) => {
        scoreboardEvents.set(event.id, event);
      });
    } catch (err) {
      console.warn(
        `[sync-internal-db] ${sport} scoreboard fetch failed for ${dates}:`,
        err?.message || err,
      );
    }
    await sleep(120);
  }

  const standingsData = await fetchJson(standingsUrl.toString());
  const gamesHistory = Array.from(scoreboardEvents.values())
    .map((event) => mapEventToGame(event, sport, leagueLogo))
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
  const currentWindowStart = new Date(now);
  const currentWindowEnd = new Date(now);
  currentWindowStart.setDate(currentWindowStart.getDate() - 450);
  currentWindowEnd.setDate(currentWindowEnd.getDate() + 220);
  const games = gamesHistory.filter((game) => {
    const d = new Date(game.dateTime);
    return d >= currentWindowStart && d <= currentWindowEnd;
  });
  const { groups, teamStatsMap: standingsTeamStatsMap } = parseStandings(standingsData, sport);

  const teamSchedules = {};
  if (includeSchedules) {
    const teamIds = Array.from(
      new Set(groups.flatMap((g) => g.standings.map((s) => s.team.id))),
    );

    const chunkSize = 6;
    for (let i = 0; i < teamIds.length; i += chunkSize) {
      const chunk = teamIds.slice(i, i + chunkSize);
      const responses = await Promise.all(
        chunk.map(async (teamId) => {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}/schedule`;
          try {
            const data = await fetchJson(url, 2);
            const teamGames = (data.events || []).map((event) =>
              mapEventToGame(event, sport, leagueLogo),
            );
            return [teamId, teamGames];
          } catch {
            return [teamId, []];
          }
        }),
      );
      responses.forEach(([teamId, teamGames]) => {
        if (teamGames.length > 0) {
          teamSchedules[`${sport}-${teamId}`] = teamGames;
        }
      });
      await sleep(150);
    }
  }

  const {
    teamStatsMap,
    teamPlayerStatsMap,
    liveScoringModel,
    finishedGamesCount,
    gamesWithBoxStats,
    statsSeasonYear,
  } = await aggregateTeamStatsFromFinishedGames({
    sport,
    endpoint,
    gamesHistory,
    standingsTeamStatsMap,
    includeGameStats,
  });

  const integritySummary = buildIntegritySummary({
    sport,
    gamesHistory,
    teamStatsMap,
    seasonYear: statsSeasonYear,
  });
  const qualityMetrics = computePregameBacktestMetrics({
    gamesHistory,
    seasonYear: statsSeasonYear,
  });

  return {
    sport,
    games,
    gamesHistory,
    standings: groups,
    teamStatsMap,
    teamPlayerStatsMap,
    liveScoringModel,
    teamSchedules,
    dateRangeCount: dateRanges.length,
    finishedGamesCount,
    gamesWithBoxStats,
    statsSeasonYear,
    integritySummary,
    qualityMetrics,
  };
};

const sportToFileName = (sport) => sport.replace(/\s+/g, "_");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();

  console.log(
    `[sync-internal-db] sports=${args.sports.join(",")} fromYear=${args.fromYear} toYear=${args.toYear} daysBack=${args.daysBack ?? "off"} daysForward=${args.daysForward ?? "off"} includeSchedules=${args.includeSchedules} includeGameStats=${args.includeGameStats}`,
  );

  await fs.mkdir(outputDir, { recursive: true });

  const manifest = {
    generatedAt,
    sports: {},
  };

  for (const sport of args.sports) {
    console.log(`[sync-internal-db] syncing ${sport}...`);
    try {
      const snapshot = await fetchSportSnapshot({
        sport,
        fromYear: args.fromYear,
        toYear: args.toYear,
        daysBack: args.daysBack,
        daysForward: args.daysForward,
        includeSchedules: args.includeSchedules,
        includeGameStats: args.includeGameStats,
      });
      const teamStats = Object.fromEntries(
        Object.entries(snapshot.teamStatsMap).filter(
          ([, values]) => Array.isArray(values) && values.length > 0,
        ),
      );
      const teamPlayerStats = Object.fromEntries(
        Object.entries(snapshot.teamPlayerStatsMap || {}).filter(
          ([, values]) => Array.isArray(values) && values.length > 0,
        ),
      );

      const sportPayload = {
        generatedAt,
        sport,
        games: snapshot.games,
        gamesHistory: snapshot.gamesHistory,
        standings: snapshot.standings,
        teamSchedules: snapshot.teamSchedules,
        statsSeasonYear: snapshot.statsSeasonYear,
        teamStats,
        teamPlayerStats,
        liveScoringModel: snapshot.liveScoringModel,
        integritySummary: snapshot.integritySummary,
        qualityMetrics: snapshot.qualityMetrics,
      };

      const sportPath = path.join(outputDir, `${sportToFileName(sport)}.json`);
      await fs.writeFile(sportPath, JSON.stringify(sportPayload), "utf8");

      manifest.sports[sport] = {
        dateRanges: snapshot.dateRangeCount,
        currentGames: snapshot.games.length,
        historyGames: snapshot.gamesHistory.length,
        standingsGroups: snapshot.standings.length,
        schedules: Object.keys(snapshot.teamSchedules).length,
        stats: Object.keys(teamStats).length,
        playerStats: Object.keys(teamPlayerStats).length,
        liveScoringTeams: Object.keys(snapshot.liveScoringModel?.teamProfiles || {}).length,
        finishedGames: snapshot.finishedGamesCount,
        gamesWithBoxStats: snapshot.gamesWithBoxStats,
        statsSeasonYear: snapshot.statsSeasonYear,
        integrityWarnings: snapshot.integritySummary?.severityCounts?.warning || 0,
        integrityCritical: snapshot.integritySummary?.severityCounts?.critical || 0,
        qualityEvaluatedGames: snapshot.qualityMetrics?.evaluatedGames || 0,
        qualityBrier: snapshot.qualityMetrics?.brier,
        qualityCalibrationError: snapshot.qualityMetrics?.calibrationError,
      };

      console.log(
        `[sync-internal-db] ${sport}: ranges=${snapshot.dateRangeCount} currentGames=${snapshot.games.length} allGames=${snapshot.gamesHistory.length} schedules=${Object.keys(snapshot.teamSchedules).length} stats=${Object.keys(snapshot.teamStatsMap).length} playerStats=${Object.keys(snapshot.teamPlayerStatsMap || {}).length} finishedGames=${snapshot.finishedGamesCount} gamesWithBoxStats=${snapshot.gamesWithBoxStats} statsSeasonYear=${snapshot.statsSeasonYear ?? "unknown"} integrityWarnings=${snapshot.integritySummary?.severityCounts?.warning || 0} integrityCritical=${snapshot.integritySummary?.severityCounts?.critical || 0} qualityGames=${snapshot.qualityMetrics?.evaluatedGames || 0}`,
      );
      console.log(
        `[sync-internal-db] wrote ${path.relative(repoRoot, sportPath)}`,
      );
    } catch (err) {
      console.warn(`[sync-internal-db] ${sport} failed:`, err?.message || err);
    }
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[sync-internal-db] wrote ${path.relative(repoRoot, manifestPath)}`);
};

main().catch((err) => {
  console.error("[sync-internal-db] fatal:", err);
  process.exit(1);
});
