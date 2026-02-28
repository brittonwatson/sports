
import { Sport, TeamStat, StatCorrelation } from "../../types";
import { fetchWithRetry, normalizeStat, extractNumber } from "../utils";

// Re-export common utils
export { fetchWithRetry, normalizeStat, extractNumber };

// Parses "34:12" (Time), "5-15" (Ratio), "45%" (Percent) into normalized floats
export const parseComplexStat = (val: string): number => {
    if (!val) return 0;
    const s = String(val).replace(/,/g, '').trim();
    
    // Time format (MM:SS) -> Minutes
    if (s.includes(':')) {
        const parts = s.split(':');
        return parseInt(parts[0]) + (parseInt(parts[1]) / 60);
    }
    
    // Ratio format (X-Y) -> Percentage (X/Y)
    if (s.includes('-') && !s.startsWith('-')) { // Avoid negative numbers
        const parts = s.split('-');
        const num = parseFloat(parts[0]);
        const den = parseFloat(parts[1]);
        if (den === 0) return 0;
        return (num / den) * 100;
    }
    
    // Percentage
    if (s.includes('%')) {
        return parseFloat(s.replace('%', ''));
    }
    
    return parseFloat(s) || 0;
};

export const parseOverUnder = (val: string | undefined): number | null => {
    if (!val) return null;
    // Matches "45.5" inside "O/U 45.5"
    const match = val.match(/(\d+(\.\d+)?)/);
    if (match) {
        return parseFloat(match[0]);
    }
    return null;
};

export const getWeatherImpact = (weatherStr: string | undefined): { impactScore: number, description: string | null } => {
    if (!weatherStr) return { impactScore: 0, description: null };
    const w = weatherStr.toLowerCase();
    let impact = 0;
    let desc = null;

    if (w.includes('rain') || w.includes('shower')) {
        impact -= 3;
        desc = "Rain (Slight Scoring Decay)";
    }
    if (w.includes('snow')) {
        impact -= 5;
        desc = "Snow (Heavy Scoring Decay)";
    }
    if (w.includes('wind') || w.includes('breezy')) {
        const speed = extractNumber(w.match(/(\d+)\s*mph/)?.[1]);
        if (speed > 15) {
            impact -= 4;
            desc = "High Winds (Passing Penalty)";
        }
    }
    if (w.includes('dome') || w.includes('indoor')) {
        impact += 2;
        desc = "Indoors (Optimal Conditions)";
    }
    
    return { impactScore: impact, description: desc };
};

export const calculatePythagoreanExpectation = (pointsFor: number, pointsAgainst: number, sport: string): number => {
    if (pointsFor === 0 || pointsAgainst === 0) return 0.50;
    const exponent = sport === 'NBA' || sport === 'NCAAM' ? 13.91 : 2.37;
    return Math.pow(pointsFor, exponent) / (Math.pow(pointsFor, exponent) + Math.pow(pointsAgainst, exponent));
};

export const parseRecord = (record: string | undefined): { wins: number, losses: number, winPct: number } => {
    if (!record) return { wins: 0, losses: 0, winPct: 0.5 };
    const parts = record.split('-').map(p => parseInt(p));
    const w = parts[0] || 0;
    const l = parts[1] || 0;
    const t = parts[2] || 0;
    const total = w + l + t;
    return { wins: w, losses: l, winPct: total === 0 ? 0.5 : (w + (t * 0.5)) / total };
};

// --- NEW CORRELATION UTILS ---

export const findCorrelationConfig = (statLabel: string, configs: StatCorrelation[]): StatCorrelation | undefined => {
    const labelLower = statLabel.toLowerCase();
    return configs.find(c => c.labels.some(l => labelLower.includes(l.toLowerCase())));
};

export const calculateStatImpact = (
    stat: TeamStat, 
    config: StatCorrelation, 
    baseScalar: number = 1.0
): { impact: number, description: string, magnitude: number } => {
    const hVal = parseComplexStat(stat.homeValue);
    const aVal = parseComplexStat(stat.awayValue);
    
    // Delta
    const diff = hVal - aVal;
    
    // Normalize based on benchmark (e.g. 100 yards vs 50 yards benchmark = 2.0 units)
    const normalizedDiff = config.benchmark > 0 ? diff / config.benchmark : 0;
    
    // Apply Correlation (Direction) and Weight (Importance)
    // Positive correlation + Positive Diff (Home better) -> Positive Impact (Points/Prob for Home)
    // Negative correlation (TOs) + Positive Diff (Home has more TOs) -> Negative Impact
    const impact = normalizedDiff * config.correlation * config.weight * baseScalar;
    
    return {
        impact,
        description: `${config.description}: ${stat.homeValue} vs ${stat.awayValue}`,
        magnitude: Math.abs(impact)
    };
};
