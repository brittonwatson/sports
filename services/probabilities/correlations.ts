
import { StatCorrelation, Sport } from "../../types";

// This database defines how specific stats historically correlate with winning outcomes.
// Positive correlation: Higher is better (e.g. Points, Rebounds)
// Negative correlation: Lower is better (e.g. Turnovers, Points Against)
// Benchmark: Used to normalize the delta between teams (e.g. a difference of 50 Yards is significant, but 50 Points is impossible)

const FOOTBALL_CORRELATIONS: StatCorrelation[] = [
    {
        id: 'turnovers',
        labels: ['turnovers', 'turnover margin', 'giveaways'],
        category: 'EFFICIENCY',
        correlation: -0.85, // Highly negative correlation with winning
        weight: 9.0, // Critical factor
        benchmark: 1.0, // 1 turnover difference is significant
        description: 'Ball Security & Takeaways'
    },
    {
        id: 'pass_efficiency',
        labels: ['passing avg', 'net passing yards', 'pass yards', 'yards per pass'],
        category: 'OFFENSE',
        correlation: 0.75,
        weight: 6.5,
        benchmark: 40.0, // 40 yards difference
        description: 'Air Superiority'
    },
    {
        id: 'rush_efficiency',
        labels: ['rushing avg', 'rushing yards', 'rush yards'],
        category: 'OFFENSE',
        correlation: 0.60,
        weight: 5.0,
        benchmark: 35.0,
        description: 'Ground Control'
    },
    {
        id: 'defense_scoring',
        labels: ['points allowed', 'opponent points', 'scoring defense'],
        category: 'DEFENSE',
        correlation: -0.80,
        weight: 8.0,
        benchmark: 4.0, // 4 points difference
        description: 'Scoring Defense'
    },
    {
        id: 'third_down',
        labels: ['3rd down conv %', 'third down conversion percentage', '3rd %'],
        category: 'EFFICIENCY',
        correlation: 0.55,
        weight: 4.0,
        benchmark: 10.0, // 10% difference
        description: 'Drive Sustainability'
    },
    {
        id: 'total_yards',
        labels: ['total yards', 'yards per play', 'ypp'],
        category: 'OFFENSE',
        correlation: 0.65,
        weight: 4.5,
        benchmark: 50.0,
        description: 'Overall Production'
    }
];

const BASKETBALL_CORRELATIONS: StatCorrelation[] = [
    {
        id: 'shooting_efficiency',
        labels: ['field goal %', 'fg%', 'effective fg%'],
        category: 'EFFICIENCY',
        correlation: 0.85,
        weight: 9.5,
        benchmark: 4.0, // 4% difference is huge
        description: 'Shooting Efficiency'
    },
    {
        id: 'three_point',
        labels: ['three point %', '3p%', '3pt %'],
        category: 'OFFENSE',
        correlation: 0.65,
        weight: 6.0,
        benchmark: 5.0,
        description: 'Perimeter Scoring'
    },
    {
        id: 'rebounding',
        labels: ['rebounds', 'total rebounds', 'rebs'],
        category: 'MISC',
        correlation: 0.55,
        weight: 5.0,
        benchmark: 6.0, // 6 rebounds difference
        description: 'Board Control'
    },
    {
        id: 'turnovers',
        labels: ['turnovers', 'to'],
        category: 'EFFICIENCY',
        correlation: -0.70,
        weight: 7.0,
        benchmark: 3.0,
        description: 'Ball Protection'
    },
    {
        id: 'assists',
        labels: ['assists', 'ast'],
        category: 'OFFENSE',
        correlation: 0.45,
        weight: 3.5,
        benchmark: 5.0,
        description: 'Ball Movement'
    },
    {
        id: 'defense_ppg',
        labels: ['points allowed', 'opponent points', 'opp ppg'],
        category: 'DEFENSE',
        correlation: -0.80,
        weight: 8.5,
        benchmark: 5.0,
        description: 'Defensive Intensity'
    }
];

