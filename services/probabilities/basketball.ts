
import { Game, GameDetails, PredictionStats, FactorComparison, CalculationDetailItem, TeamStat } from "../../types";
import { normalCDF, parseClockToMinutes } from "./math";
import { parseComplexStat, parseOverUnder } from "./utils";

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
    
    // --- 1. ESTABLISH BASELINE TOTAL ---
    const leagueDefault = game.league === 'NBA' ? 228 : game.league === 'WNBA' ? 165 : 145;
    
    // Select Source Stats for Prediction:
    const sourceStats = (details?.seasonStats && details.seasonStats.length > 0) 
        ? (details.seasonStats as unknown as TeamStat[]) 
        : details?.stats;

    let seasonTotal = 0;
    let hasSeasonStats = false;

    // Check for PPG stats
    if (sourceStats) {
        const ppgStat = sourceStats.find(s => 
            s.label.toLowerCase().includes('points per game') || 
            s.label === 'Points' ||
            s.label === 'PTS'
        );
        if (ppgStat) {
            const hPPG = parseComplexStat(ppgStat.homeValue);
            const aPPG = parseComplexStat(ppgStat.awayValue);
            if (hPPG > 0 && aPPG > 0) {
                seasonTotal = hPPG + aPPG;
                hasSeasonStats = true;
            }
        }
    }

    let projectedTotal = leagueDefault;
    if (hasSeasonStats) {
        projectedTotal = seasonTotal;
    }

    let margin = 0;
    const keyFactors: string[] = [];
    const allFactors: WeightedFactor[] = [];

    // --- 2. ROSTER & CONTEXT ---
    // Home Court
    if (!game.isNeutral) {
        margin += 3.2; 
        allFactors.push({
            label: "Home Court",
            value: "+3.2 pts",
            impact: 'positive',
            description: "Standard HCA",
            magnitude: 3.2
        });
    }

    // Power Rating (Rank Diff)
    const homeRank = game.homeTeamRank || 50;
    const awayRank = game.awayTeamRank || 50;
    const rankDiff = awayRank - homeRank;
    const rankImpact = rankDiff * 0.3;
    
    if (Math.abs(rankImpact) > 0.1) {
        margin += rankImpact;
        allFactors.push({
            label: "Power Rating",
            value: `${rankImpact > 0 ? '+' : ''}${rankImpact.toFixed(1)} pts`,
            impact: rankImpact > 0 ? 'positive' : 'negative',
            description: `Rank Diff: #${homeRank} vs #${awayRank}`,
            magnitude: Math.abs(rankImpact)
        });
    }

    // --- 3. DEEP STATS (Eight Factors) ---
    if (sourceStats) {
        const getS = (l: string) => {
            const s = sourceStats.find(x => x.label.toLowerCase().includes(l.toLowerCase()));
            if (!s) return { h: 0, a: 0, txtH: '', txtA: '' };
            return { 
                h: parseComplexStat(s.homeValue), 
                a: parseComplexStat(s.awayValue),
                txtH: s.homeValue,
                txtA: s.awayValue
            };
        };

        const factors = [
            { key: 'Field Goal %', weight: 0.45, label: 'Shooting' }, 
            { key: 'Three Point %', weight: 0.18, label: 'Perimeter' },
            { key: 'Free Throw %', weight: 0.05, label: 'Free Throws' },
            { key: 'Rebounds', weight: 0.3, label: 'Rebounding' },
            { key: 'Assists', weight: 0.2, label: 'Ball Movement' },
            { key: 'Steals', weight: 1.5, label: 'Defense (Stls)' },
            { key: 'Blocks', weight: 1.0, label: 'Rim Protection' },
            { key: 'Turnovers', weight: -1.6, label: 'Turnovers', invert: true },
            { key: 'Points in Paint', weight: 0.08, label: 'Inside Scoring' },
            { key: 'Fast Break Points', weight: 0.1, label: 'Transition' },
            { key: 'Second Chance Points', weight: 0.12, label: '2nd Chance' },
            { key: 'Points off Turnovers', weight: 0.12, label: 'TO Points' }
        ];

        factors.forEach(f => {
            const stat = getS(f.key);
            if (stat.txtH !== '' && stat.txtA !== '') {
                // Margin Adjustment
                let diff = stat.h - stat.a;
                if (f.invert) diff = -diff;
                
                const impact = diff * f.weight;
                
                if (Math.abs(impact) > 0.3) {
                    margin += impact;
                    allFactors.push({
                        label: f.label,
                        value: `${impact > 0 ? '+' : ''}${impact.toFixed(1)} pts`,
                        impact: impact > 0 ? 'positive' : 'negative',
                        description: `${f.key} Diff: ${(stat.h - stat.a).toFixed(1)}`,
                        magnitude: Math.abs(impact)
                    });
                }

                // Total Score Adjustments based on Offense Stats
                if (f.key === 'Field Goal %') {
                    const avgFG = (stat.h + stat.a) / 2;
                    if (avgFG > 48) projectedTotal += 4;
                    else if (avgFG < 42) projectedTotal -= 4;
                }
                if (f.key === 'Three Point %') {
                    const avg3P = (stat.h + stat.a) / 2;
                    if (avg3P > 38) projectedTotal += 3;
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
        const currentTotal = hScore + aScore;
        const currentDiff = hScore - aScore;
        
        const clock = details?.clock || game.clock || '00:00';
        const period = details?.period || game.period || 1;
        
        const isNCAA = game.league.includes('NCAA');
        const periodLength = isNCAA ? 20 : 12;
        const totalPeriods = isNCAA ? 2 : 4;
        const totalMins = totalPeriods * periodLength;
        
        const minsInPeriod = parseClockToMinutes(clock);
        const elapsedInPeriod = periodLength - minsInPeriod;
        let elapsed = ((period - 1) * periodLength) + elapsedInPeriod;
        
        if (period > totalPeriods) {
            const otLength = 5;
            elapsed = totalMins + ((period - totalPeriods - 1) * otLength) + (otLength - minsInPeriod);
        }

        const remaining = Math.max(0, totalMins - elapsed); 
        const timeRatio = Math.max(0, remaining / totalMins); 

        const expectedCurrentDiff = margin * (1 - timeRatio);
        const momentum = currentDiff - expectedCurrentDiff;
        if (Math.abs(momentum) > 8) {
            keyFactors.push(momentum > 0 ? "Home Momentum" : "Away Momentum");
        }

        const safeElapsed = Math.max(elapsed, 5); 
        const livePace = currentTotal / safeElapsed; 
        // Use the refined projectedTotal as the pre-game pace expectation
        const preGamePace = projectedTotal / totalMins;

        const confidenceInLive = Math.min(1, elapsed / (totalMins * 0.5)); 
        const blendedPace = (livePace * confidenceInLive) + (preGamePace * (1 - confidenceInLive));
        
        const projectedRestOfGame = blendedPace * remaining;
        const projectedFinalTotal = currentTotal + projectedRestOfGame;

        const finalMargin = (margin * timeRatio * 0.5) + currentDiff; 

        projectedTotal = projectedFinalTotal;
        projHome = (projectedTotal / 2) + (finalMargin / 2);
        projAway = (projectedTotal / 2) - (finalMargin / 2);
    }

    // --- 5. FINALIZE FACTORS ---
    allFactors.sort((a, b) => b.magnitude - a.magnitude);
    
    allFactors.slice(0, 5).forEach(f => {
        calculationBreakdown.push({
            label: f.label,
            value: f.value,
            impact: f.impact,
            description: f.description
        });
        if (f.magnitude > 4) keyFactors.push(f.label);
    });

    const stdDev = 11.5;
    const winProb = normalCDF(projHome - projAway, 0, stdDev) * 100;
    
    return {
        prob: winProb,
        confidence: 60 + (Math.abs(winProb - 50) * 0.4),
        factors: Array.from(new Set(keyFactors)).slice(0, 3),
        projectedTotal: projectedTotal,
        projectedMargin: margin,
        projectedScoreHome: Math.round(Math.max(parseInt(game.homeScore || '0'), projHome)),
        projectedScoreAway: Math.round(Math.max(parseInt(game.awayScore || '0'), projAway))
    };
};
