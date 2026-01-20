


import { Game, Sport } from "../types";
import { formatTeamName, normalizeStat, extractNumber } from "./utils";

export const mapEventToGame = (event: any, sport: Sport, leagueLogo?: string): Game => {
    const competition = event.competitions?.[0];
    const homeComp = competition?.competitors?.find((c: any) => c.homeAway === 'home');
    const awayComp = competition?.competitors?.find((c: any) => c.homeAway === 'away');
    
    const homeRank = extractNumber(homeComp?.curatedRank?.current);
    const awayRank = extractNumber(awayComp?.curatedRank?.current);

    const headline = competition?.notes?.[0]?.headline;
    const isPostseason = event.season?.type === 3;
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
    }

    const sanitizeColor = (color: string) => {
        if (!color) return undefined;
        return color.startsWith('#') ? color : `#${color}`;
    };

    // Extract Venue Info
    const venue = competition?.venue;
    const venueName = venue?.fullName;
    const city = venue?.address?.city;
    const state = venue?.address?.state;
    const location = city ? (state ? `${city}, ${state}` : city) : undefined;

    return {
        id: event.id,
        homeTeam: formatTeamName(homeComp?.team, sport),
        homeTeamId: homeComp?.team?.id,
        homeTeamLogo: homeComp?.team?.logo || homeComp?.team?.logos?.[0]?.href,
        homeTeamRank: (homeRank > 0 && homeRank !== 99) ? homeRank : undefined,
        homeTeamColor: sanitizeColor(homeComp?.team?.color),
        homeTeamAlternateColor: sanitizeColor(homeComp?.team?.alternateColor),
        homeScore: normalizeStat(homeComp?.score),
        
        awayTeam: formatTeamName(awayComp?.team, sport),
        awayTeamId: awayComp?.team?.id,
        awayTeamLogo: awayComp?.team?.logo || awayComp?.team?.logos?.[0]?.href,
        awayTeamRank: (awayRank > 0 && awayRank !== 99) ? awayRank : undefined,
        awayTeamColor: sanitizeColor(awayComp?.team?.color),
        awayTeamAlternateColor: sanitizeColor(awayComp?.team?.alternateColor),
        awayScore: normalizeStat(awayComp?.score),
        
        date: new Date(event.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        time: new Date(event.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        dateTime: event.date,
        league: sport,
        leagueName: event.league?.name,
        leagueLogo: leagueLogo,
        context: context,
        gameStatus: event.status?.type?.detail,
        status: event.status?.type?.state === 'in' ? 'in_progress' : event.status?.type?.state === 'post' ? 'finished' : 'scheduled',
        clock: event.status?.displayClock,
        period: event.status?.period,
        isPlayoff: isPostseason,
        seriesSummary: competition?.series?.summary,
        broadcast: competition?.broadcasts?.[0]?.names?.[0],
        
        venue: venueName,
        location: location,
        weather: event.weather?.displayValue,
        temperature: event.weather?.temperature ? `${event.weather.temperature}°` : undefined,
        
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