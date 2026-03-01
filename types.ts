
export interface TeamStatItem {
  label: string;
  value: string;
  rank?: number;
  category?: string; // Added for grouping in detail view
  source?: 'internal_db' | 'espn_api' | 'cached' | 'fallback_standings' | 'derived_schedule';
  sampleSize?: number;
  coverage?: number; // 0..1 where available
  seasonYear?: number;
}

export interface GameSituation {
  down?: number;
  distance?: number;
  yardLine?: number; // 1-100
  possession?: string; // Team ID
  isRedZone?: boolean;
  homeTimeouts?: number;
  awayTimeouts?: number;
  possessionText?: string; // e.g. "NE 25"
  downDistanceText?: string; // e.g. "2nd & 8"
  // Baseball Specific
  balls?: number;
  strikes?: number;
  outs?: number;
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
  batter?: string;
  pitcher?: string;
}

export interface GameOdds {
  spread?: string;
  overUnder?: string;
  moneyLineHome?: string;
  moneyLineAway?: string;
  provider?: string; // e.g., "ESPN BET" or "Consensus"
}

export interface StatCorrelation {
    id: string;
    labels: string[]; // Variations of the stat name from API (e.g. "Points", "PTS", "Points Per Game")
    category: 'OFFENSE' | 'DEFENSE' | 'EFFICIENCY' | 'MISC';
    correlation: number; // -1.0 to 1.0 (Negative means lower is better, e.g., Turnovers)
    weight: number; // 1.0 to 10.0 Importance Factor
    benchmark: number; // The unit size for normalization (e.g. 50 yards, 1 turnover, 0.5 runs)
    description: string; // Explainer text for the UI
}

export interface Game {
  id: string;
  homeTeam: string;
  homeTeamAbbreviation?: string;
  homeTeamId?: string; // Added for possession matching
  homeTeamLogo?: string;
  homeTeamRank?: number;
  homeTeamColor?: string;
  homeTeamAlternateColor?: string;
  homeScore?: string;
  awayTeam: string;
  awayTeamAbbreviation?: string;
  awayTeamId?: string; // Added for possession matching
  awayTeamLogo?: string;
  awayTeamRank?: number;
  awayTeamColor?: string;
  awayTeamAlternateColor?: string;
  awayScore?: string;
  date: string;
  time: string;
  dateTime: string; // ISO string for sorting/filtering
  league: string;
  leagueName?: string; // Added for context (e.g. "UEFA Champions League")
  leagueLogo?: string;
  context?: string; // e.g., "Western Conference First Round"
  gameStatus?: string; // e.g. "Final", "12:34 - 2nd", "Halftime"
  status: 'scheduled' | 'in_progress' | 'finished';
  clock?: string;
  period?: number;
  isPlayoff: boolean;
  isNeutral?: boolean; // e.g. Tournament games, Bowl games
  seriesSummary?: string; // e.g., "BOS leads 2-1"
  broadcast?: string; // e.g., "ESPN", "TNT", "NBC"
  situation?: GameSituation;
  odds?: GameOdds;
  venue?: string;
  location?: string;
  weather?: string;
  temperature?: string;
  seasonYear?: number;
  seasonType?: number;
}

export interface FactorComparison {
    label: string; // e.g. "Offensive Efficiency"
    homeValue: number; // 0-100 normalized
    awayValue: number; // 0-100 normalized
    displayHome: string; // e.g. "5.4 YPP"
    displayAway: string; // e.g. "4.1 YPP"
}

export interface CalculationDetailItem {
    label: string;
    value: string;
    impact: 'positive' | 'negative' | 'neutral'; // Impact on Home Team
    description: string;
}

export interface ConfidenceBreakdown {
  base: number;
  coverage: number; // 0..1
  coveragePoints: number;
  decisiveness: number; // top outcome minus runner-up probability (pct points)
  decisivenessPoints: number;
  evidenceStrength: number; // 0..1 based on strongest factors
  evidencePoints: number;
  liveProgress: number; // 0..1 elapsed game progress contribution
  livePoints: number;
  topOutcome: 'home' | 'away' | 'draw';
  topOutcomeProbability: number;
  runnerUpProbability: number;
  formula: string;
  summary: string;
}

