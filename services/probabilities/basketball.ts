
import { Game, GameDetails, PredictionStats, FactorComparison, CalculationDetailItem, TeamStat } from "../../types";
import { normalCDF, parseClockToMinutes, clamp } from "./math";
import { parseComplexStat, parseOverUnder, calculateStatImpact, findCorrelationConfig } from "./utils";
import { STAT_CORRELATIONS } from "./correlations";

interface WeightedFactor {
    label: string;
    value: string;
    impact: 'positive' | 'negative' | 'neutral';
    description: string;
    magnitude: number;
}

export const calculateBasketballProbability = (
    game: Game, 
    details: GameDetails | null, 
    baseRankProb: number, 
    calculationBreakdown: CalculationDetailItem[],
    factorBreakdown: FactorComparison[]
): { prob: number, confidence: number, factors: string[], projectedTotal: number, projectedMargin: number, projectedScoreHome: number, projectedScoreAway: number } => {
    
    const sportCorrelations = STAT_CORRELATIONS[game.league] || STAT_CORRELATIONS['NBA'];

    // --- 1. BASELINE TOTAL ---
    const LEAGUE_MAX_TOTAL = game.league === 'NBA' ? 260 : 200;
    const leagueDefault = game.league === 'NBA' ? 228 : game.league === 'WNBA' ? 165 : 145;
    
    const sourceStats = (details?.seasonStats && details.seasonStats.length > 0) 
        ? (details.seasonStats as unknown as TeamStat[]) 
        : details?.stats;

    let seasonTotal = 0;
    let hasSeasonStats = false;

    if (sourceStats) {
        const ppgStat = sourceStats.find(s => s.label.toLowerCase().includes('points per game') || s.label === 'PTS');
        if (ppgStat) {
            const hPPG = parseComplexStat(ppgStat.homeValue);
            const aPPG = parseComplexStat(ppgStat.awayValue);
            if (hPPG > 0 && aPPG > 0) {
                seasonTotal = hPPG + aPPG;
                hasSeasonStats = true;
            }
        }
    }

    let projectedTotal = hasSeasonStats ? seasonTotal : leagueDefault;
    let margin = 0;
    const keyFactors: string[] = [];
    const allFactors: WeightedFactor[] = [];

    // --- 2. ROSTER & CONTEXT ---
    if (!game.isNeutral) {
        margin += 3.2; 
        allFactors.push({ label: "Home Court", value: "+3.2 pts", impact: 'positive', description: "Standard HCA", magnitude: 3.2 });
    }

    const homeRank = game.homeTeamRank || 50;
    const awayRank = game.awayTeamRank || 50;
    const rankDiff = awayRank - homeRank;
    const rankImpact = rankDiff * 0.25;
    if (Math.abs(rankImpact) > 0.1) {
        margin += rankImpact;
        allFactors.push({ label: "Power Rating", value: `${rankImpact > 0 ? '+' : ''}${rankImpact.toFixed(1)} pts`, impact: rankImpact > 0 ? 'positive' : 'negative', description: `Rank Diff: #${homeRank} vs #${awayRank}`, magnitude: Math.abs(rankImpact) });
    }

    // --- 3. STATS (DATABASE DRIVEN) ---
    // Scalar to convert normalized unit impact to Point Spread
    const SPREAD_SCALAR = 0.20;

    if (sourceStats) {
        const processedStats = new Set<string>();
        
        sourceStats.forEach(stat => {
            const config = findCorrelationConfig(stat.label, sportCorrelations);
            if (config && !processedStats.has(config.id)) {
                // Calculate impact
                const { impact, description, magnitude } = calculateStatImpact(stat, config, SPREAD_SCALAR);
                
                if (magnitude >= 0.5) { // Filter noise
                    margin += impact;
                    allFactors.push({
                        label: config.description,
                        value: `${impact > 0 ? '+' : ''}${impact.toFixed(1)} pts`,
                        impact: impact > 0 ? 'positive' : 'negative',
                        description: description,
                        magnitude: magnitude
                    });
                    processedStats.add(config.id);
                }
            }
        });
    }

    let projHome = (projectedTotal / 2) + (margin / 2);
    let projAway = (projectedTotal / 2) - (margin / 2);

    // --- 4. LIVE ADJUSTMENT ---
    if (game.status === 'in_progress') {
        const hScore = parseInt(game.homeScore || '0');
        const aScore = parseInt(game.awayScore || '0');
        const clock = details?.clock || game.clock || '00:00';
        const period = details?.period || game.period || 1;
        const isNCAA = game.league.includes('NCAA');
        const periodLength = isNCAA ? 20 : 12;
        const totalPeriods = isNCAA ? 2 : 4;
        const regulationMins = totalPeriods * periodLength;
        
        const minsInPeriod = parseClockToMinutes(clock);
        
        let elapsed = 0;
        let targetDuration = regulationMins;

        if (period <= totalPeriods) {
            const elapsedInPeriod = periodLength - minsInPeriod;
            elapsed = ((period - 1) * periodLength) + elapsedInPeriod;
        } else {
            const otLength = 5;
            const elapsedInOT = otLength - minsInPeriod;
            const completedOTs = period - totalPeriods - 1;
            elapsed = regulationMins + (completedOTs * otLength) + elapsedInOT;
            targetDuration = regulationMins + ((period - totalPeriods) * otLength);
        }

        const remaining = Math.max(0, targetDuration - elapsed);
        
        // Calculate projected total based on current pace
        const currentTotal = hScore + aScore;
        
        // Live Pace Calculation with Safety Rails
        let livePaceTotal = projectedTotal;
        if (elapsed > 3) {
             const pace = (currentTotal / elapsed) * targetDuration;
             const minPace = projectedTotal * 0.6;
             const maxPace = projectedTotal * 1.4;
             livePaceTotal = clamp(pace, minPace, maxPace);
        }
        
        // Calculate Live Stat Momentum
        // If team is outperforming historical Shooting or Rebounding in live stats
        let liveStatMomentum = 0;
        if (details?.stats) {
            // Check FG% difference in live stats
            const liveShooting = details.stats.find(s => s.label.includes('Field Goal %') || s.label.includes('FG%'));
            const liveConfig = sportCorrelations.find(c => c.id === 'shooting_efficiency');
            
            if (liveShooting && liveConfig) {
                // Apply a stronger scalar for live "hot hand" effect
                const { impact } = calculateStatImpact(liveShooting, liveConfig, 0.4);
                liveStatMomentum += impact;
            }
        }

        // Weight live pace
        const timeRatio = elapsed / regulationMins;
        const paceWeight = clamp(Math.pow(timeRatio, 2), 0, 1);
        const blendedTotal = (livePaceTotal * paceWeight) + (projectedTotal * (1 - paceWeight));
        
        const blendedRate = blendedTotal / targetDuration;
        const remainingExpected = blendedRate * remaining;
        
        // Adjust remaining margin based on pre-game margin PLUS live stat momentum
        const adjustedMargin = margin + liveStatMomentum;
        const remainingSpread = adjustedMargin * (remaining / regulationMins);
        
        const liveMargin = hScore - aScore;
        
        // Fix for early game 0 calculation
        const safeRemainingExpected = (remaining > 0.5 && remainingExpected < 5) 
            ? (projectedTotal / targetDuration) * remaining 
            : remainingExpected;

        projHome = hScore + (safeRemainingExpected / 2) + (remainingSpread / 2);
        projAway = aScore + (safeRemainingExpected / 2) - (remainingSpread / 2);
        
        if (Math.abs(liveStatMomentum) > 1.0) {
             allFactors.push({
                label: "Live Shooting Variance",
                value: `${liveStatMomentum > 0 ? '+' : ''}${liveStatMomentum.toFixed(1)} pts`,
                impact: liveStatMomentum > 0 ? 'positive' : 'negative',
                description: `Team is shooting ${liveStatMomentum > 0 ? 'above' : 'below'} expected efficiency`,
                magnitude: Math.abs(liveStatMomentum)
            });
        }
        
        if (Math.abs(liveStatMomentum) > 5) keyFactors.push("Shooting Variance");
        if (Math.abs(liveMargin - (margin * (1-(remaining/regulationMins)))) > 15) keyFactors.push("High Tempo / Momentum");
    }

    projHome = clamp(projHome, parseInt(game.homeScore || '0'), 250);
    projAway = clamp(projAway, parseInt(game.awayScore || '0'), 250);

    allFactors.sort((a, b) => b.magnitude - a.magnitude);
    allFactors.slice(0, 5).forEach(f => {
        calculationBreakdown.push({ label: f.label, value: f.value, impact: f.impact, description: f.description });
        if (f.magnitude > 5) keyFactors.push(f.label);
    });

    if (game.status === 'finished') {
        projHome = parseInt(game.homeScore || '0');
        projAway = parseInt(game.awayScore || '0');
    }

    const stdDev = 11.5;
    const winProb = normalCDF(projHome - projAway, 0, stdDev) * 100;
    
    return {
        prob: winProb,
        confidence: clamp(60 + (Math.abs(winProb - 50) * 0.4), 51, 99),
        factors: Array.from(new Set(keyFactors)).slice(0, 3),
        projectedTotal: projHome + projAway,
        projectedMargin: margin,
        projectedScoreHome: Math.round(projHome),
        projectedScoreAway: Math.round(projAway)
    };
};
