
import { Game, GameDetails, GameSituation, PredictionStats, CalculationDetailItem } from "../../types";
import { normalCDF } from "./math";
import { parseComplexStat, parseOverUnder } from "./utils";

const RE24_MATRIX: number[][] = [
    [0.461, 0.831, 1.068, 1.373, 1.420, 1.784, 1.964, 2.292], 
    [0.243, 0.489, 0.614, 0.868, 0.884, 1.140, 1.300, 1.541],
    [0.095, 0.209, 0.308, 0.413, 0.343, 0.461, 0.560, 0.736]
];

const getBaseOutRunExpectancy = (situation?: GameSituation): number => {
    if (!situation) return 0;
    const outs = Math.min(2, situation.outs || 0);
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

    // --- 1. ESTABLISH BASELINE SCORING ---
    const baseTotal = 8.5; // Default average
    
    // Split initially based on general home field advantage (slight bump)
    let projHome = (baseTotal / 2) + 0.2;
    let projAway = (baseTotal / 2) - 0.2;

    // --- 2. BASELINE FACTORS ---
    // Home Field
    if (!game.isNeutral) {
        finalHomeProb += 4; // ~4% boost
        allFactors.push({
            label: "Home Field",
            value: "+4.0%",
            impact: 'positive',
            description: "Standard HFA",
            magnitude: 4.0
        });
    }

    // Power Rating (Rank)
    const homeRank = game.homeTeamRank || 15;
    const awayRank = game.awayTeamRank || 15;
    const rankDiff = awayRank - homeRank;
    const rankImpact = rankDiff * 0.5; // ~0.5% per rank spot
    
    if (Math.abs(rankImpact) > 0) {
        finalHomeProb += rankImpact;
        
        // Adjust projected runs based on rank diff
        const runShift = rankImpact * 0.05; // Stronger team scores slightly more
        projHome += runShift;
        projAway -= runShift;

        allFactors.push({
            label: "Power Rating",
            value: `${rankImpact > 0 ? '+' : ''}${rankImpact.toFixed(1)}%`,
            impact: rankImpact > 0 ? 'positive' : 'negative',
            description: `Rank #${homeRank} vs #${awayRank}`,
            magnitude: Math.abs(rankImpact)
        });
    }

    // --- 3. STATISTICAL ANALYSIS ---
    if (details?.stats) {
        const getS = (l: string) => {
            const s = details.stats.find(x => x.label.toLowerCase().includes(l.toLowerCase()));
            if (!s) return { h: 0, a: 0, txtH: '', txtA: '' };
            return { 
                h: parseComplexStat(s.homeValue), 
                a: parseComplexStat(s.awayValue),
                txtH: s.homeValue,
                txtA: s.awayValue 
            };
        };

        const factors = [
            { key: 'Hits', weight: 1.5, label: 'Hits' },
            { key: 'Errors', weight: -2.0, label: 'Defense', invert: true },
            { key: 'Home Runs', weight: 2.5, label: 'Power' },
            { key: 'Strikeouts', weight: 0.1, label: 'Pitching (K)' }, 
            { key: 'Walks', weight: 0.5, label: 'Discipline (BB)' },
            { key: 'Batting Average', weight: 0.04, label: 'AVG' }, 
        ];

        factors.forEach(f => {
            const stat = getS(f.key);
            if (stat.txtH !== '') {
                let valH = stat.h;
                let valA = stat.a;
                
                if (f.key === 'Batting Average') {
                    valH = valH < 1 ? valH * 1000 : valH; 
                    valA = valA < 1 ? valA * 1000 : valA;
                }

                let diff = valH - valA;
                if (f.invert) diff = -diff;
                
                const impact = diff * f.weight; 
                
                if (Math.abs(impact) > 0.5) {
                    finalHomeProb += impact;
                    allFactors.push({
                        label: f.label,
                        value: `${impact > 0 ? '+' : ''}${impact.toFixed(1)}%`,
                        impact: impact > 0 ? 'positive' : 'negative',
                        description: `${f.key}: ${stat.txtH} vs ${stat.txtA}`,
                        magnitude: Math.abs(impact)
                    });
                }
            }
        });
    }

    // --- FINALIZE FACTORS ---
    allFactors.sort((a, b) => b.magnitude - a.magnitude);
    
    allFactors.slice(0, 5).forEach(f => {
        calculationBreakdown.push({
            label: f.label,
            value: f.value,
            impact: f.impact,
            description: f.description
        });
        if (f.magnitude > 3) keyFactors.push(f.label);
    });

    if (game.status === 'in_progress') {
        const homeScore = parseInt(game.homeScore || '0');
        const awayScore = parseInt(game.awayScore || '0');
        let effectiveDiff = homeScore - awayScore;

        const currentPeriod = details?.period || game.period || 1; // Inning
        
        let currentInningRunsExp = 0;
        if (details?.situation) {
            currentInningRunsExp = getBaseOutRunExpectancy(details.situation);
            if (currentInningRunsExp > 1.0) keyFactors.push("Scoring Threat Active");
        }

        const inningsLeft = Math.max(0.5, 9 - (currentPeriod || 1));
        
        // Base run rate + adjustment based on prob
        const baseRunRate = baseTotal / 18; // runs per half-inning
        const remRuns = baseRunRate * inningsLeft * 2; 
        
        const hStrength = Math.min(0.8, Math.max(0.2, finalHomeProb / 100)); // Clamp
        
        projHome = homeScore + (remRuns * hStrength);
        projAway = awayScore + (remRuns * (1 - hStrength));
        
        const volatility = 2.5 * Math.sqrt(inningsLeft);
        const z = effectiveDiff / volatility;
        const liveProb = normalCDF(z, 0, 1) * 100;
        
        const timeWeight = Math.min(1, inningsLeft / 9);
        finalHomeProb = (liveProb * (1 - timeWeight)) + (finalHomeProb * timeWeight);
    } else {
        confidence = Math.abs(preGameProb - 50) + 50;
        
        // Pre-game adjustment based on calculated probability (Win % -> Run Differential)
        // A 60% win prob roughly implies a +0.5 to +1.0 run differential
        const runDiffExpectation = (finalHomeProb - 50) / 10; 
        
        // Center the projection around the base total but shifted by run diff
        const total = projHome + projAway; // Should equal baseTotal
        projHome = (total / 2) + (runDiffExpectation / 2);
        projAway = (total / 2) - (runDiffExpectation / 2);
        
        if (game.status === 'finished') {
             projHome = parseInt(game.homeScore || '0');
             projAway = parseInt(game.awayScore || '0');
        }
    }

    return { 
        prob: finalHomeProb, 
        confidence, 
        factors: Array.from(new Set(keyFactors)),
        projectedScoreHome: Math.max(0, Math.round(projHome)),
        projectedScoreAway: Math.max(0, Math.round(projAway))
    };
};
