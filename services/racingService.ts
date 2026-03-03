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
  RacingPreSeasonData,
  Sport,
} from "../types";
import { ESPN_ENDPOINTS } from "./constants";
import {
  ensureInternalSportLoaded,
  getInternalRacingCalendar,
  getInternalRacingDriverSeason,
  getInternalRacingEventBundle,
  getInternalRacingEventsMap,
  getInternalRacingPreSeason,
  getInternalRacingStandings,
} from "./internalDbService";
import { extractNumber, fetchWithRetry } from "./utils";

const CORE_BASE = "https://sports.core.api.espn.com/v2";
const CORE_QUERY = "lang=en&region=us";
const EVENT_CACHE_TTL_MS = 2 * 60 * 1000;
const STANDINGS_CACHE_TTL_MS = 15 * 60 * 1000;
const CALENDAR_CACHE_TTL_MS = 15 * 60 * 1000;
const DRIVER_SEASON_CACHE_TTL_MS = 15 * 60 * 1000;
const SEASON_DATA_CACHE_TTL_MS = 30 * 60 * 1000;
const COMPLETED_EVENT_STORAGE_KEY = "sports_internal_racing_completed_events_v1";
const PERSISTED_RACING_CACHE_STORAGE_KEY = "sports_internal_racing_payload_cache_v1";
const MAX_COMPLETED_EVENTS_PER_SPORT = 240;
const COMPLETED_EVENT_RETENTION_MS = 540 * 24 * 60 * 60 * 1000; // ~18 months
const PERSISTED_EVENT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PERSISTED_STANDINGS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSISTED_CALENDAR_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSISTED_DRIVER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PERSISTED_EVENT_ENTRIES = 36;
const MAX_PERSISTED_STANDINGS_ENTRIES = 8;
const MAX_PERSISTED_CALENDAR_ENTRIES = 8;
const MAX_PERSISTED_DRIVER_ENTRIES = 72;

const eventCache = new Map<string, { fetchedAt: number; data: RacingEventBundle }>();
const standingsCache = new Map<string, { fetchedAt: number; data: RacingStandingsPayload }>();
const calendarCache = new Map<string, { fetchedAt: number; data: RacingCalendarPayload }>();
const driverSeasonCache = new Map<string, { fetchedAt: number; data: RacingDriverSeasonResults }>();
const seasonDataCache = new Map<string, { fetchedAt: number; data: SeasonDataSnapshot }>();
const coreRefCache = new Map<string, any>();
const completedEventStore = new Map<string, RacingEventBundle>();
let completedEventStoreLoaded = false;
let persistedRacingPayloadCacheLoaded = false;
let persistPayloadCacheTimer: ReturnType<typeof setTimeout> | null = null;

const RACING_SPORTS = new Set<Sport>(["F1", "INDYCAR", "NASCAR"]);
const F1_ONLY_SESSION_TYPES = new Set(["practice", "free practice", "qualifying", "sprint shootout", "sprint", "race"]);

