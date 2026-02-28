
import { TeamStatItem } from "../types";

// Seed data to ensure the app feels "built-in" with data immediately.
// This acts as the shipping database.

const createStat = (label: string, value: string, category: string, rank?: number): TeamStatItem => ({ label, value, category, rank });

export const SEEDED_STATS: Record<string, TeamStatItem[]> = {
    // --- NBA ---
    // Boston Celtics - ID 2
    'NBA-2': [
        createStat('Points', '120.5', 'Team', 1),
        createStat('Rebounds', '46.5', 'Team', 2),
        createStat('Assists', '26.8', 'Team', 5),
        createStat('Field Goal %', '48.5%', 'Team', 3),
        createStat('3-Point %', '38.2%', 'Team', 1),
        createStat('Opponent Points', '109.2', 'Opponent', 4),
        createStat('Opponent Rebounds', '43.1', 'Opponent', 8),
        createStat('Opponent Field Goal %', '45.1%', 'Opponent', 2),
        createStat('Points Differential', '+11.3', 'Differential', 1),
        createStat('Rebounds Differential', '+3.4', 'Differential', 3),
        createStat('Field Goal % Differential', '+3.4%', 'Differential', 2)
    ],
    // Denver Nuggets - ID 7
    'NBA-7': [
        createStat('Points', '115.2', 'Team', 5),
        createStat('Rebounds', '44.2', 'Team', 8),
        createStat('Assists', '29.1', 'Team', 1),
        createStat('Field Goal %', '49.8%', 'Team', 1),
        createStat('3-Point %', '36.5%', 'Team', 10),
        createStat('Opponent Points', '110.5', 'Opponent', 9),
        createStat('Opponent Rebounds', '42.0', 'Opponent', 5),
        createStat('Opponent Field Goal %', '46.2%', 'Opponent', 12),
        createStat('Points Differential', '+4.7', 'Differential', 4),
        createStat('Rebounds Differential', '+2.2', 'Differential', 6),
        createStat('Field Goal % Differential', '+3.6%', 'Differential', 1)
    ],
    // Milwaukee Bucks - ID 15
    'NBA-15': [
        createStat('Points', '121.2', 'Team', 2),
        createStat('Rebounds', '44.8', 'Team', 6),
        createStat('Assists', '26.0', 'Team', 12),
        createStat('Field Goal %', '49.1%', 'Team', 4),
        createStat('3-Point %', '37.8%', 'Team', 5),
        createStat('Opponent Points', '117.5', 'Opponent', 20),
        createStat('Points Differential', '+3.7', 'Differential', 8)
    ],

    // --- NFL ---
    // Kansas City Chiefs - ID 12
    'NFL-12': [
        createStat('Points', '28.5', 'Team', 2),
        createStat('Total Yards', '390.5', 'Team', 1),
        createStat('Passing Yards', '285.2', 'Team', 1),
        createStat('Rushing Yards', '105.3', 'Team', 20),
        createStat('Points Allowed', '17.5', 'Team', 3),
        createStat('Yards Allowed', '295.0', 'Team', 4),
        createStat('Sacks', '45', 'Team', 2),
        createStat('Interceptions', '12', 'Team', 8),
        createStat('Turnover Differential', '+5', 'Differential', 5)
    ],
    // San Francisco 49ers - ID 25
    'NFL-25': [
        createStat('Points', '29.2', 'Team', 1),
        createStat('Total Yards', '388.0', 'Team', 2),
        createStat('Passing Yards', '255.0', 'Team', 4),
        createStat('Rushing Yards', '133.0', 'Team', 3),
        createStat('Points Allowed', '16.8', 'Team', 2),
        createStat('Yards Allowed', '300.5', 'Team', 6),
        createStat('Sacks', '48', 'Team', 1),
        createStat('Interceptions', '18', 'Team', 1),
        createStat('Turnover Differential', '+10', 'Differential', 1)
    ],

    // --- EPL ---
    // Man City
    'EPL-382': [
        createStat('Goals', '2.6', 'Offense', 1),
        createStat('Shots', '19.2', 'Offense', 1),
        createStat('Possession', '66.2%', 'Offense', 1),
        createStat('Pass %', '90.5%', 'Offense', 1),
        createStat('Goals Against', '0.9', 'Defense', 2),
        createStat('Clean Sheets', '12', 'Defense', 2),
        createStat('Goal Differential', '+1.7', 'Differential', 1)
    ],
    // Liverpool
    'EPL-364': [
        createStat('Goals', '2.4', 'Offense', 2),
        createStat('Shots', '18.5', 'Offense', 2),
        createStat('Possession', '60.1%', 'Offense', 3),
        createStat('Goals Against', '0.8', 'Defense', 1),
        createStat('Clean Sheets', '13', 'Defense', 1),
        createStat('Goal Differential', '+1.6', 'Differential', 2)
    ],
    // Arsenal
    'EPL-359': [
        createStat('Goals', '2.3', 'Offense', 3),
        createStat('Shots', '17.8', 'Offense', 3),
        createStat('Goals Against', '0.7', 'Defense', 1),
        createStat('Clean Sheets', '14', 'Defense', 1),
        createStat('Goal Differential', '+1.6', 'Differential', 3)
    ],

    // --- La Liga ---
    // Real Madrid
    'La Liga-86': [
        createStat('Goals', '2.4', 'Offense', 1),
        createStat('Shots', '16.5', 'Offense', 1),
        createStat('Possession', '59.5%', 'Offense', 2),
        createStat('Goals Against', '0.8', 'Defense', 1),
        createStat('Goal Differential', '+1.6', 'Differential', 1)
    ],
    // Barcelona
    'La Liga-83': [
        createStat('Goals', '2.2', 'Offense', 2),
        createStat('Shots', '15.8', 'Offense', 2),
        createStat('Possession', '64.2%', 'Offense', 1),
        createStat('Goals Against', '0.9', 'Defense', 2),
        createStat('Goal Differential', '+1.3', 'Differential', 2)
    ],

    // --- Bundesliga ---
    // Bayern Munich
    'Bundesliga-132': [
        createStat('Goals', '2.9', 'Offense', 1),
        createStat('Shots', '19.5', 'Offense', 1),
        createStat('Possession', '63.0%', 'Offense', 1),
        createStat('Goals Against', '1.0', 'Defense', 2),
        createStat('Goal Differential', '+1.9', 'Differential', 1)
    ],
    // Leverkusen
    'Bundesliga-131': [
        createStat('Goals', '2.5', 'Offense', 2),
        createStat('Shots', '17.2', 'Offense', 2),
        createStat('Possession', '61.5%', 'Offense', 2),
        createStat('Goals Against', '0.8', 'Defense', 1),
        createStat('Goal Differential', '+1.7', 'Differential', 2)
    ],

    // --- Serie A ---
    // Inter
    'Serie A-110': [
        createStat('Goals', '2.3', 'Offense', 1),
        createStat('Shots', '15.5', 'Offense', 2),
        createStat('Possession', '56.0%', 'Offense', 3),
        createStat('Goals Against', '0.6', 'Defense', 1),
        createStat('Goal Differential', '+1.7', 'Differential', 1)
    ],
    // Juventus
    'Serie A-111': [
        createStat('Goals', '1.8', 'Offense', 4),
        createStat('Shots', '13.5', 'Offense', 5),
        createStat('Goals Against', '0.5', 'Defense', 1),
        createStat('Clean Sheets', '15', 'Defense', 1),
        createStat('Goal Differential', '+1.3', 'Differential', 2)
    ],

    // --- Ligue 1 ---
    // PSG
    'Ligue 1-160': [
        createStat('Goals', '2.5', 'Offense', 1),
        createStat('Shots', '16.8', 'Offense', 1),
        createStat('Possession', '65.0%', 'Offense', 1),
        createStat('Goals Against', '0.9', 'Defense', 2),
        createStat('Goal Differential', '+1.6', 'Differential', 1)
    ],

    // --- MLS ---
    // Inter Miami
    'MLS-20232': [
        createStat('Goals', '2.3', 'Offense', 1),
        createStat('Shots', '14.5', 'Offense', 3),
        createStat('Possession', '56.5%', 'Offense', 2),
        createStat('Goals Against', '1.4', 'Defense', 12),
        createStat('Goal Differential', '+0.9', 'Differential', 1)
    ],
    // LAFC
    'MLS-18977': [
        createStat('Goals', '1.9', 'Offense', 2),
        createStat('Shots', '15.2', 'Offense', 1),
        createStat('Goals Against', '1.1', 'Defense', 3),
        createStat('Goal Differential', '+0.8', 'Differential', 2)
    ],

    // --- UCL ---
    // Man City
    'UCL-382': [
        createStat('Goals', '2.8', 'Offense', 1),
        createStat('Shots', '20.0', 'Offense', 1),
        createStat('Goals Against', '1.0', 'Defense', 5),
        createStat('Goal Differential', '+1.8', 'Differential', 1)
    ],
    // Real Madrid
    'UCL-86': [
        createStat('Goals', '2.2', 'Offense', 4),
        createStat('Shots', '17.0', 'Offense', 3),
        createStat('Goals Against', '1.1', 'Defense', 8),
        createStat('Goal Differential', '+1.1', 'Differential', 4)
    ]
};
