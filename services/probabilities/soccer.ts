
import { Game, GameDetails, CalculationDetailItem } from "../../types";
import { parseComplexStat, findCorrelationConfig, calculateStatImpact } from "./utils";
import { parseClockToMinutes, clamp, poissonProbability } from "./math";
import { STAT_CORRELATIONS } from "./correlations";

interface WeightedFactor {
    label: string;
    value: string;
    impact: 'positive' | 'negative' | 'neutral';
    description: string;
    magnitude: number;
}

// Average goals per team per game in major leagues (approx 1.35 to 1.5)
const LEAGUE_AVG_GOALS = 1.45;

export const calculateSoccerProbability = (
    game: Game, 
    details: GameDetails | null, 
    preGameProb: number,
    calculationBreakdown: CalculationDetailItem[]
): { prob: number, confidence: number, factors: string[], projectedScoreHome: number, projectedScoreAway: number } => {
    
    const isHockey = game.league.includes('NHL');
    const allFactors: WeightedFactor[] = [];
    const keyFactors: string[] = [];
    
    // 1. Calculate Team Strength (Attack vs Defense)
    // We try to find specific Season Stats (GF, GA) to build a power rating
    const seasonStats = details?.seasonStats;
    
    // Default to League Average if no stats
    let homeAttack = LEAGUE_AVG_GOALS;
    let homeDefense = LEAGUE_AVG_GOALS; // Lower is better
    let awayAttack = LEAGUE_AVG_GOALS;
    let awayDefense = LEAGUE_AVG_GOALS;

    if (seasonStats && seasonStats.length > 0) {
        // Re-implement stat extraction for the comparison format
        // details.seasonStats usually contains ONE list where homeValue/awayValue are the columns.
        const gfStat = seasonStats.find(s => s.label.toLowerCase() === 'goals' || s.label.toLowerCase().includes('goals for') || s.label === 'GF');
        const gaStat = seasonStats.find(s => s.label.toLowerCase().includes('goals against') || s.label.toLowerCase().includes('goals allowed') || s.label === 'GA');

        if (gfStat) {
            const hVal = parseComplexStat(gfStat.homeValue);
            const aVal = parseComplexStat(gfStat.awayValue);
            if (hVal > 0) homeAttack = hVal;
            if (aVal > 0) awayAttack = aVal;
        }

        if (gaStat) {
            const hVal = parseComplexStat(gaStat.homeValue);
            const aVal = parseComplexStat(gaStat.awayValue);
            if (hVal > 0) homeDefense = hVal;
            if (aVal > 0) awayDefense = aVal;
        }
    }

    // 2. Calculate Expected Goals (xG)
    // Formula: (Team Attack / League Avg) * (Opponent Defense / League Avg) * League Avg
    let homeXG = (homeAttack / LEAGUE_AVG_GOALS) * (awayDefense / LEAGUE_AVG_GOALS) * LEAGUE_AVG_GOALS;
    let awayXG = (awayAttack / LEAGUE_AVG_GOALS) * (homeDefense / LEAGUE_AVG_GOALS) * LEAGUE_AVG_GOALS;

    // Apply Home Field Advantage
    if (!game.isNeutral) {
        const hfa = isHockey ? 0.15 : 0.35; // Goals added
        homeXG += hfa;
        allFactors.push({ label: "Home Advantage", value: `+${hfa.toFixed(2)} xG`, impact: 'positive', description: "Standard Home Field Advantage", magnitude: 3 });
    }

    // Apply Power Rating Difference from Rank
    if (game.homeTeamRank && game.awayTeamRank) {
        const diff = game.awayTeamRank - game.homeTeamRank; // Positive if Home is better (lower rank)
        if (diff !== 0) {
            const rankImpact = diff * (isHockey ? 0.005 : 0.01);
            homeXG += rankImpact;
            awayXG -= rankImpact;
            allFactors.push({ 
                label: "League Rank", 
                value: `#${game.homeTeamRank} vs #${game.awayTeamRank}`, 
                impact: diff > 0 ? 'positive' : 'negative', 
                description: `Rank Disparity`, 
                magnitude: Math.abs(diff) 
            });
        }
    }

    // Apply Correlations (Recent Form, Possession, etc)
    const sportCorrelations = STAT_CORRELATIONS[game.league] || STAT_CORRELATIONS['EPL'];
    if (seasonStats) {
        const processedStats = new Set<string>();
        seasonStats.forEach(stat => {
            const config = findCorrelationConfig(stat.label, sportCorrelations);
            if (config && !processedStats.has(config.id)) {
                // We use a small scalar because xG is very sensitive. 
                // A massive stat difference should only move xG by ~0.2 or 0.3 max.
                const XG_SCALAR = 0.05; 
                const { impact, description, magnitude } = calculateStatImpact(stat, config, XG_SCALAR);
                
                if (magnitude >= 0.05) {
                    homeXG += impact;
                    awayXG -= impact; // Zero-sum adjustment for simplicity in this model
                    
                    allFactors.push({
                        label: config.description,
                        value: `${impact > 0 ? '+' : ''}${impact.toFixed(2)} xG`,
                        impact: impact > 0 ? 'positive' : 'negative',
                        description: description,
                        magnitude: magnitude * 100 // Scale up for UI sorting
                    });
                    processedStats.add(config.id);
                }
            }
        });
    }

    // 3. Handle Live Game Logic
    let projHomeScore = homeXG;
    let projAwayScore = awayXG;
    let winProb = 50;

    if (game.status === 'in_progress') {
        const currentHome = parseInt(game.homeScore || '0');
        const currentAway = parseInt(game.awayScore || '0');
        
        const clockStr = details?.clock || game.clock || '00:00';
        const period = details?.period || game.period || 1;
        
        // Parse time properly based on sport direction
        let elapsedMins = 0;
        const totalMins = isHockey ? 60 : 90;
        
        if (isHockey) {
            // Hockey clocks count DOWN (20:00 -> 0:00)
            const pMins = parseClockToMinutes(clockStr);
            elapsedMins = ((period - 1) * 20) + (20 - pMins);
        } else {
            // Soccer clocks count UP (00:00 -> 45:00, 45:00 -> 90:00)
            elapsedMins = parseClockToMinutes(clockStr);
            if (period === 2 && elapsedMins < 45) elapsedMins += 45; // Handle restart at 0 or 45
        }
        
        elapsedMins = clamp(elapsedMins, 0, totalMins);
        const minsRemaining = Math.max(0, totalMins - elapsedMins);
        const fractionRemaining = minsRemaining / totalMins;

        // Score Effects: Teams trailing by 1 goal tend to attack more
        const scoreDiff = currentHome - currentAway;
        let homePush = 1.0;
        let awayPush = 1.0;
        
        if (scoreDiff === -1) homePush = 1.25; // Home trailing by 1
        if (scoreDiff === 1) awayPush = 1.25;  // Away trailing by 1
        if (scoreDiff < -2) homePush = 0.8;    // Home getting crushed, morale drop
        if (scoreDiff > 2) awayPush = 0.8;     // Away getting crushed

        // Calculate Remaining Goals based on pre-game xG, scaled by time left
        const homeRemXG = (homeXG * fractionRemaining) * homePush;
        const awayRemXG = (awayXG * fractionRemaining) * awayPush;

        // Live Projection = Current Banked Goals + Expected Remaining Goals
        projHomeScore = currentHome + homeRemXG;
        projAwayScore = currentAway + awayRemXG;

        // Add specific live factors
        if (elapsedMins > 10) {
             const timeLabel = isHockey ? 'Time Decay' : 'Match Clock';
             allFactors.push({
                label: timeLabel,
                value: `-${(1-fractionRemaining).toFixed(2)}%`,
                impact: 'neutral',
                description: `${Math.round(minsRemaining)} mins remaining`,
                magnitude: 10
            });
        }
    }

    // 4. Final Clamping & Formatting
    // Ensure predictions aren't crazy (e.g. 15 goals)
    const maxGoals = isHockey ? 9 : 6;
    projHomeScore = clamp(projHomeScore, parseInt(game.homeScore || '0'), maxGoals);
    projAwayScore = clamp(projAwayScore, parseInt(game.awayScore || '0'), maxGoals);

    // 5. Calculate Win Probability using Poisson
    // Based on the projected final scores (lambdas)
    let homeWinProb = 0;
    let drawProb = 0;
    let awayWinProb = 0;

    for (let h = 0; h <= 10; h++) {
        for (let a = 0; a <= 10; a++) {
            const p = poissonProbability(h, projHomeScore) * poissonProbability(a, projAwayScore);
            if (h > a) homeWinProb += p;
            else if (h === a) drawProb += p;
            else awayWinProb += p;
        }
    }

    // Normalize probabilities (in case infinite loop cut off small tails)
    const totalP = homeWinProb + drawProb + awayWinProb;
    homeWinProb = (homeWinProb / totalP) * 100;
    
    // Sort and select factors
    allFactors.sort((a, b) => b.magnitude - a.magnitude);
    allFactors.slice(0, 5).forEach(f => {
        calculationBreakdown.push({ label: f.label, value: f.value, impact: f.impact, description: f.description });
        if (f.magnitude > 50) keyFactors.push(f.label);
    });

    if (game.status === 'finished') {
        projHomeScore = parseInt(game.homeScore || '0');
        projAwayScore = parseInt(game.awayScore || '0');
        homeWinProb = projHomeScore > projAwayScore ? 100 : projHomeScore < projAwayScore ? 0 : 50; // Draw is 50 for win prob purpose here or handled in UI
    }

    return { 
        prob: clamp(homeWinProb, 0.1, 99.9), 
        confidence: clamp(60 + (Math.abs(homeWinProb - 50) * 0.5), 51, 95), 
        factors: Array.from(new Set(keyFactors)).slice(0, 3),
        projectedScoreHome: Math.round(projHomeScore),
        projectedScoreAway: Math.round(projAwayScore)
    };
};
