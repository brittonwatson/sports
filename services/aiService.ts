
import { GoogleGenAI } from "@google/genai";
import { Game, PredictionStats } from "../types";
import { API_KEY } from "./constants";

const GEMINI_FLASH_MODELS = [
    'gemini-flash-latest',
    'gemini-3-flash-preview',
];

export const generateAIAnalysis = async (game: Game, stats: PredictionStats): Promise<{ analysis: string[], groundingChunks: any[] }> => {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const prompt = `
    Analyze the upcoming or live match between ${game.awayTeam} and ${game.homeTeam} in ${game.league}.
    Current Status: ${game.status === 'in_progress' ? `Live - ${game.clock} ${game.period}` : 'Scheduled'}.
    Score: ${game.awayTeam} ${game.awayScore || 0} - ${game.homeTeam} ${game.homeScore || 0}.
    Win Probability: ${stats.winProbabilityHome.toFixed(1)}% for ${game.homeTeam}.
    Key Factors: ${stats.keyFactors.join(', ')}.
    
    Provide 5 short, insightful, bullet points explaining the key factors determining this prediction. Focus on recent performance, injuries, or matchup specifics.
    Return strictly a JSON object with a property "analysis" containing an array of 5 strings.
    `;
    let lastError: unknown = null;
    for (const model of GEMINI_FLASH_MODELS) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: prompt,
                config: { responseMimeType: 'application/json', tools: [{ googleSearch: {} }] }
            });
            const text = response.text || '{ "analysis": [] }';
            const json = JSON.parse(text);
            return { analysis: json.analysis || [], groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [] };
        } catch (e) {
            lastError = e;
        }
    }
    console.error("AI Analysis Failed", lastError);
    return { analysis: ["AI Analysis unavailable at this moment."], groundingChunks: [] };
};
