


import { Game, Sport } from "../types";
import { formatTeamName, normalizeStat, extractNumber } from "./utils";

const RACING_SPORTS = new Set<Sport>(["NASCAR", "INDYCAR", "F1"]);

const normalizeColor = (color: string): string | undefined => {
    if (!color) return undefined;
    return color.startsWith('#') ? color : `#${color}`;
};

const coerceRacingCompetitors = (competition: any): any[] => {
    const competitors = Array.isArray(competition?.competitors) ? [...competition.competitors] : [];
    if (competitors.length === 0) return competitors;

    const rankValue = (competitor: any): number => {
        const order = extractNumber(competitor?.order);
        if (order > 0) return order;
        const curated = extractNumber(competitor?.curatedRank?.current);
        if (curated > 0) return curated;
        const score = extractNumber(competitor?.score);
        if (score > 0) return score;
        return Number.MAX_SAFE_INTEGER;
    };

    return competitors.sort((a, b) => rankValue(a) - rankValue(b));
};

const toRacingName = (competitor: any): string => {
    if (!competitor) return "TBD";
    if (competitor?.athlete?.displayName) return String(competitor.athlete.displayName);
    if (competitor?.athlete?.name) return String(competitor.athlete.name);
    if (competitor?.team) return formatTeamName(competitor.team, "NASCAR");
    return "TBD";
};

const toRacingAbbreviation = (competitor: any): string | undefined => {
    const fromAthlete = String(
        competitor?.athlete?.abbreviation ||
        competitor?.athlete?.shortName ||
        "",
    ).trim();
    if (fromAthlete) {
        const cleaned = fromAthlete.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (cleaned.length >= 2) return cleaned.slice(0, 4);
    }
    const display = toRacingName(competitor);
    const words = display.split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return `${words[0][0] || ""}${words[words.length - 1][0] || ""}${words[words.length - 1][1] || ""}`.toUpperCase();
};

const toRacingScore = (competitor: any, state?: string): string | undefined => {
    const normalized = normalizeStat(competitor?.score);
    if (normalized && normalized !== "-") return normalized;
    if (state === "in" || state === "post") {
        const order = Math.trunc(extractNumber(competitor?.order));
        if (Number.isFinite(order) && order > 0) return String(order);
    }
    return undefined;
};

const toRacingVehicleNumber = (competitor: any): string | undefined => {
    const candidates = [
        competitor?.vehicle?.number,
        competitor?.athlete?.displayNumber,
        competitor?.athlete?.jersey,
        competitor?.number,
    ];
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (value) return value;
    }
    return undefined;
};

const inferRacingSessionType = (competition: any): Game["racingSessionType"] => {
    const text = String(
        competition?.type?.text ||
        competition?.type?.abbreviation ||
        competition?.name ||
        "",
    ).toLowerCase();
    if (text.includes("race")) return "race";
    if (text.includes("qualifying") || text.includes("shootout")) return "qualifying";
    if (text.includes("practice") || text.startsWith("fp") || text.includes("warmup")) return "practice";
    return "other";
};

const toPositiveInt = (value: unknown): number | undefined => {
    const parsed = Math.trunc(extractNumber(value));
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
};

const parseLapFromText = (value: unknown): { currentLap?: number; totalLaps?: number } => {
    const text = String(value || '').trim();
    if (!text) return {};

    const fullMatch = text.match(/lap(?:s)?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i)
        || text.match(/(\d+)\s*(?:\/|of)\s*(\d+)\s*laps?/i);
    if (fullMatch) {
        return {
            currentLap: toPositiveInt(fullMatch[1]),
            totalLaps: toPositiveInt(fullMatch[2]),
        };
    }

    const partialMatch = text.match(/lap(?:s)?\s*(\d+)/i);
    if (partialMatch) {
        return {
            currentLap: toPositiveInt(partialMatch[1]),
        };
    }

    return {};
};

const parseStageFromText = (value: unknown): { stage?: number; totalStages?: number } => {
    const text = String(value || '').trim();
    if (!text) return {};

    const fullMatch = text.match(/stage\s*(\d+)\s*(?:\/|of)\s*(\d+)/i);
    if (fullMatch) {
        return {
            stage: toPositiveInt(fullMatch[1]),
            totalStages: toPositiveInt(fullMatch[2]),
        };
    }

    const partialMatch = text.match(/stage\s*(\d+)/i);
    if (partialMatch) {
        return {
            stage: toPositiveInt(partialMatch[1]),
        };
    }

    return {};
};

