
import { Game, Sport } from "../types";
import { CITY_OVERRIDES } from "../data/teams";
import { ESPN_ENDPOINTS } from "./constants";

export const fetchWithRetry = async (url: string, retries = 3, delay = 1000): Promise<Response> => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response;
      if (response.status === 429) { 
         await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
         continue;
      }
      if (response.status < 500 && response.status !== 429) return response;
    } catch (error) {
      if (i === retries - 1) throw error;
    }
    await new Promise(res => setTimeout(res, delay));
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
};

export const normalizeStat = (val: any): string => {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'object') {
        if (val.displayValue) return String(val.displayValue);
        if (val.value !== undefined) return String(val.value);
        return '-';
    }
    return String(val);
};

export const extractNumber = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val) || 0;
    if (typeof val === 'object') {
        // Prioritize value, fallback to displayValue
        if (val.value !== undefined) return parseFloat(val.value) || 0;
        if (val.displayValue !== undefined) return parseFloat(val.displayValue) || 0;
    }
    return 0;
};

export const formatEspnDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
};

export const getUpcomingDateRange = (sport: Sport, fullHistory: boolean): string => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    const isRacing = sport === 'NASCAR' || sport === 'INDYCAR' || sport === 'F1';

    if (fullHistory) {
        if (isRacing) {
            start.setDate(now.getDate() - 45);
            end.setDate(now.getDate() + 45);
        } else {
            start.setDate(now.getDate() - 14);
            end.setDate(now.getDate() + 7);
        }
    } else {
        if (isRacing) {
            // Racing weekends span multiple sessions and series can have wider gaps.
            start.setDate(now.getDate() - 7);
            end.setDate(now.getDate() + 21);
        } else {
            start.setDate(now.getDate() - 1);
            end.setDate(now.getDate() + 6);
        }
    }

    return `${formatEspnDate(start)}-${formatEspnDate(end)}`;
};

export const formatTeamName = (team: any, sport: Sport): string => {
    if (!team) return 'Unknown Team';
    
    // For NCAA, prioritize Location (School Name)
    if (['NCAAF', 'NCAAM', 'NCAAW'].includes(sport)) {
        return team.location || team.shortDisplayName || team.displayName || '';
    }

    // For Major Pro Leagues, use Team Name (Mascot)
    if (['NFL', 'NBA', 'NHL', 'MLB', 'WNBA', 'MLS', 'NASCAR', 'INDYCAR', 'F1'].includes(sport)) {
        if (team.name) return team.name;
        if (team.shortDisplayName) return team.shortDisplayName;
    }

    // Fallback logic
    let name = team.displayName;
    if (!name && team.location && team.name) {
        name = `${team.location} ${team.name}`;
    }
    return (name || team.location || '').replace(' AFC', '').replace(' NFC', '');
};

export const normalizeLocation = (team: any, sport: Sport): string => {
    const keys = [team.displayName, team.shortDisplayName, team.name, team.location, team.abbreviation, team.nickname].filter(k => k && typeof k === 'string');
    for (const key of keys) if (CITY_OVERRIDES[key]) return CITY_OVERRIDES[key];
    const address = team.venue?.address || team.franchise?.venue?.address;
    if (address?.city) return address.city;
    return team.location || '';
};

const normalizeTeamToken = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const isUndeterminedTeamName = (name: string | undefined): boolean => {
    const normalized = normalizeTeamToken(name || "");
    if (!normalized) return true;
    if (normalized === "tbd" || normalized === "tba") return true;
    if (normalized.includes("to be determined")) return true;
    if (normalized.includes("winner of") || normalized.includes("loser of")) return true;
    if (normalized.includes("play in winner") || normalized.includes("if necessary")) return true;
    if (normalized.includes("unknown team")) return true;
    return false;
};

export const shouldHideUndeterminedPlayoffGame = (game: Game): boolean => {
    if (!game.isPlayoff) return false;
    if (game.status !== "scheduled") return false;
    return isUndeterminedTeamName(game.homeTeam) || isUndeterminedTeamName(game.awayTeam);
};
