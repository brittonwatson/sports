import {
  RacingCompetitorResult,
  RacingEventBundle,
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

const eventCache = new Map<string, { fetchedAt: number; data: RacingEventBundle }>();
const standingsCache = new Map<string, { fetchedAt: number; data: RacingStandingsPayload }>();
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

const dedupeStats = (stats: RacingStatValue[]): RacingStatValue[] => {
  const map = new Map<string, RacingStatValue>();
  stats.forEach((stat) => {
    const key = stat.key.toLowerCase();
    if (!key) return;
    if (!shouldShowStatValue(stat.value)) return;
    if (!map.has(key)) {
      map.set(key, stat);
      return;
    }
    // Prefer non-zero values when duplicates exist.
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

const isRaceCompetition = (competition: any): boolean => {
  const typeText = String(competition?.type?.text || competition?.type?.abbreviation || "").toLowerCase();
  if (!typeText) return true;
  return typeText.includes("race");
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
      const athleteRef = competitor?.athlete?.$ref ? asHttps(String(competitor.athlete.$ref)) : "";
      const entity = entityByRef.get(athleteRef);
      const competitorId = String(competitor?.id || entity?.id || "");
      const statsKey = `${competition?.id || "comp"}:${competitorId}`;
      const stats = statsByCompetitorKey.get(statsKey) || [];
      const statusText = String(competitor?.status?.type?.description || "").trim();

      return {
        competitorId,
        name: entity?.name || "Unknown",
        shortName: entity?.shortName,
        abbreviation: entity?.abbreviation,
        logo: entity?.logo,
        flag: entity?.flag,
        vehicleNumber: competitor?.vehicle?.number ? String(competitor.vehicle.number) : undefined,
        teamName: competitor?.vehicle?.team ? String(competitor.vehicle.team) : undefined,
        manufacturer: competitor?.vehicle?.manufacturer ? String(competitor.vehicle.manufacturer) : undefined,
        startPosition: extractNumber(competitor?.startOrder) || undefined,
        finishPosition: extractNumber(competitor?.order) || undefined,
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

  const rankStat = stats.find((stat) => stat.key.toLowerCase() === "rank");
  const rank = extractNumber(rankStat?.value) || fallbackRank;

  return {
    rank,
    competitorId: entity?.id || `${tableId}-${fallbackRank}`,
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

const fetchSeasonEventRefs = async (sport: Sport, seasonYear: number): Promise<string[]> => {
  const url = buildCoreLeagueUrl(sport, `seasons/${seasonYear}/types/2/events`);
  const payload = await fetchJsonSafe(url);
  if (!payload || !Array.isArray(payload.items)) return [];
  return payload.items
    .map((item: any) => (item?.$ref ? asHttps(String(item.$ref)) : ""))
    .filter(Boolean);
};

const buildDerivedDriverStandings = async (sport: Sport): Promise<RacingStandingsPayload> => {
  const currentYear = new Date().getFullYear();
  const seasonCandidates = [currentYear, currentYear - 1];
  let eventRefs: string[] = [];

  for (const year of seasonCandidates) {
    const refs = await fetchSeasonEventRefs(sport, year);
    if (refs.length > 0) {
      eventRefs = refs;
      break;
    }
  }

  const aggregate = new Map<string, {
    ref: string;
    id: string;
    starts: number;
    wins: number;
    top5: number;
    top10: number;
    finishSum: number;
  }>();

  const relevantEvents = eventRefs.slice(0, 64);
  await mapWithConcurrency(relevantEvents, 4, async (eventRef) => {
    const event = await fetchCoreRef(eventRef);
    if (!event || !Array.isArray(event.competitions)) return;
    const raceCompetition = event.competitions.find((competition: any) => isRaceCompetition(competition))
      || event.competitions[0];
    if (!raceCompetition) return;
    const statusPayload = await fetchCoreRef(raceCompetition?.status?.$ref);
    const state = String(statusPayload?.type?.state || "").toLowerCase();
    if (state !== "post") return;

    const competitors = Array.isArray(raceCompetition.competitors) ? raceCompetition.competitors : [];
    competitors.forEach((competitor: any) => {
      const athleteRef = competitor?.athlete?.$ref ? asHttps(String(competitor.athlete.$ref)) : "";
      const athleteId = String(competitor?.id || "");
      if (!athleteRef || !athleteId) return;
      const finish = extractNumber(competitor?.order);
      if (finish <= 0) return;
      const current = aggregate.get(athleteId) || {
        ref: athleteRef,
        id: athleteId,
        starts: 0,
        wins: 0,
        top5: 0,
        top10: 0,
        finishSum: 0,
      };
      current.starts += 1;
      current.finishSum += finish;
      if (finish === 1) current.wins += 1;
      if (finish <= 5) current.top5 += 1;
      if (finish <= 10) current.top10 += 1;
      aggregate.set(athleteId, current);
    });
  });

  const entityRefs = Array.from(new Set(Array.from(aggregate.values()).map((entry) => entry.ref)));
  const entityPayloads = await mapWithConcurrency(entityRefs, 6, async (ref) => {
    const payload = await fetchCoreRef(ref);
    return { ref, payload };
  });
  const entityByRef = new Map<string, EntitySummary>();
  entityPayloads.forEach(({ ref, payload }) => {
    if (!payload) return;
    entityByRef.set(ref, parseEntitySummary(payload));
  });

  const entries: RacingStandingsEntry[] = Array.from(aggregate.values())
    .map((row) => {
      const entity = entityByRef.get(row.ref);
      const avgFinish = row.starts > 0 ? row.finishSum / row.starts : 0;
      return {
        rank: 0,
        competitorId: row.id,
        name: entity?.name || "Unknown",
        shortName: entity?.shortName,
        abbreviation: entity?.abbreviation,
        logo: entity?.logo,
        flag: entity?.flag,
        stats: [
          { key: "wins", label: "Wins", abbreviation: "W", value: String(row.wins) },
          { key: "starts", label: "Starts", abbreviation: "S", value: String(row.starts) },
          { key: "top5", label: "Top 5", abbreviation: "T5", value: String(row.top5) },
          { key: "top10", label: "Top 10", abbreviation: "T10", value: String(row.top10) },
          { key: "avgFinish", label: "Avg Finish", abbreviation: "AVG", value: avgFinish.toFixed(2) },
        ],
      };
    })
    .sort((a, b) => {
      const aWins = extractNumber(a.stats.find((stat) => stat.key === "wins")?.value);
      const bWins = extractNumber(b.stats.find((stat) => stat.key === "wins")?.value);
      if (aWins !== bWins) return bWins - aWins;
      const aTop5 = extractNumber(a.stats.find((stat) => stat.key === "top5")?.value);
      const bTop5 = extractNumber(b.stats.find((stat) => stat.key === "top5")?.value);
      if (aTop5 !== bTop5) return bTop5 - aTop5;
      const aAvg = parseFloat(a.stats.find((stat) => stat.key === "avgFinish")?.value || "0");
      const bAvg = parseFloat(b.stats.find((stat) => stat.key === "avgFinish")?.value || "0");
      return aAvg - bAvg;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    sport,
    updatedAt: new Date().toISOString(),
    derived: true,
    note: "Official standings feed unavailable. Ranking is derived from completed race finishes.",
    tables: [
      {
        id: "derived-driver",
        name: "Driver Standings (Derived)",
        category: "driver",
        entries,
      },
    ],
  };
};

export const isRacingSport = (sport: Sport): boolean => RACING_SPORTS.has(sport);

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
      const athleteRef = competitor?.athlete?.$ref ? asHttps(String(competitor.athlete.$ref)) : "";
      if (athleteRef) athleteRefs.add(athleteRef);
      const competitorId = String(competitor?.id || "");
      const statsRef = competitor?.statistics?.$ref ? asHttps(String(competitor.statistics.$ref)) : "";
      if (statsRef && competitorId) {
        competitorStatRefs.push({
          key: `${competition?.id || "comp"}:${competitorId}`,
          ref: statsRef,
        });
      }
    });
  });

  const statusPayloads = await mapWithConcurrency(Array.from(statusRefs), 6, async (ref) => {
    const payload = await fetchCoreRef(ref);
    return { ref, payload };
  });
  const statusByRef = new Map<string, any>();
  statusPayloads.forEach(({ ref, payload }) => {
    if (payload) statusByRef.set(ref, payload);
  });

  const entityPayloads = await mapWithConcurrency(Array.from(athleteRefs), 8, async (ref) => {
    const payload = await fetchCoreRef(ref);
    return { ref, payload };
  });
  const entityByRef = new Map<string, EntitySummary>();
  entityPayloads.forEach(({ ref, payload }) => {
    if (!payload) return;
    entityByRef.set(ref, parseEntitySummary(payload));
  });

  const statsPayloads = await mapWithConcurrency(competitorStatRefs, 10, async (entry) => {
    const payload = await fetchCoreRef(entry.ref);
    return {
      key: entry.key,
      stats: payload ? parseStatValues(payload) : [],
    };
  });
  const statsByCompetitorKey = new Map<string, RacingStatValue[]>();
  statsPayloads.forEach((entry) => statsByCompetitorKey.set(entry.key, entry.stats));

  const sessions = competitions
    .filter((competition: any) => {
      if (sport !== "F1") return true;
      const typeText = String(competition?.type?.text || competition?.type?.abbreviation || "").toLowerCase();
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

  const entityPayloads = await mapWithConcurrency(Array.from(entityRefs), 8, async (ref) => {
    const payload = await fetchCoreRef(ref);
    return { ref, payload };
  });

  const entityByRef = new Map<string, EntitySummary>();
  entityPayloads.forEach(({ ref, payload }) => {
    if (!payload) return;
    entityByRef.set(ref, parseEntitySummary(payload));
  });

  const tables: RacingStandingsTable[] = tablePayloads
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

  let payload: RacingStandingsPayload;
  if (tables.length > 0) {
    payload = {
      sport,
      updatedAt: new Date().toISOString(),
      tables,
    };
  } else {
    payload = await buildDerivedDriverStandings(sport);
  }

  standingsCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  return payload;
};
