
import { Game, GameDetails, PredictionStats, CalculationDetailItem, FactorComparison } from "../../types";
import { calculateFootballProbability } from "./football";
import { calculateBasketballProbability } from "./basketball";
import { calculateBaseballProbability } from "./baseball";
import { calculateSoccerProbability } from "./soccer";

export const calculateWinProbability = (game: Game, details: GameDetails | null): PredictionStats => {
    const calculationBreakdown: CalculationDetailItem[] = [];
    const factorBreakdown: FactorComparison[] = [];
    
    // --- PURE STATISTICAL ROUTING ---
    
    let result = { 
        prob: 50, 
        confidence: 0, 
        factors: [] as string[], 
        projectedScoreHome: 0, 
        projectedScoreAway: 0 
    };

    const isFootball = game.league === 'NFL' || game.league === 'NCAAF';
    const isBasketball = ['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(game.league);
    const isBaseball = game.league === 'MLB';

    if (isFootball) {
        const fbRes = calculateFootballProbability(game, details, calculationBreakdown);
        result = { 
            prob: fbRes.prob, 
            confidence: fbRes.confidence, 
            factors: fbRes.factors,
            projectedScoreHome: fbRes.projectedScoreHome,
            projectedScoreAway: fbRes.projectedScoreAway
        };
    } else if (isBasketball) {
        const bbRes = calculateBasketballProbability(game, details, 50, calculationBreakdown, factorBreakdown);
        result = {
            prob: bbRes.prob,
            confidence: bbRes.confidence,
            factors: bbRes.factors,
            projectedScoreHome: bbRes.projectedScoreHome,
            projectedScoreAway: bbRes.projectedScoreAway
        };
    } else if (isBaseball) {
        const bRes = calculateBaseballProbability(game, details, 50, calculationBreakdown);
        result = {
            prob: bRes.prob,
            confidence: bRes.confidence,
            factors: bRes.factors,
            projectedScoreHome: bRes.projectedScoreHome,
            projectedScoreAway: bRes.projectedScoreAway
        };
    } else {
        // Soccer / Hockey
        const sRes = calculateSoccerProbability(game, details, 50, calculationBreakdown);
        result = {
            prob: sRes.prob,
            confidence: sRes.confidence,
            factors: sRes.factors,
            projectedScoreHome: sRes.projectedScoreHome,
            projectedScoreAway: sRes.projectedScoreAway
        };
    }

    // --- FACTOR VISUALIZATION ---
    if (details?.stats) {
        const addFactor = (targetLabel: string, displayLabel?: string) => {
            // Flexible match: stat label includes target OR target includes stat label
            // Case insensitive match
            const stat = details.stats.find(s => 
                s.label.toLowerCase().includes(targetLabel.toLowerCase()) || 
                targetLabel.toLowerCase().includes(s.label.toLowerCase())
            );
            if (stat) {
                // Deduplicate: Don't add if a factor with this display label already exists
                if (factorBreakdown.some(f => f.label === (displayLabel || stat.label))) return;
                
                factorBreakdown.push({
                    label: displayLabel || stat.label,
                    homeValue: parseFloat(stat.homeValue) || 0,
                    awayValue: parseFloat(stat.awayValue) || 0,
                    displayHome: stat.homeValue,
                    displayAway: stat.awayValue
                });
            }
        };

        if (isFootball) {
            // Try variations found in different APIs
            addFactor('Passing Average', 'Pass Yds/Att');
            addFactor('Passing Avg', 'Pass Yds/Att'); 
            
            addFactor('Rushing Average', 'Rush Yds/Att');
            addFactor('Rushing Avg', 'Rush Yds/Att'); 
            
            addFactor('Defensive Sacks', 'Sacks');
            addFactor('Sacks', 'Sacks'); 
            
            addFactor('Turnovers', 'Turnovers');
            addFactor('Penalties', 'Penalties');
            addFactor('Penalty Yards', 'Penalty Yds');
            addFactor('Possession Time', 'TOP');
            
            addFactor('Red Zone Efficiency', 'Red Zone %');
            addFactor('Red Zone', 'Red Zone %');
            
            addFactor('Third Down Efficiency', '3rd Down %');
            addFactor('3rd Down Conv %', '3rd Down %');
        } else if (isBasketball) {
            addFactor('Field Goal %', 'FG%');
            addFactor('Rebounds');
            addFactor('Three Point %', '3P%');
        } else if (isBaseball) {
            addFactor('Hits');
            addFactor('Errors');
        } else {
            addFactor('Possession');
            addFactor('Shots');
            addFactor('Saves');
        }
    }

    // Clamp probabilities
    const finalHomeProb = Math.max(0.1, Math.min(99.9, result.prob));

    return {
        winProbabilityHome: finalHomeProb,
        winProbabilityAway: 100 - finalHomeProb,
        drawProbability: 0, 
        predictedScoreHome: result.projectedScoreHome,
        predictedScoreAway: result.projectedScoreAway,
        confidence: Math.min(99, result.confidence),
        keyFactors: result.factors.length > 0 ? result.factors : ["Statistical Variance"],
        factorBreakdown,
        calculationBreakdown,
        marketOdds: game.odds, 
        isModelOdds: true
    };
};
