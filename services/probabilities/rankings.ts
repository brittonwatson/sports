
import { Sport } from "../../types";

export interface StatDistribution {
    mean: number;
    stdDev: number; // Standard Deviation
    inverse?: boolean; // If true, lower is better (e.g. ERA, Points Allowed)
    format?: 'float' | 'int' | 'percent';
}

// Helper to parse time strings "30:15" into decimal minutes 30.25
const parseValue = (val: string): number => {
    if (typeof val === 'number') return val;
    const s = String(val).replace(/,/g, '').replace('%', '').trim();
    if (s.includes(':')) {
        const parts = s.split(':');
        return parseInt(parts[0]) + (parseInt(parts[1]) / 60);
    }
    return parseFloat(s);
};

// Statistical baselines for 2024-25 Seasons
// Acts as the "Cumulative Database" for derived rankings
export const LEAGUE_DISTRIBUTIONS: Partial<Record<Sport, Record<string, StatDistribution>>> = {
    // --- PRO FOOTBALL (NFL) ---
    'NFL': {
        // Offense
        'points': { mean: 21.8, stdDev: 3.8 },
        'total yards': { mean: 335, stdDev: 28, format: 'int' },
        'passing yards': { mean: 222, stdDev: 32, format: 'int' },
        'rushing yards': { mean: 113, stdDev: 22, format: 'int' },
        'yards per play': { mean: 5.3, stdDev: 0.5, format: 'float' },
        'first downs': { mean: 19.5, stdDev: 2.5, format: 'int' },
        'possession': { mean: 30.0, stdDev: 2.5, format: 'float' },
        'third down %': { mean: 39.5, stdDev: 4.5, format: 'percent' },
        'fourth down %': { mean: 52.0, stdDev: 10.0, format: 'percent' },
        'red zone %': { mean: 56.0, stdDev: 7.5, format: 'percent' },
        'completion %': { mean: 64.5, stdDev: 3.5, format: 'percent' },
        'pass attempts': { mean: 34.0, stdDev: 4.0, format: 'float' },
        'rush attempts': { mean: 26.5, stdDev: 4.0, format: 'float' },
        'turnovers': { mean: 1.4, stdDev: 0.4, inverse: true },
        'interceptions': { mean: 0.8, stdDev: 0.3, inverse: true },
        'fumbles lost': { mean: 0.6, stdDev: 0.3, inverse: true },
        'sacks allowed': { mean: 2.6, stdDev: 0.7, inverse: true },
        'completions': { mean: 22.0, stdDev: 3.0, format: 'int' },
        'passing tds': { mean: 1.4, stdDev: 0.5 },
        'rushing tds': { mean: 0.9, stdDev: 0.4 },
        
        // Defense (Inverse usually means lower is better for the defense stat itself, but here we usually get "Points Allowed")
        'points against': { mean: 21.8, stdDev: 3.8, inverse: true },
        'total yards allowed': { mean: 335, stdDev: 28, inverse: true },
        'passing yards allowed': { mean: 222, stdDev: 32, inverse: true },
        'rushing yards allowed': { mean: 113, stdDev: 22, inverse: true },
        'sacks': { mean: 2.6, stdDev: 0.7 }, // Defense getting sacks is good (Higher better)
        'defensive interceptions': { mean: 0.8, stdDev: 0.3 },
        
        // Special / Misc
        'penalties': { mean: 6.0, stdDev: 1.5, inverse: true, format: 'float' },
        'penalty yards': { mean: 50.0, stdDev: 15.0, inverse: true, format: 'int' },
        'turnover differential': { mean: 0, stdDev: 0.8 }
    },

    // --- COLLEGE FOOTBALL (NCAAF) ---
    'NCAAF': {
        'points': { mean: 28.5, stdDev: 7.5 },
        'points against': { mean: 28.5, stdDev: 7.5, inverse: true },
        'total yards': { mean: 390, stdDev: 55, format: 'int' },
        'passing yards': { mean: 235, stdDev: 60, format: 'int' },
        'rushing yards': { mean: 155, stdDev: 45, format: 'int' },
        'first downs': { mean: 21.0, stdDev: 3.5, format: 'int' },
        'turnovers': { mean: 1.6, stdDev: 0.5, inverse: true },
        'sacks': { mean: 2.2, stdDev: 0.8 },
        '3rd down %': { mean: 40.0, stdDev: 6.0, format: 'percent' },
        'yards per play': { mean: 5.8, stdDev: 0.8, format: 'float' },
        'completion %': { mean: 61.5, stdDev: 5.0, format: 'percent' },
        'penalties': { mean: 6.0, stdDev: 1.5, inverse: true },
        'possession': { mean: 30.0, stdDev: 3.0, format: 'float' }
    },

    // --- PRO BASKETBALL (NBA) ---
    'NBA': {
        'points': { mean: 114.5, stdDev: 4.2 },
        'points against': { mean: 114.5, stdDev: 4.2, inverse: true },
        'field goal %': { mean: 47.5, stdDev: 1.8, format: 'percent' },
        '3-point %': { mean: 36.6, stdDev: 1.5, format: 'percent' },
        'free throw %': { mean: 78.2, stdDev: 2.5, format: 'percent' },
        'rebounds': { mean: 44.0, stdDev: 2.2, format: 'int' },
        'offensive rebounds': { mean: 10.5, stdDev: 1.5, format: 'float' },
        'defensive rebounds': { mean: 33.5, stdDev: 2.5, format: 'float' },
        'assists': { mean: 26.5, stdDev: 2.5, format: 'int' },
        'blocks': { mean: 5.0, stdDev: 1.0, format: 'float' },
        'steals': { mean: 7.5, stdDev: 1.0, format: 'float' },
        'turnovers': { mean: 13.5, stdDev: 1.2, inverse: true },
        'personal fouls': { mean: 19.5, stdDev: 2.0, inverse: true, format: 'float' },
        'points in paint': { mean: 50.0, stdDev: 5.0, format: 'float' },
        'fast break points': { mean: 14.0, stdDev: 3.0, format: 'float' },
        'second chance points': { mean: 13.5, stdDev: 2.5, format: 'float' },
        'bench points': { mean: 35.0, stdDev: 5.0, format: 'float' },
        'technical fouls': { mean: 0.5, stdDev: 0.3, inverse: true },
        'field goals made': { mean: 42.5, stdDev: 2.5 },
        'field goals attempted': { mean: 89.0, stdDev: 3.5 },
        '3-pointers made': { mean: 12.8, stdDev: 1.5 },
        '3-pointers attempted': { mean: 35.0, stdDev: 3.0 },
        'free throws made': { mean: 17.5, stdDev: 2.5 },
        'free throws attempted': { mean: 22.5, stdDev: 3.0 }
    },

    // --- BASEBALL (MLB) ---
    'MLB': {
        'runs': { mean: 4.6, stdDev: 0.5 },
        'hits': { mean: 8.4, stdDev: 0.8, format: 'float' },
        'home runs': { mean: 1.15, stdDev: 0.25, format: 'float' },
        'batting avg': { mean: 0.245, stdDev: 0.015, format: 'float' },
        'on base %': { mean: 0.320, stdDev: 0.015, format: 'float' },
        'slugging %': { mean: 0.410, stdDev: 0.025, format: 'float' },
        'ops': { mean: 0.730, stdDev: 0.040, format: 'float' },
        'stolen bases': { mean: 0.7, stdDev: 0.4, format: 'float' },
        'errors': { mean: 0.5, stdDev: 0.2, inverse: true, format: 'float' },
        'era': { mean: 4.15, stdDev: 0.65, inverse: true, format: 'float' },
        'whip': { mean: 1.30, stdDev: 0.12, inverse: true, format: 'float' },
        'strikeouts': { mean: 8.5, stdDev: 1.0, format: 'float' }, // Pitching K's
        'walks': { mean: 3.2, stdDev: 0.5, inverse: true, format: 'float' },
        'saves': { mean: 0.25, stdDev: 0.1, format: 'float' }
    },

    // --- HOCKEY (NHL) ---
    'NHL': {
        'goals': { mean: 3.15, stdDev: 0.4 },
        'goals against': { mean: 3.15, stdDev: 0.4, inverse: true },
        'assists': { mean: 5.2, stdDev: 0.8, format: 'float' },
        'shots': { mean: 30.5, stdDev: 2.5, format: 'float' },
        'shooting %': { mean: 10.2, stdDev: 1.0, format: 'percent' },
        'save %': { mean: 0.905, stdDev: 0.01, format: 'float' },
        'power play %': { mean: 21.0, stdDev: 4.5, format: 'percent' },
        'penalty kill %': { mean: 79.0, stdDev: 4.5, format: 'percent' },
        'faceoff %': { mean: 50.0, stdDev: 2.5, format: 'percent' },
        'hits': { mean: 22.0, stdDev: 4.0, format: 'float' },
        'blocked shots': { mean: 14.5, stdDev: 2.5, format: 'float' },
        'penalty minutes': { mean: 9.0, stdDev: 2.5, inverse: true, format: 'int' },
        'giveaways': { mean: 8.0, stdDev: 2.0, inverse: true },
        'takeaways': { mean: 7.0, stdDev: 1.5 }
    },

    // --- SOCCER (EPL/MLS/etc) ---
    'EPL': {
        'goals': { mean: 1.45, stdDev: 0.45 },
        'goals against': { mean: 1.45, stdDev: 0.45, inverse: true },
        'assists': { mean: 1.0, stdDev: 0.4, format: 'float' },
        'possession': { mean: 50.0, stdDev: 5.5, format: 'percent' },
        'shots': { mean: 12.5, stdDev: 2.5, format: 'float' },
        'shots on target': { mean: 4.5, stdDev: 1.2, format: 'float' },
        'pass %': { mean: 81.5, stdDev: 3.5, format: 'percent' },
        'fouls': { mean: 11.0, stdDev: 2.0, inverse: true, format: 'float' },
        'yellow cards': { mean: 1.8, stdDev: 0.5, inverse: true, format: 'float' },
        'red cards': { mean: 0.1, stdDev: 0.08, inverse: true, format: 'float' },
        'corners': { mean: 5.2, stdDev: 1.5, format: 'float' },
        'offsides': { mean: 1.8, stdDev: 0.6, inverse: true, format: 'float' },
        'saves': { mean: 3.2, stdDev: 0.8, format: 'float' },
        'tackles': { mean: 16.0, stdDev: 3.0, format: 'float' },
        'interceptions': { mean: 9.0, stdDev: 2.0, format: 'float' },
        'clearances': { mean: 18.0, stdDev: 4.0, format: 'float' }
    }
};

