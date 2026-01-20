
import { Game, GameDetails, PredictionStats, FactorComparison, CalculationDetailItem } from "../../types";
import { parseComplexStat, parseOverUnder } from "./utils";
import { parseClockToMinutes } from "./math";

interface WeightedFactor {
    label: string;
    value: string;
    impact: 'positive' | 'negative' | 'neutral';
    description: string;
    magnitude: number;
}

export const calculateSoccerProbability = (
    game: Game, 
    details: GameDetails | null, 
    preGameProb: number,
    calculationBreakdown: CalculationDetailItem[]
): { prob: number, confidence: number, factors: string[], projectedScoreHome: number, projectedScoreAway: number } => {
    let finalHomeProb = preGameProb;
    let confidence = 85;
    const keyFactors: string[] = [];
    const allFactors: WeightedFactor[] = [];
    
    // --- 1. ESTABLISH BASELINE SCORING ---
    const isHockey = game.league.includes('NHL');
    
    let baseTotal = isHockey ? 6.2 : 2.7; // Default averages
    
    // Check for "Goals Scored" stats
    if (details?.stats) {
        const goalStat = details.stats.find(s => s.label === 'Goals' || s.label === 'Goals Per Game' || s.label === 'GF/GP');
        if (goalStat) {
            const hG = parseComplexStat(goalStat.homeValue);
            const aG = parseComplexStat(goalStat.awayValue);
            if (hG > 0 && aG > 0) {
                // Simple avg of offensive outputs
                const seasonTotal = hG + aG;
                baseTotal = seasonTotal;
            }
        }
    }

    // Split base total slightly favoring home by default
    let expectedGoalsHome = (baseTotal / 2) + (isHockey ? 0.1 : 0.15);
    let expectedGoalsAway = (baseTotal / 2) - (isHockey ? 0.1 : 0.15);

    // --- BASELINE FACTORS ---
    
    // Home Field Advantage
    if (!game.isNeutral) {
        finalHomeProb += 5; 
        allFactors.push({
            label: "Home Field",
            value: "+5.0%",
            impact: 'positive',
            description: "Standard HFA",
            magnitude: 5.0
        });
    }

    // Form / Power Rating (based on preGameProb variance from 50)
    // Adjust expected goals based on who is the favorite
    const powerVariance = preGameProb - 50;
    const goalAdjust = Math.abs(powerVariance) * (isHockey ? 0.02 : 0.015);
    
    if (powerVariance > 0) {
        expectedGoalsHome += goalAdjust;
        expectedGoalsAway -= goalAdjust;
    } else {
        expectedGoalsHome -= goalAdjust;
        expectedGoalsAway += goalAdjust;
    }

    if (Math.abs(powerVariance) > 2) {
        allFactors.push({
            label: "Form",
            value: `${powerVariance > 0 ? '+' : ''}${powerVariance.toFixed(1)}%`,
            impact: powerVariance > 0 ? 'positive' : 'negative',
            description: "Implied Strength",
            magnitude: Math.abs(powerVariance)
        });
    }

    // --- 2. STATISTICAL ANALYSIS ---
    if (details?.stats) {
        const getS = (l: string) => {
            const s = details.stats.find(x => x.label.toLowerCase().includes(l.toLowerCase()));
            if (!s) return { h: 0, a: 0, txtH: '', txtA: '' };
            return { h: parseComplexStat(s.homeValue), a: parseComplexStat(s.awayValue), txtH: s.homeValue, txtA: s.awayValue };
        };

        const shots = getS('Shots');
        const sog = getS('Shots on Goal');
        const corners = getS('Corners');
        const possession = getS('Possession');
        
        // Possession Factor
        if (possession.h > 0) {
            const possDiff = possession.h - possession.a;
            const possImpact = possDiff * 0.1;
            if (Math.abs(possImpact) > 1.0) {
                finalHomeProb += possImpact;
                allFactors.push({
                    label: "Possession",
                    value: `${possImpact > 0 ? '+' : ''}${possImpact.toFixed(1)}%`,
                    impact: possImpact > 0 ? 'positive' : 'negative',
                    description: `${possession.txtH} vs ${possession.txtA}`,
                    magnitude: Math.abs(possImpact)
                });
            }
        }

        // Dominance Metric (Shots/SOG/Corners)
        const hDominance = (shots.h) + (sog.h * 3) + (corners.h * 0.5);
        const aDominance = (shots.a) + (sog.a * 3) + (corners.a * 0.5);
        const totalDom = hDominance + aDominance;
        
        if (totalDom > 5) {
            const hShare = hDominance / totalDom; // 0 to 1
            const dominanceDiff = (hShare - 0.5) * 100; // -50 to +50
            const domImpact = dominanceDiff * 0.2; // Scaling factor
            
            finalHomeProb += domImpact;
            
            if (Math.abs(domImpact) > 2) {
                allFactors.push({
                    label: "Attacking Threat",
                    value: `${domImpact > 0 ? '+' : ''}${domImpact.toFixed(1)}%`,
                    impact: domImpact > 0 ? 'positive' : 'negative',
                    description: "Shot/Corner Volume",
                    magnitude: Math.abs(domImpact)
                });
                
                // Adjust scores based on dominance
                if (hShare > 0.6) { expectedGoalsHome *= 1.2; expectedGoalsAway *= 0.85; }
                if (hShare < 0.4) { expectedGoalsAway *= 1.2; expectedGoalsHome *= 0.85; }
            }
        }
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

    let projHome = expectedGoalsHome;
    let projAway = expectedGoalsAway;

    // --- 3. LIVE DECAY ---
    if (game.status === 'in_progress') {
        const homeScore = parseInt(game.homeScore || '0');
        const awayScore = parseInt(game.awayScore || '0');
        const scoreDiff = homeScore - awayScore;

        const currentPeriod = details?.period || game.period || 1;
        const clockStr = details?.clock || game.clock || '00:00';
        
        let minutesRemaining = 0;
        
        if (isHockey) {
            const periodMins = parseClockToMinutes(clockStr);
            const playedPeriods = currentPeriod - 1;
            minutesRemaining = ((3 - playedPeriods) * 20) - (20 - periodMins);
        } else {
            const elapsed = parseClockToMinutes(clockStr);
            minutesRemaining = 90 - elapsed;
            if (currentPeriod > 2) minutesRemaining = 15; // ET assumed
        }
        
        minutesRemaining = Math.max(0, Math.min(isHockey ? 60 : 90, minutesRemaining));
        
        const totalDuration = isHockey ? 60 : 90;
        const timeFractionLeft = minutesRemaining / totalDuration;

        const remHome = expectedGoalsHome * timeFractionLeft;
        const remAway = expectedGoalsAway * timeFractionLeft;

        projHome = homeScore + remHome;
        projAway = awayScore + remAway;

        if (scoreDiff === 0) {
             const timeWeight = minutesRemaining / totalDuration;
             finalHomeProb = 50 + ((finalHomeProb - 50) * timeWeight);
        } else {
            const steepness = isHockey ? 1.5 : 0.8; 
            const sigmoid = 1 / (1 + Math.exp(-Math.abs(scoreDiff) / steepness)); 
            const leadStrength = (scoreDiff > 0 ? sigmoid : 1 - sigmoid) * 100;
            const certainty = 1 - Math.pow(minutesRemaining / totalDuration, 0.5); 
            finalHomeProb = (leadStrength * certainty) + (finalHomeProb * (1 - certainty));
        }
        
        if (Math.abs(scoreDiff) >= 2) keyFactors.push("Scoreline Control");
    }

    if (keyFactors.length === 0) keyFactors.push("Matchup History");

    return { 
        prob: finalHomeProb, 
        confidence, 
        factors: Array.from(new Set(keyFactors)).slice(0, 3),
        projectedScoreHome: Math.round(projHome),
        projectedScoreAway: Math.round(projAway)
    };
};