const BASEBALL_CORRELATIONS: StatCorrelation[] = [
    {
        id: 'runs_scored',
        labels: ['runs', 'runs scored', 'r'],
        category: 'OFFENSE',
        correlation: 0.90,
        weight: 10.0,
        benchmark: 1.5,
        description: 'Run Production'
    },
    {
        id: 'batting_avg',
        labels: ['batting average', 'avg', 'obp', 'on base pct'],
        category: 'OFFENSE',
        correlation: 0.60,
        weight: 5.0,
        benchmark: 0.025, // 25 points of batting average
        description: 'Plate Discipline'
    },
    {
        id: 'pitching_era',
        labels: ['earned run average', 'era'],
        category: 'DEFENSE',
        correlation: -0.85,
        weight: 9.0,
        benchmark: 0.75, // 0.75 ERA difference
        description: 'Pitching Staff'
    },
    {
        id: 'whip',
        labels: ['whip'],
        category: 'DEFENSE',
        correlation: -0.75,
        weight: 7.0,
        benchmark: 0.2,
        description: 'Base Traffic Control'
    },
    {
        id: 'home_runs',
        labels: ['home runs', 'hr'],
        category: 'OFFENSE',
        correlation: 0.50,
        weight: 4.0,
        benchmark: 20.0, // Season total diff
        description: 'Power Hitting'
    }
];

const SOCCER_CORRELATIONS: StatCorrelation[] = [
    {
        id: 'goals_for',
        labels: ['goals', 'goals for', 'gf', 'goals per game'],
        category: 'OFFENSE',
        correlation: 0.90,
        weight: 10.0,
        benchmark: 0.5,
        description: 'Attack Potency'
    },
    {
        id: 'goals_against',
        labels: ['goals against', 'ga', 'goals allowed'],
        category: 'DEFENSE',
        correlation: -0.85,
        weight: 9.5,
        benchmark: 0.5,
        description: 'Defensive Solidity'
    },
    {
        id: 'possession',
        labels: ['possession', 'possession %'],
        category: 'MISC',
        correlation: 0.30, // Correlation is weaker than people think
        weight: 2.0,
        benchmark: 10.0,
        description: 'Ball Control'
    },
    {
        id: 'goal_diff',
        labels: ['goal differential', 'diff'],
        category: 'EFFICIENCY',
        correlation: 0.95,
        weight: 8.5,
        benchmark: 1.0,
        description: 'Net Efficiency'
    }
];

export const STAT_CORRELATIONS: Record<string, StatCorrelation[]> = {
    'NFL': FOOTBALL_CORRELATIONS,
    'NCAAF': FOOTBALL_CORRELATIONS,
    'NBA': BASKETBALL_CORRELATIONS,
    'NCAAM': BASKETBALL_CORRELATIONS,
    'NCAAW': BASKETBALL_CORRELATIONS,
    'WNBA': BASKETBALL_CORRELATIONS,
    'MLB': BASEBALL_CORRELATIONS,
    'EPL': SOCCER_CORRELATIONS,
    'MLS': SOCCER_CORRELATIONS,
    'Bundesliga': SOCCER_CORRELATIONS,
    'La Liga': SOCCER_CORRELATIONS,
    'Serie A': SOCCER_CORRELATIONS,
    'Ligue 1': SOCCER_CORRELATIONS,
    'UCL': SOCCER_CORRELATIONS,
    'NHL': [
        // Quick definition for Hockey using Soccer template but adjusted
        { id: 'goals_for', labels: ['goals', 'goals for', 'gf/gp'], category: 'OFFENSE', correlation: 0.9, weight: 10, benchmark: 0.5, description: 'Scoring Rate' },
        { id: 'goals_against', labels: ['goals against', 'ga/gp'], category: 'DEFENSE', correlation: -0.85, weight: 9, benchmark: 0.5, description: 'Goaltending & Defense' },
        { id: 'power_play', labels: ['power play %', 'pp%'], category: 'EFFICIENCY', correlation: 0.6, weight: 5, benchmark: 5.0, description: 'Special Teams (PP)' },
        { id: 'penalty_kill', labels: ['penalty kill %', 'pk%'], category: 'DEFENSE', correlation: 0.55, weight: 4.5, benchmark: 5.0, description: 'Special Teams (PK)' }
    ]
};
