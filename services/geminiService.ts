
// This file is deprecated. Please import from the specific modular services.
// services/gameService, services/teamService, services/playerService, services/aiService, services/probabilities/index

export { calculateWinProbability } from './probabilities/index';
export { generateAIAnalysis } from './aiService';
export { fetchStandings, fetchRankings, fetchTeamProfile, fetchTeamSchedule, fetchTeamStatistics } from './teamService';
export { fetchUpcomingGames, fetchGamesForDate, fetchGameDatesForMonth, fetchBracketGames, fetchGameDetails } from './gameService';
export { fetchPlayerProfile } from './playerService';
