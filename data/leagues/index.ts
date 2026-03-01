
import { Sport, TeamOption } from '../../types';
import { NFL, NFL_OVERRIDES } from './nfl';
import { NBA, NBA_OVERRIDES } from './nba';
import { MLB, MLB_OVERRIDES } from './mlb';
import { NHL, NHL_OVERRIDES } from './nhl';
import { MLS, EPL, LaLiga, Bundesliga, SerieA, Ligue1, UCL, SOCCER_OVERRIDES } from './soccer';
import { WNBA, WNBA_OVERRIDES } from './wnba';
import { NCAA_OVERRIDES } from './ncaa';

export const LOCAL_TEAMS: Record<Sport, TeamOption[]> = {
    'F1': [],
    'NFL': NFL,
    'INDYCAR': [],
    'NBA': NBA,
    'MLB': MLB,
    'NASCAR': [],
    'NHL': NHL,
    'MLS': MLS,
    'WNBA': WNBA,
    'EPL': EPL,
    'La Liga': LaLiga,
    'Bundesliga': Bundesliga,
    'Serie A': SerieA,
    'Ligue 1': Ligue1,
    'UCL': UCL,
    'NCAAF': [],
    'NCAAM': [],
    'NCAAW': [],
    'UFC': [] 
};

export const CITY_OVERRIDES: Record<string, string> = {
    ...NFL_OVERRIDES,
    ...NBA_OVERRIDES,
    ...MLB_OVERRIDES,
    ...NHL_OVERRIDES,
    ...WNBA_OVERRIDES,
    ...SOCCER_OVERRIDES,
    ...NCAA_OVERRIDES
};
