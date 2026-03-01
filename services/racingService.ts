import {
  RacingCalendarEvent,
  RacingCalendarFinisher,
  RacingCalendarPayload,
  RacingCalendarSession,
  RacingCompetitorResult,
  RacingDriverEventResult,
  RacingDriverSeasonResults,
  RacingEventBundle,
  RacingEventPrediction,
  RacingEventPredictionEntry,
  RacingSessionResult,
  RacingStandingsEntry,
  RacingStandingsPayload,
  RacingStandingsTable,
  RacingStatValue,
  Sport,
} from "../types";
import { ESPN_ENDPOINTS } from "./constants";
import { extractNumber, fetchWithRetry } from "./utils";

const CORE_BASE = "https://sports.core.api.espn.com/v2";
const CORE_QUERY = "lang=en&region=us";
const EVENT_CACHE_TTL_MS = 2 * 60 * 1000;
const STANDINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;
const DRIVER_SEASON_CACHE_TTL_MS = 5 * 60 * 1000;
const SEASON_DATA_CACHE_TTL_MS = 10 * 60 * 1000;

const eventCache = new Map<string, { fetchedAt: number; data: RacingEventBundle }>();
const standingsCache = new Map<string, { fetchedAt: number; data: RacingStandingsPayload }>();
const calendarCache = new Map<string, { fetchedAt: number; data: RacingCalendarPayload }>();
const driverSeasonCache = new Map<string, { fetchedAt: number; data: RacingDriverSeasonResults }>();
const seasonDataCache = new Map<string, { fetchedAt: number; data: SeasonDataSnapshot }>();
const coreRefCache = new Map<string, any>();

const RACING_SPORTS = new Set<Sport>(["F1", "INDYCAR", "NASCAR"]);
const F1_ONLY_SESSION_TYPES = new Set(["practice", "free practice", "qualifying", "sprint shootout", "sprint", "race"]);

interface EntitySummary {
  id: string;
  name: string;
  shortName?: string;
  abbreviation?: string;
  logo?: string;
  flag?: string;
}

interface StandingsTableRaw {
  id: string;
  name: string;
  displayName?: string;
  standings: any[];
}

interface DriverAggregateRow {
  competitorId: string;
  ref: string;
  starts: number;
  wins: number;
  podiums: number;
  top5: number;
  top10: number;
  finishSum: number;
  points: number;
  recentFinishes: number[];
  lastFinish?: number;
}

interface SeasonDataSnapshot {
  sport: Sport;
  seasonYear: number;
  eventRefs: string[];
  events: any[];
}

interface SeriesScoringRule {
  displayName: string;
  racePoints: number[];
  sprintPoints?: number[];
  notes: string;
}

const SERIES_SCORING_RULES: Record<Sport, SeriesScoringRule | null> = {
  F1: {
    displayName: "F1",
    racePoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sprintPoints: [8, 7, 6, 5, 4, 3, 2, 1],
    notes: "Race + sprint finish points (fastest-lap bonus excluded unless published in feed).",
  },
  INDYCAR: {
    displayName: "INDYCAR",
    racePoints: [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    notes: "Race finish points with common INDYCAR base schedule (special bonus points may vary by event).",
  },
  NASCAR: {
    displayName: "NASCAR Cup",
    racePoints: [40, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1],
    notes: "Race finish points only (stage/playoff bonus points excluded unless present in feed).",
  },
  NBA: null,
  NFL: null,
  MLB: null,
  NHL: null,
  EPL: null,
  Bundesliga: null,
  "La Liga": null,
  "Ligue 1": null,
  "Serie A": null,
  MLS: null,
  UCL: null,
  NCAAF: null,
  NCAAM: null,
  NCAAW: null,
  WNBA: null,
  UFC: null,
};

const asHttps = (value: string): string => value.replace(/^http:/i, "https:");

const getLeagueSlug = (sport: Sport): string => {
  const endpoint = ESPN_ENDPOINTS[sport] || "";
  const parts = endpoint.split("/");
  return parts[parts.length - 1] || "";
};

const buildCoreLeagueUrl = (sport: Sport, path: string): string => {
  const league = getLeagueSlug(sport);
  return `${CORE_BASE}/sports/racing/leagues/${league}/${path}?${CORE_QUERY}`;
};

const safeStatValue = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim();
  if (!normalized) return "";
  return normalized;
};

const shouldShowStatValue = (value: string): boolean => {
  if (!value) return false;
  if (value === "-" || value === "--") return false;
  return true;
};

const normalizeKey = (value: string): string => String(value || "").trim().toLowerCase();

const dedupeStats = (stats: RacingStatValue[]): RacingStatValue[] => {
  const map = new Map<string, RacingStatValue>();
  stats.forEach((stat) => {
    const key = normalizeKey(stat.key);
    if (!key) return;
    if (!shouldShowStatValue(stat.value)) return;
    if (!map.has(key)) {
      map.set(key, stat);
      return;
    }
    const existing = map.get(key)!;
    const existingNum = extractNumber(existing.value);
    const nextNum = extractNumber(stat.value);
    if (nextNum !== 0 && existingNum === 0) {
      map.set(key, stat);
    }
  });
  return Array.from(map.values());
};

const parseStatValues = (statsPayload: any): RacingStatValue[] => {
  const categories = Array.isArray(statsPayload?.splits?.categories)
    ? statsPayload.splits.categories
    : [];
  const parsed: RacingStatValue[] = [];

  categories.forEach((category: any) => {
    (category?.stats || []).forEach((stat: any) => {
      const key = String(stat?.name || stat?.abbreviation || "").trim();
      if (!key) return;
      const label = String(stat?.displayName || stat?.shortDisplayName || stat?.name || key).trim();
      const value = safeStatValue(stat?.displayValue ?? stat?.value);
      parsed.push({
        key,
        label,
        abbreviation: stat?.abbreviation ? String(stat.abbreviation) : undefined,
        value,
      });
    });
  });

  return dedupeStats(parsed);
};

const parseEntitySummary = (payload: any): EntitySummary => ({
  id: String(payload?.id || ""),
  name: String(payload?.displayName || payload?.name || "Unknown"),
  shortName: payload?.shortName ? String(payload.shortName) : payload?.shortDisplayName ? String(payload.shortDisplayName) : undefined,
  abbreviation: payload?.abbreviation ? String(payload.abbreviation) : undefined,
  logo: payload?.headshot?.href || payload?.logo || payload?.logos?.[0]?.href,
  flag: payload?.flag?.href,
});

