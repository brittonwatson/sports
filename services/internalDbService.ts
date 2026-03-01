import { Game, Sport, StandingsGroup, TeamStatItem, StatCategory } from "../types";

interface InternalSportSnapshot {
  generatedAt?: string;
  games?: Game[];
  gamesHistory?: Game[];
  standings?: StandingsGroup[];
  teamSchedules?: Record<string, Game[]>;
  teamStats?: Record<string, TeamStatItem[]>;
  teamPlayerStats?: Record<string, StatCategory[]>;
  liveScoringModel?: InternalLiveScoringModel;
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
};

const loadedSports = new Set<Sport>();
const failedSports = new Set<Sport>();
const inFlightLoads = new Map<Sport, Promise<void>>();

const keyForTeam = (sport: Sport, teamId: string): string => `${sport}-${teamId}`;

const sportToFileName = (sport: Sport): string => `${sport.replace(/\s+/g, "_")}.json`;

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
  if (snapshot.generatedAt) {
    if (!runtimeDb.generatedAt || snapshot.generatedAt > runtimeDb.generatedAt) {
      runtimeDb.generatedAt = snapshot.generatedAt;
    }
  }

  runtimeDb.gamesBySport[sport] = Array.isArray(snapshot.games) ? snapshot.games : [];

  if (Array.isArray(snapshot.gamesHistory) && snapshot.gamesHistory.length > 0) {
    runtimeDb.gamesHistoryBySport[sport] = snapshot.gamesHistory;
  } else {
    runtimeDb.gamesHistoryBySport[sport] = runtimeDb.gamesBySport[sport] || [];
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
