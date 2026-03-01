import {
  Game,
  Sport,
  StandingsGroup,
  TeamStatItem,
  StatCategory,
  RacingCalendarPayload,
  RacingStandingsPayload,
  RacingEventBundle,
  RacingDriverSeasonResults,
} from "../types";

interface InternalSportSnapshot {
  generatedAt?: string;
  games?: Game[];
  gamesHistory?: Game[];
  standings?: StandingsGroup[];
  teamSchedules?: Record<string, Game[]>;
  teamStats?: Record<string, TeamStatItem[]>;
  teamPlayerStats?: Record<string, StatCategory[]>;
  liveScoringModel?: InternalLiveScoringModel;
  racingCalendar?: RacingCalendarPayload;
  racingStandings?: RacingStandingsPayload;
  racingEventsById?: Record<string, RacingEventBundle>;
  racingDriverSeasons?: Record<string, RacingDriverSeasonResults>;
}

export interface InternalLiveScoringTeamProfile {
  offenseShare: number[];
  offenseCount: number[];
  defenseShare: number[];
  defenseCount: number[];
}

interface InternalLiveScoringModel {
  binCount: number;
  teamProfiles: Record<string, InternalLiveScoringTeamProfile>;
}

interface InternalRuntimeDatabase {
  generatedAt: string;
  gamesBySport: Partial<Record<Sport, Game[]>>;
  gamesHistoryBySport: Partial<Record<Sport, Game[]>>;
  teamSchedules: Record<string, Game[]>;
  teamStats: Record<string, TeamStatItem[]>;
  teamPlayerStats: Record<string, StatCategory[]>;
  standingsBySport: Partial<Record<Sport, StandingsGroup[]>>;
  liveScoringBySport: Partial<Record<Sport, InternalLiveScoringModel>>;
  racingCalendarBySport: Partial<Record<Sport, RacingCalendarPayload>>;
  racingStandingsBySport: Partial<Record<Sport, RacingStandingsPayload>>;
  racingEventsBySport: Partial<Record<Sport, Record<string, RacingEventBundle>>>;
  racingDriverSeasonsBySport: Partial<Record<Sport, Record<string, RacingDriverSeasonResults>>>;
}

const runtimeDb: InternalRuntimeDatabase = {
  generatedAt: "",
  gamesBySport: {},
  gamesHistoryBySport: {},
  teamSchedules: {},
  teamStats: {},
  teamPlayerStats: {},
  standingsBySport: {},
  liveScoringBySport: {},
  racingCalendarBySport: {},
  racingStandingsBySport: {},
  racingEventsBySport: {},
  racingDriverSeasonsBySport: {},
};

const loadedSports = new Set<Sport>();
const failedSports = new Set<Sport>();
const inFlightLoads = new Map<Sport, Promise<void>>();
const LOCAL_FINISHED_GAMES_STORAGE_KEY = "sports_internal_finished_games_v1";
let localFinishedGamesLoaded = false;
const localFinishedGamesBySport: Partial<Record<Sport, Game[]>> = {};

const keyForTeam = (sport: Sport, teamId: string): string => `${sport}-${teamId}`;

const sportToFileName = (sport: Sport): string => `${sport.replace(/\s+/g, "_")}.json`;

const gameStorageKey = (game: Game): string =>
  String(game.id || `${game.dateTime}-${game.homeTeamId || "home"}-${game.awayTeamId || "away"}`);

const mergeGamesById = (base: Game[], overlay: Game[]): Game[] => {
  const merged = new Map<string, Game>();
  [...base, ...overlay].forEach((game) => {
    const key = gameStorageKey(game);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, game);
      return;
    }
    const preferIncoming =
      !(existing.status === "finished" && game.status !== "finished");
    merged.set(key, preferIncoming ? { ...existing, ...game } : { ...game, ...existing });
  });
  return Array.from(merged.values()).sort(
    (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime(),
  );
};

const canUseLocalStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const loadLocalFinishedGames = (): void => {
  if (localFinishedGamesLoaded || !canUseLocalStorage()) return;
  localFinishedGamesLoaded = true;
  try {
    const raw = window.localStorage.getItem(LOCAL_FINISHED_GAMES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    Object.entries(parsed || {}).forEach(([sportKey, value]) => {
      if (!Array.isArray(value)) return;
      localFinishedGamesBySport[sportKey as Sport] = value
        .filter((entry): entry is Game => Boolean(entry && typeof entry === "object"))
        .map((entry) => ({ ...(entry as Game) }))
        .filter((entry) => entry.status === "finished");
    });
  } catch {
    // Ignore corrupted local storage payloads.
  }
};

const persistLocalFinishedGames = (): void => {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(
      LOCAL_FINISHED_GAMES_STORAGE_KEY,
      JSON.stringify(localFinishedGamesBySport),
    );
  } catch {
    // Ignore storage quota/private mode failures.
  }
};

const getSportAssetUrl = (sport: Sport): string => {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}internal-db/${sportToFileName(sport)}`;
};

const withSportPrefix = (sport: Sport, key: string): string =>
  key.includes("-") ? key : keyForTeam(sport, key);

const mergeTeamMap = <T>(
  target: Record<string, T>,
  source: Record<string, T> | undefined,
  sport: Sport,
): void => {
  if (!source) return;
  Object.entries(source).forEach(([key, value]) => {
    target[withSportPrefix(sport, key)] = value;
  });
};

const hydrateSportSnapshot = (sport: Sport, snapshot: InternalSportSnapshot): void => {
  loadLocalFinishedGames();
  if (snapshot.generatedAt) {
    if (!runtimeDb.generatedAt || snapshot.generatedAt > runtimeDb.generatedAt) {
      runtimeDb.generatedAt = snapshot.generatedAt;
    }
  }

  const baseGames = Array.isArray(snapshot.games) ? snapshot.games : [];
  const localFinished = localFinishedGamesBySport[sport] || [];
  runtimeDb.gamesBySport[sport] = mergeGamesById(baseGames, localFinished);

  if (Array.isArray(snapshot.gamesHistory) && snapshot.gamesHistory.length > 0) {
    runtimeDb.gamesHistoryBySport[sport] = mergeGamesById(snapshot.gamesHistory, localFinished);
  } else {
    runtimeDb.gamesHistoryBySport[sport] = mergeGamesById(runtimeDb.gamesBySport[sport] || [], localFinished);
  }

  runtimeDb.standingsBySport[sport] = Array.isArray(snapshot.standings)
    ? snapshot.standings
    : [];

  mergeTeamMap(runtimeDb.teamSchedules, snapshot.teamSchedules, sport);
  mergeTeamMap(runtimeDb.teamStats, snapshot.teamStats, sport);
  mergeTeamMap(runtimeDb.teamPlayerStats, snapshot.teamPlayerStats, sport);

  runtimeDb.liveScoringBySport[sport] = snapshot.liveScoringModel
    ? {
        binCount: Number(snapshot.liveScoringModel.binCount) || 0,
        teamProfiles: snapshot.liveScoringModel.teamProfiles || {},
      }
    : { binCount: 0, teamProfiles: {} };

  if (snapshot.racingCalendar && Array.isArray(snapshot.racingCalendar.events)) {
    runtimeDb.racingCalendarBySport[sport] = snapshot.racingCalendar;
  } else {
    delete runtimeDb.racingCalendarBySport[sport];
  }

  if (snapshot.racingStandings && Array.isArray(snapshot.racingStandings.tables)) {
    runtimeDb.racingStandingsBySport[sport] = snapshot.racingStandings;
  } else {
    delete runtimeDb.racingStandingsBySport[sport];
  }

  if (snapshot.racingEventsById && typeof snapshot.racingEventsById === "object") {
    runtimeDb.racingEventsBySport[sport] = snapshot.racingEventsById;
  } else {
    delete runtimeDb.racingEventsBySport[sport];
  }

  if (snapshot.racingDriverSeasons && typeof snapshot.racingDriverSeasons === "object") {
    runtimeDb.racingDriverSeasonsBySport[sport] = snapshot.racingDriverSeasons;
  } else {
    delete runtimeDb.racingDriverSeasonsBySport[sport];
  }
};

const isSameLocalDate = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const ensureInternalSportLoaded = async (sport: Sport): Promise<void> => {
  if (loadedSports.has(sport) || failedSports.has(sport)) return;

  const existingLoad = inFlightLoads.get(sport);
  if (existingLoad) return existingLoad;

  const loadPromise = (async () => {
    try {
      const response = await fetch(getSportAssetUrl(sport), { cache: "no-store" });
      if (!response.ok) {
        failedSports.add(sport);
        return;
      }

      const payload = (await response.json()) as InternalSportSnapshot;
      hydrateSportSnapshot(sport, payload);
      loadedSports.add(sport);
    } catch {
      failedSports.add(sport);
    } finally {
      inFlightLoads.delete(sport);
    }
  })();

  inFlightLoads.set(sport, loadPromise);
  return loadPromise;
};

export const getInternalDatabaseGeneratedAt = (): string => runtimeDb.generatedAt;

export const getInternalGamesBySport = (sport: Sport): Game[] => {
  return runtimeDb.gamesBySport[sport] || runtimeDb.gamesHistoryBySport[sport] || [];
};

export const getInternalHistoricalGamesBySport = (sport: Sport): Game[] => {
  return runtimeDb.gamesHistoryBySport[sport] || runtimeDb.gamesBySport[sport] || [];
};

export const recordCompletedGame = (game: Game): void => {
  if (!game || game.status !== "finished") return;
  const sport = game.league as Sport;
  if (!sport) return;

  loadLocalFinishedGames();
  const existingStored = localFinishedGamesBySport[sport] || [];
  const mergedStored = mergeGamesById(existingStored, [game]).filter((entry) => entry.status === "finished");
  localFinishedGamesBySport[sport] = mergedStored;
  persistLocalFinishedGames();

  const existingHistory = runtimeDb.gamesHistoryBySport[sport] || [];
  runtimeDb.gamesHistoryBySport[sport] = mergeGamesById(existingHistory, [game]);

  const existingGames = runtimeDb.gamesBySport[sport] || [];
  runtimeDb.gamesBySport[sport] = mergeGamesById(existingGames, [game]);

  if (game.homeTeamId) delete runtimeDb.teamSchedules[keyForTeam(sport, String(game.homeTeamId))];
  if (game.awayTeamId) delete runtimeDb.teamSchedules[keyForTeam(sport, String(game.awayTeamId))];
};

export const recordCompletedGames = (games: Game[]): void => {
  if (!Array.isArray(games) || games.length === 0) return;

  const perSport = new Map<Sport, Map<string, Game>>();
  games.forEach((game) => {
    if (!game || game.status !== "finished") return;
    const sport = game.league as Sport;
    if (!sport) return;
    if (!perSport.has(sport)) perSport.set(sport, new Map<string, Game>());
    perSport.get(sport)!.set(gameStorageKey(game), game);
  });

  if (perSport.size === 0) return;

  loadLocalFinishedGames();
  let hasLocalStorageChanges = false;

  perSport.forEach((incomingMap, sport) => {
    const incoming = Array.from(incomingMap.values());
    if (incoming.length === 0) return;

    const existingStored = localFinishedGamesBySport[sport] || [];
    const existingByKey = new Map<string, Game>();
    existingStored.forEach((entry) => existingByKey.set(gameStorageKey(entry), entry));

    const hasDelta = incoming.some((entry) => {
      const existing = existingByKey.get(gameStorageKey(entry));
      if (!existing) return true;
      return (
        String(existing.homeScore || "") !== String(entry.homeScore || "") ||
        String(existing.awayScore || "") !== String(entry.awayScore || "") ||
        String(existing.gameStatus || "") !== String(entry.gameStatus || "")
      );
    });

    if (hasDelta) {
      localFinishedGamesBySport[sport] = mergeGamesById(existingStored, incoming)
        .filter((entry) => entry.status === "finished");
      hasLocalStorageChanges = true;
    }

    const existingHistory = runtimeDb.gamesHistoryBySport[sport] || [];
    runtimeDb.gamesHistoryBySport[sport] = mergeGamesById(existingHistory, incoming);

    const existingGames = runtimeDb.gamesBySport[sport] || [];
    runtimeDb.gamesBySport[sport] = mergeGamesById(existingGames, incoming);

    incoming.forEach((game) => {
      if (game.homeTeamId) delete runtimeDb.teamSchedules[keyForTeam(sport, String(game.homeTeamId))];
      if (game.awayTeamId) delete runtimeDb.teamSchedules[keyForTeam(sport, String(game.awayTeamId))];
    });
  });

  if (hasLocalStorageChanges) persistLocalFinishedGames();
};

export const getInternalGamesForDate = (sport: Sport, date: Date): Game[] => {
  const games = getInternalHistoricalGamesBySport(sport);
  return games.filter((game) => isSameLocalDate(new Date(game.dateTime), date));
};

export const getInternalGameDaysForMonth = (
  sport: Sport,
  year: number,
  month: number,
): Set<number> => {
  const out = new Set<number>();
  getInternalHistoricalGamesBySport(sport).forEach((game) => {
    const d = new Date(game.dateTime);
    if (d.getFullYear() === year && d.getMonth() === month) out.add(d.getDate());
  });
  return out;
};

export const getInternalTeamSchedule = (sport: Sport, teamId: string): Game[] => {
  const key = keyForTeam(sport, teamId);
  const direct = runtimeDb.teamSchedules[key];
  if (Array.isArray(direct) && direct.length > 0) return direct;

  const teamIdStr = String(teamId);
  const derived = getInternalHistoricalGamesBySport(sport)
    .filter((game) => String(game.homeTeamId || "") === teamIdStr || String(game.awayTeamId || "") === teamIdStr);

  if (derived.length === 0) return [];

  const deduped = Array.from(
    new Map(
      derived.map((game) => [
        String(game.id || `${game.dateTime}-${game.homeTeamId}-${game.awayTeamId}`),
        game,
      ]),
    ).values(),
  ).sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

  runtimeDb.teamSchedules[key] = deduped;
  return deduped;
};

export const getInternalTeamStats = (
  sport: Sport,
  teamId: string,
): TeamStatItem[] => {
  return runtimeDb.teamStats[keyForTeam(sport, teamId)] || [];
};

export const getInternalTeamStatsBySport = (
  sport: Sport,
): Record<string, TeamStatItem[]> => {
  const out: Record<string, TeamStatItem[]> = {};
  const prefix = `${sport}-`;
  Object.entries(runtimeDb.teamStats).forEach(([key, stats]) => {
    if (!key.startsWith(prefix)) return;
    const teamId = key.slice(prefix.length);
    if (!teamId) return;
    out[teamId] = Array.isArray(stats) ? stats : [];
  });
  return out;
};

export const getInternalTeamPlayerStats = (
  sport: Sport,
  teamId: string,
): StatCategory[] => {
  return runtimeDb.teamPlayerStats[keyForTeam(sport, teamId)] || [];
};

export const getInternalStandings = (sport: Sport): StandingsGroup[] => {
  return runtimeDb.standingsBySport[sport] || [];
};

export const getInternalRacingCalendar = (sport: Sport): RacingCalendarPayload | null => {
  return runtimeDb.racingCalendarBySport[sport] || null;
};

export const getInternalRacingStandings = (sport: Sport): RacingStandingsPayload | null => {
  return runtimeDb.racingStandingsBySport[sport] || null;
};

export const getInternalRacingEventBundle = (
  sport: Sport,
  eventId: string,
): RacingEventBundle | null => {
  if (!eventId) return null;
  const events = runtimeDb.racingEventsBySport[sport];
  if (!events) return null;
  return events[String(eventId)] || null;
};

export const getInternalRacingDriverSeason = (
  sport: Sport,
  driverId: string,
): RacingDriverSeasonResults | null => {
  if (!driverId) return null;
  const drivers = runtimeDb.racingDriverSeasonsBySport[sport];
  if (!drivers) return null;
  return drivers[String(driverId)] || null;
};

export const getInternalLiveScoringTeamProfile = (
  sport: Sport,
  teamId: string,
): (InternalLiveScoringTeamProfile & { binCount: number }) | null => {
  const model = runtimeDb.liveScoringBySport[sport];
  if (!model || model.binCount <= 0) return null;

  const directKey = keyForTeam(sport, teamId);
  const profile = model.teamProfiles[directKey] || model.teamProfiles[teamId];
  if (!profile) return null;

  return {
    binCount: model.binCount,
    offenseShare: Array.isArray(profile.offenseShare) ? profile.offenseShare : [],
    offenseCount: Array.isArray(profile.offenseCount) ? profile.offenseCount : [],
    defenseShare: Array.isArray(profile.defenseShare) ? profile.defenseShare : [],
    defenseCount: Array.isArray(profile.defenseCount) ? profile.defenseCount : [],
  };
};
