
import { Game, GameDetails, PredictionStats, CalculationDetailItem, TeamStat } from "../../types";
import { getWeatherImpact, parseRecord, calculatePythagoreanExpectation, parseComplexStat, parseOverUnder, calculateStatImpact, findCorrelationConfig } from "./utils";
import { normalCDF, parseClockToMinutes, clamp } from "./math";
import { STAT_CORRELATIONS } from "./correlations";

const calculateEP = (yardLine: number, down: number, distance: number): number => {
    // Basic Expected Points based on field position
    // yardLine is 1-100 (100 = opponents goal line)
    let ep = -1.5 + (yardLine / 100) * 7.5; 
    if (yardLine <= 10) ep -= 0.5; // Backed up
    if (yardLine >= 80) ep += 1.0; // Red zone
    if (down === 3 && distance > 9) ep -= 1.0;
    return clamp(ep, -2.5, 6.5);
};

interface WeightedFactor {
    label: string;
    value: string;
    impact: 'positive' | 'negative' | 'neutral';
    description: string;
    magnitude: number;
}

export const calculateFootballProbability = (game: Game, details: GameDetails | null, calculationBreakdown: CalculationDetailItem[]): { prob: number, confidence: number, factors: string[], projectedScoreHome: number, projectedScoreAway: number } => {
    const keyFactors: string[] = [];
    const allFactors: WeightedFactor[] = [];
    const sportCorrelations = STAT_CORRELATIONS[game.league] || STAT_CORRELATIONS['NFL'];
    
    // --- 1. BASELINE PROJECTIONS ---
    let spreadProjection = 0;
    const LEAGUE_MAX_SCORE = game.league === 'NCAAF' ? 65 : 52;
    const LEAGUE_MIN_TOTAL = 17;
    
    const sourceStats = (details?.seasonStats && details.seasonStats.length > 0) 
        ? (details.seasonStats as unknown as TeamStat[]) 
        : details?.stats;

    const leagueBase = game.league === 'NCAAF' ? 52.0 : 44.0;
    
    let seasonTotal = 0;
    let hasSeasonStats = false;
    
    if (sourceStats) {
        const ppgStat = sourceStats.find(s => s.label.toLowerCase().includes('points per game') || 
                        s.label === 'Points' || 
                        s.label.toLowerCase().includes('scoring'));
        
        if (ppgStat) {
            const hPPG = parseComplexStat(ppgStat.homeValue);
            const aPPG = parseComplexStat(ppgStat.awayValue);
            if (hPPG > 0 && aPPG > 0 && hPPG < 80 && aPPG < 80) {
                seasonTotal = hPPG + aPPG; 
                hasSeasonStats = true;
            }
        }
    }

    let totalScoreProjection = hasSeasonStats ? seasonTotal : leagueBase;

    const homeRank = game.homeTeamRank || 50; 
    const awayRank = game.awayTeamRank || 50;
    const rankDiff = awayRank - homeRank; 
    const rankImpact = rankDiff * 0.35;
    spreadProjection += rankImpact;
    
    if (Math.abs(rankImpact) > 0.1) {
        allFactors.push({
            label: "Power Rating",
            value: `${rankImpact > 0 ? '+' : ''}${rankImpact.toFixed(1)} pts`,
            impact: rankImpact > 0 ? 'positive' : 'negative',
            description: `Rank Diff: #${homeRank} vs #${awayRank}`,
            magnitude: Math.abs(rankImpact)
        });
    }

    if (!game.isNeutral) {
        spreadProjection += 2.5; 
        allFactors.push({
            label: "Home Field",
            value: "+2.5 pts",
            impact: 'positive',
            description: "Standard HFA",
            magnitude: 2.5
        });
    }

    // --- 2. DEEP STATISTICAL ANALYSIS (DATABASE DRIVEN) ---
    // The scalar converts the raw impact score into "Point Spread Points"
    // Heuristic: Weight of 10.0 (Max) * Correlation 1.0 * Benchmark 1.0 = 10 units. 
    // We want that to be ~1-2 points of spread impact. So scalar around 0.15.
    const SPREAD_SCALAR = 0.15; 

    if (sourceStats) {
        const processedStats = new Set<string>();

        sourceStats.forEach(stat => {
            const config = findCorrelationConfig(stat.label, sportCorrelations);
            if (config && !processedStats.has(config.id)) {
                // Calculate impact using shared utility
                const { impact, description, magnitude } = calculateStatImpact(stat, config, SPREAD_SCALAR);
                
                if (magnitude >= 0.2) { // Filter noise
                    spreadProjection += impact;
                    allFactors.push({
                        label: config.description, // Use the clean DB description
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

    // --- 3. ENVIRONMENTAL FACTORS ---
    const { impactScore } = getWeatherImpact(details?.gameInfo?.weather);
    if (impactScore !== 0) {
        totalScoreProjection += impactScore;
        spreadProjection *= 0.95; 
        keyFactors.push("Weather Impact");
        allFactors.push({
            label: "Weather",
            value: `${impactScore} total`,
            impact: 'neutral',
            description: details?.gameInfo?.weather || 'Adverse Conditions',
            magnitude: Math.abs(impactScore)
        });
    }

    // --- 4. SCORE CALCULATION ---
    totalScoreProjection = clamp(totalScoreProjection, LEAGUE_MIN_TOTAL, LEAGUE_MAX_SCORE * 1.5);
    let projHome = (totalScoreProjection / 2) + (spreadProjection / 2);
    let projAway = (totalScoreProjection / 2) - (spreadProjection / 2);

    // --- 5. LIVE GAME ADJUSTMENTS (USING DATABASE CORRELATIONS) ---
    if (game.status === 'in_progress') {
        const curHome = parseInt(game.homeScore || '0');
        const curAway = parseInt(game.awayScore || '0');
        const scoreDiff = curHome - curAway;
        
        const clock = details?.clock || game.clock || '00:00';
        const period = details?.period || game.period || 1;
        const totalGameMins = 60;
        const periodMins = 15;
        
        const elapsedMins = ((period - 1) * periodMins) + (periodMins - parseClockToMinutes(clock));
        const remMins = Math.max(0, totalGameMins - elapsedMins);
        const timeFractionLeft = remMins / totalGameMins;
        
        // A. Dynamic pace calculation
        const currentTotal = curHome + curAway;
        const livePace = elapsedMins > 8 ? (currentTotal / elapsedMins) * totalGameMins : totalScoreProjection;
        const paceWeight = clamp(Math.pow(elapsedMins / 45, 1.5), 0, 1); 
        const blendedPaceTotal = (livePace * paceWeight) + (totalScoreProjection * (1 - paceWeight));
        
        // B. Live Performance Modifier (Stat Momentum)
        // If we have live boxscore stats, check key correlations (Turnovers, Yards)
        // and adjust the 'spreadProjection' for the REMAINING time.
        let liveStatImpact = 0;
        if (details?.stats) { // In live games, details.stats usually reflects current totals
             const liveTurnoverConfig = sportCorrelations.find(c => c.id === 'turnovers');
             if (liveTurnoverConfig) {
                 const liveStat = details.stats.find(s => liveTurnoverConfig.labels.includes(s.label.toLowerCase()));
                 if (liveStat) {
                     // Heavy penalty for live turnovers
                     const { impact } = calculateStatImpact(liveStat, liveTurnoverConfig, 1.0); // Higher scalar for live impact
                     liveStatImpact += impact;
                 }
             }
        }

        // C. Field Position (EP)
        let epAdj = 0;
        if (details?.situation) {
            const { yardLine, down, distance, possession } = details.situation;
            const ep = calculateEP(yardLine || 20, down || 1, distance || 10);
            if (possession === game.homeTeamId) epAdj += ep;
            else epAdj -= ep;
        }

        // Add Live Factors to Breakdown
        if (Math.abs(epAdj) > 0.5) {
             allFactors.push({
                label: "Field Position (EP)",
                value: `${epAdj > 0 ? '+' : ''}${epAdj.toFixed(1)} pts`,
                impact: epAdj > 0 ? 'positive' : 'negative',
                description: `Live Drive Context: ${details?.situation?.possessionText || 'Possession'}`,
                magnitude: Math.abs(epAdj) * 1.5 // Boost magnitude for sorting visibility
            });
        }
        if (Math.abs(liveStatImpact) > 0.5) {
             allFactors.push({
                label: "Live Efficiency Swing",
                value: `${liveStatImpact > 0 ? '+' : ''}${liveStatImpact.toFixed(1)} pts`,
                impact: liveStatImpact > 0 ? 'positive' : 'negative',
                description: `Real-time performance deviation from pre-game expectation`,
                magnitude: Math.abs(liveStatImpact)
            });
        }

        const remainingProjDiff = (spreadProjection + liveStatImpact) * timeFractionLeft; 
        
        // D. Final Projection
        // Start with current score
        // Add expected points from current drive (EP)
        // Add expected remaining points split by the adjusted spread
        
        const remainingExpectedPoints = clamp(blendedPaceTotal * timeFractionLeft, 0, remMins * 1.2);

        projHome = curHome + (remainingExpectedPoints / 2) + (remainingProjDiff / 2) + (epAdj > 0 ? epAdj : 0);
        projAway = curAway + (remainingExpectedPoints / 2) - (remainingProjDiff / 2) + (epAdj < 0 ? -epAdj : 0);
        
        if (Math.abs(epAdj) > 3) keyFactors.push("High Leverage Drive");
        if (Math.abs(liveStatImpact) > 2) keyFactors.push("Turnover Margin");
    }

    // --- 6. FINALIZE & CLAMP ---
    projHome = clamp(projHome, parseInt(game.homeScore || '0'), LEAGUE_MAX_SCORE + 21);
    projAway = clamp(projAway, parseInt(game.awayScore || '0'), LEAGUE_MAX_SCORE + 21);

    allFactors.sort((a, b) => b.magnitude - a.magnitude);
    allFactors.slice(0, 5).forEach(f => {
        calculationBreakdown.push({ label: f.label, value: f.value, impact: f.impact, description: f.description });
        if (f.magnitude > 2.5) keyFactors.push(f.label);
    });

    if (game.status === 'finished') {
        projHome = parseInt(game.homeScore || '0');
        projAway = parseInt(game.awayScore || '0');
    }

    const stdDev = 13.5;
    const winProb = normalCDF(projHome - projAway, 0, stdDev) * 100;
    const confidence = 55 + (Math.abs(winProb - 50) * 0.5);

    return {
        prob: winProb,
        confidence: clamp(confidence, 51, 99),
        factors: Array.from(new Set(keyFactors)).slice(0, 3),
        projectedScoreHome: Math.round(projHome),
        projectedScoreAway: Math.round(projAway)
    };
};
