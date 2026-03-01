import { Game, GameDetails, PredictionStats } from "../../types";
import { clamp } from "./math";
import { runProbabilityModel } from "./model";

export const calculateWinProbability = (game: Game, details: GameDetails | null): PredictionStats => {
    const outcome = runProbabilityModel(game, details);
    const marketOdds = details?.odds || game.odds;
    const isDrawLeague = outcome.drawProbability > 0;

    return {
        winProbabilityHome: clamp(outcome.winProbabilityHome, 0, 100),
        winProbabilityAway: clamp(outcome.winProbabilityAway, 0, 100),
        drawProbability: isDrawLeague ? clamp(outcome.drawProbability, 0, 100) : 0,
        predictedScoreHome: Math.max(0, outcome.predictedScoreHome),
        predictedScoreAway: Math.max(0, outcome.predictedScoreAway),
        confidence: clamp(outcome.confidence, 1, 99),
        confidenceBreakdown: outcome.confidenceBreakdown,
        keyFactors: outcome.keyFactors.length > 0 ? outcome.keyFactors : ["Statistical Baseline"],
        factorBreakdown: outcome.factorBreakdown,
        calculationBreakdown: outcome.calculationBreakdown,
        marketOdds,
        isModelOdds: !marketOdds,
    };
};
