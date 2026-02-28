
import { Game, GameDetails, GameSituation, PredictionStats, CalculationDetailItem } from "../../types";
import { normalCDF, clamp } from "./math";
import { parseComplexStat, parseOverUnder, calculateStatImpact, findCorrelationConfig } from "./utils";
import { STAT_CORRELATIONS } from "./correlations";

const RE24_MATRIX: number[][] = [
    [0.461, 0.831, 1.068, 1.373, 1.420, 1.784, 1.964, 2.292], 
    [0.243, 0.489, 0.614, 0.868, 0.884, 1.140, 1.300, 1.541],
    [0.095, 0.209, 0.308, 0.413, 0.343, 0.461, 0.560, 0.736]
];

const getBaseOutRunExpectancy = (situation?: GameSituation): number => {
    if (!situation) return 0;
    const outs = clamp(situation.outs || 0, 0, 2);
    let state = 0;
    if (situation.onFirst) state += 1;
    if (situation.onSecond) state += 2;
    if (situation.onThird) state += 4;
    return RE24_MATRIX[outs][state];
};

interface WeightedFactor {
    label: string;
    value: string;
    impact: 'positive' | 'negative' | 'neutral';
    description: string;
    magnitude: number;
}

export const calculateBaseballProbability = (game: Game, details: GameDetails | null, preGameProb: number, calculationBreakdown: CalculationDetailItem[]): { prob: number, confidence: number, factors: string[], projectedScoreHome: number, projectedScoreAway: number } => {
    let finalHomeProb = preGameProb;
    let confidence = 70;
    const keyFactors: string[] = [];
    const allFactors: WeightedFactor[] = [];
    const baseTotal = 8.8; 
    
    // Stats Processing
    const sportCorrelations = STAT_CORRELATIONS['MLB'];
    const sourceStats = details?.seasonStats || details?.stats;
    
    // Impact on Win Probability Percentage directly
    const PROB_SCALAR = 0.5; 

    if (sourceStats) {
        const processedStats = new Set<string>();
        sourceStats.forEach(stat => {
            const config = findCorrelationConfig(stat.label, sportCorrelations);
            if (config && !processedStats.has(config.id)) {
                // Returns probability impact
                const { impact, description, magnitude } = calculateStatImpact(stat, config, PROB_SCALAR);
                
                if (magnitude >= 1.0) {
                    finalHomeProb += impact;
                    allFactors.push({
                        label: config.description,
                        value: `${impact > 0 ? '+' : ''}${impact.toFixed(1)}%`,
                        impact: impact > 0 ? 'positive' : 'negative',
                        description: description,
                        magnitude: magnitude
                    });
                    processedStats.add(config.id);
                }
            }
        });
    }

    let projHome = (baseTotal / 2) + 0.2;
    let projAway = (baseTotal / 2) - 0.2;

    if (!game.isNeutral) {
        finalHomeProb += 4; 
        allFactors.push({ label: "Home Field", value: "+4.0%", impact: 'positive', description: "Standard HFA", magnitude: 4.0 });
    }

    const homeRank = game.homeTeamRank || 15;
    const awayRank = game.awayTeamRank || 15;
    const rankDiff = awayRank - homeRank;
    const rankImpact = rankDiff * 0.45;
    if (Math.abs(rankImpact) > 0) {
        finalHomeProb += rankImpact;
        allFactors.push({ label: "Power Rating", value: `${rankImpact > 0 ? '+' : ''}${rankImpact.toFixed(1)}%`, impact: rankImpact > 0 ? 'positive' : 'negative', description: `Rank #${homeRank} vs #${awayRank}`, magnitude: Math.abs(rankImpact) });
    }

    if (game.status === 'in_progress') {
        const hScore = parseInt(game.homeScore || '0');
        const aScore = parseInt(game.awayScore || '0');
        const currentInning = details?.period || game.period || 1;
        
        let threat = 0;
        if (details?.situation) threat = getBaseOutRunExpectancy(details.situation);
        if (threat > 1.2) keyFactors.push("Critical Scoring Threat");

        const inningsLeft = Math.max(0.5, 9.5 - currentInning);
        const timeFractionLeft = inningsLeft / 9;
        
        const remExpected = baseTotal * timeFractionLeft;
        const hStrength = clamp(finalHomeProb / 100, 0.2, 0.8);
        
        projHome = hScore + (remExpected * hStrength) + (game.situation?.possession === game.homeTeamId ? threat : 0);
        projAway = aScore + (remExpected * (1 - hStrength)) + (game.situation?.possession === game.awayTeamId ? threat : 0);
        
        const certainty = 1 - Math.sqrt(timeFractionLeft);
        const z = (hScore - aScore) / (2.5 * Math.sqrt(Math.max(1, inningsLeft)));
        const liveProb = normalCDF(z, 0, 1) * 100;
        finalHomeProb = (liveProb * certainty) + (finalHomeProb * (1 - certainty));
    } else {
        const variance = (finalHomeProb - 50) / 10;
        projHome = (baseTotal / 2) + variance;
        projAway = (baseTotal / 2) - variance;
    }

    projHome = clamp(projHome, parseInt(game.homeScore || '0'), 18);
    projAway = clamp(projAway, parseInt(game.awayScore || '0'), 18);

    allFactors.sort((a, b) => b.magnitude - a.magnitude).slice(0, 5).forEach(f => {
        calculationBreakdown.push({ label: f.label, value: f.value, impact: f.impact, description: f.description });
        if (f.magnitude > 3) keyFactors.push(f.label);
    });

    if (game.status === 'finished') {
        projHome = parseInt(game.homeScore || '0');
        projAway = parseInt(game.awayScore || '0');
    }

    return { 
        prob: clamp(finalHomeProb, 0.1, 99.9), 
        confidence: clamp(50 + Math.abs(finalHomeProb - 50), 51, 99), 
        factors: Array.from(new Set(keyFactors)).slice(0, 3),
        projectedScoreHome: Math.round(projHome),
        projectedScoreAway: Math.round(projAway)
    };
};