// Map other soccer leagues to the EPL baseline
const SOCCER_LEAGUES: Sport[] = ['MLS', 'Bundesliga', 'La Liga', 'Serie A', 'Ligue 1', 'UCL'];
SOCCER_LEAGUES.forEach(lg => {
    LEAGUE_DISTRIBUTIONS[lg] = {
        ...LEAGUE_DISTRIBUTIONS['EPL'],
        'goals': { mean: lg === 'Bundesliga' ? 1.55 : 1.45, stdDev: 0.45 }
    } as any;
});

// Map WNBA/NCAA to NBA baseline with adjustments
LEAGUE_DISTRIBUTIONS['WNBA'] = { ...LEAGUE_DISTRIBUTIONS['NBA'], points: { mean: 82.5, stdDev: 3.5 } } as any;
LEAGUE_DISTRIBUTIONS['NCAAM'] = { ...LEAGUE_DISTRIBUTIONS['NBA'], points: { mean: 73.5, stdDev: 5.8 }, possession: { mean: 68, stdDev: 3.0 } } as any;
LEAGUE_DISTRIBUTIONS['NCAAW'] = { ...LEAGUE_DISTRIBUTIONS['NBA'], points: { mean: 68.5, stdDev: 7.5 } } as any;

export const normalizeKey = (key: string): string => {
    return key.toLowerCase()
        .replace(' per game', '')
        .replace(' allowed', ' against')
        .replace('percentage', '%')
        .replace('pct', '%')
        .replace('avg', '')
        .replace('rate', '%')
        .trim();
};