interface EntitySummary {
  id: string;
  name: string;
  shortName?: string;
  abbreviation?: string;
  logo?: string;
  flag?: string;
  number?: string;
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
    notes: "Race finish points + bonus: 1 for pole, 1 for leading a lap, 2 for most laps led. Model table may undercount lap-led bonuses.",
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

const normalizeNameKey = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const parseVehicleNumber = (...candidates: unknown[]): string | undefined => {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return undefined;
};

const parsePercentValue = (value: number): string => {
  if (!Number.isFinite(value)) return "0.0%";
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(1)}%`;
};

const firstText = (...candidates: unknown[]): string | undefined => {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return undefined;
};

const buildRacingVenueAndLocation = (
  event: any,
  raceCompetition: any,
): { venueName?: string; location?: string } => {
  const venueName = firstText(
    event?.circuit?.fullName,
    event?.circuit?.displayName,
    event?.circuit?.name,
    raceCompetition?.circuit?.fullName,
    raceCompetition?.circuit?.displayName,
    raceCompetition?.circuit?.name,
    event?.venues?.[0]?.fullName,
    raceCompetition?.venue?.fullName,
  );

  const city = firstText(
    event?.circuit?.address?.city,
    raceCompetition?.circuit?.address?.city,
    event?.venues?.[0]?.address?.city,
    raceCompetition?.venue?.address?.city,
  );
  const region = firstText(
    event?.circuit?.address?.state,
    event?.circuit?.address?.country,
    raceCompetition?.circuit?.address?.state,
    raceCompetition?.circuit?.address?.country,
    event?.venues?.[0]?.address?.state,
    event?.venues?.[0]?.address?.country,
    raceCompetition?.venue?.address?.state,
    raceCompetition?.venue?.address?.country,
  );
  const location = city ? (region ? `${city}, ${region}` : city) : region;
  return { venueName, location };
};

const canUseLocalStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

interface PersistedCacheEntry<T> {
  fetchedAt: number;
  data: T;
}

interface PersistedRacingPayloadEnvelope {
  version: 1;
  savedAt: number;
  events?: Record<string, PersistedCacheEntry<RacingEventBundle>>;
  standings?: Record<string, PersistedCacheEntry<RacingStandingsPayload>>;
  calendars?: Record<string, PersistedCacheEntry<RacingCalendarPayload>>;
  drivers?: Record<string, PersistedCacheEntry<RacingDriverSeasonResults>>;
}

const copyCacheEntry = <T>(value: { fetchedAt: number; data: T }): { fetchedAt: number; data: T } => ({
  fetchedAt: value.fetchedAt,
  data: value.data,
});

const serializeCacheBucket = <T>(
  source: Map<string, { fetchedAt: number; data: T }>,
  maxAgeMs: number,
  maxEntries: number,
): Record<string, PersistedCacheEntry<T>> => {
  const now = Date.now();
  const rows = Array.from(source.entries())
    .filter(([, entry]) => Number.isFinite(entry.fetchedAt) && (now - entry.fetchedAt) <= maxAgeMs)
    .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
    .slice(0, maxEntries);

  const out: Record<string, PersistedCacheEntry<T>> = {};
  rows.forEach(([key, entry]) => {
    out[key] = copyCacheEntry(entry);
  });
  return out;
};

const hydrateCacheBucket = <T>(
  raw: unknown,
  target: Map<string, { fetchedAt: number; data: T }>,
  maxAgeMs: number,
): void => {
  if (!raw || typeof raw !== "object") return;
  const now = Date.now();
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const fetchedAt = Number((value as { fetchedAt?: number }).fetchedAt);
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return;
    if ((now - fetchedAt) > maxAgeMs) return;
    const data = (value as { data?: T }).data;
    if (data === undefined || data === null) return;

    const existing = target.get(key);
    if (existing && existing.fetchedAt >= fetchedAt) return;
    target.set(key, { fetchedAt, data });
  });
};

const persistRacingPayloadCaches = (): void => {
  if (!canUseLocalStorage()) return;
  try {
    const payload: PersistedRacingPayloadEnvelope = {
      version: 1,
      savedAt: Date.now(),
      events: serializeCacheBucket(eventCache, PERSISTED_EVENT_MAX_AGE_MS, MAX_PERSISTED_EVENT_ENTRIES),
      standings: serializeCacheBucket(standingsCache, PERSISTED_STANDINGS_MAX_AGE_MS, MAX_PERSISTED_STANDINGS_ENTRIES),
      calendars: serializeCacheBucket(calendarCache, PERSISTED_CALENDAR_MAX_AGE_MS, MAX_PERSISTED_CALENDAR_ENTRIES),
      drivers: serializeCacheBucket(driverSeasonCache, PERSISTED_DRIVER_MAX_AGE_MS, MAX_PERSISTED_DRIVER_ENTRIES),
    };
    window.localStorage.setItem(PERSISTED_RACING_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota/private mode failures.
  }
};

const schedulePersistRacingPayloadCaches = (): void => {
  if (!canUseLocalStorage()) return;
  if (persistPayloadCacheTimer) return;
  persistPayloadCacheTimer = setTimeout(() => {
    persistPayloadCacheTimer = null;
    persistRacingPayloadCaches();
  }, 120);
};

const loadPersistedRacingPayloadCaches = (): void => {
  if (persistedRacingPayloadCacheLoaded || !canUseLocalStorage()) return;
  persistedRacingPayloadCacheLoaded = true;

  try {
    const raw = window.localStorage.getItem(PERSISTED_RACING_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedRacingPayloadEnvelope>;
    if (!parsed || typeof parsed !== "object") return;

    hydrateCacheBucket<RacingEventBundle>(parsed.events, eventCache, PERSISTED_EVENT_MAX_AGE_MS);
    hydrateCacheBucket<RacingStandingsPayload>(parsed.standings, standingsCache, PERSISTED_STANDINGS_MAX_AGE_MS);
    hydrateCacheBucket<RacingCalendarPayload>(parsed.calendars, calendarCache, PERSISTED_CALENDAR_MAX_AGE_MS);
    hydrateCacheBucket<RacingDriverSeasonResults>(parsed.drivers, driverSeasonCache, PERSISTED_DRIVER_MAX_AGE_MS);
  } catch {
    // Ignore malformed storage payloads.
  }
};

const completedEventStorageKeyFor = (sport: Sport, eventId: string): string => `${sport}:${eventId}`;

const loadCompletedEventStore = (): void => {
  if (completedEventStoreLoaded || !canUseLocalStorage()) return;
  completedEventStoreLoaded = true;
  try {
    const raw = window.localStorage.getItem(COMPLETED_EVENT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    Object.entries(parsed || {}).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      const bundle = value as RacingEventBundle;
      if (!bundle?.sport || !bundle?.eventId || !Array.isArray(bundle?.sessions)) return;
      completedEventStore.set(key, bundle);
    });
  } catch {
    // Ignore malformed storage payloads.
  }
};

const persistCompletedEventStore = (): void => {
  if (!canUseLocalStorage()) return;
  try {
    const serializable: Record<string, RacingEventBundle> = {};
    completedEventStore.forEach((bundle, key) => {
      serializable[key] = bundle;
    });
    window.localStorage.setItem(COMPLETED_EVENT_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Ignore quota/private mode failures.
  }
};

const getStoredCompletedEvent = (sport: Sport, eventId: string): RacingEventBundle | null => {
  loadCompletedEventStore();
  return completedEventStore.get(completedEventStorageKeyFor(sport, eventId)) || null;
};

const isCompletedRaceEvent = (bundle: RacingEventBundle): boolean => {
  const raceSession = bundle.sessions.find((session) => normalizeKey(session.name).includes("race"));
  if (raceSession) return raceSession.status === "finished";
  if (bundle.sessions.length === 0) return false;
  return bundle.sessions.every((session) => session.status === "finished");
};

const pruneCompletedEventStore = (): void => {
  const nowMs = Date.now();
  const grouped = new Map<Sport, Array<{ key: string; bundle: RacingEventBundle; dateMs: number }>>();

  completedEventStore.forEach((bundle, key) => {
    const sport = bundle.sport;
    if (!sport) return;
    const dateMs = new Date(bundle.date).getTime();
    if (!grouped.has(sport)) grouped.set(sport, []);
    grouped.get(sport)!.push({ key, bundle, dateMs });
  });

  grouped.forEach((entries) => {
    entries.sort((a, b) => {
      const aMs = Number.isFinite(a.dateMs) ? a.dateMs : 0;
      const bMs = Number.isFinite(b.dateMs) ? b.dateMs : 0;
      return bMs - aMs;
    });

    entries.forEach((entry, index) => {
      const isTooOld = Number.isFinite(entry.dateMs) && entry.dateMs < (nowMs - COMPLETED_EVENT_RETENTION_MS);
      if (index >= MAX_COMPLETED_EVENTS_PER_SPORT || isTooOld) {
        completedEventStore.delete(entry.key);
      }
    });
  });
};

const recordCompletedEventBundle = (bundle: RacingEventBundle): void => {
  if (!bundle?.sport || !bundle?.eventId || !isCompletedRaceEvent(bundle)) return;
  loadCompletedEventStore();
  const key = completedEventStorageKeyFor(bundle.sport, bundle.eventId);
  completedEventStore.set(key, bundle);
  pruneCompletedEventStore();
  persistCompletedEventStore();
};

const extractFinishDataFromCompletedStore = (
  sport: Sport,
  afterDateIso?: string,
): Map<string, number[]> => {
  loadCompletedEventStore();
  const result = new Map<string, number[]>();
  const afterMs = afterDateIso ? new Date(afterDateIso).getTime() : 0;

  completedEventStore.forEach((bundle) => {
    if (bundle.sport !== sport) return;
    const eventDateMs = new Date(bundle.date).getTime();
    if (!Number.isFinite(eventDateMs) || eventDateMs < afterMs) return;

    const raceSession = bundle.sessions.find((s) =>
      normalizeKey(s.name).includes('race') && s.status === 'finished',
    );
    if (!raceSession) return;

    raceSession.competitors.forEach((comp) => {
      if (!comp.competitorId || !comp.finishPosition) return;
      const existing = result.get(comp.competitorId) || [];
      existing.push(comp.finishPosition);
      result.set(comp.competitorId, existing);
    });
  });

  return result;
};

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

const readNested = (source: any, path: string): unknown => {
  if (!source) return undefined;
  const segments = path.split(".");
  let current: any = source;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
};

const INLINE_COMPETITOR_STAT_FIELDS: Array<{
  key: string;
  label: string;
  abbreviation?: string;
  paths: string[];
}> = [
  { key: "totalTime", label: "Total Time", abbreviation: "TIME", paths: ["totalTime", "time"] },
  { key: "behindTime", label: "Gap", abbreviation: "GAP", paths: ["behindTime", "timeBehind", "interval"] },
  { key: "gapToLeader", label: "Gap", abbreviation: "GAP", paths: ["gapToLeader"] },
  { key: "behindLaps", label: "Laps Down", abbreviation: "LD", paths: ["behindLaps", "lapsDown"] },
  { key: "lapsCompleted", label: "Laps", abbreviation: "LAPS", paths: ["lapsCompleted", "completedLaps"] },
  { key: "lapsLead", label: "Laps Led", abbreviation: "LED", paths: ["lapsLead", "lapsLed"] },
  { key: "pitsTaken", label: "Pit Stops", abbreviation: "PIT", paths: ["pitsTaken", "pitStops"] },
  { key: "lastPitLap", label: "Last Pit", abbreviation: "LAST PIT", paths: ["lastPitLap", "lastPit"] },
  { key: "fastestLap", label: "Fastest Lap", abbreviation: "FAST", paths: ["fastestLap", "bestLap"] },
  { key: "fastestLapNum", label: "Fast Lap #", abbreviation: "FAST#", paths: ["fastestLapNum", "fastestLapNumber"] },
  { key: "championshipPts", label: "Points", abbreviation: "PTS", paths: ["championshipPts"] },
  { key: "points", label: "Points", abbreviation: "PTS", paths: ["points"] },
  { key: "qual1TimeMS", label: "Q1", abbreviation: "Q1", paths: ["qual1TimeMS", "q1"] },
  { key: "qual2TimeMS", label: "Q2", abbreviation: "Q2", paths: ["qual2TimeMS", "q2"] },
  { key: "qual3TimeMS", label: "Q3", abbreviation: "Q3", paths: ["qual3TimeMS", "q3"] },
  { key: "bestLap", label: "Best Lap", abbreviation: "BEST", paths: ["bestLap"] },
];

const parseInlineCompetitorStats = (competitor: any): RacingStatValue[] => {
  const stats: RacingStatValue[] = [];
  INLINE_COMPETITOR_STAT_FIELDS.forEach((field) => {
    const value = field.paths
      .map((path) => readNested(competitor, path))
      .map((candidate) => safeStatValue(candidate))
      .find((candidate) => shouldShowStatValue(candidate));
    if (!value) return;
    stats.push({
      key: field.key,
      label: field.label,
      abbreviation: field.abbreviation,
      value,
    });
  });
  return stats;
};

const parseEntitySummary = (payload: any): EntitySummary => ({
  id: String(payload?.id || ""),
  name: String(payload?.displayName || payload?.name || "Unknown"),
  shortName: payload?.shortName ? String(payload.shortName) : payload?.shortDisplayName ? String(payload.shortDisplayName) : undefined,
  abbreviation: payload?.abbreviation ? String(payload.abbreviation) : undefined,
  logo: payload?.headshot?.href || payload?.logo || payload?.logos?.[0]?.href,
  flag: payload?.flag?.href,
  number: parseVehicleNumber(
    payload?.displayNumber,
    payload?.number,
    payload?.jersey,
    payload?.uniform?.number,
    payload?.athlete?.displayNumber,
    payload?.athlete?.number,
  ),
});

const getNumericStatFromEntry = (entry: RacingStandingsEntry, keys: string[]): number | null => {
  for (const key of keys) {
    const match = entry.stats.find((stat) => normalizeKey(stat.key) === normalizeKey(key));
    if (!match) continue;
    const parsed = extractNumber(match.value);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
    if (String(match.value || "").trim() === "0") return 0;
  }
  return null;
};

const upsertEntryStat = (
  entry: RacingStandingsEntry,
  stat: { key: string; label: string; abbreviation?: string; value: string },
): RacingStandingsEntry => {
  const normalizedKey = normalizeKey(stat.key);
  const nextStats = [...entry.stats];
  const index = nextStats.findIndex((item) => normalizeKey(item.key) === normalizedKey);
  if (index >= 0) {
    nextStats[index] = {
      ...nextStats[index],
      ...stat,
    };
  } else {
    nextStats.push(stat);
  }
  return { ...entry, stats: nextStats };
};

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
  return typeText.includes("qualifying") || typeText.includes("shootout") || typeText === "qual";
};

const isSprintCompetition = (sport: Sport, competition: any): boolean => {
  if (sport !== "F1") return false;
  const typeText = normalizeCompetitionType(competition);
  if (!typeText) return false;
  return typeText.includes("sprint") && !typeText.includes("shootout");
};

const inferSessionTypeFromName = (name: string): "race" | "qualifying" | "practice" | "other" => {
  const normalized = normalizeKey(name);
  if (!normalized) return "other";
  if (normalized.includes("race")) return "race";
  if (normalized.includes("qualifying") || normalized.includes("shootout")) return "qualifying";
  if (normalized.includes("practice") || normalized.startsWith("fp") || normalized.includes("warmup")) return "practice";
  return "other";
};

const getSessionTypeOrder = (name: string): number => {
  const type = inferSessionTypeFromName(name);
  if (type === "practice") return 0;
  if (type === "qualifying") return 1;
  if (type === "race") return 2;
  return 3;
};

const getSessionStatusOrder = (status: "scheduled" | "in_progress" | "finished"): number => {
  if (status === "in_progress") return 0;
  if (status === "scheduled") return 1;
  return 2;
};

const sortRacingSessionsForDisplay = <T extends { status: "scheduled" | "in_progress" | "finished"; date: string; name?: string }>(
  sessions: T[],
): T[] => {
  return [...sessions].sort((a, b) => {
    const statusDiff = getSessionStatusOrder(a.status) - getSessionStatusOrder(b.status);
    if (statusDiff !== 0) return statusDiff;

    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    const aHasTime = Number.isFinite(aTime);
    const bHasTime = Number.isFinite(bTime);

    if (a.status === "finished") {
      if (aHasTime && bHasTime && aTime !== bTime) return bTime - aTime;
    } else {
      if (aHasTime && bHasTime && aTime !== bTime) return aTime - bTime;
    }

    const typeDiff = getSessionTypeOrder(String(a.name || "")) - getSessionTypeOrder(String(b.name || ""));
    if (typeDiff !== 0) return typeDiff;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
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
    vehicleNumber: parseVehicleNumber(
      competitor?.vehicle?.number,
      competitor?.athlete?.displayNumber,
      competitor?.athlete?.jersey,
      competitor?.number,
      entity?.number,
    ),
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
    name: entity?.name || String(entry?.athlete?.displayName || entry?.manufacturer?.displayName || "Unknown"),
    shortName: entity?.shortName,
    abbreviation: entity?.abbreviation,
    logo: entity?.logo,
    flag: entity?.flag,
    vehicleNumber: parseVehicleNumber(
      entry?.athlete?.displayNumber,
      entry?.athlete?.jersey,
      entry?.number,
      entity?.number,
    ),
    teamName: safeStatValue(entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name) || undefined,
    manufacturer: safeStatValue(entry?.manufacturer?.displayName || entry?.manufacturer?.shortDisplayName || entry?.manufacturer?.name) || undefined,
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
  const nowMonth = new Date().getMonth(); // 0-indexed
  // Early in the year (Jan-Feb), the previous season might still be relevant.
  // Limit to 3 candidates to avoid excessive API calls.
  if (nowMonth <= 1) return [nowYear, nowYear - 1, nowYear + 1];
  return [nowYear, nowYear + 1, nowYear - 1];
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
  const nowMs = Date.now();
  const nowYear = new Date().getFullYear();

  // --- Try internal DB first (avoids hundreds of ESPN API calls) ---
  await ensureInternalSportLoaded(sport);
  const internalEventsMap = getInternalRacingEventsMap(sport);
  if (internalEventsMap && Object.keys(internalEventsMap).length > 0) {
    const internalCalendar = getInternalRacingCalendar(sport);
    const byYear = partitionInternalBundlesBySeason(internalEventsMap);
    const internalCandidates = resolveSeasonYearCandidates();
    for (const year of internalCandidates) {
      const yearBundles = byYear.get(year);
      if (!yearBundles || Object.keys(yearBundles).length === 0) continue;
      const cacheKey = `${sport}:${year}`;
      const cached = seasonDataCache.get(cacheKey);
      if (cached && (Date.now() - cached.fetchedAt) < SEASON_DATA_CACHE_TTL_MS) {
        return cached.data;
      }
      const snapshot = buildSeasonSnapshotFromInternalBundles(
        sport, yearBundles,
        year === internalCalendar?.seasonYear ? internalCalendar : null,
      );
      if (snapshot && snapshot.events.length > 0) {
        snapshot.seasonYear = year;
        seasonDataCache.set(cacheKey, { fetchedAt: Date.now(), data: snapshot });
        return snapshot;
      }
    }
  }

  // --- Fall through to ESPN Core API ---
  const candidates = resolveSeasonYearCandidates();
  const snapshots: SeasonDataSnapshot[] = [];

  const scoreSnapshot = (snapshot: SeasonDataSnapshot): number => {
    const raceStates = snapshot.events.map((event: any) => {
      const raceCompetition = extractRaceCompetition(event);
      const state = String(raceCompetition?.status?.type?.state || "").toLowerCase();
      const eventMs = new Date(String(event?.date || "")).getTime();
      const hasDate = Number.isFinite(eventMs);
      return { state, eventMs, hasDate };
    });

    const liveCount = raceStates.filter((row) => row.state === "in").length;
    const upcomingCount = raceStates.filter((row) => row.state !== "post" && (!row.hasDate || row.eventMs >= (nowMs - (6 * 60 * 60 * 1000)))).length;
    const completedCount = raceStates.filter((row) => row.state === "post").length;
    const nearWindowCount = raceStates.filter((row) => row.hasDate && row.eventMs >= (nowMs - (150 * 24 * 60 * 60 * 1000)) && row.eventMs <= (nowMs + (210 * 24 * 60 * 60 * 1000))).length;

    let score = 0;
    score += Math.min(snapshot.events.length, 48);
    score += nearWindowCount * 6;
    score += upcomingCount * 5;
    score += completedCount * 3;
    score += liveCount * 35;

    if (snapshot.seasonYear === nowYear) score += 24;
    else if (snapshot.seasonYear === nowYear - 1) score += 10;
    else if (snapshot.seasonYear === nowYear + 1) score += 6;
    else score -= Math.abs(snapshot.seasonYear - nowYear) * 4;

    if (nearWindowCount === 0 && upcomingCount === 0 && liveCount === 0) {
      score -= 24;
    }
    return score;
  };

  for (const seasonYear of candidates) {
    const cacheKey = `${sport}:${seasonYear}`;
    const cached = seasonDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < SEASON_DATA_CACHE_TTL_MS) {
      snapshots.push(cached.data);
      continue;
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
    snapshots.push(snapshot);
  }

  if (snapshots.length === 0) return null;
  snapshots.sort((a, b) => scoreSnapshot(b) - scoreSnapshot(a));
  return snapshots[0];
};

const fetchPreviousSeasonSnapshot = async (
  sport: Sport,
  currentSeasonYear: number,
): Promise<SeasonDataSnapshot | null> => {
  const prevYear = currentSeasonYear - 1;
  const cacheKey = `${sport}:${prevYear}`;
  const cached = seasonDataCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < SEASON_DATA_CACHE_TTL_MS) {
    return cached.data;
  }

  // --- Try internal DB for previous season ---
  await ensureInternalSportLoaded(sport);
  const internalEventsMap = getInternalRacingEventsMap(sport);
  if (internalEventsMap) {
    const byYear = partitionInternalBundlesBySeason(internalEventsMap);
    const prevBundles = byYear.get(prevYear);
    if (prevBundles && Object.keys(prevBundles).length > 0) {
      const snapshot = buildSeasonSnapshotFromInternalBundles(sport, prevBundles, null);
      if (snapshot && snapshot.events.length > 0) {
        snapshot.seasonYear = prevYear;
        seasonDataCache.set(cacheKey, { fetchedAt: Date.now(), data: snapshot });
        return snapshot;
      }
    }
  }

  // --- Fall through to ESPN Core API ---
  const refs = await fetchSeasonEventRefsForYear(sport, prevYear);
  if (refs.length === 0) return null;

  const events = await mapWithConcurrency(refs, 4, async (ref) => fetchCoreRef(ref));
  const validEvents = events.filter(Boolean);
  if (validEvents.length === 0) return null;

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

  const snapshot: SeasonDataSnapshot = { sport, seasonYear: prevYear, eventRefs: refs, events: validEvents };
  seasonDataCache.set(cacheKey, { fetchedAt: Date.now(), data: snapshot });
  return snapshot;
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

// ---------------------------------------------------------------------------
// Bridge: convert internal RacingEventBundle objects into ESPN-like events
// that buildSeasonDriverAggregate, buildDriverMetadataFromSnapshot,
// computeRacingChampionshipProbabilities, and countRemainingChampionshipSessions
// all expect.
// ---------------------------------------------------------------------------

const internalStatusToEspnState = (status: string): string => {
  if (status === "finished") return "post";
  if (status === "in_progress") return "in";
  return "pre";
};

const buildSyntheticCompetitor = (c: RacingCompetitorResult, sport: Sport): any => ({
  id: c.competitorId,
  athlete: {
    id: c.competitorId,
    $ref: `${CORE_BASE}/sports/racing/leagues/${getLeagueSlug(sport)}/athletes/${c.competitorId}?${CORE_QUERY}`,
    displayName: c.name,
    shortDisplayName: c.shortName || c.name,
    abbreviation: c.abbreviation,
    displayNumber: c.vehicleNumber || undefined,
    jersey: c.vehicleNumber || undefined,
  },
  vehicle: {
    number: c.vehicleNumber || undefined,
    team: c.teamName || undefined,
    manufacturer: c.manufacturer || undefined,
  },
  order: c.finishPosition || 0,
  startOrder: c.startPosition || 0,
  startPosition: c.startPosition || 0,
  winner: c.winner || false,
  status: { type: { description: c.statusText || "", shortDetail: c.statusText || "" } },
});

const buildSyntheticEvent = (bundle: RacingEventBundle, sport: Sport): any => ({
  id: bundle.eventId,
  name: bundle.name,
  shortName: bundle.shortName,
  date: bundle.date,
  endDate: bundle.endDate,
  competitions: (bundle.sessions || []).map((session: RacingSessionResult) => ({
    id: session.id,
    date: session.date || bundle.date,
    type: { text: session.name, abbreviation: session.shortName || session.name },
    status: { type: { state: internalStatusToEspnState(session.status) } },
    competitors: (session.competitors || []).map((c: RacingCompetitorResult) =>
      buildSyntheticCompetitor(c, sport),
    ),
  })),
});

const partitionInternalBundlesBySeason = (
  eventsById: Record<string, RacingEventBundle>,
): Map<number, Record<string, RacingEventBundle>> => {
  const byYear = new Map<number, Record<string, RacingEventBundle>>();
  Object.entries(eventsById).forEach(([id, bundle]) => {
    const year = new Date(bundle.date).getFullYear();
    if (!Number.isFinite(year) || year < 2000) return;
    if (!byYear.has(year)) byYear.set(year, {});
    byYear.get(year)![id] = bundle;
  });
  return byYear;
};

const buildSeasonSnapshotFromInternalBundles = (
  sport: Sport,
  eventsById: Record<string, RacingEventBundle>,
  calendar: RacingCalendarPayload | null,
): SeasonDataSnapshot | null => {
  const bundles = Object.values(eventsById);
  if (bundles.length === 0) return null;
  const syntheticEvents = bundles.map((b) => buildSyntheticEvent(b, sport));
  const seasonYear = calendar?.seasonYear
    || new Date(bundles[0].date).getFullYear()
    || new Date().getFullYear();
  return {
    sport,
    seasonYear,
    eventRefs: [],
    events: syntheticEvents,
  };
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

  const thirtyDaysAgoMs = Date.now() - (30 * 24 * 60 * 60 * 1000);

  sortedEvents.forEach((event) => {
    const eventDateMs = new Date(String(event?.date || "")).getTime();
    const isOldEvent = Number.isFinite(eventDateMs) && eventDateMs < thirtyDaysAgoMs;
    const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
    competitions.forEach((competition: any) => {
      const statusState = String(competition?.status?.type?.state || "").toLowerCase();
      // For old events where status $ref resolution may have failed,
      // infer completion from competitor data having valid finish order.
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      const hasCompetitorResults = isOldEvent && competitors.length > 2
        && competitors.some((c: any) => extractNumber(c?.order) > 0 && Boolean(c?.winner));
      if (statusState !== "post" && !hasCompetitorResults) return;

      const typeText = normalizeCompetitionType(competition);
      const useSprintPoints = isSprintCompetition(sport, competition);
      const includeInPoints = isRaceCompetition(competition) || useSprintPoints;
      const pointsTable = useSprintPoints
        ? (rule?.sprintPoints || [])
        : (rule?.racePoints || []);

      if (!includeInPoints) return;

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
          // Lap-led bonuses (+1 led any lap, +2 most laps led) are
          // awarded below in a second pass when lapsLead data is available.
          // The core API season snapshot does NOT include lapsLead on
          // competitors, so these bonuses only fire for full event bundles.
          const lapsLed = extractNumber(competitor?.lapsLead);
          if (lapsLed > 0) bonus += 1;
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

      // INDYCAR: +2 bonus for the driver who led the most laps in a race.
      if (sport === "INDYCAR" && isRaceCompetition(competition)) {
        let mostLapsLedId: string | null = null;
        let mostLapsLedCount = 0;
        competitors.forEach((competitor: any) => {
          const cId = getCompetitorId(competitor);
          if (!cId) return;
          const ll = extractNumber(competitor?.lapsLead);
          if (ll > mostLapsLedCount) {
            mostLapsLedCount = ll;
            mostLapsLedId = cId;
          }
        });
        if (mostLapsLedId && mostLapsLedCount > 0) {
          const row = aggregate.get(mostLapsLedId);
          if (row) row.points += 2;
        }
      }

      if (sport === "F1" && isSprintCompetition(sport, competition) && !typeText.includes("shootout")) {
        // Sprint sessions are already scored above.
      }
    });
  });

  return aggregate;
};

const buildCrossSeasonDriverAggregate = (
  currentAggregate: Map<string, DriverAggregateRow>,
  previousAggregate: Map<string, DriverAggregateRow> | null,
  completedStoreFinishes: Map<string, number[]>,
): Map<string, DriverAggregateRow> => {
  const merged = new Map<string, DriverAggregateRow>();

  currentAggregate.forEach((row, id) => merged.set(id, { ...row, recentFinishes: [...row.recentFinishes] }));

  const BACKFILL_TARGET = 4;

  merged.forEach((row, id) => {
    if (row.recentFinishes.length >= BACKFILL_TARGET) return;

    const needed = BACKFILL_TARGET - row.recentFinishes.length;
    const backfill: number[] = [];

    if (previousAggregate) {
      const prev = previousAggregate.get(id);
      if (prev && prev.recentFinishes.length > 0) {
        const prevSlice = prev.recentFinishes.slice(-needed);
        backfill.push(...prevSlice);
      }
    }

    if (backfill.length < needed) {
      const storeFinishes = completedStoreFinishes.get(id);
      if (storeFinishes && storeFinishes.length > 0) {
        const still = needed - backfill.length;
        const storeSlice = storeFinishes.slice(-still);
        storeSlice.forEach((f) => {
          if (!backfill.includes(f) || backfill.length < still) backfill.push(f);
        });
      }
    }

    if (backfill.length > 0) {
      row.recentFinishes = [...backfill.slice(0, needed), ...row.recentFinishes];
    }
  });

  if (previousAggregate) {
    previousAggregate.forEach((prevRow, id) => {
      if (merged.has(id)) return;
      merged.set(id, {
        competitorId: prevRow.competitorId,
        ref: prevRow.ref,
        starts: 0,
        wins: 0,
        podiums: 0,
        top5: 0,
        top10: 0,
        finishSum: 0,
        points: 0,
        recentFinishes: prevRow.recentFinishes.slice(-BACKFILL_TARGET),
        lastFinish: undefined,
      });
    });
  }

  return merged;
};

// ---------------------------------------------------------------------------
// Pre-season detection & testing adjustment
// ---------------------------------------------------------------------------

/**
 * Returns true when the current season snapshot exists but no session
 * (including FP1) has completed with competitor data yet.  Once any
 * session finishes (even free practice), this flips to false and the
 * model falls back to 2025-backfill mode automatically.
 */
const isRacingPreSeason = (
  snapshot: SeasonDataSnapshot | null,
  currentAggregate: Map<string, DriverAggregateRow>,
): boolean => {
  if (!snapshot || snapshot.events.length === 0) return false;

  for (const row of currentAggregate.values()) {
    if (row.starts > 0) return false;
  }

  for (const event of snapshot.events) {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
    for (const comp of competitions) {
      const state = String(comp?.status?.type?.state || "").toLowerCase();
      if (state === "post" || state === "in") {
        const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
        if (competitors.length > 2) return false;
      }
    }
  }

  return true;
};

/**
 * Adjusts a driver's expected finish position using pre-season testing
 * data.  When the driver has 2025 backfill finishes the adjustment
 * blends 75 % historical + 25 % testing.  When no historical data
 * exists the testing rank becomes the primary signal.
 */
const applyPreSeasonTestingAdjustment = (
  preSeasonData: RacingPreSeasonData,
  driverId: string,
  baseExpectedFinish: number,
  baseFinishStdDev: number,
  hasFinishData: boolean,
  starterCount: number,
): { expectedFinish: number; finishStdDev: number } => {
  const entry = preSeasonData.entries.find((e) => e.competitorId === driverId);
  if (!entry) return { expectedFinish: baseExpectedFinish, finishStdDev: baseFinishStdDev };

  // Testing rank → expected finish: rank 1 → ~P2.0, rank 11 → ~P10.4
  const testExpectedFinish = 1.0 + (entry.testingRank / starterCount) * (starterCount * 0.85);

  if (!hasFinishData) {
    // No historical backfill — testing rank is the primary signal.
    return { expectedFinish: testExpectedFinish, finishStdDev: starterCount * 0.20 };
  }

  // Blend 75 % historical + 25 % testing.
  const TESTING_BLEND_WEIGHT = 0.25;
  return {
    expectedFinish: (1 - TESTING_BLEND_WEIGHT) * baseExpectedFinish + TESTING_BLEND_WEIGHT * testExpectedFinish,
    finishStdDev: baseFinishStdDev,
  };
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
        vehicleNumber: entity?.number,
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

    const venueMeta = buildRacingVenueAndLocation(event, raceCompetition);

    return {
      eventId: String(event?.id || ""),
      name: String(event?.name || "Race Event"),
      shortName: String(event?.shortName || event?.name || "Race Event"),
      date: String(event?.date || ""),
      endDate: event?.endDate ? String(event.endDate) : undefined,
      venue: venueMeta.venueName,
      location: venueMeta.location,
      status: raceStatus.state,
      statusText: raceStatus.text,
      seasonYear: Number(event?.season?.year) || snapshot.seasonYear,
      seasonType: Number(event?.season?.type?.type ?? event?.season?.type?.id) || undefined,
      topFinishers,
      sessions: sortRacingSessionsForDisplay(sessions),
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
      const refStats = statsByCompetitorKey.get(statsKey) || [];
      const inlineStats = parseInlineCompetitorStats(competitor);
      const stats = dedupeStats([...refStats, ...inlineStats]);
      const statusText = String(competitor?.status?.type?.description || "").trim();

      return {
        competitorId,
        name: entity?.name || String(competitor?.athlete?.displayName || "Unknown"),
        shortName: entity?.shortName,
        abbreviation: entity?.abbreviation,
        logo: entity?.logo,
        flag: entity?.flag,
        vehicleNumber: parseVehicleNumber(
          competitor?.vehicle?.number,
          competitor?.athlete?.displayNumber,
          competitor?.athlete?.jersey,
          competitor?.number,
          entity?.number,
        ),
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
  if (raceSession.status === "finished") return undefined;
  const raceTimeMs = new Date(raceSession.date).getTime();
  if (
    raceSession.status === "scheduled" &&
    Number.isFinite(raceTimeMs) &&
    raceTimeMs < (Date.now() - (4 * 60 * 60 * 1000))
  ) {
    return undefined;
  }

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
  const isLiveRace = raceSession.status === "in_progress";

  // Build map of current running positions during a live race.
  const livePositionByDriver = new Map<string, number>();
  if (isLiveRace) {
    participants.forEach((p) => {
      if (p.finishPosition && p.finishPosition > 0) {
        livePositionByDriver.set(p.competitorId, p.finishPosition);
      }
    });
  }
  const hasLivePositions = livePositionByDriver.size > 0;

  // Build secondary aggregate lookup by athlete ref ID for robust matching.
  const aggregateByRefId = new Map<string, DriverAggregateRow>();
  aggregate.forEach((row) => {
    const refMatch = row.ref.match(/athletes\/(\d+)/);
    if (refMatch) aggregateByRefId.set(refMatch[1], row);
  });
  const lookupAggregate = (id: string): DriverAggregateRow | undefined =>
    aggregate.get(id) || aggregateByRefId.get(id);

  // --- Bayesian finish-distribution model for each driver ---
  // Base pace comes from actual race finishes (cross-season aggregate).
  // Qualifying, practice, and live running order adjust the estimate.
  const PRIOR_STRENGTH = 1.5;
  const priorMean = starterCount * 0.5;
  const priorStdDev = starterCount * 0.28;
  const MIN_EMPIRICAL_STD_DEV = 1.5;

  const featureRows = participants.map((participant) => {
    const aggregateRow = lookupAggregate(participant.competitorId);
    const finishes = aggregateRow?.recentFinishes || [];
    const starts = aggregateRow?.starts || 0;
    const qualifyingRank = qualifyingRankByDriver.get(participant.competitorId);
    const practiceRank = practiceRankByDriver.get(participant.competitorId);
    const startPosition = participant.startPosition;
    const seasonRank = seasonRankByDriver.get(participant.competitorId) || starterCount;
    const seasonPoints = pointsByDriver.get(participant.competitorId) || aggregateRow?.points || 0;
    const livePosition = livePositionByDriver.get(participant.competitorId);

    // Estimate expected finish from historical race results.
    let basePace: number;
    let baseStdDev: number;

    if (finishes.length > 0) {
      const weights = finishes.map((_, i) => 0.5 + 0.5 * ((i + 1) / finishes.length));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      const empiricalMean = finishes.reduce((s, f, i) => s + f * weights[i], 0) / totalWeight;

      basePace = (PRIOR_STRENGTH * priorMean + totalWeight * empiricalMean) / (PRIOR_STRENGTH + totalWeight);

      const empiricalVar = finishes.reduce((s, f, i) => s + weights[i] * (f - empiricalMean) ** 2, 0) / totalWeight;
      const empiricalStdDev = Math.sqrt(Math.max(empiricalVar, 0));

      const shrinkage = PRIOR_STRENGTH / (PRIOR_STRENGTH + totalWeight);
      baseStdDev = shrinkage * priorStdDev + (1 - shrinkage) * Math.max(empiricalStdDev, MIN_EMPIRICAL_STD_DEV);
    } else {
      // No historical finish data: use back-of-field prior.
      // Drivers with no race history should not be mid-field by default.
      basePace = starterCount * 0.75;
      baseStdDev = starterCount * 0.22;
    }

    // Blend in this-weekend session data when available.
    // Qualifying is the strongest pre-race signal; practice is weaker.
    // During a live race, current running order is the dominant signal.
    const hasQualifying = qualifyingRank !== undefined;
    const hasPractice = practiceRank !== undefined;
    const hasLivePos = livePosition !== undefined && livePosition > 0;

    let expectedFinish = basePace;
    if (hasLivePos) {
      // Live race: current running order is the strongest signal.
      // Blend: 50% live position, 20% qualifying, 30% historical pace
      if (hasQualifying) {
        expectedFinish = livePosition! * 0.50 + qualifyingRank! * 0.20 + basePace * 0.30;
      } else {
        expectedFinish = livePosition! * 0.55 + basePace * 0.45;
      }
    } else if (hasQualifying && hasPractice) {
      // Qualifying (30%) + practice (10%) + historical pace (60%)
      expectedFinish = basePace * 0.60 + qualifyingRank! * 0.30 + practiceRank! * 0.10;
    } else if (hasQualifying) {
      // Qualifying (35%) + historical pace (65%)
      expectedFinish = basePace * 0.65 + qualifyingRank! * 0.35;
    } else if (hasPractice) {
      // Practice (15%) + historical pace (85%)
      expectedFinish = basePace * 0.85 + practiceRank! * 0.15;
    } else if (startPosition && startPosition > 0) {
      // Grid position as weak fallback (20%)
      expectedFinish = basePace * 0.80 + startPosition * 0.20;
    }

    // Reduce variance when we have this-race data (qualifying/practice
    // tell us how competitive the driver is THIS weekend).
    // Live race data reduces variance the most — positions are partially settled.
    let finishStdDev = baseStdDev;
    if (hasLivePos) finishStdDev *= 0.60;
    else if (hasQualifying) finishStdDev *= 0.85;
    if (hasPractice) finishStdDev *= 0.92;

    const recentAvgFinish = finishes.length > 0
      ? finishes.slice(-5).reduce((s, f) => s + f, 0) / Math.min(5, finishes.length)
      : basePace;

    return {
      participant,
      expectedFinish,
      finishStdDev,
      seasonRank,
      seasonPoints,
      starts,
      recentAvgFinish,
      qualifyingRank,
      practiceRank,
      startPosition,
      livePosition,
    };
  });

  const simulations = 10000;
  const seed = featureRows
    .map((row) => `${row.participant.competitorId}:${row.expectedFinish.toFixed(4)}:${row.finishStdDev.toFixed(4)}`)
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
    const sampled = featureRows
      .map((row) => ({
        id: row.participant.competitorId,
        value: sampleNormal(row.expectedFinish, row.finishStdDev),
      }))
      .sort((a, b) => a.value - b.value);

    sampled.forEach((row, index) => {
      const position = index + 1;
      if (position === 1) winCounts.set(row.id, (winCounts.get(row.id) || 0) + 1);
      if (position <= 3) podiumCounts.set(row.id, (podiumCounts.get(row.id) || 0) + 1);
      if (position <= 5) top5Counts.set(row.id, (top5Counts.get(row.id) || 0) + 1);
    });
  }

  const predictionEntries: RacingEventPredictionEntry[] = featureRows
    .map((row) => {
      const wins = winCounts.get(row.participant.competitorId) || 0;
      const podiums = podiumCounts.get(row.participant.competitorId) || 0;
      const top5 = top5Counts.get(row.participant.competitorId) || 0;

      const bullets: string[] = [];
      if (row.livePosition && row.livePosition > 0) bullets.push(`running P${row.livePosition}`);
      if (row.qualifyingRank) bullets.push(`qualified P${row.qualifyingRank}`);
      if (row.practiceRank && row.practiceRank <= 10) bullets.push(`practice avg P${row.practiceRank.toFixed(1)}`);
      if (row.seasonRank && row.seasonRank <= 5) bullets.push(`season rank #${row.seasonRank}`);
      if (row.recentAvgFinish && row.recentAvgFinish <= 7) bullets.push(`recent avg finish ${row.recentAvgFinish.toFixed(1)}`);
      if (!row.livePosition && row.startPosition && row.startPosition <= 10) bullets.push(`starting P${row.startPosition}`);
      const aggRow = lookupAggregate(row.participant.competitorId);
      if (aggRow && aggRow.recentFinishes.length > aggRow.starts) bullets.push("prior season form factored in");