const parseRacingProgressMeta = (
    event: any,
    competition: any,
    sport: Sport,
    statusDetail: string,
    statusClock: string,
): { currentLap?: number; totalLaps?: number; stage?: number; totalStages?: number } => {
    const textCandidates: string[] = [
        statusDetail,
        statusClock,
        competition?.status?.displayClock,
        event?.status?.displayClock,
        competition?.status?.type?.detail,
        competition?.status?.type?.description,
        event?.status?.type?.detail,
        event?.status?.type?.description,
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

    let currentLap = toPositiveInt(
        competition?.status?.currentLap
        ?? competition?.currentLap
        ?? competition?.lap
        ?? competition?.lapsCompleted
        ?? competition?.completedLaps,
    );

    const competitorLaps = (Array.isArray(competition?.competitors) ? competition.competitors : [])
        .map((competitor: any) => (
            toPositiveInt(
                competitor?.lapsCompleted
                ?? competitor?.completedLaps
                ?? competitor?.lap
                ?? competitor?.laps,
            )
        ))
        .filter((value): value is number => Boolean(value && value > 0));

    if (!currentLap && competitorLaps.length > 0) {
        currentLap = Math.max(...competitorLaps);
    }

    let totalLaps = toPositiveInt(
        competition?.status?.totalLaps
        ?? competition?.totalLaps
        ?? competition?.laps
        ?? competition?.numberOfLaps
        ?? event?.totalLaps
        ?? event?.laps,
    );

    textCandidates.forEach((text) => {
        const parsed = parseLapFromText(text);
        if (!currentLap && parsed.currentLap) currentLap = parsed.currentLap;
        if (!totalLaps && parsed.totalLaps) totalLaps = parsed.totalLaps;
    });

    let stage: number | undefined;
    let totalStages: number | undefined;
    if (sport === 'NASCAR') {
        stage = toPositiveInt(
            competition?.status?.stage
            ?? competition?.stage
            ?? competition?.status?.period
            ?? event?.status?.period,
        );
        totalStages = toPositiveInt(
            competition?.totalStages
            ?? competition?.numberOfStages
            ?? event?.totalStages
            ?? event?.numberOfStages,
        );

        textCandidates.forEach((text) => {
            const parsed = parseStageFromText(text);
            if (!stage && parsed.stage) stage = parsed.stage;
            if (!totalStages && parsed.totalStages) totalStages = parsed.totalStages;
        });

        if (stage && stage > 12) stage = undefined;
        if (totalStages && totalStages > 12) totalStages = undefined;
    }

    return {
        currentLap,
        totalLaps,
        stage,
        totalStages,
    };
};

const firstText = (...candidates: unknown[]): string | undefined => {
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (value) return value;
    }
    return undefined;
};

const toRacingVenueAndLocation = (
    event: any,
    competition: any,
): { venueName?: string; location?: string } => {
    const venueName = firstText(
        event?.circuit?.fullName,
        event?.circuit?.displayName,
        event?.circuit?.name,
        competition?.circuit?.fullName,
        competition?.circuit?.displayName,
        competition?.circuit?.name,
        competition?.venue?.fullName,
        event?.venues?.[0]?.fullName,
        event?.venue?.fullName,
    );

    const city = firstText(
        event?.circuit?.address?.city,
        competition?.circuit?.address?.city,
        competition?.venue?.address?.city,
        event?.venues?.[0]?.address?.city,
    );
    const region = firstText(
        event?.circuit?.address?.state,
        event?.circuit?.address?.country,
        competition?.circuit?.address?.state,
        competition?.circuit?.address?.country,
        competition?.venue?.address?.state,
        competition?.venue?.address?.country,
        event?.venues?.[0]?.address?.state,
        event?.venues?.[0]?.address?.country,
    );
    const location = city ? (region ? `${city}, ${region}` : city) : region;
    return { venueName, location };
};

