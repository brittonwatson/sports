
import { Sport, PlayerProfile } from "../types";
import { ESPN_ENDPOINTS } from "./constants";
import { fetchWithRetry, normalizeStat } from "./utils";

export const fetchPlayerProfile = async (sport: Sport, playerId: string): Promise<PlayerProfile | null> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/common/v3/sports/${endpoint}/athletes/${playerId}`;
    try {
        const response = await fetchWithRetry(baseUrl);
        if (!response.ok) return null;
        const data = await response.json();
        const ath = data.athlete;
        return {
            id: ath.id, name: ath.displayName, team: ath.team?.displayName, position: ath.position?.displayName, jersey: ath.jersey, headshot: ath.headshot?.href, height: ath.displayHeight, weight: ath.displayWeight, age: ath.age, birthPlace: ath.birthPlace?.city ? `${ath.birthPlace.city}, ${ath.birthPlace.state || ath.birthPlace.country}` : undefined,
            stats: ath.statsSummary?.statistics ? [{ title: 'Season Stats', data: ath.statsSummary.statistics.map((s: any) => ({ label: s.displayName, value: normalizeStat(s) })) }] : []
        };
    } catch { return null; }
};