      const explanation = bullets.length > 0
        ? `${bullets.slice(0, 4).join(", ")} drive this projection.`
        : "Projection is driven mostly by season form and current-session data.";

      return {
        rank: 0,
        competitorId: row.participant.competitorId,
        name: row.participant.name,
        shortName: row.participant.shortName,
        abbreviation: row.participant.abbreviation,
        logo: row.participant.logo,
        vehicleNumber: row.participant.vehicleNumber,
        teamName: row.participant.teamName,
        manufacturer: row.participant.manufacturer,
        startingPosition: row.startPosition,
        qualifyingRank: row.qualifyingRank,
        practiceRank: row.practiceRank,
        seasonRank: row.seasonRank,
        winProbability: (wins / simulations) * 100,
        podiumProbability: (podiums / simulations) * 100,
        top5Probability: (top5 / simulations) * 100,
        compositeRating: row.expectedFinish,
        explanation,
      };
    })
    .sort((a, b) => b.winProbability - a.winProbability)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const topWin = predictionEntries[0]?.winProbability || 0;
  const secondWin = predictionEntries[1]?.winProbability || 0;
  const separation = Math.max(0, topWin - secondWin);
  const hasQualifying = qualifyingSession !== undefined;
  const hasPractice = practiceSessions.length > 0;
  const totalFinishes = featureRows.reduce((sum, row) => sum + (lookupAggregate(row.participant.competitorId)?.recentFinishes.length || 0), 0);
  const avgFinishesPerDriver = totalFinishes / Math.max(1, featureRows.length);
  const sampleCoverage = Math.min(1, (
    (hasLivePositions ? 0.40 : 0) +
    (hasQualifying ? 0.28 : 0) +
    (hasPractice ? 0.12 : 0) +
    (Math.min(1, avgFinishesPerDriver / 8) * 0.20)
  ));
  const confidence = Math.max(0.2, Math.min(0.97, (sampleCoverage * 0.65) + (Math.min(1, separation / 12) * 0.35)));

  return {
    sport,
    eventId,
    simulations,
    confidence,
    updatedAt: new Date().toISOString(),
    model: "Racing Pace Blend v4 (finish-distribution + live-position + qualifying + practice)",
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
  let latestVehicleNumber: string | undefined;

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
      latestVehicleNumber = latestVehicleNumber || parseVehicleNumber(
        competitor?.vehicle?.number,
        competitor?.athlete?.displayNumber,
        competitor?.athlete?.jersey,
        competitor?.number,
      );

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
    vehicleNumber: parseVehicleNumber(entity?.number, latestVehicleNumber),
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

interface RacingChampionshipProbabilityModel {
  driverProbabilities: Map<string, number>;
  teamProbabilitiesById: Map<string, number>;
  teamProbabilitiesByName: Map<string, number>;
  driverNumbers: Map<string, string>;
  driverTeamKeys: Map<string, string>;
  simulations: number;
  remainingRaces: number;
  remainingSprints: number;
}

const choosePrimaryTable = (
  tables: RacingStandingsTable[],
  categories: RacingStandingsTable["category"][],
): RacingStandingsTable | null => {
  const candidates = tables.filter((table) => categories.includes(table.category) && table.entries.length > 0);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aPointsCoverage = a.entries.filter((entry) => getNumericStatFromEntry(entry, ["points", "championshipPts", "pts"]) !== null).length;
    const bPointsCoverage = b.entries.filter((entry) => getNumericStatFromEntry(entry, ["points", "championshipPts", "pts"]) !== null).length;
    const aModelPenalty = a.id === "model-series-points" ? 1 : 0;
    const bModelPenalty = b.id === "model-series-points" ? 1 : 0;
    if (aModelPenalty !== bModelPenalty) return aModelPenalty - bModelPenalty;
    if (aPointsCoverage !== bPointsCoverage) return bPointsCoverage - aPointsCoverage;
    return b.entries.length - a.entries.length;
  })[0];
};

