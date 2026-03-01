
import { Game, GameDetails, Sport, LineScore, TeamStat, ScoringPlay, Play, GameSituation, TeamBoxScore, TeamGameLeaders, TeamStatItem } from "../types";
import { ESPN_ENDPOINTS, SPORT_PARAMS, DAILY_CALENDAR_SPORTS } from "./constants";
import {
    fetchWithRetry,
    getUpcomingDateRange,
    formatEspnDate,
    formatTeamName,
    normalizeStat,
    extractNumber,
    shouldHideUndeterminedPlayoffGame,
} from "./utils";
import { mapEventToGame } from "./mappers";
import { fetchTeamSeasonStats } from "./teamService";
import {
    ensureInternalSportLoaded,
    getInternalGameDaysForMonth,
    getInternalGamesBySport,
    getInternalGamesForDate,
} from "./internalDbService";

interface LiveRefreshCacheEntry {
    fetchedAt: number;
    games: Game[];
}

interface OddsBackfillCacheEntry {
    fetchedAt: number;
    odds: Game["odds"] | null;
}

const liveRefreshCache = new Map<string, LiveRefreshCacheEntry>();
const oddsBackfillCache = new Map<string, OddsBackfillCacheEntry>();
const LIVE_REFRESH_TTL_MS = 60 * 1000;
const STALE_LIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const ODDS_BACKFILL_TTL_MS = 10 * 60 * 1000;
const ODDS_BACKFILL_LOOKAHEAD_MS = 12 * 24 * 60 * 60 * 1000;
const ODDS_BACKFILL_MAX_REQUESTS = 64;

const sortGamesByDateTime = (games: Game[]): Game[] =>
    [...games].sort((a, b) => {
        const aTime = new Date(a.dateTime).getTime();
        const bTime = new Date(b.dateTime).getTime();
        if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
        if (!Number.isFinite(aTime)) return 1;
        if (!Number.isFinite(bTime)) return -1;
        return aTime - bTime;
    });

const hasNearSeasonActivity = (games: Game[], now: Date = new Date()): boolean => {
    if (!Array.isArray(games) || games.length === 0) return false;
    const nowMs = now.getTime();
    const lookbackMs = 14 * 24 * 60 * 60 * 1000;
    const lookaheadMs = 30 * 24 * 60 * 60 * 1000;

    return games.some((game) => {
        if (game.status === "in_progress") return true;
        const gameMs = new Date(game.dateTime).getTime();
        if (!Number.isFinite(gameMs)) return false;
        return gameMs >= (nowMs - lookbackMs) && gameMs <= (nowMs + lookaheadMs);
    });
};

const isLikelyPausedGame = (statusText?: string): boolean => {
    const normalized = (statusText || "").toLowerCase();
    return (
        normalized.includes("delayed") ||
        normalized.includes("postponed") ||
        normalized.includes("suspended") ||
        normalized.includes("rain")
    );
};

const coerceStaleLiveGames = (games: Game[]): Game[] => {
    const nowMs = Date.now();
    return games.map((game) => {
        if (game.status !== "in_progress") return game;
        if (isLikelyPausedGame(game.gameStatus)) return game;

        const startMs = new Date(game.dateTime).getTime();
        if (!Number.isFinite(startMs)) return game;
        if (nowMs - startMs <= STALE_LIVE_MAX_AGE_MS) return game;

        return {
            ...game,
            status: "finished",
            gameStatus: "Final",
            clock: undefined,
        };
    });
};

const removeUndeterminedPlayoffGames = (games: Game[]): Game[] =>
    games.filter((game) => !shouldHideUndeterminedPlayoffGame(game));

const isSameLocalDate = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

const shouldRefreshLiveWindow = (games: Game[], now: Date): boolean => {
    const nowMs = now.getTime();
    const refreshWindowMs = 36 * 60 * 60 * 1000;
    return games.some((game) => {
        if (game.status === "in_progress") return true;
        const gameMs = new Date(game.dateTime).getTime();
        if (!Number.isFinite(gameMs)) return false;
        return Math.abs(nowMs - gameMs) <= refreshWindowMs;
    });
};

const mergeGamesByIdPreferFresh = (baseGames: Game[], freshGames: Game[]): Game[] => {
    if (freshGames.length === 0) return baseGames;

    const merged = new Map<string, Game>();
    baseGames.forEach((game) => merged.set(game.id, game));
    freshGames.forEach((game) => {
        const existing = merged.get(game.id);
        if (!existing) {
            merged.set(game.id, game);
            return;
        }
        merged.set(game.id, {
            ...existing,
            ...game,
            context: game.context ?? existing.context,
            gameStatus: game.gameStatus ?? existing.gameStatus,
            leagueLogo: game.leagueLogo || existing.leagueLogo,
        });
    });

    return sortGamesByDateTime(Array.from(merged.values()));
};

const hasMarketOdds = (odds?: Game["odds"]): boolean =>
    Boolean(odds?.spread || odds?.overUnder || odds?.moneyLineAway || odds?.moneyLineHome);

const parseOddsFromSummaryPayload = (payload: any): Game["odds"] | undefined => {
    const pickcenter = payload?.pickcenter?.[0];
    if (pickcenter) {
        const mapped = {
            spread: pickcenter.details,
            overUnder: pickcenter.overUnder ? `O/U ${pickcenter.overUnder}` : undefined,
            moneyLineAway: pickcenter.awayTeamOdds?.moneyLine !== undefined ? String(pickcenter.awayTeamOdds.moneyLine) : undefined,
            moneyLineHome: pickcenter.homeTeamOdds?.moneyLine !== undefined ? String(pickcenter.homeTeamOdds.moneyLine) : undefined,
            provider: pickcenter.provider?.name,
        };
        if (hasMarketOdds(mapped)) return mapped;
    }

    const competitionOdds = payload?.header?.competitions?.[0]?.odds?.[0];
    if (competitionOdds) {
        const mapped = {
            spread: competitionOdds.details,
            overUnder: competitionOdds.overUnder ? `O/U ${competitionOdds.overUnder}` : undefined,
            moneyLineAway: competitionOdds.awayTeamOdds?.moneyLine !== undefined ? String(competitionOdds.awayTeamOdds.moneyLine) : undefined,
            moneyLineHome: competitionOdds.homeTeamOdds?.moneyLine !== undefined ? String(competitionOdds.homeTeamOdds.moneyLine) : undefined,
            provider: competitionOdds.provider?.name,
        };
        if (hasMarketOdds(mapped)) return mapped;
    }

    return undefined;
};

