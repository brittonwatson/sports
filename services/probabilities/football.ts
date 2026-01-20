
import { Game, GameDetails, PredictionStats, CalculationDetailItem, TeamStat } from "../../types";
import { getWeatherImpact, parseRecord, calculatePythagoreanExpectation, parseComplexStat, parseOverUnder } from "./utils";
import { normalCDF, parseClockToMinutes } from "./math";

const calculateEP = (yardLine: number, down: number, distance: number): number => {
    let ep = -2.0 + (yardLine / 100) * 8.5; 
    if (yardLine <= 10) ep -= 0.8;
    if (yardLine >= 80) ep += 0.5;
    if (down === 3 && distance > 9) ep -= 1.4;
    return ep;
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
    
    // --- 1. BASELINE PROJECTIONS ---
    let spreadProjection = 0;
    
    // Select Source Stats for Prediction:
    const sourceStats = (details?.seasonStats && details.seasonStats.length > 0) 
        ? (details.seasonStats as unknown as TeamStat[]) 
        : details?.stats;

    const leagueBase = game.league === 'NCAAF' ? 54.0 : 44.0;
    
    // Attempt to find Season Stats for PPG
    let seasonTotal = 0;
    let hasSeasonStats = false;
    
    if (sourceStats) {
        const ppgStat = sourceStats.find(s => s.label.toLowerCase().includes('points per game')) || 
                        sourceStats.find(s => s.label === 'Points') || 
                        sourceStats.find(s => s.label.toLowerCase().includes('scoring'));
        
        if (ppgStat) {
            const hPPG = parseComplexStat(ppgStat.homeValue);
            const aPPG = parseComplexStat(ppgStat.awayValue);
            
            if (hPPG > 0 && aPPG > 0 && hPPG < 80 && aPPG < 80) {
                seasonTotal = hPPG + aPPG; 
                hasSeasonStats = true;
            }
        }
    }

    // Determine Base Total
    let totalScoreProjection = leagueBase;
    if (hasSeasonStats) {
        totalScoreProjection = seasonTotal;
    }

    // Power Rating (Rank) for Spread
    const homeRank = game.homeTeamRank || 50; 
    const awayRank = game.awayTeamRank || 50;
    const rankDiff = awayRank - homeRank; 
    
    const rankImpact = rankDiff * 0.4;
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

    // --- 2. DEEP STATISTICAL ANALYSIS ---
    // Adjust both Spread AND Total based on efficiencies

    if (sourceStats) {
        const statWeights: Record<string, { weight: number, unit: string, label: string, invert?: boolean, threshold?: number, desc?: string }> = {
            // Passing
            'Passing Avg': { weight: 3.5, unit: 'yds', label: 'Air Superiority', threshold: 0.3, desc: 'Passing Efficiency (YPA)' },
            'pass avg': { weight: 3.5, unit: 'yds', label: 'Air Superiority', threshold: 0.3, desc: 'Passing Efficiency (YPA)' },
            'Yards Per Pass': { weight: 3.5, unit: 'yds', label: 'Air Superiority', threshold: 0.3, desc: 'Passing Efficiency (YPA)' },
            
            // Rushing
            'Rushing Avg': { weight: 2.2, unit: 'yds', label: 'Ground Control', threshold: 0.3, desc: 'Rushing Efficiency (YPR)' },
            'rush avg': { weight: 2.2, unit: 'yds', label: 'Ground Control', threshold: 0.3, desc: 'Rushing Efficiency (YPR)' },
            'Yards Per Rush': { weight: 2.2, unit: 'yds', label: 'Ground Control', threshold: 0.3, desc: 'Rushing Efficiency (YPR)' },
            
            // General Efficiency
            'Yards Per Play': { weight: 1.5, unit: 'yds', label: 'Overall Eff', threshold: 0.2, desc: 'Yards Per Play Diff' },
            'Total Yards': { weight: 0.005, unit: 'yds', label: 'Yardage Edge', threshold: 50.0 },
            
            // Scoring Defense
            'Points Allowed': { weight: -1.5, unit: 'pts', label: 'Scoring Defense', threshold: 2.0, desc: 'Points Allowed Avg' },
            'Opponent Points': { weight: -1.5, unit: 'pts', label: 'Scoring Defense', threshold: 2.0, desc: 'Points Allowed Avg' },
            
            // Defense / Pressure
            'Defensive Sacks': { weight: 1.2, unit: '', label: 'Trench Warfare', threshold: 1.0, desc: 'Sack/Pressure Diff' },
            'Sacks': { weight: 1.2, unit: '', label: 'Trench Warfare', threshold: 1.0, desc: 'Sack/Pressure Diff' },
            
            // Mistakes & Discipline
            'Turnovers': { weight: -4.2, unit: '', label: 'Ball Security', invert: true, threshold: 0.5, desc: 'Turnover Differential' },
            'Interceptions': { weight: -2.5, unit: '', label: 'INTs', invert: true, threshold: 0.5 },
            'Penalties': { weight: -0.5, unit: '', label: 'Discipline', invert: true, threshold: 1.0, desc: 'Penalty Count' },
            'Penalty Yards': { weight: -0.05, unit: 'yds', label: 'Hidden Yards', invert: true, threshold: 10.0, desc: 'Penalty Yardage' },
            
            // Situational
            'Red Zone Efficiency': { weight: 0.08, unit: '%', label: 'Red Zone', threshold: 5.0, desc: 'Finishing Drives' },
            'Third Down Efficiency': { weight: 0.15, unit: '%', label: '3rd Down', threshold: 5.0, desc: 'Sustain Drives' },
            '3rd Down Conv %': { weight: 0.15, unit: '%', label: '3rd Down', threshold: 5.0, desc: 'Sustain Drives' },
            
            // Pace & Control
            'Total Plays': { weight: 0.02, unit: '', label: 'Pace', threshold: 5.0, desc: 'Tempo Control' },
            'Possession Time': { weight: 0.15, unit: 'min', label: 'Possession', threshold: 2.0, desc: 'Time of Possession' },
        };

        const processedKeys = new Set<string>();

        sourceStats.forEach(stat => {
            const key = Object.keys(statWeights).find(k => 
                stat.label.toLowerCase() === k.toLowerCase() || 
                stat.label.toLowerCase().includes(k.toLowerCase()) ||
                k.toLowerCase().includes(stat.label.toLowerCase())
            );
            
            if (key) {
                const config = statWeights[key];
                if (processedKeys.has(config.label)) return;

                const hVal = parseComplexStat(stat.homeValue);
                const aVal = parseComplexStat(stat.awayValue);
                
                // --- SPREAD IMPACT ---
                let diff = hVal - aVal;
                if (config.invert) diff = -diff; 
                const impact = diff * config.weight;
                
                if (Math.abs(hVal - aVal) >= (config.threshold || 0)) {
                    spreadProjection += impact;
                    allFactors.push({
                        label: config.label,
                        value: `${impact > 0 ? '+' : ''}${impact.toFixed(1)} pts`,
                        impact: impact > 0 ? 'positive' : 'negative',
                        description: `${config.desc || config.label}: ${stat.homeValue} vs ${stat.awayValue}`,
                        magnitude: Math.abs(impact)
                    });
                    processedKeys.add(config.label);
                }

                // --- TOTAL SCORE IMPACT ---
                
                // 1. Pace Adjustment
                if (key.toLowerCase().includes('plays')) {
                    const avgPlays = (hVal + aVal) / 2;
                    const paceFactor = (avgPlays - 65) * 0.3; 
                    totalScoreProjection += paceFactor;
                }
                
                // 2. Explosiveness Adjustment (Yards per Play/Pass)
                if (key.toLowerCase().includes('avg') || key.toLowerCase().includes('pass') || key.toLowerCase().includes('play')) {
                     const avgVal = (hVal + aVal) / 2;
                     if (config.unit === 'yds') {
                         if (avgVal > 7.0) totalScoreProjection += 3.5;
                         else if (avgVal > 6.0) totalScoreProjection += 1.5;
                         else if (avgVal < 4.5) totalScoreProjection -= 2.0;
                     }
                }

                // 3. Defensive Strength Adjustment (Points Allowed)
                if (key.toLowerCase().includes('points allowed') || key.toLowerCase().includes('opponent points')) {
                    const avgPA = (hVal + aVal) / 2;
                    if (avgPA < 18 && avgPA > 0) totalScoreProjection -= 3.0;
                    else if (avgPA > 28) totalScoreProjection += 3.0;
                }
            }
        });
    }

    // --- 3. ENVIRONMENTAL FACTORS ---
    const { impactScore, description } = getWeatherImpact(details?.gameInfo?.weather);
    
    if (impactScore !== 0) {
        totalScoreProjection += impactScore;
        spreadProjection *= 0.9; 
        allFactors.push({
            label: "Weather",
            value: `${impactScore} total pts`,
            impact: 'neutral',
            description: description || 'Weather Conditions',
            magnitude: Math.abs(impactScore)
        });
        keyFactors.push("Weather Impact");
    }

    // Injuries
    const countInjuries = (tid: string | undefined) => details?.injuries?.filter(i => i.teamId === tid && (i.status === 'Out' || i.status === 'Questionable')).length || 0;
    const homeInjuries = countInjuries(game.homeTeamId);
    const awayInjuries = countInjuries(game.awayTeamId);
    const injuryNet = awayInjuries - homeInjuries;
    const injuryImpact = injuryNet * 0.5;
    
    if (Math.abs(injuryNet) >= 2) {
        spreadProjection += injuryImpact;
        allFactors.push({
            label: "Injuries",
            value: `${injuryImpact > 0 ? '+' : ''}${injuryImpact.toFixed(1)} pts`,
            impact: injuryImpact > 0 ? 'positive' : 'negative',
            description: `Net injury diff: ${injuryNet}`,
            magnitude: Math.abs(injuryImpact)
        });
    }

    // --- 4. SCORE CALCULATION ---
    // Ensure total isn't ridiculously low/high
    totalScoreProjection = Math.max(20, Math.min(90, totalScoreProjection));

    let projHome = (totalScoreProjection / 2) + (spreadProjection / 2);
    let projAway = (totalScoreProjection / 2) - (spreadProjection / 2);

    // --- 5. LIVE GAME ADJUSTMENTS ---
    if (game.status === 'in_progress') {
        const curHome = parseInt(game.homeScore || '0');
        const curAway = parseInt(game.awayScore || '0');
        const scoreDiff = curHome - curAway;
        
        const clock = details?.clock || game.clock || '00:00';
        const period = details?.period || game.period || 1;
        const minsLeft = 60 - (((period - 1) * 15) + (15 - parseClockToMinutes(clock)));
        const timeFraction = Math.max(0, minsLeft / 60);
        
        let epAdj = 0;
        if (details?.situation) {
            const { yardLine, down, distance, possession } = details.situation;
            const ep = calculateEP(yardLine || 20, down || 1, distance || 10);
            if (possession === game.homeTeamId) epAdj += ep;
            else epAdj -= ep;
        }

        const remainingProj = spreadProjection * timeFraction; 
        const projectedFinalDiff = scoreDiff + epAdj + remainingProj;
        
        const projectedTotalLive = (curHome + curAway) / Math.max(0.2, (1 - timeFraction));
        const blendedTotal = (totalScoreProjection * timeFraction) + (projectedTotalLive * (1 - timeFraction));
        
        projHome = (blendedTotal / 2) + (projectedFinalDiff / 2);
        projAway = (blendedTotal / 2) - (projectedFinalDiff / 2);
        
        if (epAdj !== 0) {
             if (Math.abs(epAdj) > 2) keyFactors.push("Field Position");
        }
    }

    // --- 6. FINALIZE FACTORS ---
    allFactors.sort((a, b) => b.magnitude - a.magnitude);
    
    allFactors.slice(0, 5).forEach(f => {
        calculationBreakdown.push({
            label: f.label,
            value: f.value,
            impact: f.impact,
            description: f.description
        });
        if (f.magnitude > 1.5) keyFactors.push(f.label);
    });

    const stdDev = 13.5;
    const winProb = normalCDF(projHome - projAway, 0, stdDev) * 100;
    const confidence = 55 + (Math.abs(winProb - 50) * 0.5);

    return {
        prob: winProb,
        confidence,
        factors: Array.from(new Set(keyFactors)).slice(0, 3),
        projectedScoreHome: Math.round(projHome),
        projectedScoreAway: Math.round(projAway)
    };
};