const parseStatus = (statusPayload: any): { state: "scheduled" | "in_progress" | "finished"; text: string } => {
  const stateText = String(statusPayload?.type?.state || "").toLowerCase();
  if (stateText === "in") {
    return {
      state: "in_progress",
      text: String(statusPayload?.type?.detail || statusPayload?.type?.description || "In Progress"),
    };
  }
  if (stateText === "post") {
    return {
      state: "finished",
      text: String(statusPayload?.type?.detail || statusPayload?.type?.description || "Final"),
    };
  }
  return {
    state: "scheduled",
    text: String(statusPayload?.type?.detail || statusPayload?.type?.description || "Scheduled"),
  };
};

const fetchJson = async (url: string): Promise<any> => {
  const response = await fetchWithRetry(asHttps(url));
  if (!response.ok) {
    throw new Error(`Failed request (${response.status}) for ${url}`);
  }
  return response.json();
};

const fetchJsonSafe = async (url: string): Promise<any | null> => {
  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
};

const fetchCoreRef = async (ref: string | undefined): Promise<any | null> => {
  if (!ref) return null;
  const key = asHttps(ref);
  if (coreRefCache.has(key)) return coreRefCache.get(key);
  const payload = await fetchJsonSafe(key);
  if (payload) coreRefCache.set(key, payload);
  return payload;
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const safeLimit = Math.max(1, Math.floor(limit));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
};

const getSessionDisplayName = (competition: any): string => {
  const typeText = String(competition?.type?.text || competition?.type?.abbreviation || "Session").trim();
  const sessionNumber = extractNumber(competition?.session);
  const normalizedType = typeText.toLowerCase();

  if (normalizedType === "free practice" && sessionNumber > 0) return `Practice ${sessionNumber}`;
  if (normalizedType === "qualifying" && sessionNumber > 1) return `Qualifying ${sessionNumber}`;
  if (normalizedType === "sprint shootout") return "Sprint Shootout";
  if (normalizedType === "sprint") return "Sprint";
  if (normalizedType === "race") return "Race";
  if (sessionNumber > 1) return `${typeText} ${sessionNumber}`;
  return typeText;
};

const parseCompetitionStatus = async (competition: any): Promise<{ state: "scheduled" | "in_progress" | "finished"; text: string }> => {
  const inlineState = competition?.status?.type?.state;
  if (inlineState) {
    return parseStatus(competition.status);
  }
  const statusRef = competition?.status?.$ref ? asHttps(String(competition.status.$ref)) : "";
  if (!statusRef) return { state: "scheduled", text: "Scheduled" };
  const statusPayload = await fetchCoreRef(statusRef);
  return parseStatus(statusPayload);
};

const normalizeCompetitionType = (competition: any): string => {
  return String(competition?.type?.text || competition?.type?.abbreviation || "").toLowerCase();
};

const isRaceCompetition = (competition: any): boolean => {
  const typeText = normalizeCompetitionType(competition);
  if (!typeText) return true;
  return typeText.includes("race");
};

const isPracticeCompetition = (competition: any): boolean => {
  const typeText = normalizeCompetitionType(competition);
  return typeText.includes("practice") || typeText.startsWith("fp") || typeText.includes("warmup");
};

const isQualifyingCompetition = (competition: any): boolean => {
  const typeText = normalizeCompetitionType(competition);
  return typeText.includes("qualifying") || typeText.includes("shootout");
};

const isSprintCompetition = (sport: Sport, competition: any): boolean => {
  if (sport !== "F1") return false;
  const typeText = normalizeCompetitionType(competition);
  if (!typeText) return false;
  return typeText.includes("sprint") && !typeText.includes("shootout");
};

const getCompetitorFinish = (competitor: any): number => {
  const order = extractNumber(competitor?.order);
  if (order > 0) return order;
  const place = extractNumber(competitor?.place);
  if (place > 0) return place;
  const curated = extractNumber(competitor?.curatedRank?.current);
  if (curated > 0) return curated;
  return Number.MAX_SAFE_INTEGER;
};

const getCompetitorStart = (competitor: any): number | undefined => {
  const startOrder = extractNumber(competitor?.startOrder);
  if (startOrder > 0) return startOrder;
  const start = extractNumber(competitor?.startPosition);
  if (start > 0) return start;
  return undefined;
};

const getCompetitorId = (competitor: any): string => {
  const athleteId = String(competitor?.athlete?.id || "").trim();
  if (athleteId) return athleteId;
  const id = String(competitor?.id || "").trim();
  return id;
};

const getCompetitorAthleteRef = (competitor: any): string => {
  return competitor?.athlete?.$ref ? asHttps(String(competitor.athlete.$ref)) : "";
};

const getStatValue = (stats: RacingStatValue[] | undefined, keys: string[]): number | null => {
  if (!stats || stats.length === 0) return null;
  for (const key of keys) {
    const match = stats.find((stat) => normalizeKey(stat.key) === normalizeKey(key));
    if (!match) continue;
    const parsed = extractNumber(match.value);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
    if (match.value.trim() === "0") return 0;
  }
  return null;
};

const makeTopFinisher = (
  competitor: any,
  entityByRef: Map<string, EntitySummary>,
): RacingCalendarFinisher | null => {
  const finish = getCompetitorFinish(competitor);
  if (!Number.isFinite(finish) || finish <= 0 || finish === Number.MAX_SAFE_INTEGER) return null;

  const athleteRef = getCompetitorAthleteRef(competitor);
  const entity = entityByRef.get(athleteRef);
  const competitorId = getCompetitorId(competitor);

  return {
    rank: finish,
    competitorId: competitorId || entity?.id || `driver-${finish}`,
    name: entity?.name || String(competitor?.athlete?.displayName || competitor?.name || "Unknown"),
    shortName: entity?.shortName,
    abbreviation: entity?.abbreviation,
    logo: entity?.logo,
    teamName: competitor?.vehicle?.team ? String(competitor.vehicle.team) : undefined,
    manufacturer: competitor?.vehicle?.manufacturer ? String(competitor.vehicle.manufacturer) : undefined,
    statusText: competitor?.status?.type?.description ? String(competitor.status.type.description) : undefined,
  };
};

const parseCategoryFromTable = (table: StandingsTableRaw): RacingStandingsTable["category"] => {
  const label = `${table?.name || ""} ${table?.displayName || ""}`.toLowerCase();
  if (label.includes("driver") || label.includes("athlete")) return "driver";
  if (label.includes("constructor") || label.includes("manufacturer")) return "constructor";
  if (label.includes("team")) return "team";
  return "other";
};