const fetchSummaryOdds = async (sport: Sport, gameId: string): Promise<Game["odds"] | null> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary`;
    const params = new URLSearchParams({ event: gameId });
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, 1);
        if (!response.ok) return null;
        const payload = await response.json();
        return parseOddsFromSummaryPayload(payload) || null;
    } catch {
        return null;
    }
};

const backfillMissingOdds = async (sport: Sport, games: Game[]): Promise<Game[]> => {
    if (games.length === 0) return games;

    const nowMs = Date.now();
    const candidates = games
        .map((game, index) => ({ game, index }))
        .filter(({ game }) => {
            if (game.status !== "scheduled") return false;
            if (hasMarketOdds(game.odds)) return false;
            const gameMs = new Date(game.dateTime).getTime();
            if (!Number.isFinite(gameMs)) return false;
            return gameMs >= nowMs && gameMs <= (nowMs + ODDS_BACKFILL_LOOKAHEAD_MS);
        })
        .slice(0, ODDS_BACKFILL_MAX_REQUESTS);

    if (candidates.length === 0) return games;

    const updates = await Promise.all(
        candidates.map(async ({ game, index }) => {
            const cacheKey = `${sport}:${game.id}`;
            const cached = oddsBackfillCache.get(cacheKey);
            if (cached && (nowMs - cached.fetchedAt) < ODDS_BACKFILL_TTL_MS) {
                return { index, odds: cached.odds };
            }

            const odds = await fetchSummaryOdds(sport, game.id);
            oddsBackfillCache.set(cacheKey, { fetchedAt: Date.now(), odds });
            return { index, odds };
        }),
    );

    if (!updates.some((entry) => hasMarketOdds(entry.odds || undefined))) return games;

    const next = [...games];
    updates.forEach(({ index, odds }) => {
        if (!odds || !hasMarketOdds(odds)) return;
        next[index] = { ...next[index], odds };
    });
    return next;
};

const fetchFreshGamesWindow = async (sport: Sport, start: Date, end: Date): Promise<Game[] | null> => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const dateRange = `${formatEspnDate(startDate)}-${formatEspnDate(endDate)}`;
    const cacheKey = `${sport}:${dateRange}`;
    const cached = liveRefreshCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < LIVE_REFRESH_TTL_MS) {
        return cached.games;
    }

    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const params = new URLSearchParams(SPORT_PARAMS[sport] || "");
    if (sport === "NCAAF" && !params.has("groups")) params.set("groups", "80");
    if ((sport === "NCAAM" || sport === "NCAAW") && !params.has("groups")) params.set("groups", "50");
    params.set("dates", dateRange);
    if (!params.has("limit")) params.set("limit", "1000");

    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) return null;
        const data = await response.json();
        const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href;
        const freshGames = (data.events || []).map((event: any) => mapEventToGame(event, sport, leagueLogo));
        liveRefreshCache.set(cacheKey, { fetchedAt: Date.now(), games: freshGames });
        return freshGames;
    } catch {
        return null;
    }
};

export const fetchUpcomingGames = async (sport: Sport, fullHistory = false): Promise<{ games: Game[], groundingChunks: any[], isSeasonActive: boolean }> => {
    await ensureInternalSportLoaded(sport);
    const internalGames = getInternalGamesBySport(sport);
    const now = new Date();
    if (internalGames.length > 0) {
        const displayStart = new Date(now);
        const displayEnd = new Date(now);
        displayStart.setDate(displayStart.getDate() - 1);
        displayEnd.setDate(displayEnd.getDate() + 6);

        let games = fullHistory
            ? sortGamesByDateTime(internalGames)
            : internalGames.filter((g) => {
                const gameDate = new Date(g.dateTime);
                return gameDate >= displayStart && gameDate <= displayEnd;
            });

        // Refresh a narrow near-live window so internal snapshots do not keep stale "in progress" statuses.
        if (games.length > 0 && shouldRefreshLiveWindow(games, now)) {
            const refreshStart = new Date(now);
            const refreshEnd = new Date(now);
            refreshStart.setDate(refreshStart.getDate() - 1);
            refreshEnd.setDate(refreshEnd.getDate() + 1);
            const freshWindowGames = await fetchFreshGamesWindow(sport, refreshStart, refreshEnd);
            if (freshWindowGames && freshWindowGames.length > 0) {
                games = mergeGamesByIdPreferFresh(games, freshWindowGames);
            }
        }
        games = coerceStaleLiveGames(games);
        games = removeUndeterminedPlayoffGames(games);
        if (!fullHistory) {
            games = await backfillMissingOdds(sport, games);
        }

        const internalSeasonActive = hasNearSeasonActivity(internalGames, now);
        if (games.length > 0) {
            return { games: sortGamesByDateTime(games), groundingChunks: [], isSeasonActive: internalSeasonActive || games.length > 0 };
        }
    }

    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const params = new URLSearchParams(SPORT_PARAMS[sport] || '');
    if (sport === 'NCAAF' && !params.has('groups')) params.set('groups', '80');
    if ((sport === 'NCAAM' || sport === 'NCAAW') && !params.has('groups')) params.set('groups', '50');
    if (DAILY_CALENDAR_SPORTS.includes(sport) || sport === 'NFL' || sport === 'NCAAF') params.set('dates', getUpcomingDateRange(sport, fullHistory));
    if (!params.has('limit')) params.set('limit', fullHistory ? '1000' : '200');

    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href;
        const events = data.events || [];
        let games = removeUndeterminedPlayoffGames(
            coerceStaleLiveGames(events.map((event: any) => mapEventToGame(event, sport, leagueLogo))),
        );
        if (!fullHistory) {
            games = await backfillMissingOdds(sport, games);
        }
        const leagueSeason = data.leagues?.[0]?.season;
        const seasonTypeCode = Number(leagueSeason?.type?.type ?? leagueSeason?.type?.id);
        const seasonTypeName = String(leagueSeason?.type?.name || leagueSeason?.type?.abbreviation || '').toLowerCase();
        const isOffSeason = seasonTypeCode === 4 || seasonTypeName.includes('off');

        let isSeasonActive = hasNearSeasonActivity(games, now);
        if (!isSeasonActive && !isOffSeason && leagueSeason?.startDate && leagueSeason?.endDate) {
            const start = new Date(leagueSeason.startDate);
            const end = new Date(new Date(leagueSeason.endDate).getTime() + 86400000);
            isSeasonActive = now >= start && now <= end;
        }

        if (games.length > 0 && !isOffSeason) isSeasonActive = true;
        return { games: sortGamesByDateTime(games), groundingChunks: [], isSeasonActive };
    } catch (e) {
        return { games: [], groundingChunks: [], isSeasonActive: false };
    }
};

export const fetchGamesForDate = async (sport: Sport, date: Date): Promise<Game[]> => {
    await ensureInternalSportLoaded(sport);
    const internalGames = getInternalGamesForDate(sport, date);
    if (internalGames.length > 0) {
        let games = internalGames;
        const now = new Date();
        const oneDayMs = 24 * 60 * 60 * 1000;
        if (Math.abs(now.getTime() - date.getTime()) <= oneDayMs * 2) {
            const refreshStart = new Date(date);
            const refreshEnd = new Date(date);
            refreshStart.setDate(refreshStart.getDate() - 1);
            refreshEnd.setDate(refreshEnd.getDate() + 1);
            const freshWindowGames = await fetchFreshGamesWindow(sport, refreshStart, refreshEnd);
            if (freshWindowGames && freshWindowGames.length > 0) {
                games = mergeGamesByIdPreferFresh(games, freshWindowGames).filter((g) =>
                    isSameLocalDate(new Date(g.dateTime), date),
                );
            }
        }
        const cleaned = removeUndeterminedPlayoffGames(coerceStaleLiveGames(games));
        return backfillMissingOdds(sport, cleaned);
    }

    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const start = new Date(date); start.setDate(start.getDate() - 1);
    const end = new Date(date); end.setDate(end.getDate() + 1);
    const formatDate = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const params = new URLSearchParams(SPORT_PARAMS[sport] || '');
    if (sport === 'NCAAF') params.set('groups', '80');
    if (sport === 'NCAAM' || sport === 'NCAAW') params.set('groups', '50');
    params.set('dates', `${formatDate(start)}-${formatDate(end)}`);
    params.set('limit', '1000');
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href;
        let games = removeUndeterminedPlayoffGames(
            coerceStaleLiveGames((data.events || []).map((e: any) => mapEventToGame(e, sport, leagueLogo))),
        );
        games = games.filter((g: Game) => {
            const gd = new Date(g.dateTime);
            return gd.getFullYear() === date.getFullYear() && gd.getMonth() === date.getMonth() && gd.getDate() === date.getDate();
        });
        const sorted = sortGamesByDateTime(games);
        return backfillMissingOdds(sport, sorted);
    } catch { return []; }
};

export const fetchGameDatesForMonth = async (sport: Sport, year: number, month: number): Promise<Set<number>> => {
    await ensureInternalSportLoaded(sport);
    const internalDays = getInternalGameDaysForMonth(sport, year, month);
    if (internalDays.size > 0) return internalDays;

    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dateRange = `${year}${String(month + 1).padStart(2, '0')}01-${year}${String(month + 1).padStart(2, '0')}${lastDay}`;
    const params = new URLSearchParams(SPORT_PARAMS[sport] || '');
    if (sport === 'NCAAF') params.set('groups', '80');
    if (sport === 'NCAAM' || sport === 'NCAAW') params.set('groups', '50');
    params.set('dates', dateRange); params.set('limit', '1000');
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) return new Set();
        const data = await response.json();
        const days = new Set<number>();
        (data.events || []).forEach((evt: any) => {
            const d = new Date(evt.date);
            if (d.getFullYear() === year && d.getMonth() === month) days.add(d.getDate());
        });
        return days;
    } catch { return new Set(); }
};

export const fetchBracketGames = async (sport: Sport): Promise<Game[]> => {
    if (sport === 'NFL') {
        const endpoint = ESPN_ENDPOINTS[sport];
        const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
        const weeks = [1, 2, 3, 4, 5];
        const promises = weeks.map(w => 
            fetchWithRetry(`${baseUrl}?seasontype=3&week=${w}`).then(async r => {
                if (!r.ok) return [];
                const data = await r.json();
                const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href;
                return (data.events || []).map((e: any) => ({ ...e, _leagueLogo: leagueLogo }));
            }).catch(() => [])
        );
        const results = await Promise.all(promises);
        const allEvents = results.flat();
        const uniqueEvents = new Map();
        allEvents.forEach((e: any) => uniqueEvents.set(e.id, e));
        const games = Array.from(uniqueEvents.values()).map((e: any) => mapEventToGame(e, sport, e._leagueLogo));
        return games.filter(g => {
            const ctx = (g.context || '').toLowerCase();
            return !ctx.includes('pro bowl');
        }).sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
    }
    return [];
};

const toInjuryStatus = (status: any): string => {
    if (typeof status === 'string' && status.trim()) return status.trim();
    if (status && typeof status === 'object') {
        const candidate = [
            status.type,
            status.abbreviation,
            status.shortDetail,
            status.displayName,
            status.name,
            status.description,
            status.detail,
        ].find((value) => typeof value === 'string' && value.trim());
        if (typeof candidate === 'string') return candidate.trim();
    }
    return 'Unavailable';
};

export const fetchGameDetails = async (gameId: string, sport: Sport): Promise<GameDetails | null> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary`;
    const params = new URLSearchParams({ event: gameId });
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) return null;
        const data = await response.json();
        
        const competition = data.header?.competitions?.[0];
        const competitors = competition?.competitors || [];
        const isRacing = sport === 'NASCAR' || sport === 'INDYCAR' || sport === 'F1';
        const orderRank = (competitor: any): number => {
            const order = extractNumber(competitor?.order);
            if (order > 0) return order;
            const curated = extractNumber(competitor?.curatedRank?.current);
            if (curated > 0) return curated;
            const score = extractNumber(competitor?.score);
            if (score > 0) return score;
            return Number.MAX_SAFE_INTEGER;
        };
        let homeComp = competitors.find((c: any) => c.homeAway === 'home');
        let awayComp = competitors.find((c: any) => c.homeAway === 'away');
        if ((!homeComp || !awayComp) && isRacing && competitors.length > 0) {
            const ranked = [...competitors].sort((a: any, b: any) => orderRank(a) - orderRank(b));
            homeComp = homeComp || ranked[0];
            awayComp = awayComp || ranked[1] || ranked[0];
        }
        const statusState = data.header?.competitions?.[0]?.status?.type?.state; // 'pre', 'in', 'post'
        const currentPeriod = data.header?.competitions?.[0]?.status?.period || 0;
        const isSoccer = ['EPL', 'Bundesliga', 'La Liga', 'Ligue 1', 'Serie A', 'MLS', 'UCL'].includes(sport);
        const resolveCompetitorScore = (competitor: any): string | undefined => {
            const normalized = normalizeStat(competitor?.score);
            if (normalized && normalized !== '-') return normalized;
            if (isRacing) {
                const position = Math.trunc(extractNumber(competitor?.order));
                if (Number.isFinite(position) && position > 0 && statusState !== 'pre') {
                    return String(position);
                }
            }
            return undefined;
        };

        const getPlayPeriod = (play: any): number => {
            const explicit = parseInt(String(play?.period?.number ?? play?.period ?? '0'));
            if (Number.isFinite(explicit) && explicit > 0) return explicit;
            const clockValue = Number(play?.clock?.value);
            if (isSoccer && Number.isFinite(clockValue)) {
                if (clockValue > 2700) return 2;
                return 1;
            }
            return 0;
        };

        const getPlayClock = (play: any): string => {
            return play?.clock?.displayValue || play?.displayClock || '';
        };

        const getPlayTypeText = (play: any): string => {
            if (play?.type?.text) return play.type.text;
            if (play?.type?.name) return play.type.name;
            if (play?.redCard) return 'Red Card';
            if (play?.penaltyKick) return 'Penalty Kick';
            if (play?.ownGoal) return 'Own Goal';
            if (play?.scoringPlay) return isSoccer ? 'Goal' : 'Score';
            return 'Play';
        };

        const getPlayText = (play: any): string => {
            if (play?.text) return play.text;
            if (play?.shortText) return play.shortText;
            const names = (play?.participants || [])
                .map((p: any) => p?.athlete?.displayName)
                .filter(Boolean);
            if (names.length > 0) return `${names.join(', ')} - ${getPlayTypeText(play)}`;
            return getPlayTypeText(play);
        };

        const inferScoreValue = (play: any): number => {
            if (!play?.scoringPlay) return 0;
            const typeText = getPlayTypeText(play).toLowerCase();
            const text = getPlayText(play).toLowerCase();

            if (sport === 'NFL' || sport === 'NCAAF') {
                if (typeText.includes('touchdown') || text.includes('touchdown')) return 6;
                if (typeText.includes('field goal') || text.includes('field goal')) return 3;
                if (typeText.includes('safety') || text.includes('safety')) return 2;
                if (typeText.includes('two-point') || text.includes('two-point')) return 2;
                if (typeText.includes('extra point') || text.includes('extra point')) return 1;
                return 1;
            }
            if (['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(sport)) {
                if (typeText.includes('three') || text.includes('three')) return 3;
                if (typeText.includes('free throw') || text.includes('free throw')) return 1;
                return 2;
            }
            return 1;
        };

        const withFallbackShape = (play: any, idx: number): any => ({
            ...play,
            id: play?.id || `${gameId}-play-${idx}`,
            period: play?.period?.number ? play.period : { number: getPlayPeriod(play) },
            clock: play?.clock || { displayValue: '' },
            type: play?.type || { text: getPlayTypeText(play) },
            text: getPlayText(play),
            scoringPlay: !!play?.scoringPlay,
        });

        const toTeamTokens = (comp: any): string[] => {
            const team = comp?.team || {};
            return [
                team.displayName,
                team.shortDisplayName,
                team.name,
                team.location,
                team.abbreviation,
                team.nickname,
            ]
                .map((value) => String(value || '').trim().toLowerCase())
                .filter(Boolean);
        };

        const homeTokens = toTeamTokens(homeComp);
        const awayTokens = toTeamTokens(awayComp);

        const inferCommentaryTeamId = (text: string): string | undefined => {
            const normalized = String(text || '').toLowerCase();
            if (!normalized) return undefined;
            const homeHit = homeTokens.some((token) => token.length >= 3 && normalized.includes(token));
            const awayHit = awayTokens.some((token) => token.length >= 3 && normalized.includes(token));
            if (homeHit && !awayHit) return homeComp?.team?.id ? String(homeComp.team.id) : undefined;
            if (awayHit && !homeHit) return awayComp?.team?.id ? String(awayComp.team.id) : undefined;
            return undefined;
        };

        const parseSoccerCommentaryTime = (rawTime: string): { period: number; displayClock: string } => {
            const timeText = String(rawTime || '').trim();
            const match = timeText.match(/(\d{1,3})(?:\+(\d{1,2}))?\s*'?/);
            if (!match) {
                return {
                    period: Number.isFinite(currentPeriod) && currentPeriod > 0 ? currentPeriod : 0,
                    displayClock: timeText,
                };
            }
            const base = Number(match[1]);
            const extra = Number(match[2] || 0);
            const minute = Number.isFinite(base) ? base : 0;
            const extraMinute = Number.isFinite(extra) ? extra : 0;
            const minuteTotal = minute + extraMinute;
            const period = minuteTotal > 45 ? 2 : 1;
            return {
                period,
                displayClock: `${minute}${extraMinute > 0 ? `+${extraMinute}` : ''}'`,
            };
        };

        const commentaryToFallbackPlay = (entry: any, idx: number): any => {
            const text = String(entry?.text || '').trim();
            const lower = text.toLowerCase();
            const isScoringText =
                !lower.includes('goal kick') &&
                /\b(goal|touchdown|home run|homerun|scores?|penalty scored)\b/.test(lower);
            const timeText = String(entry?.time || '').trim();
            const soccerTiming = isSoccer ? parseSoccerCommentaryTime(timeText) : undefined;
            const period = soccerTiming?.period ?? (Number.isFinite(currentPeriod) ? currentPeriod : 0);
            const displayClock = soccerTiming?.displayClock || timeText;
            const teamId = inferCommentaryTeamId(text);
            const playType = isScoringText ? (isSoccer ? 'Goal' : 'Score') : 'Commentary';

            return {
                id: entry?.id || `${gameId}-commentary-${idx}`,
                period: { number: period },
                clock: { displayValue: displayClock },
                displayClock,
                type: { text: playType },
                text: text || playType,
                team: teamId ? { id: teamId } : undefined,
                scoringPlay: isScoringText,
                sequence: entry?.sequence,
            };
        };

        // 1. Prepare raw plays early to support fallback for scoringPlays
        const keyEventPlays = Array.isArray(data.keyEvents)
            ? data.keyEvents.map((p: any, idx: number) => withFallbackShape(p, idx))
            : [];
        const commentaryPlays = Array.isArray(data.commentary)
            ? [...data.commentary]
                .sort((a: any, b: any) => {
                    const seqA = Number(a?.sequence ?? 0);
                    const seqB = Number(b?.sequence ?? 0);
                    return seqA - seqB;
                })
                .map((entry: any, idx: number) => withFallbackShape(commentaryToFallbackPlay(entry, idx), idx))
            : [];

        let rawPlays = data.plays || [];
        if (rawPlays.length === 0 && data.drives) {
             const drives = [...(data.drives.previous || [])];
             if (data.drives.current) drives.push(data.drives.current);
             rawPlays = drives.flatMap((d: any) => d.plays || []);
        }
        if (rawPlays.length === 0 && keyEventPlays.length > 0) {
            rawPlays = keyEventPlays;
        }
        if (rawPlays.length === 0 && Array.isArray(data.header?.competitions?.[0]?.details) && data.header.competitions[0].details.length > 0) {
            rawPlays = data.header.competitions[0].details.map((p: any, idx: number) => withFallbackShape(p, idx));
        }
        if (rawPlays.length === 0 && commentaryPlays.length > 0) {
            rawPlays = commentaryPlays;
        }

        // Soccer feeds often include sparse keyEvents (without descriptive text) and rich commentary.
        // Prefer commentary in that case so play-by-play and derived box-score events stay populated.
        if (isSoccer && commentaryPlays.length > 0) {
            const keyEventsSparse =
                keyEventPlays.length > 0 &&
                keyEventPlays.every((play: any) => {
                    const text = String(play?.text || '').trim().toLowerCase();
                    const typeText = String(play?.type?.text || '').trim().toLowerCase();
                    return !text || text === 'play' || text === typeText;
                });
            if (rawPlays.length === 0 || keyEventsSparse || commentaryPlays.length >= (keyEventPlays.length * 2)) {
                rawPlays = commentaryPlays;
            }
        }

        // 2. Extract scoring plays with fallback
        let sourceScoringPlays = data.scoringPlays || [];
        if (sourceScoringPlays.length === 0 && isSoccer && keyEventPlays.length > 0) {
            sourceScoringPlays = keyEventPlays.filter((p: any) => {
                const typeText = String(p?.type?.text || '').toLowerCase();
                const text = String(p?.text || '').toLowerCase();
                if (typeText.includes('goal kick')) return false;
                return (
                    !!p?.scoringPlay ||
                    typeText.includes('goal') ||
                    text.includes('goal')
                );
            });
        }
        if (sourceScoringPlays.length === 0 && rawPlays.length > 0) {
            // Fallback: Filter raw plays for scores
            // Fixed: Only include explicit scoring plays or text matches
            sourceScoringPlays = rawPlays.filter((p: any) => {
                const typeText = p.type?.text?.toLowerCase() || '';
                
                // Exclude "Goal Kick" explicitly as it often appears in soccer feeds without score change
                if (typeText.includes('goal kick')) return false;

                const isExplicitScore = p.scoringPlay || 
                    typeText.includes('score') || 
                    typeText.includes('touchdown') || 
                    typeText.includes('goal') || 
                    typeText.includes('safety') ||
                    typeText.includes('homerun');

                return isExplicitScore;
            });
        }
        const isFallback = (data.scoringPlays || []).length === 0 && sourceScoringPlays.length > 0;

        let runningHomeScore = 0;
        let runningAwayScore = 0;
        const scoringPlays: ScoringPlay[] = sourceScoringPlays.map((p: any, idx: number) => {
            const hasExplicitScore = p?.homeScore !== undefined && p?.awayScore !== undefined;
            let homeScore = hasExplicitScore ? extractNumber(p.homeScore) : runningHomeScore;
            let awayScore = hasExplicitScore ? extractNumber(p.awayScore) : runningAwayScore;

            if (!hasExplicitScore && p?.scoringPlay) {
                const points = inferScoreValue(p);
                let scoringTeamId = p?.team?.id;
                if (isSoccer && p?.ownGoal) {
                    scoringTeamId = scoringTeamId === homeComp?.team?.id ? awayComp?.team?.id : homeComp?.team?.id;
                }
                if (scoringTeamId === homeComp?.team?.id) homeScore += points;
                else if (scoringTeamId === awayComp?.team?.id) awayScore += points;
            }

            runningHomeScore = homeScore;
            runningAwayScore = awayScore;

            return {
                id: p.id || `${gameId}-score-${idx}`,
                period: getPlayPeriod(p),
                clock: getPlayClock(p),
                type: getPlayTypeText(p),
                text: getPlayText(p),
                isHome: p.team?.id === homeComp?.team?.id,
                homeScore,
                awayScore,
                teamId: p.team?.id
            };
        });

        // --- HYBRID LINESCORE ENGINE ---
        // 1. Calculate Manual/Shadow Linescores from Scoring Plays (Source of Truth for "What happened")
        const manualLinescores: LineScore[] = [];
        
        // Calculate logic whenever the game is active or finished, even if no scoring plays exist (0-0 game)
        if (statusState !== 'pre' && currentPeriod > 0) {
            const periodsFromPlays = new Set(scoringPlays.map(p => p.period));
            // Ensure we calculate up to the current period reported by the header
            const maxPeriod = Math.max(...Array.from(periodsFromPlays), currentPeriod);
            
            // Sort chronologically: Period ASC, then Total Score ASC
            const sortedSP = [...scoringPlays].sort((a, b) => {
                if (a.period !== b.period) return a.period - b.period;
                return (a.homeScore + a.awayScore) - (b.homeScore + b.awayScore);
            });

            let prevHome = 0;
            let prevAway = 0;

            for (let p = 1; p <= maxPeriod; p++) {
                const playsUpToPeriod = sortedSP.filter(sp => sp.period <= p);
                const lastPlay = playsUpToPeriod[playsUpToPeriod.length - 1];
                
                // If we have no plays at all up to this period, score is 0. 
                // If we have plays, the cumulative score is the score of the latest play.
                const cumHome = lastPlay ? lastPlay.homeScore : 0;
                const cumAway = lastPlay ? lastPlay.awayScore : 0;
                
                manualLinescores.push({
                    period: p,
                    displayValue: String(p),
                    homeScore: String(cumHome - prevHome),
                    awayScore: String(cumAway - prevAway)
                });
                
                // Set baseline for next period
                prevHome = cumHome;
                prevAway = cumAway;
            }
        }

        // 2. Parse API Linescores (Official, but sometimes incomplete)
        let apiLinescores: LineScore[] = [];
        const sourceLinescores = homeComp?.linescores || awayComp?.linescores;
        
        if (sourceLinescores && Array.isArray(sourceLinescores)) {
            apiLinescores = sourceLinescores.map((ls: any) => {
                const period = parseInt(ls.period); 
                const hLs = homeComp?.linescores?.find((h: any) => parseInt(h.period) === period);
                const aLs = awayComp?.linescores?.find((a: any) => parseInt(a.period) === period);
                
                return {
                    period: period,
                    displayValue: ls.displayValue || String(period),
                    homeScore: hLs ? normalizeStat(hLs) : '-',
                    awayScore: aLs ? normalizeStat(aLs) : '-'
                };
            }).filter((ls: LineScore) => !isNaN(ls.period));
        }

        // 3. Merge: Prefer API, fill holes with Manual
        const finalLinescoreMap = new Map<number, LineScore>();
        
        // Populate with manual first (so we have full coverage including 0s)
        manualLinescores.forEach(ls => finalLinescoreMap.set(ls.period, ls));
        
        // Overlay API data
        apiLinescores.forEach(ls => {
            const hasData = ls.homeScore !== '-' && ls.awayScore !== '-';
            if (hasData) {
                // If we are in fallback mode (meaning API didn't provide scoringPlays),
                // we should mistrust the API linescores if they are just 0-0 placeholders while we found actual goals.
                if (isFallback) {
                    const apiTotal = extractNumber(ls.homeScore) + extractNumber(ls.awayScore);
                    // Only overwrite if API actually has data > 0, OR if our manual calc was also 0.
                    // This protects a manual "1-0" from being overwritten by an API "0-0".
                    const manual = finalLinescoreMap.get(ls.period);
                    const manualTotal = manual ? (extractNumber(manual.homeScore) + extractNumber(manual.awayScore)) : 0;
                    
                    if (apiTotal > 0 || manualTotal === 0) {
                        finalLinescoreMap.set(ls.period, ls);
                    }
                } else {
                    // Standard mode: Trust API linescore as authority
                    finalLinescoreMap.set(ls.period, ls);
                }
            }
        });

        // 4. Convert back to array
        const parsedLinescores = Array.from(finalLinescoreMap.values())
            .sort((a, b) => a.period - b.period);
        
        const leaders: TeamGameLeaders[] = (data.leaders || []).map((t: any) => ({
            team: {
                id: t.team.id,
                abbreviation: t.team.abbreviation,
                logo: t.team.logo
            },
            leaders: (t.leaders || []).map((l: any) => ({
                name: l.name,
                displayName: l.displayName,
                shortDisplayName: l.shortDisplayName,
                leaders: (l.leaders || []).map((a: any) => ({
                    id: a.athlete.id,
                    displayName: a.athlete.displayName,
                    headshot: a.athlete.headshot?.href,
                    displayValue: a.displayValue,
                    position: a.athlete.position?.abbreviation,
                    jersey: a.athlete.jersey
                }))
            }))
        }));

        const playerSource = data.boxscore?.players || [];
        const rosterSource = Array.isArray(data.rosters) ? data.rosters : [];
        const competitorRosterSource = competitors
            .filter((comp: any) => Array.isArray(comp?.roster) && comp.roster.length > 0)
            .map((comp: any) => ({
                team: comp.team,
                roster: comp.roster,
            }));
        const resolvedRosterSource = rosterSource.length > 0 ? rosterSource : competitorRosterSource;
        let teamBoxSource = data.boxscore?.teams;
        
        if ((!teamBoxSource || teamBoxSource.length === 0) && data.statistics) {
            teamBoxSource = data.statistics;
        }

        const mapRosterToLineupGroup = (teamRoster: any) => ({
            label: 'Lineup',
            labels: ['Pos', 'Starter'],
            players: (teamRoster.roster || []).map((entry: any, idx: number) => ({
                player: {
                    id: entry.athlete?.id || `${teamRoster.team?.id || 'team'}-${entry.jersey || idx}`,
                    displayName: entry.athlete?.displayName || 'Unknown Player',
                    shortName: entry.athlete?.shortName,
                    jersey: entry.jersey || entry.athlete?.jersey,
                    position: entry.position?.abbreviation || entry.athlete?.position?.abbreviation,
                    headshot: entry.athlete?.headshot?.href,
                    isStarter: !!entry.starter
                },
                stats: [
                    entry.position?.abbreviation || entry.athlete?.position?.abbreviation || '-',
                    entry.starter ? 'Yes' : 'No'
                ]
            }))
        });

        const parseSoccerPlayerName = (text: string): string | null => {
            const normalized = String(text || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return null;

            const byMatch = normalized.match(/\bby\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/);
            if (byMatch?.[1]) return byMatch[1].trim();

            const beforeParen = normalized.split('(')[0] || normalized;
            const sentenceParts = beforeParen
                .split(/[.!?]/)
                .map((part) => part.trim())
                .filter(Boolean);
            const candidateRaw = sentenceParts.length > 0 ? sentenceParts[sentenceParts.length - 1] : beforeParen;
            const cleaned = candidateRaw
                .replace(/^(goal!?|penalty|own goal|yellow card|red card|substitution|foul|shot|save|assisted by)\s*(?:by\s*)?/i, '')
                .replace(/\s+\d{1,3}(?:\+\d{1,2})?'?$/i, '')
                .replace(/,$/, '')
                .trim();

            if (!cleaned) return null;
            if (cleaned.length < 3) return null;
            if (!/[A-Za-z]/.test(cleaned)) return null;
            return cleaned;
        };

        const parseSoccerAssistNames = (text: string): string[] => {
            const normalized = String(text || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return [];
            const assistMatch = normalized.match(/assisted by\s+([^.]*)/i);
            if (!assistMatch?.[1]) return [];
            return assistMatch[1]
                .split(/,| and | & /i)
                .map((chunk) => chunk.replace(/\([^)]*\)/g, '').trim())
                .filter((chunk) => chunk.length >= 3);
        };

        const parseSoccerMinute = (clock: string, text: string): string => {
            const clockText = String(clock || '').trim();
            if (clockText) return clockText.replace(/\s+/g, '');
            const textMatch = String(text || '').match(/(\d{1,3}(?:\+\d{1,2})?)\s*'?/);
            if (!textMatch?.[1]) return '';
            return `${textMatch[1]}'`;
        };

        const isYellowCardEvent = (play: Play): boolean => {
            const source = `${play.type || ''} ${play.text || ''}`.toLowerCase();
            return source.includes('yellow card');
        };

        const isRedCardEvent = (play: Play): boolean => {
            const source = `${play.type || ''} ${play.text || ''}`.toLowerCase();
            return source.includes('red card') || source.includes('second yellow');
        };

        let boxscore: TeamBoxScore[] = [];
        if (playerSource.length > 0) {
            boxscore = (playerSource || []).map((t: any) => ({
                teamId: String(t.team.id),
                teamName: formatTeamName(t.team, sport),
                teamLogo: t.team.logo,
                groups: (t.statistics || []).map((g: any) => ({
                    label: g.name === 'defensive' ? 'Defense' : g.name === 'offensive' ? 'Offense' : g.name || 'Stats',
                    labels: g.labels || (g.names || []),
                    players: (g.athletes || []).map((a: any) => ({
                        player: { 
                            id: a.athlete.id, 
                            displayName: a.athlete.displayName, 
                            shortName: a.athlete.shortName, 
                            jersey: a.athlete.jersey, 
                            position: a.athlete.position?.abbreviation, 
                            headshot: a.athlete.headshot?.href, 
                            isStarter: a.starter 
                        },
                        stats: (a.stats || []).map(normalizeStat)
                    }))
                }))
            }));
        } else if (isSoccer) {
            type SoccerPlayerAccum = {
                teamId: string;
                playerId: string;
                displayName: string;
                goals: number;
                assists: number;
                ownGoals: number;
                yellowCards: number;
                redCards: number;
                minute: string;
            };

            const homeTeamId = String(homeComp?.team?.id || '');
            const awayTeamId = String(awayComp?.team?.id || '');
            const fallbackTeamIds = [awayTeamId, homeTeamId].filter(Boolean);
            const perTeam = new Map<string, Map<string, SoccerPlayerAccum>>();
            const rosterByTeam = new Map<string, any>(
                resolvedRosterSource.map((teamRoster: any) => [String(teamRoster.team?.id || ''), teamRoster]),
            );
            const leaderByTeam = new Map<string, TeamGameLeaders>(
                leaders.map((entry) => [String(entry.team.id || ''), entry]),
            );

            const ensureTeamMap = (teamId: string): Map<string, SoccerPlayerAccum> => {
                if (!perTeam.has(teamId)) perTeam.set(teamId, new Map<string, SoccerPlayerAccum>());
                return perTeam.get(teamId)!;
            };

            const toPlayerKey = (name: string): string =>
                name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'player';

            const upsertPlayer = (teamId: string, playerName: string): SoccerPlayerAccum => {
                const safeTeamId = String(teamId || '');
                const normalizedName = playerName.trim();
                const teamMap = ensureTeamMap(safeTeamId);
                const playerId = `${safeTeamId}-${toPlayerKey(normalizedName)}`;
                const existing = teamMap.get(playerId);
                if (existing) return existing;
                const created: SoccerPlayerAccum = {
                    teamId: safeTeamId,
                    playerId,
                    displayName: normalizedName,
                    goals: 0,
                    assists: 0,
                    ownGoals: 0,
                    yellowCards: 0,
                    redCards: 0,
                    minute: '',
                };
                teamMap.set(playerId, created);
                return created;
            };

            scoringPlays.forEach((play) => {
                const teamId = String(play.teamId || (play.isHome ? homeTeamId : awayTeamId) || '');
                if (!teamId) return;
                const minute = parseSoccerMinute(play.clock, play.text);
                const scorer = parseSoccerPlayerName(play.text);
                const ownGoal = /own goal/i.test(`${play.type || ''} ${play.text || ''}`);
                if (scorer) {
                    const player = upsertPlayer(teamId, scorer);
                    if (ownGoal) player.ownGoals += 1;
                    else player.goals += 1;
                    if (minute) player.minute = minute;
                }
                parseSoccerAssistNames(play.text).forEach((assistName) => {
                    const player = upsertPlayer(teamId, assistName);
                    player.assists += 1;
                    if (minute && !player.minute) player.minute = minute;
                });
            });

            plays.forEach((play) => {
                const teamId = String(play.teamId || '');
                if (!teamId) return;
                const yellow = isYellowCardEvent(play);
                const red = isRedCardEvent(play);
                if (!yellow && !red) return;
                const playerName = parseSoccerPlayerName(play.text);
                if (!playerName) return;
                const player = upsertPlayer(teamId, playerName);
                if (yellow) player.yellowCards += 1;
                if (red) player.redCards += 1;
                const minute = parseSoccerMinute(play.clock, play.text);
                if (minute) player.minute = minute;
            });

            const teamMeta = [awayComp?.team, homeComp?.team]
                .filter(Boolean)
                .map((team: any) => ({
                    id: String(team.id || ''),
                    name: formatTeamName(team, sport),
                    logo: team.logo || team.logos?.[0]?.href,
                }))
                .filter((team) => team.id);

            const normalizedTeams = teamMeta.length > 0
                ? teamMeta
                : fallbackTeamIds.map((teamId) => ({ id: teamId, name: 'Team', logo: undefined }));

            boxscore = normalizedTeams.map((team) => {
                const players = Array.from((perTeam.get(team.id) || new Map()).values());
                const goalRows = players
                    .filter((entry) => entry.goals > 0 || entry.assists > 0 || entry.ownGoals > 0)
                    .sort((a, b) => (b.goals - a.goals) || (b.assists - a.assists) || a.displayName.localeCompare(b.displayName));
                const disciplineRows = players
                    .filter((entry) => entry.yellowCards > 0 || entry.redCards > 0)
                    .sort((a, b) => (b.redCards - a.redCards) || (b.yellowCards - a.yellowCards) || a.displayName.localeCompare(b.displayName));

                const leaderRows = (leaderByTeam.get(team.id)?.leaders || [])
                    .flatMap((category) => (
                        category.leaders.map((leader) => ({
                            category: category.shortDisplayName || category.displayName || category.name,
                            player: leader,
                        }))
                    ));

                const groups: Array<{
                    label: string;
                    labels: string[];
                    players: Array<{
                        player: {
                            id: string;
                            displayName: string;
                            shortName?: string;
                            jersey?: string;
                            position?: string;
                            headshot?: string;
                            isStarter?: boolean;
                        };
                        stats: string[];
                    }>;
                }> = [];

                if (goalRows.length > 0) {
                    groups.push({
                        label: 'Goal Contributions',
                        labels: ['G', 'A', 'OG', 'Min'],
                        players: goalRows.map((entry) => ({
                            player: {
                                id: entry.playerId,
                                displayName: entry.displayName,
                            },
                            stats: [
                                String(entry.goals),
                                String(entry.assists),
                                String(entry.ownGoals),
                                entry.minute || '-',
                            ],
                        })),
                    });
                }

                if (disciplineRows.length > 0) {
                    groups.push({
                        label: 'Discipline',
                        labels: ['YC', 'RC', 'Min'],
                        players: disciplineRows.map((entry) => ({
                            player: {
                                id: entry.playerId,
                                displayName: entry.displayName,
                            },
                            stats: [
                                String(entry.yellowCards),
                                String(entry.redCards),
                                entry.minute || '-',
                            ],
                        })),
                    });
                }

                if (leaderRows.length > 0) {
                    groups.push({
                        label: 'Key Leaders',
                        labels: ['Stat', 'Value'],
                        players: leaderRows.map((entry) => ({
                            player: {
                                id: entry.player.id || `${team.id}-${toPlayerKey(entry.player.displayName)}`,
                                displayName: entry.player.displayName,
                                position: entry.player.position,
                                jersey: entry.player.jersey,
                                headshot: entry.player.headshot,
                            },
                            stats: [
                                entry.category || 'Leader',
                                entry.player.displayValue || '-',
                            ],
                        })),
                    });
                }

                if (groups.length === 0) {
                    const teamRoster = rosterByTeam.get(team.id);
                    if (teamRoster) groups.push(mapRosterToLineupGroup(teamRoster));
                }

                return {
                    teamId: team.id,
                    teamName: team.name,
                    teamLogo: team.logo,
                    groups,
                };
            }).filter((team) => team.groups.some((group) => (group.players || []).length > 0));
        } else if (resolvedRosterSource.length > 0) {
            boxscore = resolvedRosterSource.map((teamRoster: any) => ({
                teamId: String(teamRoster.team?.id || ''),
                teamName: formatTeamName(teamRoster.team, sport),
                teamLogo: teamRoster.team?.logo || teamRoster.team?.logos?.[0]?.href,
                groups: [mapRosterToLineupGroup(teamRoster)]
            }));
        }

        let teamStats: TeamStat[] = [];
        if (teamBoxSource && teamBoxSource.length === 2) {
            const homeTeamId = homeComp?.team?.id ? String(homeComp.team.id) : '';
            const homeData = teamBoxSource.find((t: any) => String(t.team?.id || '') === homeTeamId);
            const awayData = teamBoxSource.find((t: any) => String(t.team?.id || '') !== homeTeamId);
            
            if (homeData && awayData) {
                const getStatsList = (d: any) => {
                    if (d.statistics && Array.isArray(d.statistics)) return d.statistics;
                    return [];
                };

                const homeStatsList = getStatsList(homeData);
                const awayStatsList = getStatsList(awayData);

                if (homeStatsList.length > 0) {
                     teamStats = homeStatsList.map((hStat: any): TeamStat | null => {
                        const aStat = awayStatsList.find((aS: any) => (aS.name === hStat.name) || (aS.label === hStat.label));
                        if (!aStat) return null;
                        return { 
                            label: hStat.label || hStat.name, 
                            homeValue: normalizeStat(hStat), 
                            awayValue: normalizeStat(aStat),
                            homeRank: hStat.rank ? parseInt(hStat.rank) : undefined,
                            awayRank: aStat.rank ? parseInt(aStat.rank) : undefined
                        };
                    }).filter((s): s is TeamStat => s !== null);
                } else {
                    const flattenStats = (teamData: any) => teamData.statistics?.flatMap((group: any) => 
                        (group.stats || [group]).map((s: any) => ({
                            ...s,
                            label: (group.name && group.name !== 'general' && !s.label?.toLowerCase().includes(group.name.toLowerCase()) && !group.name.includes('general')) 
                                ? `${group.label || group.name} ${s.label}` 
                                : s.label
                        }))
                    ) || [];

                    const hList = flattenStats(homeData);
                    const aList = flattenStats(awayData);
                    
                    teamStats = hList.map((hStat: any): TeamStat | null => {
                        const aStat = aList.find((aS: any) => 
                            aS.name === hStat.name || 
                            aS.label === hStat.label ||
                            (aS.label && hStat.label && normalizeGroupedLabel(aS.label) === normalizeGroupedLabel(hStat.label))
                        );
                        if (!aStat) return null;
                        return { 
                            label: hStat.label || hStat.name, 
                            homeValue: normalizeStat(hStat), 
                            awayValue: normalizeStat(aStat),
                            homeRank: hStat.rank ? parseInt(hStat.rank) : undefined,
                            awayRank: aStat.rank ? parseInt(aStat.rank) : undefined
                        };
                    }).filter((s): s is TeamStat => s !== null);
                }
            }
        }

        let seasonStats: TeamStat[] | undefined;
        
        const seasonType = data.header?.competitions?.[0]?.season?.type;
        const seasonYear = data.header?.competitions?.[0]?.season?.year;
        const isPostseason = seasonType === 3;
        const homeId = homeComp?.team?.id;
        const awayId = awayComp?.team?.id;
        
        if (homeId && awayId) {
            try {
                // Always pull regular-season baseline for matchup modeling.
                // For current season this resolves from internal snapshot first.
                let [hBaseline, aBaseline] = await Promise.all([
                    fetchTeamSeasonStats(sport, homeId, 2),
                    fetchTeamSeasonStats(sport, awayId, 2),
                ]);

                if (isPostseason && (sport === 'NFL' || sport === 'NCAAF' || sport === 'NBA' || sport === 'NHL' || sport === 'WNBA' || sport === 'MLB')) {
                    const [hPost, aPost] = await Promise.all([
                        fetchTeamSeasonStats(sport, homeId, 3, seasonYear),
                        fetchTeamSeasonStats(sport, awayId, 3, seasonYear),
                    ]);

                    let defaultGP = 1;
                    if (sport === 'NFL') defaultGP = 17;
                    else if (sport === 'NBA' || sport === 'NHL') defaultGP = 82;
                    else if (sport === 'MLB') defaultGP = 162;
                    else if (sport === 'WNBA') defaultGP = 40;
                    else if (sport.startsWith('NCAA')) defaultGP = 12;

                    hBaseline = mergeSeasonStats(hBaseline, hPost, defaultGP);
                    aBaseline = mergeSeasonStats(aBaseline, aPost, defaultGP);
                }

                if (hBaseline.length > 0 && aBaseline.length > 0) {
                    const homeByLabel = new Map<string, TeamStatItem>();
                    const awayByLabel = new Map<string, TeamStatItem>();
                    const orderedLabels: string[] = [];
                    const seen = new Set<string>();

                    hBaseline.forEach((stat) => {
                        const key = stat.label.toLowerCase();
                        if (!homeByLabel.has(key)) homeByLabel.set(key, stat);
                        if (!seen.has(key)) {
                            seen.add(key);
                            orderedLabels.push(stat.label);
                        }
                    });

                    aBaseline.forEach((stat) => {
                        const key = stat.label.toLowerCase();
                        if (!awayByLabel.has(key)) awayByLabel.set(key, stat);
                        if (!seen.has(key)) {
                            seen.add(key);
                            orderedLabels.push(stat.label);
                        }
                    });

                    seasonStats = orderedLabels.map((label) => {
                        const key = label.toLowerCase();
                        const homeStat = homeByLabel.get(key);
                        const awayStat = awayByLabel.get(key);
                        return {
                            label: homeStat?.label || awayStat?.label || label,
                            homeValue: homeStat?.value || '0',
                            awayValue: awayStat?.value || '0',
                            homeRank: homeStat?.rank,
                            awayRank: awayStat?.rank,
                        };
                    });
                }
            } catch (e) {
                console.warn("Failed to fetch season stats for prediction baseline", e);
            }
        }

        let runningPlayHomeScore = 0;
        let runningPlayAwayScore = 0;
        const plays: Play[] = rawPlays.map((p: any, idx: number) => {
            const hasExplicitScore = p?.homeScore !== undefined && p?.awayScore !== undefined;
            let homeScore = hasExplicitScore ? extractNumber(p.homeScore) : runningPlayHomeScore;
            let awayScore = hasExplicitScore ? extractNumber(p.awayScore) : runningPlayAwayScore;

            if (!hasExplicitScore && p?.scoringPlay) {
                const points = inferScoreValue(p);
                let scoringTeamId = p?.team?.id;
                if (isSoccer && p?.ownGoal) {
                    scoringTeamId = scoringTeamId === homeComp?.team?.id ? awayComp?.team?.id : homeComp?.team?.id;
                }
                if (scoringTeamId === homeComp?.team?.id) homeScore += points;
                else if (scoringTeamId === awayComp?.team?.id) awayScore += points;
            }

            runningPlayHomeScore = homeScore;
            runningPlayAwayScore = awayScore;

            return {
                id: p.id || `${gameId}-raw-${idx}`,
                period: getPlayPeriod(p),
                clock: getPlayClock(p),
                type: getPlayTypeText(p),
                text: getPlayText(p),
                scoringPlay: !!p.scoringPlay,
                homeScore,
                awayScore,
                teamId: p.team?.id,
                wallclock: p.wallclock,
                down: p.start?.down,
                distance: p.start?.distance,
                yardLine: p.start?.yardLine,
                downDistanceText: p.start?.downDistanceText
            };
        });

        let situation: GameSituation | undefined;
        if (data.situation) {
            if (sport === 'NFL' || sport === 'NCAAF') {
                situation = { down: data.situation.down, distance: data.situation.distance, yardLine: data.situation.yardLine, possession: data.situation.possession ? String(data.situation.possession) : undefined, isRedZone: data.situation.isRedZone, possessionText: data.situation.possessionText, downDistanceText: data.situation.downDistanceText, homeTimeouts: homeComp?.timeoutsLeft, awayTimeouts: awayComp?.timeoutsLeft };
            } else if (sport === 'MLB') {
                 situation = { balls: data.situation.balls, strikes: data.situation.strikes, outs: data.situation.outs, onFirst: !!data.situation.onFirst, onSecond: !!data.situation.onSecond, onThird: !!data.situation.onThird, batter: data.situation.batter?.athlete?.displayName, pitcher: data.situation.pitcher?.athlete?.displayName };
            }
        }

        return {
            gameId, linescores: parsedLinescores, stats: teamStats, seasonStats, scoringPlays, plays, leaders,
            gameInfo: { weather: data.gameInfo?.weather?.displayValue, venue: data.gameInfo?.venue?.fullName, attendance: data.gameInfo?.attendance },
            injuries: (data.injuries || []).flatMap((t: any) =>
                (t.injuries || []).map((i: any) => ({
                    athlete: {
                        id: i.athlete.id,
                        displayName: i.athlete.displayName,
                        position: i.athlete.position?.abbreviation,
                    },
                    status: toInjuryStatus(i.status),
                    teamId: t.team.id,
                })),
            ),
            boxscore,
            situation,
            clock: data.header?.competitions?.[0]?.status?.displayClock,
            period: data.header?.competitions?.[0]?.status?.period,
            homeScore: resolveCompetitorScore(homeComp),
            awayScore: resolveCompetitorScore(awayComp),
            odds: data.pickcenter?.[0] ? { spread: data.pickcenter[0].details, overUnder: data.pickcenter[0].overUnder ? `O/U ${data.pickcenter[0].overUnder}` : undefined, moneyLineAway: data.pickcenter[0].awayTeamOdds?.moneyLine !== undefined ? String(data.pickcenter[0].awayTeamOdds.moneyLine) : undefined, moneyLineHome: data.pickcenter[0].homeTeamOdds?.moneyLine !== undefined ? String(data.pickcenter[0].homeTeamOdds.moneyLine) : undefined, provider: data.pickcenter[0].provider?.name } : undefined
        };
    } catch { return null; }
};

const normalizeGroupedLabel = (label: string): string => {
    return label
        .toLowerCase()
        // Remove common group prefixes like "Offense: " or "General - "
        .replace(/^[^:|-]+[:|-]\s*/, '')
        .trim();
};

// Robust Merger: Always produces Average per Game for Volume Stats
const mergeSeasonStats = (reg: TeamStatItem[], post: TeamStatItem[], defaultRegGP: number = 1): TeamStatItem[] => {
    const getVal = (items: TeamStatItem[], label: string) => {
        const item = items.find(i => i.label.toLowerCase() === label.toLowerCase());
        return item ? parseFloat(item.value.replace(/,/g, '').replace('%', '')) : 0;
    };

    const shouldSumAcrossSeasons = (label: string): boolean => {
        const l = label.toLowerCase();
        return (
            l.includes('win') ||
            l.includes('loss') ||
            l.includes('tie') ||
            l === 'games' ||
            l === 'games played'
        );
    };

    // 1. Calculate Grand Total GP
    let gpReg = getVal(reg, 'games played') || getVal(reg, 'games') || defaultRegGP;
    if (gpReg === 0 && reg.length > 0) gpReg = defaultRegGP;

    let gpPost = getVal(post, 'games played') || getVal(post, 'games');
    if (gpPost === 0 && post.length > 0) gpPost = 1;

    const totalGP = gpReg + gpPost;
    
    // If no postseason data, just return regular season
    if (gpPost === 0) return reg;

    const merged: TeamStatItem[] = [];

    reg.forEach(rItem => {
        const pItem = post.find(p => p.label === rItem.label);
        const labelLower = rItem.label.toLowerCase();
        
        const vReg = parseFloat(rItem.value.replace(/,/g, '').replace('%', ''));
        if (isNaN(vReg)) {
            merged.push(rItem);
            return;
        }
        let newVal = vReg;
        
        if (!pItem) {
            newVal = vReg;
        } else {
            const vPost = parseFloat(pItem.value.replace(/,/g, '').replace('%', ''));
            
            if (isNaN(vReg) || isNaN(vPost)) {
                merged.push(rItem);
                return;
            }

            if (labelLower.includes('rank')) {
                newVal = vReg;
            } else if (shouldSumAcrossSeasons(labelLower)) {
                newVal = vReg + vPost;
            } else {
                // Keep season stats as GP-weighted per-game values.
                newVal = totalGP > 0 ? ((vReg * gpReg) + (vPost * gpPost)) / totalGP : vReg;
            }
        }

        const isPct = rItem.value.includes('%') || labelLower.includes('pct') || labelLower.includes('%');
        let valStr = '';
        
        if (isPct) {
            valStr = newVal.toFixed(1) + '%';
        } else if (shouldSumAcrossSeasons(labelLower)) {
            valStr = Math.round(newVal).toString();
        } else {
            valStr = newVal.toFixed(1);
        }

        merged.push({
            label: rItem.label,
            value: valStr,
            rank: rItem.rank
        });
    });

    return merged;
};