export const mapEventToGame = (event: any, sport: Sport, leagueLogo?: string): Game => {
    const competition = event.competitions?.[0];
    const eventStatusState = String(event.status?.type?.state || '').toLowerCase();
    const competitionStatusState = String(competition?.status?.type?.state || '').toLowerCase();
    const statusState = competitionStatusState || eventStatusState;
    const isRacing = RACING_SPORTS.has(sport);
    const racingSessionType = isRacing ? inferRacingSessionType(competition) : undefined;
    const racingSessionName = isRacing
        ? String(competition?.type?.text || competition?.name || event.shortName || "").trim()
        : "";
    const competitionStatusDetail = String(
        competition?.status?.type?.detail ||
        competition?.status?.type?.description ||
        "",
    ).trim();
    const eventStatusDetail = String(event.status?.type?.detail || "").trim();
    const baseStatusDetail = competitionStatusDetail || eventStatusDetail;
    const racingStatusDetail = isRacing
        ? (() => {
            if (!racingSessionName) return baseStatusDetail;
            if (!baseStatusDetail) return racingSessionName;
            if (baseStatusDetail.toLowerCase().includes(racingSessionName.toLowerCase())) return baseStatusDetail;
            return `${racingSessionName} - ${baseStatusDetail}`;
        })()
        : baseStatusDetail;
    const racingProgress = isRacing
        ? parseRacingProgressMeta(
            event,
            competition,
            sport,
            racingStatusDetail,
            String(competition?.status?.displayClock || event?.status?.displayClock || ''),
        )
        : {};

    let homeComp = competition?.competitors?.find((c: any) => c.homeAway === 'home');
    let awayComp = competition?.competitors?.find((c: any) => c.homeAway === 'away');
    if ((!homeComp || !awayComp) && isRacing) {
        const ranked = coerceRacingCompetitors(competition);
        homeComp = homeComp || ranked[0];
        awayComp = awayComp || ranked[1] || ranked[0];
    }
    const rawSeasonType = event.season?.type;
    const parsedSeasonType = typeof rawSeasonType === 'number'
        ? rawSeasonType
        : Number(rawSeasonType?.type ?? rawSeasonType?.id ?? rawSeasonType?.value);
    const seasonType = Number.isFinite(parsedSeasonType) ? parsedSeasonType : undefined;
    
    const homeRank = extractNumber(homeComp?.curatedRank?.current);
    const awayRank = extractNumber(awayComp?.curatedRank?.current);

    const headline = competition?.notes?.[0]?.headline;
    const isPostseason = seasonType === 3;
    const isPreseason = seasonType === 1;
    let context = undefined;

    if (isPostseason) {
        if (headline) {
            context = headline;
        } else if (event.status?.type?.detail && !event.status.type.detail.includes(':') && event.status.type.detail !== 'Final') {
            // Fallback to detail if it looks like a title (not clock or Final)
            context = event.status.type.detail;
        } else {
            context = 'Playoffs';
        }
    } else if (isPreseason) {
        const weekText = event.week?.text;
        if (typeof weekText === 'string' && weekText.toLowerCase().includes('preseason')) {
            context = weekText;
        } else {
            context = 'Preseason';
        }
    }

    // Extract Venue Info
    const venue = competition?.venue;
    const racingVenue = isRacing ? toRacingVenueAndLocation(event, competition) : null;
    const venueName = isRacing ? racingVenue?.venueName : venue?.fullName;
    const city = venue?.address?.city;
    const state = venue?.address?.state;
    const location = isRacing
        ? racingVenue?.location
        : (city ? (state ? `${city}, ${state}` : city) : undefined);

    const homeName = isRacing ? toRacingName(homeComp) : formatTeamName(homeComp?.team, sport);
    const awayName = isRacing ? toRacingName(awayComp) : formatTeamName(awayComp?.team, sport);
    const homeId = isRacing ? String(homeComp?.athlete?.id || homeComp?.team?.id || '') : homeComp?.team?.id;
    const awayId = isRacing ? String(awayComp?.athlete?.id || awayComp?.team?.id || '') : awayComp?.team?.id;
    const homeLogo = isRacing
        ? homeComp?.athlete?.flag?.href || homeComp?.athlete?.headshot?.href || homeComp?.team?.logo || homeComp?.team?.logos?.[0]?.href
        : homeComp?.team?.logo || homeComp?.team?.logos?.[0]?.href;
    const awayLogo = isRacing
        ? awayComp?.athlete?.flag?.href || awayComp?.athlete?.headshot?.href || awayComp?.team?.logo || awayComp?.team?.logos?.[0]?.href
        : awayComp?.team?.logo || awayComp?.team?.logos?.[0]?.href;
    const homeAbbreviation = isRacing ? toRacingAbbreviation(homeComp) : homeComp?.team?.abbreviation;
    const awayAbbreviation = isRacing ? toRacingAbbreviation(awayComp) : awayComp?.team?.abbreviation;
    const homeScore = isRacing ? toRacingScore(homeComp, statusState) : normalizeStat(homeComp?.score);
    const awayScore = isRacing ? toRacingScore(awayComp, statusState) : normalizeStat(awayComp?.score);
    const racingOrderSnapshot = isRacing
        ? coerceRacingCompetitors(competition)
            .slice(0, 5)
            .map((competitor: any) => ({
                competitorId: String(competitor?.athlete?.id || competitor?.id || ""),
                name: toRacingName(competitor),
                abbreviation: toRacingAbbreviation(competitor),
                logo: competitor?.athlete?.flag?.href ||
                    competitor?.athlete?.headshot?.href ||
                    competitor?.team?.logo ||
                    competitor?.team?.logos?.[0]?.href,
                vehicleNumber: toRacingVehicleNumber(competitor),
                position: (() => {
                    const order = Math.trunc(extractNumber(competitor?.order));
                    if (Number.isFinite(order) && order > 0) return order;
                    const place = Math.trunc(extractNumber(competitor?.place));
                    if (Number.isFinite(place) && place > 0) return place;
                    return undefined;
                })(),
                statusText: String(competitor?.status?.type?.description || "").trim() || undefined,
            }))
            .filter((row) => row.name)
        : undefined;

    return {
        id: event.id,
        homeTeam: homeName,
        homeTeamAbbreviation: homeAbbreviation,
        homeTeamId: homeId,
        homeTeamLogo: homeLogo,
        homeTeamRank: (homeRank > 0 && homeRank !== 99) ? homeRank : undefined,
        homeTeamColor: normalizeColor(homeComp?.team?.color),
        homeTeamAlternateColor: normalizeColor(homeComp?.team?.alternateColor),
        homeScore,
        
        awayTeam: awayName,
        awayTeamAbbreviation: awayAbbreviation,
        awayTeamId: awayId,
        awayTeamLogo: awayLogo,
        awayTeamRank: (awayRank > 0 && awayRank !== 99) ? awayRank : undefined,
        awayTeamColor: normalizeColor(awayComp?.team?.color),
        awayTeamAlternateColor: normalizeColor(awayComp?.team?.alternateColor),
        awayScore,
        
        date: new Date(event.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        time: new Date(event.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        dateTime: event.date,
        league: sport,
        leagueName: event.league?.name,
        leagueLogo: leagueLogo,
        context: context || (isRacing ? (competition?.type?.text || event.name || competition?.name) : undefined),
        gameStatus: isRacing ? racingStatusDetail : event.status?.type?.detail,
        status: statusState === 'in' ? 'in_progress' : statusState === 'post' ? 'finished' : 'scheduled',
        clock: isRacing
            ? (competition?.status?.displayClock || event.status?.displayClock)
            : event.status?.displayClock,
        period: event.status?.period,
        isPlayoff: isPostseason,
        seriesSummary: competition?.series?.summary,
        broadcast: competition?.broadcasts?.[0]?.names?.[0],
        
        venue: venueName,
        location: location,
        weather: event.weather?.displayValue,
        temperature: event.weather?.temperature ? `${event.weather.temperature}°` : undefined,
        seasonYear: event.season?.year,
        seasonType: seasonType,
        racingSessionType,
        racingCurrentLap: racingProgress.currentLap,
        racingTotalLaps: racingProgress.totalLaps,
        racingStage: racingProgress.stage,
        racingTotalStages: racingProgress.totalStages,
        racingOrderSnapshot,
        
        situation: sport === 'NFL' || sport === 'NCAAF' ? (event.competitions?.[0]?.situation ? {
             down: event.competitions[0].situation.down,
             distance: event.competitions[0].situation.distance,
             yardLine: event.competitions[0].situation.yardLine,
             possession: event.competitions[0].situation.possession ? String(event.competitions[0].situation.possession) : undefined,
             isRedZone: event.competitions[0].situation.isRedZone,
             possessionText: event.competitions[0].situation.possessionText,
             downDistanceText: event.competitions[0].situation.downDistanceText,
             homeTimeouts: homeComp?.timeoutsLeft,
             awayTimeouts: awayComp?.timeoutsLeft
        } : undefined) : sport === 'MLB' ? (event.competitions?.[0]?.situation ? {
             balls: event.competitions[0].situation.balls,
             strikes: event.competitions[0].situation.strikes,
             outs: event.competitions[0].situation.outs,
             onFirst: !!event.competitions[0].situation.onFirst,
             onSecond: !!event.competitions[0].situation.onSecond,
             onThird: !!event.competitions[0].situation.onThird,
             batter: event.competitions[0].situation.batter?.athlete?.displayName,
             pitcher: event.competitions[0].situation.pitcher?.athlete?.displayName
        } : undefined) : undefined,

        odds: competition?.odds?.[0] ? {
            spread: competition.odds[0].details,
            overUnder: competition.odds[0].overUnder ? `O/U ${competition.odds[0].overUnder}` : undefined,
            moneyLineAway: competition.odds[0].awayTeamOdds?.moneyLine !== undefined ? String(competition.odds[0].awayTeamOdds.moneyLine) : undefined,
            moneyLineHome: competition.odds[0].homeTeamOdds?.moneyLine !== undefined ? String(competition.odds[0].homeTeamOdds.moneyLine) : undefined,
            provider: competition.odds[0].provider?.name
        } : undefined
    };
};