const buildDriverMetadataFromSnapshot = (
  snapshot: SeasonDataSnapshot,
): { teamKeyByDriverId: Map<string, string>; numberByDriverId: Map<string, string> } => {
  const sortedEvents = snapshot.events
    .slice()
    .sort((a, b) => new Date(String(a?.date || "")).getTime() - new Date(String(b?.date || "")).getTime());

  const teamKeyByDriverId = new Map<string, string>();
  const numberByDriverId = new Map<string, string>();
  sortedEvents.forEach((event: any) => {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
    competitions.forEach((competition: any) => {
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      competitors.forEach((competitor: any) => {
        const driverId = getCompetitorId(competitor);
        if (!driverId) return;
        const teamName = safeStatValue(competitor?.vehicle?.team || competitor?.vehicle?.manufacturer);
        if (teamName) {
          teamKeyByDriverId.set(driverId, normalizeNameKey(teamName));
        }
        const number = parseVehicleNumber(
          competitor?.vehicle?.number,
          competitor?.athlete?.displayNumber,
          competitor?.athlete?.jersey,
          competitor?.number,
        );
        if (number) numberByDriverId.set(driverId, number);
      });
    });
  });
  return { teamKeyByDriverId, numberByDriverId };
};

const countRemainingChampionshipSessions = (
  sport: Sport,
  snapshot: SeasonDataSnapshot,
): { remainingRaces: number; remainingSprints: number } => {
  const nowMs = Date.now();
  let remainingRaces = 0;
  let remainingSprints = 0;

  snapshot.events.forEach((event: any) => {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : [];
    competitions.forEach((competition: any) => {
      const isRace = isRaceCompetition(competition);
      const isSprint = isSprintCompetition(sport, competition);
      if (!isRace && !isSprint) return;

      const state = String(competition?.status?.type?.state || "").toLowerCase();
      if (state === "post") return;
      const competitionTimeMs = new Date(String(competition?.date || event?.date || "")).getTime();
      if (Number.isFinite(competitionTimeMs) && state !== "in" && competitionTimeMs < (nowMs - (36 * 60 * 60 * 1000))) return;

      if (isSprint) remainingSprints += 1;
      else remainingRaces += 1;
    });
  });

  return { remainingRaces, remainingSprints };
};

