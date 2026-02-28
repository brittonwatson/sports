import { Game, GameDetails, PredictionStats, CalculationDetailItem, FactorComparison } from "../../types";
import { calculateFootballProbability } from "./football";
import { calculateBasketballProbability } from "./basketball";
import { calculateBaseballProbability } from "./baseball";
import { calculateSoccerProbability } from "./soccer";
import { clamp } from "./math";

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
            const stat = details.stats.find(s => 
                s.label.toLowerCase().includes(targetLabel.toLowerCase()) || 
                targetLabel.toLowerCase().includes(s.label.toLowerCase())
            );
            if (stat) {
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
            addFactor('Passing Average', 'Pass Yds/Att');
            addFactor('Rushing Average', 'Rush Yds/Att'); 
            addFactor('Sacks', 'Sacks'); 
            addFactor('Turnovers', 'Turnovers');
            addFactor('Red Zone', 'Red Zone %');
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
        }
    }

    return {
        winProbabilityHome: clamp(result.prob, 0.1, 99.9),
        winProbabilityAway: clamp(100 - result.prob, 0.1, 99.9),
        drawProbability: 0, 
        predictedScoreHome: Math.max(0, Math.round(result.projectedScoreHome)),
        predictedScoreAway: Math.max(0, Math.round(result.projectedScoreAway)),
        confidence: clamp(result.confidence, 1, 99),
        keyFactors: result.factors.length > 0 ? result.factors : ["Statistical Variance"],
        factorBreakdown,
        calculationBreakdown,
        marketOdds: game.odds, 
        isModelOdds: true
    };
};