const parseStandingsEntry = (
  entry: any,
  tableId: string,
  fallbackRank: number,
  entityByRef: Map<string, EntitySummary>,
): RacingStandingsEntry => {
  const athleteRef = entry?.athlete?.$ref ? asHttps(String(entry.athlete.$ref)) : "";
  const manufacturerRef = entry?.manufacturer?.$ref ? asHttps(String(entry.manufacturer.$ref)) : "";
  const selectedRef = athleteRef || manufacturerRef;
  const entity = selectedRef ? entityByRef.get(selectedRef) : undefined;
  const records = Array.isArray(entry?.records) ? entry.records : [];
  const stats = dedupeStats(
    records.flatMap((record: any) => (
      (record?.stats || []).map((stat: any) => ({
        key: String(stat?.name || stat?.abbreviation || "").trim(),
        label: String(stat?.displayName || stat?.shortDisplayName || stat?.name || "").trim(),
        abbreviation: stat?.abbreviation ? String(stat.abbreviation) : undefined,
        value: safeStatValue(stat?.displayValue ?? stat?.value),
      }))
    )),
  );

  const rankStat = stats.find((stat) => normalizeKey(stat.key) === "rank");
  const rank = extractNumber(rankStat?.value) || fallbackRank;

  return {
    rank,
    competitorId: entity?.id || getCompetitorId(entry) || `${tableId}-${fallbackRank}`,
    name: entity?.name || "Unknown",
    shortName: entity?.shortName,
    abbreviation: entity?.abbreviation,
    logo: entity?.logo,
    flag: entity?.flag,
    teamName: undefined,
    manufacturer: undefined,
    stats,
  };
};

const scoreFromTable = (pointsTable: number[], finishPosition: number): number => {
  if (!Number.isFinite(finishPosition) || finishPosition <= 0 || finishPosition === Number.MAX_SAFE_INTEGER) return 0;
  if (finishPosition <= pointsTable.length) return pointsTable[finishPosition - 1] || 0;
  return 0;
};

const resolveSeasonYearCandidates = (): number[] => {
  const nowYear = new Date().getFullYear();
  return [nowYear, nowYear + 1, nowYear - 1, nowYear - 2];
};

const fetchSeasonTypeIds = async (sport: Sport, seasonYear: number): Promise<number[]> => {
  const payload = await fetchJsonSafe(buildCoreLeagueUrl(sport, `seasons/${seasonYear}/types`));
  const ids = Array.isArray(payload?.items)
    ? payload.items
      .map((item: any) => Number(item?.id || item?.type || item?.value))
      .filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  if (ids.length === 0) return [2];
  return Array.from(new Set(ids));
};

const fetchSeasonEventRefsForYear = async (sport: Sport, seasonYear: number): Promise<string[]> => {
  const typeIds = await fetchSeasonTypeIds(sport, seasonYear);
  const refsByType = await mapWithConcurrency(typeIds, 3, async (typeId) => {
    const url = buildCoreLeagueUrl(sport, `seasons/${seasonYear}/types/${typeId}/events`);
    const payload = await fetchJsonSafe(url);
    if (!payload || !Array.isArray(payload.items)) return [] as string[];
    return payload.items
      .map((item: any) => (item?.$ref ? asHttps(String(item.$ref)) : ""))
      .filter(Boolean);
  });

  return Array.from(new Set(refsByType.flat()));
};

const fetchSeasonDataSnapshot = async (sport: Sport): Promise<SeasonDataSnapshot | null> => {
  const candidates = resolveSeasonYearCandidates();
  for (const seasonYear of candidates) {
    const cacheKey = `${sport}:${seasonYear}`;
    const cached = seasonDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < SEASON_DATA_CACHE_TTL_MS) {
      return cached.data;
    }

    const refs = await fetchSeasonEventRefsForYear(sport, seasonYear);
    if (refs.length === 0) continue;

    const events = await mapWithConcurrency(refs, 4, async (ref) => fetchCoreRef(ref));
    const validEvents = events.filter(Boolean);
    if (validEvents.length === 0) continue;

    const statusRefs = new Set<string>();
    validEvents.forEach((event: any) => {
      const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
      competitions.forEach((competition: any) => {
        const ref = competition?.status?.$ref ? asHttps(String(competition.status.$ref)) : "";
        if (ref) statusRefs.add(ref);
      });
    });
    if (statusRefs.size > 0) {
      const statusPayloads = await mapWithConcurrency(Array.from(statusRefs), 10, async (ref) => ({ ref, payload: await fetchCoreRef(ref) }));
      const statusByRef = new Map<string, any>();
      statusPayloads.forEach((entry) => {
        if (entry.payload) statusByRef.set(entry.ref, entry.payload);
      });
      validEvents.forEach((event: any) => {
        const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
        competitions.forEach((competition: any) => {
          if (competition?.status?.type?.state) return;
          const ref = competition?.status?.$ref ? asHttps(String(competition.status.$ref)) : "";
          if (!ref) return;
          const status = statusByRef.get(ref);
          if (status) competition.status = status;
        });
      });
    }

    const snapshot: SeasonDataSnapshot = {
      sport,
      seasonYear,
      eventRefs: refs,
      events: validEvents,
    };
    seasonDataCache.set(cacheKey, { fetchedAt: Date.now(), data: snapshot });
    return snapshot;
  }

  return null;
};

const buildEntityMapForRefs = async (refs: string[]): Promise<Map<string, EntitySummary>> => {
  const uniqueRefs = Array.from(new Set(refs.filter(Boolean)));
  if (uniqueRefs.length === 0) return new Map<string, EntitySummary>();
  const entities = await mapWithConcurrency(uniqueRefs, 8, async (ref) => {
    const payload = await fetchCoreRef(ref);
    return payload ? { ref, entity: parseEntitySummary(payload) } : null;
  });
  const map = new Map<string, EntitySummary>();
  entities.forEach((entry) => {
    if (!entry) return;
    map.set(entry.ref, entry.entity);
  });
  return map;
};

const extractRaceCompetition = (event: any): any | null => {
  const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
  if (competitions.length === 0) return null;
  return competitions.find((competition: any) => isRaceCompetition(competition)) || competitions[0] || null;
};