const computeRacingChampionshipProbabilities = (
  sport: Sport,
  snapshot: SeasonDataSnapshot,
  prevSnapshot: SeasonDataSnapshot | null,
  aggregate: Map<string, DriverAggregateRow>,
  tables: RacingStandingsTable[],
  preSeasonData: RacingPreSeasonData | null = null,
): RacingChampionshipProbabilityModel | null => {
  const scoring = SERIES_SCORING_RULES[sport];
  if (!scoring) return null;

  const primaryDriverTable = choosePrimaryTable(tables, ["driver"]);
  if (!primaryDriverTable || primaryDriverTable.entries.length < 2) return null;

  // Build driver metadata (team key, vehicle number) from snapshot events.
  // If current season has no competitor data (pre-season), also check prev.
  const { teamKeyByDriverId, numberByDriverId } = buildDriverMetadataFromSnapshot(snapshot);
  if (prevSnapshot) {
    const prevMeta = buildDriverMetadataFromSnapshot(prevSnapshot);
    prevMeta.teamKeyByDriverId.forEach((value, key) => {
      if (!teamKeyByDriverId.has(key)) teamKeyByDriverId.set(key, value);
    });
    prevMeta.numberByDriverId.forEach((value, key) => {
      if (!numberByDriverId.has(key)) numberByDriverId.set(key, value);
    });
  }

  // Pre-season testing data provides the definitive 2026 team/number
  // mapping, overriding any stale 2025 associations.
  if (preSeasonData) {
    preSeasonData.entries.forEach((e) => {
      if (e.competitorId && e.teamName) {
        teamKeyByDriverId.set(e.competitorId, normalizeNameKey(e.teamName));
      }
      if (e.competitorId && e.vehicleNumber) {
        numberByDriverId.set(e.competitorId, e.vehicleNumber);
      }
    });
  }

  const starterCount = Math.max(2, primaryDriverTable.entries.length);

  // --- Bayesian finish-position model ---
  // Each driver's future race performance is estimated from their actual
  // finish positions (current season + previous season backfill).
  // PRIOR_STRENGTH is kept low (1.5) so that empirical data dominates quickly.
  // For drivers with NO finish data (new to the series), we use a pessimistic
  // back-of-field prior instead of mid-field to avoid over-rating unknowns.
  const PRIOR_STRENGTH = 1.5;
  const priorMean = starterCount * 0.5;
  const priorStdDev = starterCount * 0.28;
  const MIN_EMPIRICAL_STD_DEV = 1.5;

  // Build a secondary aggregate lookup by the athlete ID extracted from
  // the ref URL. The aggregate is keyed by getCompetitorId() which may
  // use competitor.id, while standings entries use the resolved entity.id
  // (athlete ID). These CAN be different ID spaces, so we index both ways.
  const aggregateByRefId = new Map<string, DriverAggregateRow>();
  aggregate.forEach((row) => {
    const refMatch = row.ref.match(/athletes\/(\d+)/);
    if (refMatch) aggregateByRefId.set(refMatch[1], row);
  });

  const lookupAggregate = (competitorId: string): DriverAggregateRow | undefined => {
    return aggregate.get(competitorId) || aggregateByRefId.get(competitorId);
  };

  const driverProfiles = primaryDriverTable.entries.map((entry) => {
    const aggRow = lookupAggregate(String(entry.competitorId));
    const finishes = aggRow?.recentFinishes || [];
    const currentPoints = Math.max(
      0,
      getNumericStatFromEntry(entry, ["points", "championshipPts", "pts"]) ?? aggRow?.points ?? 0,
    );
    const currentWins = Math.max(
      0,
      getNumericStatFromEntry(entry, ["wins", "win"]) ?? aggRow?.wins ?? 0,
    );
    const teamKey = normalizeNameKey(entry.teamName || entry.manufacturer || "") || teamKeyByDriverId.get(String(entry.competitorId)) || "";

    let expectedFinish: number;
    let finishStdDev: number;

    if (finishes.length > 0) {
      // Recency-weighted: later entries in the array are more recent and
      // get higher weight (linear ramp from 0.5 to 1.0).
      const weights = finishes.map((_, i) => 0.5 + 0.5 * ((i + 1) / finishes.length));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      const empiricalMean = finishes.reduce((s, f, i) => s + f * weights[i], 0) / totalWeight;

      // Bayesian shrinkage: blend empirical mean toward the prior.
      // With PRIOR_STRENGTH=1.5 and 4 finishes (totalWeight~3.25),
      // empirical data has ~68% weight, keeping top drivers near their pace.
      expectedFinish = (PRIOR_STRENGTH * priorMean + totalWeight * empiricalMean) / (PRIOR_STRENGTH + totalWeight);

      // Individual consistency from weighted variance of actual finishes.
      const empiricalVar = finishes.reduce((s, f, i) => s + weights[i] * (f - empiricalMean) ** 2, 0) / totalWeight;
      const empiricalStdDev = Math.sqrt(Math.max(empiricalVar, 0));

      // Blend variance with prior: more data -> trust empirical more.
      const shrinkage = PRIOR_STRENGTH / (PRIOR_STRENGTH + totalWeight);
      finishStdDev = shrinkage * priorStdDev + (1 - shrinkage) * Math.max(empiricalStdDev, MIN_EMPIRICAL_STD_DEV);
    } else {
      // No finish data: use standings rank as a signal when available.
      // The pre-season standings rank reflects at least some ordering
      // (e.g., 2025 final championship positions for returning drivers).
      // For completely unknown drivers (new to series), expect near back.
      const rankInStandings = entry.rank > 0 && entry.rank <= starterCount ? entry.rank : 0;

      if (rankInStandings > 0) {
        // Scale rank → expected finish: rank 1 → ~P3, rank 10 → ~P12, rank 20 → ~P18
        // This provides a mild differentiation based on their standing.
        expectedFinish = 1.5 + (rankInStandings / starterCount) * (starterCount * 0.85);
      } else {
        // Completely unknown: back-of-field prior.
        expectedFinish = starterCount * 0.80;
      }
      // Wide variance for no-data drivers, but capped lower than before
      // so unknowns can't randomly dominate the simulations.
      finishStdDev = starterCount * 0.22;
    }

    // Pre-season testing adjustment: blend testing pace ranking into
    // the expected finish estimate when pre-season data is available.
    if (preSeasonData) {
      const adj = applyPreSeasonTestingAdjustment(
        preSeasonData, String(entry.competitorId),
        expectedFinish, finishStdDev, finishes.length > 0, starterCount,
      );
      expectedFinish = adj.expectedFinish;
      finishStdDev = adj.finishStdDev;
    }

    return {
      id: String(entry.competitorId),
      currentPoints,
      currentWins,
      expectedFinish,
      finishStdDev,
      teamKey,
      number: entry.vehicleNumber || numberByDriverId.get(String(entry.competitorId)) || "",
    };
  });

  const racePointTable = scoring.racePoints || [];
  const sprintPointTable = scoring.sprintPoints || [];
  const { remainingRaces, remainingSprints } = countRemainingChampionshipSessions(sport, snapshot);
  const totalRemainingSessions = remainingRaces + remainingSprints;

  // --- Team setup (F1 constructors) ---
  let teamProfiles: Array<{ id: string; nameKey: string; currentPoints: number }> = [];
  let teamIndexByNameKey = new Map<string, number>();
  if (sport === "F1") {
    const primaryTeamTable = choosePrimaryTable(tables, ["constructor", "team"]);
    if (primaryTeamTable) {
      teamProfiles = primaryTeamTable.entries.map((entry, idx) => {
        const nameKey = normalizeNameKey(entry.name || entry.shortName || `${entry.competitorId}-${idx}`);
        return {
          id: String(entry.competitorId || `${nameKey}-${idx}`),
          nameKey,
          currentPoints: Math.max(0, getNumericStatFromEntry(entry, ["points", "championshipPts", "pts"]) ?? 0),
        };
      });
      teamProfiles.forEach((team, index) => {
        if (team.nameKey) teamIndexByNameKey.set(team.nameKey, index);
      });
    }
  }

  const driverTeamIndices = driverProfiles.map((driver) => {
    if (!driver.teamKey) return -1;
    return teamIndexByNameKey.has(driver.teamKey) ? (teamIndexByNameKey.get(driver.teamKey) as number) : -1;
  });

  // --- Monte Carlo simulation ---
  const remainingForSimulation = Math.max(0, totalRemainingSessions);
  const simulations = remainingForSimulation <= 4
    ? 10000
    : remainingForSimulation <= 12
      ? 7000
      : 5000;

  // Deterministic seeded PRNG for reproducible results.
  const seedBasis = [
    sport,
    snapshot.seasonYear,
    remainingRaces,
    remainingSprints,
    ...driverProfiles.map((d) => `${d.id}:${d.currentPoints}:${d.currentWins}:${d.expectedFinish.toFixed(4)}:${d.finishStdDev.toFixed(4)}:${d.number}`),
    ...teamProfiles.map((t) => `${t.id}:${t.currentPoints}`),
  ].join("|");
  let randomSeed = seedBasis
    .split("")
    .reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 2166136261);

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

  // F1 fastest-lap bonus: weighted pick from top-10 finishers.
  // Better-paced drivers (lower expectedFinish) are more likely.
  const weightedPick = (indices: number[]): number => {
    if (indices.length === 0) return -1;
    const weights = indices.map((idx) => {
      const ef = driverProfiles[idx]?.expectedFinish ?? starterCount / 2;
      return Math.max(0.1, (starterCount + 1 - ef) / starterCount);
    });
    const total = weights.reduce((s, w) => s + w, 0);
    if (!Number.isFinite(total) || total <= 0) return indices[0];
    let marker = random() * total;
    for (let i = 0; i < indices.length; i += 1) {
      marker -= weights[i];
      if (marker <= 0) return indices[i];
    }
    return indices[indices.length - 1];
  };

  const driverChampionCounts = new Array(driverProfiles.length).fill(0);
  const teamChampionCounts = new Array(teamProfiles.length).fill(0);

  for (let sim = 0; sim < simulations; sim += 1) {
    // Start each simulation from actual current points & wins.
    const points = driverProfiles.map((d) => d.currentPoints);
    const wins = driverProfiles.map((d) => d.currentWins);
    const teamPoints = teamProfiles.map((t) => t.currentPoints);
    const teamWins = new Array(teamProfiles.length).fill(0);

    const runSession = (pointsTable: number[], includeFastestLapBonus: boolean): void => {
      // Fisher-Yates shuffle of indices to eliminate PRNG positional bias.
      // Without this, drivers at fixed array positions get correlated random
      // sequences, producing skewed results when distributions are similar.
      const shuffledIndices = driverProfiles.map((_, i) => i);
      for (let i = shuffledIndices.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        const tmp = shuffledIndices[i];
        shuffledIndices[i] = shuffledIndices[j];
        shuffledIndices[j] = tmp;
      }

      // Sample each driver's finish from their individual distribution,
      // then rank the samples to determine finishing order.
      const sampledOrder = shuffledIndices
        .map((driverIndex) => ({
          index: driverIndex,
          value: sampleNormal(driverProfiles[driverIndex].expectedFinish, driverProfiles[driverIndex].finishStdDev),
        }))
        .sort((a, b) => a.value - b.value)
        .map((row) => row.index);

      sampledOrder.forEach((driverIndex, finishingIndex) => {
        const finishPosition = finishingIndex + 1;
        const pointsAwarded = scoreFromTable(pointsTable, finishPosition);
        if (pointsAwarded > 0) {
          points[driverIndex] += pointsAwarded;
          const teamIndex = driverTeamIndices[driverIndex];
          if (teamIndex >= 0 && teamIndex < teamPoints.length) {
            teamPoints[teamIndex] += pointsAwarded;
          }
        }

        if (finishPosition === 1) {
          wins[driverIndex] += 1;
          const teamIndex = driverTeamIndices[driverIndex];
          if (teamIndex >= 0 && teamIndex < teamWins.length) {
            teamWins[teamIndex] += 1;
          }
        }
      });

      if (includeFastestLapBonus && sport === "F1") {
        const topTen = sampledOrder.slice(0, Math.min(10, sampledOrder.length));
        const fastestLapDriverIndex = weightedPick(topTen);
        if (fastestLapDriverIndex >= 0) {
          points[fastestLapDriverIndex] += 1;
          const teamIndex = driverTeamIndices[fastestLapDriverIndex];
          if (teamIndex >= 0 && teamIndex < teamPoints.length) {
            teamPoints[teamIndex] += 1;
          }
        }
      }
    };

    for (let raceIdx = 0; raceIdx < remainingRaces; raceIdx += 1) {
      runSession(racePointTable, true);
    }
    for (let sprintIdx = 0; sprintIdx < remainingSprints; sprintIdx += 1) {
      runSession(sprintPointTable, false);
    }

    // Driver champion: highest points, tiebreak by wins.
    const topDriverPoints = Math.max(...points);
    let driverLeaderIndices = points
      .map((value, index) => ({ value, index }))
      .filter((row) => Math.abs(row.value - topDriverPoints) < 1e-9)
      .map((row) => row.index);
    if (driverLeaderIndices.length > 1) {
      const maxWins = Math.max(...driverLeaderIndices.map((index) => wins[index] || 0));
      driverLeaderIndices = driverLeaderIndices.filter((index) => (wins[index] || 0) === maxWins);
    }
    const driverShare = 1 / Math.max(1, driverLeaderIndices.length);
    driverLeaderIndices.forEach((index) => {
      driverChampionCounts[index] += driverShare;
    });

    // Team champion (F1 constructors): highest points, tiebreak by wins.
    if (teamProfiles.length > 0) {
      const topTeamPoints = Math.max(...teamPoints);
      let teamLeaderIndices = teamPoints
        .map((value, index) => ({ value, index }))
        .filter((row) => Math.abs(row.value - topTeamPoints) < 1e-9)
        .map((row) => row.index);
      if (teamLeaderIndices.length > 1) {
        const maxTeamWins = Math.max(...teamLeaderIndices.map((index) => teamWins[index] || 0));
        teamLeaderIndices = teamLeaderIndices.filter((index) => (teamWins[index] || 0) === maxTeamWins);
      }
      const teamShare = 1 / Math.max(1, teamLeaderIndices.length);
      teamLeaderIndices.forEach((index) => {
        teamChampionCounts[index] += teamShare;
      });
    }
  }

  const driverProbabilities = new Map<string, number>();
  driverProfiles.forEach((driver, index) => {
    driverProbabilities.set(driver.id, (driverChampionCounts[index] || 0) / simulations);
  });

  const teamProbabilitiesById = new Map<string, number>();
  const teamProbabilitiesByName = new Map<string, number>();
  teamProfiles.forEach((team, index) => {
    const probability = (teamChampionCounts[index] || 0) / simulations;
    teamProbabilitiesById.set(team.id, probability);
    if (team.nameKey) teamProbabilitiesByName.set(team.nameKey, probability);
  });

  // Expose vehicle numbers and team keys for standings enrichment.
  const driverNumbersMap = new Map<string, string>();
  const driverTeamKeysMap = new Map<string, string>();
  driverProfiles.forEach((driver) => {
    if (driver.number) driverNumbersMap.set(driver.id, driver.number);
    if (driver.teamKey) driverTeamKeysMap.set(driver.id, driver.teamKey);
  });

  return {
    driverProbabilities,
    teamProbabilitiesById,
    teamProbabilitiesByName,
    driverNumbers: driverNumbersMap,
    driverTeamKeys: driverTeamKeysMap,
    simulations,
    remainingRaces,
    remainingSprints,
  };
};

