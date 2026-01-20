
import { Sport } from "../types";

export const API_KEY = process.env.API_KEY;

export const ESPN_ENDPOINTS: Record<Sport, string> = {
  'NBA': 'basketball/nba',
  'NFL': 'football/nfl',
  'MLB': 'baseball/mlb',
  'NHL': 'hockey/nhl',
  'EPL': 'soccer/eng.1',
  'Bundesliga': 'soccer/ger.1',
  'La Liga': 'soccer/esp.1',
  'Ligue 1': 'soccer/fra.1',
  'Serie A': 'soccer/ita.1',
  'MLS': 'soccer/usa.1',
  'UCL': 'soccer/uefa.champions',
  'NCAAF': 'football/college-football',
  'NCAAM': 'basketball/mens-college-basketball',
  'NCAAW': 'basketball/womens-college-basketball',
  'WNBA': 'basketball/wnba',
  'UFC': 'mma/ufc'
};

export const SPORT_PARAMS: Partial<Record<Sport, string>> = {
  'NFL': 'limit=200',
  'NBA': 'limit=200',
  'NHL': 'limit=500',
  'MLB': 'limit=200',
  'NCAAF': 'limit=200&groups=80',
  'NCAAM': 'limit=900&groups=50', 
  'NCAAW': 'limit=900&groups=50',
};

export const DAILY_CALENDAR_SPORTS: Sport[] = [
  'MLB', 'NBA', 'NHL', 'NCAAM', 'NCAAW', 'WNBA',
  'Bundesliga', 'EPL', 'La Liga', 'Ligue 1', 'MLS', 'Serie A', 'UCL'
];