const buildSeasonDriverAggregate = (
  sport: Sport,
  events: any[],
): Map<string, DriverAggregateRow> => {
  const rule = SERIES_SCORING_RULES[sport];
  const aggregate = new Map<string, DriverAggregateRow>();

  const sortedEvents = [...events].sort((a, b) => {
    const aTime = new Date(String(a?.date || "")).getTime();
    const bTime = new Date(String(b?.date || "")).getTime();
    return aTime - bTime;
  });

  sortedEvents.forEach((event) => {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
    competitions.forEach((competition: any) => {
      const statusState = String(competition?.status?.type?.state || "").toLowerCase();
      if (statusState !== "post") return;

      const typeText = normalizeCompetitionType(competition);
      const useSprintPoints = isSprintCompetition(sport, competition);
      const includeInPoints = isRaceCompetition(competition) || useSprintPoints;
      const pointsTable = useSprintPoints
        ? (rule?.sprintPoints || [])
        : (rule?.racePoints || []);

      if (!includeInPoints) return;

      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      competitors.forEach((competitor: any) => {
        const athleteRef = getCompetitorAthleteRef(competitor);
        const competitorId = getCompetitorId(competitor);
        if (!athleteRef || !competitorId) return;
        const finish = getCompetitorFinish(competitor);
        if (!Number.isFinite(finish) || finish <= 0 || finish === Number.MAX_SAFE_INTEGER) return;

        const current = aggregate.get(competitorId) || {
          competitorId,
          ref: athleteRef,
          starts: 0,
          wins: 0,
          podiums: 0,
          top5: 0,
          top10: 0,
          finishSum: 0,
          points: 0,
          recentFinishes: [],
          lastFinish: undefined,
        };

        if (isRaceCompetition(competition)) {
          current.starts += 1;
          current.finishSum += finish;
          current.recentFinishes.push(finish);
          if (current.recentFinishes.length > 8) current.recentFinishes = current.recentFinishes.slice(-8);
          current.lastFinish = finish;
          if (finish === 1) current.wins += 1;
          if (finish <= 3) current.podiums += 1;
          if (finish <= 5) current.top5 += 1;
          if (finish <= 10) current.top10 += 1;
        }

        const basePoints = scoreFromTable(pointsTable, finish);
        let bonus = 0;
        if (sport === "INDYCAR" && isRaceCompetition(competition)) {
          const start = getCompetitorStart(competitor);
          if (start === 1) bonus += 1;
        }
        if (sport === "NASCAR" && isRaceCompetition(competition)) {
          const stagePoints = extractNumber(competitor?.stagePoints);
          if (stagePoints > 0) bonus += stagePoints;
        }
        if (sport === "F1" && isRaceCompetition(competition) && finish <= 10) {
          const fastestLapRank = extractNumber(competitor?.fastestLapRank);
          if (fastestLapRank === 1) bonus += 1;
        }

        current.points += (basePoints + bonus);
        aggregate.set(competitorId, current);
      });

      if (sport === "F1" && isSprintCompetition(sport, competition) && !typeText.includes("shootout")) {
        // Sprint sessions are already scored above.
      }
    });
  });

  return aggregate;
};