export interface PredictionStats {
  winProbabilityHome: number;
  winProbabilityAway: number;
  drawProbability?: number;
  predictedScoreHome: number;
  predictedScoreAway: number;
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  keyFactors: string[];
  factorBreakdown: FactorComparison[];
  calculationBreakdown: CalculationDetailItem[]; // New field for transparency
  marketOdds?: GameOdds; // OPTIONAL: Only present if real data exists
  isModelOdds: boolean; // Flag to indicate if odds are real or simulated
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface PredictionResult {
  analysis: string[];
  stats: PredictionStats;
  groundingChunks: GroundingChunk[];
}

export interface LineScore {
  period: number;
  displayValue: string; // e.g. "1", "2", "OT"
  homeScore: string;
  awayScore: string;
}

export interface TeamStat {
  label: string;
  homeValue: string;
  awayValue: string;
  homeRank?: number;
  awayRank?: number;
}

export interface ScoringPlay {
  id: string;
  period: number;
  clock: string;
  type: string;
  text: string;
  isHome: boolean;
  homeScore: number;
  awayScore: number;
  teamId?: string; // Added for robust icon matching
}

export interface Play {
  id: string;
  period: number;
  clock: string;
  type: string;
  text: string;
  scoringPlay: boolean;
  homeScore: number;
  awayScore: number;
  teamId?: string;
  wallclock?: string;
  down?: number;
  distance?: number;
  yardLine?: number;
  downDistanceText?: string;
}

export interface Player {
    id: string;
    displayName: string;
    shortName?: string;
    jersey?: string;
    position?: string;
    headshot?: string;
    isStarter?: boolean;
}

export interface PlayerProfile {
    id: string;
    name: string;
    team?: string;
    position?: string;
    jersey?: string;
    headshot?: string;
    height?: string;
    weight?: string;
    age?: number;
    birthPlace?: string;
    stats: {
        title: string; // e.g. "2024 Season"
        data: { label: string; value: string }[];
    }[];
}

export interface BoxScoreStatGroup {
    label: string; // e.g. "Passing"
    labels: string[]; // e.g. ["C/ATT", "YDS"] - these are the column headers
    players: {
        player: Player;
        stats: string[];
    }[];
}

export interface TeamBoxScore {
    teamId: string;
    teamName: string;
    teamLogo?: string;
    teamColor?: string;
    groups: BoxScoreStatGroup[];
}

export interface RacingStatValue {
  key: string;
  label: string;
  abbreviation?: string;
  value: string;
}

export interface RacingCompetitorResult {
  competitorId: string;
  name: string;
  shortName?: string;
  abbreviation?: string;
  logo?: string;
  flag?: string;
  vehicleNumber?: string;
  teamName?: string;
  manufacturer?: string;
  startPosition?: number;
  finishPosition?: number;
  winner?: boolean;
  statusText?: string;
  stats: RacingStatValue[];
}

export interface RacingSessionResult {
  id: string;
  name: string;
  shortName?: string;
  sessionNumber?: number;
  date: string;
  status: 'scheduled' | 'in_progress' | 'finished';
  statusText: string;
  competitors: RacingCompetitorResult[];
}

export interface RacingEventBundle {
  sport: Sport;
  eventId: string;
  name: string;
  shortName: string;
  date: string;
  endDate?: string;
  venue?: string;
  location?: string;
  sessions: RacingSessionResult[];
}

export interface RacingStandingsEntry {
  rank: number;
  competitorId: string;
  name: string;
  shortName?: string;
  abbreviation?: string;
  logo?: string;
  flag?: string;
  teamName?: string;
  manufacturer?: string;
  stats: RacingStatValue[];
}

export interface RacingStandingsTable {
  id: string;
  name: string;
  category: 'driver' | 'team' | 'constructor' | 'other';
  entries: RacingStandingsEntry[];
}

export interface RacingStandingsPayload {
  sport: Sport;
  updatedAt: string;
  derived?: boolean;
  note?: string;
  tables: RacingStandingsTable[];
}

export type SeasonState = 'in_season' | 'preseason' | 'offseason';

export interface GameInfo {
  weather?: string;
  venue?: string;
  attendance?: string;
}

export interface Injury {
    athlete: {
        id: string;
        displayName: string;
        position?: string;
    };
    status: string; // e.g. "Out", "Questionable"
    teamId: string;
}

export interface LeaderAthlete {
    id: string;
    displayName: string;
    headshot?: string;
    displayValue: string;
    position?: string;
    jersey?: string;
}

export interface LeaderCategory {
    name: string;
    displayName: string;
    shortDisplayName?: string;
    leaders: LeaderAthlete[];
}

export interface TeamGameLeaders {
    team: {
        id: string;
        abbreviation?: string;
        logo?: string;
    };
    leaders: LeaderCategory[];
}

export interface GameDetails {
  gameId: string;
  linescores: LineScore[];
  stats: TeamStat[];
  seasonStats?: TeamStat[]; // ADDED: Specific field for Regular Season Stats override
  scoringPlays: ScoringPlay[];
  plays: Play[]; // Added full play-by-play
  gameInfo?: GameInfo;
  injuries: Injury[];
  boxscore?: TeamBoxScore[];
  situation?: GameSituation; // Added to sync field graphic with PBP
  odds?: GameOdds; // Added to capture odds from summary if available
  leaders?: TeamGameLeaders[]; // Added for Season Leaders
  period?: number;
  clock?: string;
  homeScore?: string;
  awayScore?: string;
}

export interface Standing {
  team: {
    id: string;
    name: string;
    abbreviation: string;
    logo?: string;
  };
  stats: {
    wins?: number;
    losses?: number;
    ties?: number;
    pct?: string;
    points?: number;
    gamesBehind?: string;
    streak?: string;
    pointDifferential?: number;
    confRecord?: string; // e.g. "5-1"
    overallRecord?: string; // e.g. "10-2"
  };
  rank: number;
  clincher?: string; // e.g., "x" or "y"
  isChampion?: boolean; // Derived from clincher for UI
  note?: string; // Description of seed/tiebreaker
}

export interface StandingsGroup {
  name: string;
  standings: Standing[];
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
  sub: string; // Google ID
  given_name?: string;
}

export interface TeamOption {
  id: string;
  name: string;
  abbreviation?: string;
  logo?: string;
  league: Sport;
}

export interface StatCategory {
    name: string;
    displayName: string;
    shortDisplayName?: string;
    labels: string[];
    athletes: {
        player: Player;
        stats: string[];
    }[];
}

export interface TeamStatistics {
    categories: StatCategory[];
}

export interface TeamProfile {
  id: string;
  location: string; // City/State/Country
  name: string; // Full Name
  rank?: number;
  abbreviation: string;
  displayName: string;
  color?: string;
  alternateColor?: string;
  logo?: string;
  standingSummary?: string; // e.g. "1st in AFC East"
  record?: string;
  roster: Player[];
  seasonStats?: TeamStatItem[];
  conferenceRank?: string;
  conferenceName?: string;
}

export interface LeagueStatRow {
    team: {
        id: string;
        name: string;
        logo?: string;
    };
    stats: Record<string, string>; // label -> value
    ranks: Record<string, number>; // label -> calculated rank
}

export type StandingsType = 'PLAYOFF' | 'DIVISION';

export type Sport = 
  | 'F1'
  | 'Bundesliga' 
  | 'EPL' 
  | 'INDYCAR'
  | 'La Liga' 
  | 'Ligue 1' 
  | 'MLB' 
  | 'MLS' 
  | 'NBA' 
  | 'NASCAR'
  | 'NCAAF' 
  | 'NCAAM' 
  | 'NCAAW'
  | 'NFL' 
  | 'NHL' 
  | 'Serie A' 
  | 'UCL' 
  | 'UFC' 
  | 'WNBA';

export const SPORTS: Sport[] = [
  'F1',
  'Bundesliga',
  'EPL',
  'INDYCAR',
  'La Liga',
  'Ligue 1',
  'MLB',
  'MLS',
  'NBA',
  'NASCAR',
  'NCAAF',
  'NCAAM',
  'NCAAW',
  'NFL',
  'NHL',
  'Serie A',
  'UCL',
  'UFC',
  'WNBA'
];

export const SOCCER_LEAGUES: Sport[] = ['Bundesliga', 'EPL', 'La Liga', 'Ligue 1', 'MLS', 'Serie A', 'UCL'];
export const RACING_LEAGUES: Sport[] = ['F1', 'INDYCAR', 'NASCAR'];