const applyRacingChampionshipProbabilities = (
  sport: Sport,
  tables: RacingStandingsTable[],
  model: RacingChampionshipProbabilityModel,
): RacingStandingsTable[] => {
  return tables.map((table) => {
    if (table.category === "driver") {
      const entries = table.entries.map((entry) => {
        const cid = String(entry.competitorId);
        const probability = model.driverProbabilities.get(cid);

        // Inject missing vehicle number and team name from previous-season metadata.
        let patched = entry;
        const modelNumber = model.driverNumbers.get(cid);
        const modelTeam = model.driverTeamKeys.get(cid);
        if ((!patched.vehicleNumber || patched.vehicleNumber === "0") && modelNumber) {
          patched = { ...patched, vehicleNumber: modelNumber };
        }
        if (!patched.teamName && modelTeam) {
          patched = { ...patched, teamName: modelTeam };
        }

        if (probability === undefined) return patched;
        return upsertEntryStat(patched, {
          key: "championshipProbability",
          label: "Championship Probability",
          abbreviation: "TITLE %",
          value: parsePercentValue(probability * 100),
        });
      });
      return { ...table, entries };
    }

    if (sport === "F1" && (table.category === "constructor" || table.category === "team")) {
      const entries = table.entries.map((entry) => {
        const byId = model.teamProbabilitiesById.get(String(entry.competitorId));
        const byName = model.teamProbabilitiesByName.get(normalizeNameKey(entry.name || entry.shortName || ""));
        const probability = byId ?? byName;
        if (probability === undefined) return entry;
        return upsertEntryStat(entry, {
          key: "championshipProbability",
          label: "Championship Probability",
          abbreviation: "TITLE %",
          value: parsePercentValue(probability * 100),
        });
      });
      return { ...table, entries };
    }

    return table;
  });
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
  loadPersistedRacingPayloadCaches();

  const cacheKey = `${sport}:calendar`;
  const cached = calendarCache.get(cacheKey);
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs < CALENDAR_CACHE_TTL_MS) return cached.data;
    if (ageMs < PERSISTED_CALENDAR_MAX_AGE_MS) return cached.data;
  }

  await ensureInternalSportLoaded(sport);
  const internalCalendar = getInternalRacingCalendar(sport);
  if (internalCalendar && Array.isArray(internalCalendar.events) && internalCalendar.events.length > 0) {
    calendarCache.set(cacheKey, { fetchedAt: Date.now(), data: internalCalendar });
    schedulePersistRacingPayloadCaches();
    return internalCalendar;
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
    schedulePersistRacingPayloadCaches();
    return payload;
  }

  const payload = await buildCalendarPayloadFromSnapshot(snapshot);
  calendarCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  schedulePersistRacingPayloadCaches();
  return payload;
};