const buildDerivedStandingsTable = async (
  sport: Sport,
  aggregate: Map<string, DriverAggregateRow>,
): Promise<RacingStandingsTable> => {
  const refs = Array.from(new Set(Array.from(aggregate.values()).map((row) => row.ref)));
  const entityByRef = await buildEntityMapForRefs(refs);

  const entries: RacingStandingsEntry[] = Array.from(aggregate.values())
    .map((row) => {
      const entity = entityByRef.get(row.ref);
      const avgFinish = row.starts > 0 ? row.finishSum / row.starts : 0;
      return {
        rank: 0,
        competitorId: row.competitorId,
        name: entity?.name || "Unknown",
        shortName: entity?.shortName,
        abbreviation: entity?.abbreviation,
        logo: entity?.logo,
        flag: entity?.flag,
        stats: [
          { key: "points", label: "Points", abbreviation: "PTS", value: String(Math.round(row.points)) },
          { key: "wins", label: "Wins", abbreviation: "W", value: String(row.wins) },
          { key: "podiums", label: "Podiums", abbreviation: "POD", value: String(row.podiums) },
          { key: "starts", label: "Starts", abbreviation: "S", value: String(row.starts) },
          { key: "top5", label: "Top 5", abbreviation: "T5", value: String(row.top5) },
          { key: "top10", label: "Top 10", abbreviation: "T10", value: String(row.top10) },
          { key: "avgFinish", label: "Avg Finish", abbreviation: "AVG", value: avgFinish > 0 ? avgFinish.toFixed(2) : "-" },
          { key: "lastFinish", label: "Last Finish", abbreviation: "LAST", value: row.lastFinish ? String(row.lastFinish) : "-" },
        ],
      };
    })
    .sort((a, b) => {
      const pointsA = extractNumber(a.stats.find((stat) => normalizeKey(stat.key) === "points")?.value);
      const pointsB = extractNumber(b.stats.find((stat) => normalizeKey(stat.key) === "points")?.value);
      if (pointsA !== pointsB) return pointsB - pointsA;
      const winsA = extractNumber(a.stats.find((stat) => normalizeKey(stat.key) === "wins")?.value);
      const winsB = extractNumber(b.stats.find((stat) => normalizeKey(stat.key) === "wins")?.value);
      if (winsA !== winsB) return winsB - winsA;
      const avgA = extractNumber(a.stats.find((stat) => normalizeKey(stat.key) === "avgfinish")?.value);
      const avgB = extractNumber(b.stats.find((stat) => normalizeKey(stat.key) === "avgfinish")?.value);
      return avgA - avgB;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    id: "model-series-points",
    name: `${SERIES_SCORING_RULES[sport]?.displayName || sport} Series Points (Model)`,
    category: "driver",
    entries,
  };
};

const buildCalendarPayloadFromSnapshot = async (snapshot: SeasonDataSnapshot): Promise<RacingCalendarPayload> => {
  const events = snapshot.events;

  const athleteRefs = new Set<string>();
  const statusRefs = new Set<string>();
  events.forEach((event: any) => {
    const raceCompetition = extractRaceCompetition(event);
    if (!raceCompetition) return;

    if (raceCompetition?.status?.$ref) statusRefs.add(asHttps(String(raceCompetition.status.$ref)));

    const competitors = Array.isArray(raceCompetition?.competitors) ? raceCompetition.competitors : [];
    competitors
      .sort((a: any, b: any) => getCompetitorFinish(a) - getCompetitorFinish(b))
      .slice(0, 5)
      .forEach((competitor: any) => {
        const athleteRef = getCompetitorAthleteRef(competitor);
        if (athleteRef) athleteRefs.add(athleteRef);
      });
  });

  const [entityByRef, statusPayloads] = await Promise.all([
    buildEntityMapForRefs(Array.from(athleteRefs)),
    mapWithConcurrency(Array.from(statusRefs), 8, async (ref) => ({ ref, payload: await fetchCoreRef(ref) })),
  ]);

  const statusByRef = new Map<string, any>();
  statusPayloads.forEach((entry) => {
    if (!entry.payload) return;
    statusByRef.set(entry.ref, entry.payload);
  });

  const mappedEvents: RacingCalendarEvent[] = await mapWithConcurrency(events, 4, async (event: any) => {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
    const raceCompetition = extractRaceCompetition(event);

    const raceStatus = raceCompetition?.status?.$ref
      ? parseStatus(statusByRef.get(asHttps(String(raceCompetition.status.$ref))))
      : await parseCompetitionStatus(raceCompetition);

    const topFinishers = raceCompetition
      ? (Array.isArray(raceCompetition.competitors) ? raceCompetition.competitors : [])
        .sort((a: any, b: any) => getCompetitorFinish(a) - getCompetitorFinish(b))
        .slice(0, 5)
        .map((competitor: any) => makeTopFinisher(competitor, entityByRef))
        .filter((entry): entry is RacingCalendarFinisher => Boolean(entry))
      : [];

    const sessions: RacingCalendarSession[] = await mapWithConcurrency(competitions, 4, async (competition: any) => {
      const status = await parseCompetitionStatus(competition);
      return {
        id: String(competition?.id || ""),
        name: getSessionDisplayName(competition),
        date: String(competition?.date || event?.date || ""),
        status: status.state,
        statusText: status.text,
      };
    });

    const venueName = event?.venues?.[0]?.fullName || event?.circuit?.shortName || undefined;
    const locationParts = [
      event?.venues?.[0]?.address?.city,
      event?.venues?.[0]?.address?.state || event?.venues?.[0]?.address?.country,
    ].filter(Boolean);

    return {
      eventId: String(event?.id || ""),
      name: String(event?.name || "Race Event"),
      shortName: String(event?.shortName || event?.name || "Race Event"),
      date: String(event?.date || ""),
      endDate: event?.endDate ? String(event.endDate) : undefined,
      venue: venueName,
      location: locationParts.length > 0 ? locationParts.join(", ") : undefined,
      status: raceStatus.state,
      statusText: raceStatus.text,
      seasonYear: Number(event?.season?.year) || snapshot.seasonYear,
      seasonType: Number(event?.season?.type?.type ?? event?.season?.type?.id) || undefined,
      topFinishers,
      sessions: sessions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    };
  });

  const sorted = mappedEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return {
    sport: snapshot.sport,
    seasonYear: snapshot.seasonYear,
    updatedAt: new Date().toISOString(),
    events: sorted,
  };
};

const toSessionResult = (
  competition: any,
  status: { state: "scheduled" | "in_progress" | "finished"; text: string },
  entityByRef: Map<string, EntitySummary>,
  statsByCompetitorKey: Map<string, RacingStatValue[]>,
): RacingSessionResult => {
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const results: RacingCompetitorResult[] = competitors
    .map((competitor: any) => {
      const athleteRef = getCompetitorAthleteRef(competitor);
      const entity = entityByRef.get(athleteRef);
      const competitorId = getCompetitorId(competitor) || entity?.id || "";
      const statsKey = `${competition?.id || "comp"}:${competitorId}`;
      const stats = statsByCompetitorKey.get(statsKey) || [];
      const statusText = String(competitor?.status?.type?.description || "").trim();

      return {
        competitorId,
        name: entity?.name || String(competitor?.athlete?.displayName || "Unknown"),
        shortName: entity?.shortName,
        abbreviation: entity?.abbreviation,
        logo: entity?.logo,
        flag: entity?.flag,
        vehicleNumber: competitor?.vehicle?.number ? String(competitor.vehicle.number) : undefined,
        teamName: competitor?.vehicle?.team ? String(competitor.vehicle.team) : undefined,
        manufacturer: competitor?.vehicle?.manufacturer ? String(competitor.vehicle.manufacturer) : undefined,
        startPosition: getCompetitorStart(competitor),
        finishPosition: (() => {
          const finish = getCompetitorFinish(competitor);
          return finish === Number.MAX_SAFE_INTEGER ? undefined : finish;
        })(),
        winner: Boolean(competitor?.winner),
        statusText: statusText || undefined,
        stats,
      };
    })
    .sort((a, b) => {
      const aPos = a.finishPosition || Number.MAX_SAFE_INTEGER;
      const bPos = b.finishPosition || Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
      const aStart = a.startPosition || Number.MAX_SAFE_INTEGER;
      const bStart = b.startPosition || Number.MAX_SAFE_INTEGER;
      return aStart - bStart;
    });

  return {
    id: String(competition?.id || ""),
    name: getSessionDisplayName(competition),
    shortName: competition?.type?.abbreviation ? String(competition.type.abbreviation) : undefined,
    sessionNumber: extractNumber(competition?.session) || undefined,
    date: String(competition?.date || ""),
    status: status.state,
    statusText: status.text,
    competitors: results,
  };
};

const buildEventPrediction = (
  sport: Sport,
  eventId: string,
  sessions: RacingSessionResult[],
  aggregate: Map<string, DriverAggregateRow>,
  standings: RacingStandingsPayload | null,
): RacingEventPrediction | undefined => {
  const raceSession = sessions.find((session) => normalizeKey(session.name).includes("race")) || sessions[sessions.length - 1];
  if (!raceSession) return undefined;

  const participants = raceSession.competitors;
  if (participants.length < 2) return undefined;

  const qualifyingSession = [...sessions]
    .filter((session) => normalizeKey(session.name).includes("qualifying") || normalizeKey(session.name).includes("shootout"))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  const practiceSessions = sessions
    .filter((session) => normalizeKey(session.name).includes("practice") || normalizeKey(session.name).startsWith("fp"));

  const seasonRankByDriver = new Map<string, number>();
  const pointsByDriver = new Map<string, number>();
  const driverTable = standings?.tables.find((table) => table.category === "driver") || standings?.tables[0];
  (driverTable?.entries || []).forEach((entry) => {
    seasonRankByDriver.set(String(entry.competitorId), entry.rank);
    const points = extractNumber(entry.stats.find((stat) => normalizeKey(stat.key) === "points" || normalizeKey(stat.key) === "championshippts")?.value);
    if (points > 0) pointsByDriver.set(String(entry.competitorId), points);
  });

  const qualifyingRankByDriver = new Map<string, number>();
  (qualifyingSession?.competitors || []).forEach((row) => {
    if (!row.competitorId) return;
    const rank = row.finishPosition || row.startPosition;
    if (rank && rank > 0) qualifyingRankByDriver.set(row.competitorId, rank);
  });

  const practiceRankByDriver = new Map<string, number>();
  participants.forEach((participant) => {
    const ranks = practiceSessions
      .map((session) => session.competitors.find((row) => row.competitorId === participant.competitorId))
      .filter((row): row is RacingCompetitorResult => Boolean(row))
      .map((row) => row.finishPosition || row.startPosition)
      .filter((rank): rank is number => Boolean(rank && rank > 0));

    if (ranks.length === 0) return;
    const avg = ranks.reduce((sum, value) => sum + value, 0) / ranks.length;
    practiceRankByDriver.set(participant.competitorId, avg);
  });

  const starterCount = participants.length;
  const featureRows = participants.map((participant) => {
    const aggregateRow = aggregate.get(participant.competitorId);
    const starts = Math.max(1, aggregateRow?.starts || 0);
    const avgFinish = aggregateRow && aggregateRow.starts > 0
      ? aggregateRow.finishSum / aggregateRow.starts
      : starterCount / 2;
    const recentAvgFinish = aggregateRow && aggregateRow.recentFinishes.length > 0
      ? aggregateRow.recentFinishes.slice(-5).reduce((sum, value) => sum + value, 0) / Math.min(5, aggregateRow.recentFinishes.length)
      : avgFinish;

    return {
      participant,
      seasonRank: seasonRankByDriver.get(participant.competitorId) || starterCount,
      seasonPoints: pointsByDriver.get(participant.competitorId) || aggregateRow?.points || 0,
      starts,
      avgFinish,
      recentAvgFinish,
      winRate: aggregateRow && starts > 0 ? aggregateRow.wins / starts : 0,
      top5Rate: aggregateRow && starts > 0 ? aggregateRow.top5 / starts : 0,
      qualifyingRank: qualifyingRankByDriver.get(participant.competitorId),
      practiceRank: practiceRankByDriver.get(participant.competitorId),
      startPosition: participant.startPosition,
    };
  });

  const normalizeInverseRank = (value: number | undefined, fallback: number): number => {
    const safe = value && Number.isFinite(value) && value > 0 ? value : fallback;
    return (starterCount + 1 - Math.min(starterCount, safe)) / starterCount;
  };

  const pointsMax = Math.max(...featureRows.map((row) => row.seasonPoints), 1);

  const scored = featureRows.map((row) => {
    const seasonRankScore = normalizeInverseRank(row.seasonRank, starterCount / 2);
    const qualifyingScore = normalizeInverseRank(row.qualifyingRank, starterCount * 0.65);
    const practiceScore = normalizeInverseRank(row.practiceRank, starterCount * 0.65);
    const startScore = normalizeInverseRank(row.startPosition, starterCount * 0.7);
    const avgFinishScore = normalizeInverseRank(row.avgFinish, starterCount * 0.55);
    const recentScore = normalizeInverseRank(row.recentAvgFinish, starterCount * 0.55);
    const pointsScore = Math.max(0, Math.min(1, row.seasonPoints / pointsMax));
    const winRateScore = Math.max(0, Math.min(1, row.winRate));
    const top5RateScore = Math.max(0, Math.min(1, row.top5Rate));

    const hasQualifying = row.qualifyingRank !== undefined;
    const hasPractice = row.practiceRank !== undefined;

    const composite = (
      (seasonRankScore * 0.18) +
      (pointsScore * 0.15) +
      (avgFinishScore * 0.16) +
      (recentScore * 0.17) +
      (winRateScore * 0.10) +
      (top5RateScore * 0.08) +
      ((hasQualifying ? qualifyingScore : startScore) * 0.11) +
      ((hasPractice ? practiceScore : 0.5) * 0.05)
    );

    const variance = 0.8 + (hasQualifying ? 0 : 0.2) + (hasPractice ? 0 : 0.12) + Math.max(0, 0.4 - (row.starts / 20));

    return {
      ...row,
      composite,
      variance,
    };
  });

  const simulations = 10000;
  const seed = scored
    .map((row) => `${row.participant.competitorId}:${row.composite.toFixed(6)}:${row.variance.toFixed(6)}`)
    .join("|")
    .split("")
    .reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 2166136261);

  let randomSeed = seed >>> 0;
  const random = (): number => {
    randomSeed = (randomSeed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(randomSeed ^ (randomSeed >>> 15), 1 | randomSeed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const sampleNormal = (mean: number, stdev: number): number => {
    const u1 = Math.max(1e-12, random());
    const u2 = Math.max(1e-12, random());
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + (z * stdev);
  };

  const winCounts = new Map<string, number>();
  const podiumCounts = new Map<string, number>();
  const top5Counts = new Map<string, number>();

  for (let sim = 0; sim < simulations; sim += 1) {
    const sampled = scored
      .map((row) => ({
        id: row.participant.competitorId,
        value: sampleNormal(-row.composite, row.variance),
      }))
      .sort((a, b) => a.value - b.value);

    sampled.forEach((row, index) => {
      const position = index + 1;
      if (position === 1) winCounts.set(row.id, (winCounts.get(row.id) || 0) + 1);
      if (position <= 3) podiumCounts.set(row.id, (podiumCounts.get(row.id) || 0) + 1);
      if (position <= 5) top5Counts.set(row.id, (top5Counts.get(row.id) || 0) + 1);
    });
  }

  const predictionEntries: RacingEventPredictionEntry[] = scored
    .map((row) => {
      const wins = winCounts.get(row.participant.competitorId) || 0;
      const podiums = podiumCounts.get(row.participant.competitorId) || 0;
      const top5 = top5Counts.get(row.participant.competitorId) || 0;

      const bullets: string[] = [];
      if (row.qualifyingRank && row.qualifyingRank <= 5) bullets.push(`qualifying P${row.qualifyingRank}`);
      if (row.practiceRank && row.practiceRank <= 5) bullets.push(`practice avg P${row.practiceRank.toFixed(1)}`);
      if (row.seasonRank && row.seasonRank <= 5) bullets.push(`season rank #${row.seasonRank}`);
      if (row.recentAvgFinish && row.recentAvgFinish <= 7) bullets.push(`recent avg finish ${row.recentAvgFinish.toFixed(1)}`);
      if (row.startPosition && row.startPosition <= 5) bullets.push(`starting P${row.startPosition}`);

      const explanation = bullets.length > 0
        ? `${bullets.slice(0, 3).join(", ")} drive this projection.`
        : "Projection is driven mostly by season form and current-session data.";

      return {
        rank: 0,
        competitorId: row.participant.competitorId,
        name: row.participant.name,
        shortName: row.participant.shortName,
        abbreviation: row.participant.abbreviation,
        logo: row.participant.logo,
        teamName: row.participant.teamName,
        manufacturer: row.participant.manufacturer,
        startingPosition: row.startPosition,
        qualifyingRank: row.qualifyingRank,
        practiceRank: row.practiceRank,
        seasonRank: row.seasonRank,
        winProbability: (wins / simulations) * 100,
        podiumProbability: (podiums / simulations) * 100,
        top5Probability: (top5 / simulations) * 100,
        compositeRating: row.composite,
        explanation,
      };
    })
    .sort((a, b) => b.winProbability - a.winProbability)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const topWin = predictionEntries[0]?.winProbability || 0;
  const secondWin = predictionEntries[1]?.winProbability || 0;
  const separation = Math.max(0, topWin - secondWin);
  const sampleCoverage = Math.min(1, (
    (qualifyingSession ? 0.36 : 0) +
    (practiceSessions.length > 0 ? 0.22 : 0) +
    (Math.min(1, featureRows.reduce((sum, row) => sum + row.starts, 0) / (featureRows.length * 12)) * 0.42)
  ));
  const confidence = Math.max(0.2, Math.min(0.97, (sampleCoverage * 0.65) + (Math.min(1, separation / 12) * 0.35)));

  return {
    sport,
    eventId,
    simulations,
    confidence,
    updatedAt: new Date().toISOString(),
    model: "Racing Pace Blend v1 (qualifying + practice + season form)",
    entries: predictionEntries,
  };
};

const buildDriverSeasonResultsFromSnapshot = async (
  sport: Sport,
  snapshot: SeasonDataSnapshot,
  driverId: string,
): Promise<RacingDriverSeasonResults | null> => {
  const aggregate = buildSeasonDriverAggregate(sport, snapshot.events);
  const driverAggregate = aggregate.get(driverId);
  if (!driverAggregate) return null;

  const entityByRef = await buildEntityMapForRefs([driverAggregate.ref]);
  const entity = entityByRef.get(driverAggregate.ref);

  const rule = SERIES_SCORING_RULES[sport];
  const results: RacingDriverEventResult[] = [];

  snapshot.events
    .slice()
    .sort((a, b) => new Date(String(a?.date || "")).getTime() - new Date(String(b?.date || "")).getTime())
    .forEach((event: any) => {
      const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
      const raceCompetition = extractRaceCompetition(event);
      if (!raceCompetition) return;

      const competitor = (Array.isArray(raceCompetition.competitors) ? raceCompetition.competitors : [])
        .find((row: any) => getCompetitorId(row) === driverId);

      if (!competitor) return;

      const statusState = String(raceCompetition?.status?.type?.state || "").toLowerCase();
      const statusText = String(raceCompetition?.status?.type?.detail || raceCompetition?.status?.type?.description || "Scheduled");
      const finish = getCompetitorFinish(competitor);
      const start = getCompetitorStart(competitor);
      const points = rule
        ? scoreFromTable(rule.racePoints, finish)
        : 0;

      const lapsLed = extractNumber(competitor?.lapsLead);
      const positionGain = Number.isFinite(start) && Number.isFinite(finish) && finish !== Number.MAX_SAFE_INTEGER
        ? (start - finish)
        : undefined;

      results.push({
        eventId: String(event?.id || ""),
        eventName: String(event?.name || "Race Event"),
        shortName: String(event?.shortName || event?.name || "Race Event"),
        date: String(event?.date || ""),
        status: statusState === "post" ? "finished" : statusState === "in" ? "in_progress" : "scheduled",
        statusText,
        startPosition: start,
        finishPosition: finish === Number.MAX_SAFE_INTEGER ? undefined : finish,
        points: points > 0 ? points : undefined,
        lapsLed: lapsLed > 0 ? lapsLed : undefined,
        positionGain,
        teamName: competitor?.vehicle?.team ? String(competitor.vehicle.team) : undefined,
        manufacturer: competitor?.vehicle?.manufacturer ? String(competitor.vehicle.manufacturer) : undefined,
      });

      const sprintCompetition = competitions.find((competition: any) => isSprintCompetition(sport, competition));
      if (sprintCompetition) {
        const sprintCompetitor = (Array.isArray(sprintCompetition.competitors) ? sprintCompetition.competitors : [])
          .find((row: any) => getCompetitorId(row) === driverId);
        if (sprintCompetitor) {
          const sprintFinish = getCompetitorFinish(sprintCompetitor);
          const sprintPoints = rule?.sprintPoints ? scoreFromTable(rule.sprintPoints, sprintFinish) : 0;
          if (sprintPoints > 0 && results.length > 0) {
            const last = results[results.length - 1];
            last.points = (last.points || 0) + sprintPoints;
          }
        }
      }
    });

  const starts = driverAggregate.starts;
  const avgFinish = starts > 0 ? driverAggregate.finishSum / starts : 0;

  return {
    sport,
    seasonYear: snapshot.seasonYear,
    driverId,
    driverName: entity?.name || "Unknown Driver",
    shortName: entity?.shortName,
    abbreviation: entity?.abbreviation,
    logo: entity?.logo,
    starts,
    wins: driverAggregate.wins,
    podiums: driverAggregate.podiums,
    top5: driverAggregate.top5,
    top10: driverAggregate.top10,
    avgFinish,
    points: Math.round(driverAggregate.points),
    pointsSource: "derived",
    results,
  };
};

const buildDerivedPayloadFallback = async (sport: Sport): Promise<RacingStandingsPayload> => {
  const snapshot = await fetchSeasonDataSnapshot(sport);
  if (!snapshot) {
    return {
      sport,
      updatedAt: new Date().toISOString(),
      derived: true,
      note: "Official standings feed unavailable.",
      tables: [],
    };
  }

  const aggregate = buildSeasonDriverAggregate(sport, snapshot.events);
  const table = await buildDerivedStandingsTable(sport, aggregate);
  return {
    sport,
    updatedAt: new Date().toISOString(),
    derived: true,
    note: `Official standings feed unavailable. ${SERIES_SCORING_RULES[sport]?.notes || "Model points derived from completed race results."}`,
    tables: [table],
  };
};

export const isRacingSport = (sport: Sport): boolean => RACING_SPORTS.has(sport);

export const fetchRacingCalendarPayload = async (sport: Sport): Promise<RacingCalendarPayload> => {
  if (!isRacingSport(sport)) {
    return {
      sport,
      seasonYear: new Date().getFullYear(),
      updatedAt: new Date().toISOString(),
      events: [],
    };
  }

  const cacheKey = `${sport}:calendar`;
  const cached = calendarCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < CALENDAR_CACHE_TTL_MS) {
    return cached.data;
  }

  const snapshot = await fetchSeasonDataSnapshot(sport);
  if (!snapshot) {
    const payload: RacingCalendarPayload = {
      sport,
      seasonYear: new Date().getFullYear(),
      updatedAt: new Date().toISOString(),
      events: [],
    };
    calendarCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
    return payload;
  }

  const payload = await buildCalendarPayloadFromSnapshot(snapshot);
  calendarCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  return payload;
};

export const fetchRacingDriverSeasonResults = async (sport: Sport, driverId: string): Promise<RacingDriverSeasonResults | null> => {
  if (!isRacingSport(sport) || !driverId) return null;

  const cacheKey = `${sport}:${driverId}`;
  const cached = driverSeasonCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < DRIVER_SEASON_CACHE_TTL_MS) {
    return cached.data;
  }

  const snapshot = await fetchSeasonDataSnapshot(sport);
  if (!snapshot) return null;

  const payload = await buildDriverSeasonResultsFromSnapshot(sport, snapshot, driverId);
  if (!payload) return null;

  driverSeasonCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  return payload;
};

export const fetchRacingEventBundle = async (sport: Sport, eventId: string): Promise<RacingEventBundle | null> => {
  if (!isRacingSport(sport) || !eventId) return null;
  const cacheKey = `${sport}:${eventId}`;
  const cached = eventCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < EVENT_CACHE_TTL_MS) {
    return cached.data;
  }

  const eventUrl = buildCoreLeagueUrl(sport, `events/${eventId}`);
  const event = await fetchJsonSafe(eventUrl);
  if (!event) return null;

  const competitions = Array.isArray(event.competitions) ? event.competitions : [];
  const athleteRefs = new Set<string>();
  const statusRefs = new Set<string>();
  const competitorStatRefs: Array<{ key: string; ref: string }> = [];

  competitions.forEach((competition: any) => {
    if (competition?.status?.$ref) statusRefs.add(asHttps(String(competition.status.$ref)));
    (competition?.competitors || []).forEach((competitor: any) => {
      const athleteRef = getCompetitorAthleteRef(competitor);
      if (athleteRef) athleteRefs.add(athleteRef);
      const competitorId = getCompetitorId(competitor);
      const statsRef = competitor?.statistics?.$ref ? asHttps(String(competitor.statistics.$ref)) : "";
      if (statsRef && competitorId) {
        competitorStatRefs.push({
          key: `${competition?.id || "comp"}:${competitorId}`,
          ref: statsRef,
        });
      }
    });
  });

  const [statusPayloads, entityByRef, statsPayloads] = await Promise.all([
    mapWithConcurrency(Array.from(statusRefs), 8, async (ref) => ({ ref, payload: await fetchCoreRef(ref) })),
    buildEntityMapForRefs(Array.from(athleteRefs)),
    mapWithConcurrency(competitorStatRefs, 10, async (entry) => {
      const payload = await fetchCoreRef(entry.ref);
      return { key: entry.key, stats: payload ? parseStatValues(payload) : [] as RacingStatValue[] };
    }),
  ]);

  const statusByRef = new Map<string, any>();
  statusPayloads.forEach(({ ref, payload }) => {
    if (payload) statusByRef.set(ref, payload);
  });

  const statsByCompetitorKey = new Map<string, RacingStatValue[]>();
  statsPayloads.forEach((entry) => statsByCompetitorKey.set(entry.key, entry.stats));

  const sessions = competitions
    .filter((competition: any) => {
      if (sport !== "F1") return true;
      const typeText = normalizeCompetitionType(competition);
      if (!typeText) return true;
      return F1_ONLY_SESSION_TYPES.has(typeText);
    })
    .map((competition: any) => {
      const statusRef = competition?.status?.$ref ? asHttps(String(competition.status.$ref)) : "";
      const parsedStatus = parseStatus(statusByRef.get(statusRef));
      return toSessionResult(competition, parsedStatus, entityByRef, statsByCompetitorKey);
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const venueName = event?.venues?.[0]?.fullName || event?.circuit?.shortName || undefined;
  const locationParts = [
    event?.venues?.[0]?.address?.city,
    event?.venues?.[0]?.address?.state || event?.venues?.[0]?.address?.country,
  ].filter(Boolean);

  const snapshot = await fetchSeasonDataSnapshot(sport);
  const aggregate = snapshot ? buildSeasonDriverAggregate(sport, snapshot.events) : new Map<string, DriverAggregateRow>();
  const standings = await fetchRacingStandingsPayload(sport);
  const prediction = buildEventPrediction(sport, String(event?.id || eventId), sessions, aggregate, standings);

  const result: RacingEventBundle = {
    sport,
    eventId: String(event?.id || eventId),
    name: String(event?.name || "Race Event"),
    shortName: String(event?.shortName || event?.name || "Race Event"),
    date: String(event?.date || ""),
    endDate: event?.endDate ? String(event.endDate) : undefined,
    venue: venueName,
    location: locationParts.length > 0 ? locationParts.join(", ") : undefined,
    sessions,
    prediction,
  };

  eventCache.set(cacheKey, { fetchedAt: Date.now(), data: result });
  return result;
};

export const fetchRacingStandingsPayload = async (sport: Sport): Promise<RacingStandingsPayload> => {
  if (!isRacingSport(sport)) {
    return { sport, updatedAt: new Date().toISOString(), tables: [] };
  }

  const cacheKey = `${sport}:standings`;
  const cached = standingsCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < STANDINGS_CACHE_TTL_MS) {
    return cached.data;
  }

  const root = await fetchJsonSafe(buildCoreLeagueUrl(sport, "standings"));
  const standingsRef = root?.$ref ? asHttps(String(root.$ref)) : "";
  const standingsIndex = standingsRef ? await fetchCoreRef(standingsRef) : null;
  const items = Array.isArray(standingsIndex?.items) ? standingsIndex.items : [];

  const tablePayloads = await mapWithConcurrency(items, 4, async (item: any) => {
    const ref = item?.$ref ? asHttps(String(item.$ref)) : "";
    const payload = ref ? await fetchCoreRef(ref) : null;
    return {
      id: String(item?.id || payload?.id || ""),
      name: String(item?.displayName || item?.name || payload?.displayName || payload?.name || "Standings"),
      displayName: String(item?.displayName || payload?.displayName || ""),
      standings: Array.isArray(payload?.standings) ? payload.standings : [],
    } as StandingsTableRaw;
  });

  const entityRefs = new Set<string>();
  tablePayloads.forEach((table) => {
    table.standings.forEach((entry: any) => {
      const athleteRef = entry?.athlete?.$ref ? asHttps(String(entry.athlete.$ref)) : "";
      const manufacturerRef = entry?.manufacturer?.$ref ? asHttps(String(entry.manufacturer.$ref)) : "";
      if (athleteRef) entityRefs.add(athleteRef);
      if (manufacturerRef) entityRefs.add(manufacturerRef);
    });
  });

  const entityByRef = await buildEntityMapForRefs(Array.from(entityRefs));

  const officialTables: RacingStandingsTable[] = tablePayloads
    .map((table) => {
      const entries = table.standings
        .map((entry: any, index: number) => parseStandingsEntry(entry, table.id || "table", index + 1, entityByRef))
        .sort((a, b) => a.rank - b.rank);
      return {
        id: table.id || table.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: table.name || table.displayName || "Standings",
        category: parseCategoryFromTable(table),
        entries,
      };
    })
    .filter((table) => table.entries.length > 0);

  const snapshot = await fetchSeasonDataSnapshot(sport);
  const aggregate = snapshot ? buildSeasonDriverAggregate(sport, snapshot.events) : new Map<string, DriverAggregateRow>();
  const derivedTable = await buildDerivedStandingsTable(sport, aggregate);
  const includeDerivedTable = derivedTable.entries.length > 0;
  const mergedTables = includeDerivedTable ? [derivedTable, ...officialTables] : officialTables;

  let payload: RacingStandingsPayload;
  if (officialTables.length > 0) {
    payload = {
      sport,
      updatedAt: new Date().toISOString(),
      note: `Model points table uses series rules: ${SERIES_SCORING_RULES[sport]?.notes || "completed race finish points."}`,
      tables: mergedTables,
    };
  } else {
    payload = await buildDerivedPayloadFallback(sport);
  }

  standingsCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  return payload;
};
