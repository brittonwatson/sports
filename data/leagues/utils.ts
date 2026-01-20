
import { Sport, TeamOption } from '../../types';

// Helper to construct ESPN logo URLs
export const getLogo = (league: string, abbr: string, id: string, isSoccer = false) => {
    if (isSoccer) return `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
    const path = league.toLowerCase().replace('ncaaf', 'ncaa').replace('ncaam', 'ncaa').replace('ncaaw', 'ncaa');
    return `https://a.espncdn.com/i/teamlogos/${path}/500/${abbr.toLowerCase()}.png`;
};

// Helper to create team objects (updated to accept ID directly)
export const t = (league: Sport, name: string, abbr: string, id: string, isSoccer = false): TeamOption => ({
    id: id,
    name,
    league,
    logo: getLogo(league, abbr, id, isSoccer)
});