export const fetchRacingDriverSeasonResults = async (sport: Sport, driverId: string): Promise<RacingDriverSeasonResults | null> => {
  if (!isRacingSport(sport) || !driverId) return null;
  loadPersistedRacingPayloadCaches();

  const cacheKey = `${sport}:${driverId}`;
  const cached = driverSeasonCache.get(cacheKey);
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs < DRIVER_SEASON_CACHE_TTL_MS) return cached.data;
    if (ageMs < PERSISTED_DRIVER_MAX_AGE_MS) return cached.data;
  }

  await ensureInternalSportLoaded(sport);
  const internalSeason = getInternalRacingDriverSeason(sport, driverId);
  if (internalSeason) {
    driverSeasonCache.set(cacheKey, { fetchedAt: Date.now(), data: internalSeason });
    schedulePersistRacingPayloadCaches();
    return internalSeason;
  }

  const snapshot = await fetchSeasonDataSnapshot(sport);
  if (!snapshot) return null;

  const payload = await buildDriverSeasonResultsFromSnapshot(sport, snapshot, driverId);
  if (!payload) return null;

  driverSeasonCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  schedulePersistRacingPayloadCaches();
  return payload;
};

export const fetchRacingEventBundle = async (sport: Sport, eventId: string): Promise<RacingEventBundle | null> => {
  if (!isRacingSport(sport) || !eventId) return null;
  loadPersistedRacingPayloadCaches();
  const cacheKey = `${sport}:${eventId}`;
  const cached = eventCache.get(cacheKey);
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs < EVENT_CACHE_TTL_MS) return cached.data;
    const hasLiveSession = (cached.data.sessions || []).some((session) => session.status === "in_progress");
    if (!hasLiveSession && ageMs < PERSISTED_EVENT_MAX_AGE_MS) return cached.data;
  }

  await ensureInternalSportLoaded(sport);
  const internalBundle = getInternalRacingEventBundle(sport, eventId);
  if (internalBundle) {
    const hasLiveSession = (internalBundle.sessions || []).some((session) => session.status === "in_progress");
    if (!hasLiveSession) {
      // Compute predictions for upcoming events (race session still scheduled).
      const hasUpcomingRace = !internalBundle.prediction
        && internalBundle.sessions.some((s) =>
          s.status === "scheduled"
          && (normalizeKey(s.name).includes("race") || s.competitors.length === 0),
        );

      if (hasUpcomingRace) {
        const snapshot = await fetchSeasonDataSnapshot(sport);
        const currentAggregate = snapshot
          ? buildSeasonDriverAggregate(sport, snapshot.events)
          : new Map<string, DriverAggregateRow>();
        const prevSnapshot = snapshot
          ? await fetchPreviousSeasonSnapshot(sport, snapshot.seasonYear)
          : null;
        const prevAggregate = prevSnapshot
          ? buildSeasonDriverAggregate(sport, prevSnapshot.events)
          : null;
        const completedStoreFinishes = extractFinishDataFromCompletedStore(sport);
        const aggregate = buildCrossSeasonDriverAggregate(currentAggregate, prevAggregate, completedStoreFinishes);
        const standings = await fetchRacingStandingsPayload(sport);
        const prediction = buildEventPrediction(
          sport, String(internalBundle.eventId), internalBundle.sessions, aggregate, standings,
        );
        const enrichedBundle: RacingEventBundle = { ...internalBundle, prediction };
        eventCache.set(cacheKey, { fetchedAt: Date.now(), data: enrichedBundle });
        schedulePersistRacingPayloadCaches();
        return enrichedBundle;
      }

      eventCache.set(cacheKey, { fetchedAt: Date.now(), data: internalBundle });
      schedulePersistRacingPayloadCaches();
      return internalBundle;
    }
  }

  const storedCompleted = getStoredCompletedEvent(sport, eventId);

  const eventUrl = buildCoreLeagueUrl(sport, `events/${eventId}`);
  const event = await fetchJsonSafe(eventUrl);
  if (!event) {
    if (storedCompleted) {
      eventCache.set(cacheKey, { fetchedAt: Date.now(), data: storedCompleted });
      schedulePersistRacingPayloadCaches();
      return storedCompleted;
    }
    if (internalBundle) {
      eventCache.set(cacheKey, { fetchedAt: Date.now(), data: internalBundle });
      schedulePersistRacingPayloadCaches();
      return internalBundle;
    }
    return null;
  }

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

  const sessions: RacingSessionResult[] = competitions
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
    });
  const orderedSessions = sortRacingSessionsForDisplay(sessions);

  const raceCompetition = extractRaceCompetition(event);
  const venueMeta = buildRacingVenueAndLocation(event, raceCompetition);

  const snapshot = await fetchSeasonDataSnapshot(sport);
  const currentAggregate = snapshot ? buildSeasonDriverAggregate(sport, snapshot.events) : new Map<string, DriverAggregateRow>();
  const prevSnapshot = snapshot ? await fetchPreviousSeasonSnapshot(sport, snapshot.seasonYear) : null;
  const prevAggregate = prevSnapshot ? buildSeasonDriverAggregate(sport, prevSnapshot.events) : null;
  const completedStoreFinishes = extractFinishDataFromCompletedStore(sport);
  const aggregate = buildCrossSeasonDriverAggregate(currentAggregate, prevAggregate, completedStoreFinishes);
  const standings = await fetchRacingStandingsPayload(sport);
  const prediction = buildEventPrediction(sport, String(event?.id || eventId), orderedSessions, aggregate, standings);

  const result: RacingEventBundle = {
    sport,
    eventId: String(event?.id || eventId),
    name: String(event?.name || "Race Event"),
    shortName: String(event?.shortName || event?.name || "Race Event"),
    date: String(event?.date || ""),
    endDate: event?.endDate ? String(event.endDate) : undefined,
    venue: venueMeta.venueName,
    location: venueMeta.location,
    sessions: orderedSessions,
    prediction,
  };

  if (isCompletedRaceEvent(result)) {
    recordCompletedEventBundle(result);
  }
  eventCache.set(cacheKey, { fetchedAt: Date.now(), data: result });
  schedulePersistRacingPayloadCaches();
  return result;
};