export const getDistribution = (sport: Sport, statLabel: string): StatDistribution | null => {
    let leagueDist = LEAGUE_DISTRIBUTIONS[sport];
    if (!leagueDist) return null;

    let key = normalizeKey(statLabel);
    
    // Exact match
    if (leagueDist[key]) return leagueDist[key];

    // Common Mappings
    if (key.includes('possession') && !key.includes('time')) key = 'possession';
    if (key === 'time of possession') key = 'possession';
    if (key.includes('3rd') && key.includes('%')) key = 'third down %';
    if (key.includes('4th') && key.includes('%')) key = 'fourth down %';
    if (key.includes('red zone')) key = 'red zone %';
    if (key.includes('fumble')) key = 'fumbles lost'; // Conservative assumption
    if (key.includes('penalties') && !key.includes('yards')) key = 'penalties';
    if (key.includes('passes completed')) key = 'completions';
    
    // Fuzzy match
    const configKey = Object.keys(leagueDist || {}).find(k => {
        return key.includes(k) || k.includes(key);
    });
    
    return configKey ? leagueDist[configKey] : null;
};

export const calculateDerivedRank = (sport: Sport, statLabel: string, valueStr: string): number => {
    const val = parseValue(valueStr);
    if (isNaN(val)) return 0;

    const config = getDistribution(sport, statLabel);
    if (!config) return 0;

    // Calculate Z-Score (Standard Score)
    const zScore = (val - config.mean) / config.stdDev;
    
    // Convert Z-Score to Percentile (CDF)
    const percentile = 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (zScore + 0.044715 * Math.pow(zScore, 3))));

    let teamCount = 32;
    if (sport === 'NBA' || sport === 'NHL' || sport === 'MLB') teamCount = 30;
    else if (sport === 'EPL' || sport === 'La Liga' || sport === 'Serie A') teamCount = 20;
    else if (sport === 'Bundesliga') teamCount = 18;
    else if (sport === 'MLS') teamCount = 29;
    else if (sport.startsWith('NCAA')) teamCount = 133;

    let rank;
    if (config.inverse) {
        // Lower is better (e.g. 1st percentile is rank 1)
        rank = Math.ceil(percentile * teamCount);
    } else {
        // Higher is better (e.g. 99th percentile is rank 1)
        rank = Math.ceil((1 - percentile) * teamCount);
    }

    return Math.max(1, Math.min(teamCount, rank));
};