export const fetchRacingStandingsPayload = async (sport: Sport): Promise<RacingStandingsPayload> => {
  if (!isRacingSport(sport)) {
    return { sport, updatedAt: new Date().toISOString(), tables: [] };
  }
  loadPersistedRacingPayloadCaches();

  const cacheKey = `${sport}:standings`;
  const cached = standingsCache.get(cacheKey);
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs < STANDINGS_CACHE_TTL_MS) return cached.data;
    if (ageMs < PERSISTED_STANDINGS_MAX_AGE_MS) return cached.data;
  }

  await ensureInternalSportLoaded(sport);
  const internalStandings = getInternalRacingStandings(sport);
  if (internalStandings && Array.isArray(internalStandings.tables) && internalStandings.tables.length > 0) {
    // Use internal standings as base but still run the championship probability model.
    const snapshot = await fetchSeasonDataSnapshot(sport);
    let mergedTables = [...internalStandings.tables];
    let championshipModel: RacingChampionshipProbabilityModel | null = null;
    let preSeasonData: RacingPreSeasonData | null = null;

    if (snapshot) {
      const currentAggregate = buildSeasonDriverAggregate(sport, snapshot.events);
      const prevSnapshot = await fetchPreviousSeasonSnapshot(sport, snapshot.seasonYear);
      const prevAggregate = prevSnapshot ? buildSeasonDriverAggregate(sport, prevSnapshot.events) : null;
      const completedStoreFinishes = extractFinishDataFromCompletedStore(sport);
      const crossSeasonAggregate = buildCrossSeasonDriverAggregate(currentAggregate, prevAggregate, completedStoreFinishes);

      // Detect pre-season: no completed sessions with competitors yet.
      const preSeasonActive = isRacingPreSeason(snapshot, currentAggregate);
      preSeasonData = preSeasonActive ? getInternalRacingPreSeason(sport) : null;

      if (typeof console !== "undefined") {
        console.warn(
          `[racing] ${sport} standings pipeline (internal DB): snapshot yr=${snapshot.seasonYear}, `
          + `prevSnapshot yr=${prevSnapshot?.seasonYear ?? "none"} events=${prevSnapshot?.events?.length ?? 0}, `
          + `currentAgg=${currentAggregate.size} prevAgg=${prevAggregate?.size ?? 0} crossAgg=${crossSeasonAggregate.size}`
          + (preSeasonData ? ` | PRE-SEASON mode (testing: ${preSeasonData.testLocation})` : ""),
        );
      }

      championshipModel = computeRacingChampionshipProbabilities(sport, snapshot, prevSnapshot, crossSeasonAggregate, mergedTables, preSeasonData);
      if (championshipModel) {
        mergedTables = applyRacingChampionshipProbabilities(sport, mergedTables, championshipModel);
      }
    }

    const preSeasonNoteStr = preSeasonData
      ? `Pre-season: ${preSeasonData.testLocation} testing (${preSeasonData.testDates}) blended with previous season. `
      : "";
    const titleModelNote = championshipModel
      ? `${preSeasonNoteStr}Title model: ${championshipModel.remainingRaces} races`
        + (championshipModel.remainingSprints > 0 ? ` + ${championshipModel.remainingSprints} sprints` : "")
        + ` remaining, ${championshipModel.simulations.toLocaleString()} Monte Carlo simulations.`
      : "";
    const enrichedPayload: RacingStandingsPayload = {
      sport,
      updatedAt: internalStandings.updatedAt || new Date().toISOString(),
      note: internalStandings.note
        ? `${internalStandings.note}${titleModelNote ? ` ${titleModelNote}` : ""}`
        : titleModelNote || undefined,
      tables: mergedTables,
    };
    standingsCache.set(cacheKey, { fetchedAt: Date.now(), data: enrichedPayload });
    schedulePersistRacingPayloadCaches();
    return enrichedPayload;
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
  const currentAggregate = snapshot ? buildSeasonDriverAggregate(sport, snapshot.events) : new Map<string, DriverAggregateRow>();
  const derivedTable = await buildDerivedStandingsTable(sport, currentAggregate);
  const includeDerivedTable = derivedTable.entries.length > 0;
  let mergedTables = includeDerivedTable ? [derivedTable, ...officialTables] : officialTables;
  let championshipModel: RacingChampionshipProbabilityModel | null = null;
  if (snapshot) {
    const prevSnapshot = await fetchPreviousSeasonSnapshot(sport, snapshot.seasonYear);
    const prevAggregate = prevSnapshot ? buildSeasonDriverAggregate(sport, prevSnapshot.events) : null;
    const completedStoreFinishes = extractFinishDataFromCompletedStore(sport);
    const crossSeasonAggregate = buildCrossSeasonDriverAggregate(currentAggregate, prevAggregate, completedStoreFinishes);

    const preSeasonActive2 = isRacingPreSeason(snapshot, currentAggregate);
    const preSeasonData2 = preSeasonActive2 ? getInternalRacingPreSeason(sport) : null;

    /* diagnostic: track cross-season data availability */
    if (typeof console !== "undefined") {
      const curSize = currentAggregate.size;
      const prevSize = prevAggregate?.size ?? 0;
      const crossSize = crossSeasonAggregate.size;
      const storeCount = completedStoreFinishes.size;
      const prevEvents = prevSnapshot?.events?.length ?? 0;
      console.warn(
        `[racing] ${sport} standings pipeline: snapshot yr=${snapshot.seasonYear}, `
        + `prevSnapshot yr=${prevSnapshot?.seasonYear ?? "none"} events=${prevEvents}, `
        + `currentAgg=${curSize} prevAgg=${prevSize} crossAgg=${crossSize} storeFinishes=${storeCount}`
        + (preSeasonData2 ? ` | PRE-SEASON mode` : ""),
      );
    }

    championshipModel = computeRacingChampionshipProbabilities(sport, snapshot, prevSnapshot, crossSeasonAggregate, mergedTables, preSeasonData2);
    if (championshipModel) {
      mergedTables = applyRacingChampionshipProbabilities(sport, mergedTables, championshipModel);
    }
  }

  let payload: RacingStandingsPayload;
  if (officialTables.length > 0) {
    const titleModelNote = championshipModel
      ? `Title model: ${championshipModel.remainingRaces} races`
        + (championshipModel.remainingSprints > 0 ? ` + ${championshipModel.remainingSprints} sprints` : "")
        + ` remaining, ${championshipModel.simulations.toLocaleString()} Monte Carlo simulations.`
      : "";
    payload = {
      sport,
      updatedAt: new Date().toISOString(),
      note: `Model points table uses series rules: ${SERIES_SCORING_RULES[sport]?.notes || "completed race finish points."}${titleModelNote ? ` ${titleModelNote}` : ""}`,
      tables: mergedTables,
    };
  } else {
    payload = await buildDerivedPayloadFallback(sport);
    if (championshipModel) {
      payload = {
        ...payload,
        tables: applyRacingChampionshipProbabilities(sport, payload.tables, championshipModel),
        note: `${payload.note ? `${payload.note} ` : ""}Title model: ${championshipModel.remainingRaces} races`
          + (championshipModel.remainingSprints > 0 ? ` + ${championshipModel.remainingSprints} sprints` : "")
          + ` remaining, ${championshipModel.simulations.toLocaleString()} Monte Carlo simulations.`,
      };
    }
  }

  standingsCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  schedulePersistRacingPayloadCaches();
  return payload;
};
