
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Game, Player, TeamProfile, Sport, PlayerProfile, TeamStatistics, PredictionResult, GameDetails, TeamStatItem, StatCategory } from '../types';
import { GameCard } from './GameCard';
import { PredictionView } from './PredictionView';
import { LiveGameView } from './LiveGameView';
import { StatDetailModal } from './modals/StatDetailModal';
import { User, Calendar, List, MapPin, Hash, BarChart2, X, Loader2, Trophy, Activity, TrendingUp, Target, Zap, ShieldCheck, Gauge, ExternalLink, Database, AlertTriangle } from 'lucide-react';
import { fetchPlayerProfile } from '../services/playerService';
import { fetchTeamStatistics, fetchTeamCurrentSeasonStatsDetailed, getStoredTeamSeasonStats } from '../services/teamService';
import { STAT_CORRELATIONS } from '../services/probabilities/correlations';
import { findCorrelationConfig } from '../services/probabilities/utils';
import { dbEvents } from '../services/statsDb';
import { getRankColor } from '../services/uiUtils';

interface TeamDetailViewProps {
  team: TeamProfile;
  schedule: Game[];
  league: Sport;
  onPlayerClick?: (playerId: string) => void;
  onGameSelect: (game: Game) => void;
  selectedGameId: string | undefined;
  prediction?: PredictionResult | null;
  gameDetails?: GameDetails | null;
  isPredicting?: boolean;
  isDarkMode?: boolean;
  onGenerateAnalysis?: () => void;
  onTeamClick?: (teamId: string, league: Sport) => void;
  isGameFollowed?: (game: Game) => boolean;
  onToggleFollowGame?: (game: Game, e: React.MouseEvent<HTMLButtonElement>) => void;
}

interface IdentityItem {
    label: string;
    value: string;
    rank: number;
    rating: string;
    color: string;
    description: string;
}

const getPositionOrder = (sport: Sport, position: string | undefined): number => {
    if (!position) return 999;
    const pos = position.toUpperCase();
    
    const orders: Record<string, string[]> = {
        'NFL': ['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'C', 'G', 'T', 'OT', 'OG', 'DL', 'DT', 'DE', 'LB', 'ILB', 'OLB', 'CB', 'DB', 'S', 'FS', 'SS', 'K', 'PK', 'P', 'LS'],
        'NCAAF': ['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'C', 'G', 'T', 'OT', 'OG', 'DL', 'DT', 'DE', 'LB', 'ILB', 'OLB', 'CB', 'DB', 'S', 'FS', 'SS', 'K', 'P', 'LS'],
        'NBA': ['PG', 'G', 'SG', 'SF', 'F', 'PF', 'C'],
        'MLB': ['P', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'IF', 'LF', 'CF', 'RF', 'OF', 'DH'],
        'NHL': ['C', 'LW', 'RW', 'F', 'D', 'G'],
        'SOCCER': ['GK', 'D', 'DF', 'CD', 'RB', 'LB', 'M', 'MF', 'DM', 'CM', 'AM', 'LM', 'RM', 'F', 'FW', 'ST', 'CF']
    };

    let lookup = orders[sport];
    if (!lookup) {
        if (['NCAAM', 'NCAAW', 'WNBA'].includes(sport)) lookup = orders['NBA'];
        else if (['EPL', 'Bundesliga', 'La Liga', 'Ligue 1', 'Serie A', 'MLS', 'UCL'].includes(sport)) lookup = orders['SOCCER'];
        else lookup = [];
    }
    
    if (lookup.length === 0) return 999;
    const idx = lookup.indexOf(pos);
    return idx !== -1 ? idx : 999;
};

const getSoccerLeagueName = (sport: string, summary?: string) => {
    if (summary && summary.includes(' in ')) return summary.split(' in ')[1];
    const map: Record<string, string> = { 'EPL': 'Premier League', 'MLS': 'Major League Soccer', 'UCL': 'Champions League', 'Bundesliga': 'Bundesliga', 'La Liga': 'La Liga', 'Serie A': 'Serie A', 'Ligue 1': 'Ligue 1' };
    return map[sport] || sport;
};

const cleanStatValue = (label: string, value: string | number | undefined | null): string => {
    if (value === null || value === undefined) return '-';
    const strValue = String(value);
    const hadPlusPrefix = strValue.trim().startsWith('+');
    if (/[a-zA-Z]/.test(strValue) && !strValue.toLowerCase().includes('e')) return strValue;
    const rawNum = parseFloat(strValue.replace(/,/g, '').replace('%', ''));
    if (isNaN(rawNum)) return strValue;
    const lowerLabel = label.toLowerCase();
    const isPercent = strValue.includes('%') || lowerLabel.includes('pct') || lowerLabel.includes('percentage') || lowerLabel.includes('%') || lowerLabel.includes('rate');
    if (isPercent) {
        let finalNum = rawNum;
        if (!strValue.includes('%') && Math.abs(rawNum) <= 1.0 && rawNum !== 0) finalNum = rawNum * 100;
        return `${finalNum.toFixed(1)}%`;
    }
    if (strValue.includes('.')) {
        const formatted = rawNum.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        return hadPlusPrefix && rawNum > 0 ? `+${formatted}` : formatted;
    }
    const rounded = Math.round(rawNum);
    const formatted = rounded.toLocaleString();
    return hadPlusPrefix && rounded > 0 ? `+${formatted}` : formatted;
};

const formatPlayerStatCell = (label: string, value: string | number | undefined | null): string => {
    if (value === null || value === undefined) return '-';
    const strValue = String(value).trim();
    if (!strValue) return '-';
    if (/^\s*-?\d+(?:\.\d+)?\s*[\/-]\s*-?\d+(?:\.\d+)?\s*$/.test(strValue)) return strValue;
    if (/^\s*\d+:\d{2}(?::\d{2})?\s*$/.test(strValue)) return strValue;
    if (label.toLowerCase() === 'gp') {
        const gp = parseFloat(strValue);
        return Number.isFinite(gp) ? String(Math.round(gp)) : strValue;
    }
    if (strValue.includes('.') || strValue.includes('%')) return strValue;
    return cleanStatValue(label, strValue);
};

const parseStatFloat = (value: string | number | undefined | null): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = parseFloat(String(value).replace(/,/g, '').replace('%', '').replace('+', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
};

export const TeamDetailView: React.FC<TeamDetailViewProps> = ({ 
    team, schedule, league, onGameSelect, selectedGameId, prediction, gameDetails, isPredicting, isDarkMode = true, onGenerateAnalysis, onTeamClick, isGameFollowed, onToggleFollowGame
}) => {
    const [activeTab, setActiveTab] = useState<'SCHEDULE' | 'ROSTER' | 'STATS'>('SCHEDULE');
    const [scheduleFilter, setScheduleFilter] = useState<'UPCOMING' | 'PAST'>('UPCOMING');
    
    // UI State
    const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
    const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
    const [isPlayerLoading, setIsPlayerLoading] = useState(false);
    
    // Stat Detail State
    const [selectedStat, setSelectedStat] = useState<{ label: string; value: string; rank?: number; category?: string; initialView?: 'DETAILS' | 'LEADERBOARD' } | null>(null);

    // Team Statistics State (For Player Leaders)
    const [teamStats, setTeamStats] = useState<TeamStatistics | null>(null);
    const [isStatsLoading, setIsStatsLoading] = useState(false);

    // Live Season Stats override (for real-time updates)
    const [liveSeasonStats, setLiveSeasonStats] = useState<TeamStatItem[] | undefined>(team.seasonStats);
    const [isSeasonStatsLoading, setIsSeasonStatsLoading] = useState(false);

    useEffect(() => {
        setLiveSeasonStats(team.seasonStats);
    }, [team.seasonStats]);

    useEffect(() => {
        let cancelled = false;

        const loadSeasonStats = async () => {
            setIsSeasonStatsLoading(true);
            try {
                let freshStats = await getStoredTeamSeasonStats(league, { id: team.id, name: team.name, logo: team.logo });
                if (freshStats.length === 0) {
                    freshStats = await fetchTeamCurrentSeasonStatsDetailed(league, team.id);
                }
                if (!cancelled && freshStats.length > 0) {
                    setLiveSeasonStats(freshStats);
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (!cancelled) setIsSeasonStatsLoading(false);
            }
        };

        loadSeasonStats();
        return () => { cancelled = true; };
    }, [league, team.id, team.name, team.logo]);

    useEffect(() => {
        const handleUpdate = async (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail?.sport === league) {
                 let freshStats = await getStoredTeamSeasonStats(league, { id: team.id, name: team.name, logo: team.logo });
                 if (freshStats.length === 0) {
                     freshStats = await fetchTeamCurrentSeasonStatsDetailed(league, team.id);
                 }
                 setLiveSeasonStats(freshStats);
            }
        };
        dbEvents.addEventListener('stats_updated', handleUpdate);
        return () => dbEvents.removeEventListener('stats_updated', handleUpdate);
    }, [league, team.id, team.name, team.logo]);

    useEffect(() => {
        if (activeTab === 'STATS' && !teamStats && !isStatsLoading) {
            const loadStats = async () => {
                setIsStatsLoading(true);
                try {
                    const stats = await fetchTeamStatistics(league, team.id);
                    setTeamStats(stats);
                } catch (e) { console.error(e); }
                finally { setIsStatsLoading(false); }
            };
            loadStats();
        }
    }, [activeTab, league, team.id]);

    const seasonStatsGamesPlayed = useMemo(() => {
        if (!liveSeasonStats || liveSeasonStats.length === 0) return 0;
        const gpStat = liveSeasonStats.find(stat => {
            const label = stat.label.toLowerCase();
            return label === 'games played' || label === 'games' || label === 'gp';
        });
        if (!gpStat) return 0;
        const gp = parseFloat(String(gpStat.value).replace(/,/g, ''));
        return Number.isFinite(gp) ? gp : 0;
    }, [liveSeasonStats]);

    const completedSeasonGames = useMemo(() => {
        const completed = schedule.filter(g => {
            if (g.status !== 'finished') return false;
            if (typeof g.seasonType === 'number' && g.seasonType === 1) return false;
            const homeScore = parseInt(String(g.homeScore ?? ''), 10);
            const awayScore = parseInt(String(g.awayScore ?? ''), 10);
            return Number.isFinite(homeScore) && Number.isFinite(awayScore);
        });
        if (completed.length === 0) return [] as Game[];

        const seasonYearCounts = new Map<number, number>();
        completed.forEach(g => {
            if (typeof g.seasonYear !== 'number' || !Number.isFinite(g.seasonYear)) return;
            seasonYearCounts.set(g.seasonYear, (seasonYearCounts.get(g.seasonYear) || 0) + 1);
        });

        if (seasonYearCounts.size === 0) return completed;

        let selectedSeasonYear: number | null = null;
        let selectedCount = -1;
        seasonYearCounts.forEach((count, seasonYear) => {
            if (count > selectedCount || (count === selectedCount && (selectedSeasonYear === null || seasonYear > selectedSeasonYear))) {
                selectedSeasonYear = seasonYear;
                selectedCount = count;
            }
        });

        if (selectedSeasonYear === null) return completed;
        return completed.filter(g => typeof g.seasonYear !== 'number' || g.seasonYear === selectedSeasonYear);
    }, [schedule]);

    const seasonStatsForDisplay = useMemo(() => {
        if (!liveSeasonStats || liveSeasonStats.length === 0) return [] as TeamStatItem[];
        if (league === 'UFC') return liveSeasonStats;

        const completed = completedSeasonGames;
        if (completed.length === 0) return liveSeasonStats;

        // Some leagues (notably NCAAF off-season) can return partial schedules.
        // If schedule coverage is materially below known season GP, trust season stats feed.
        const hasReliableSeasonGp = seasonStatsGamesPlayed > 0;
        const scheduleCoverageRatio = hasReliableSeasonGp ? (completed.length / seasonStatsGamesPlayed) : 1;
        if (hasReliableSeasonGp && scheduleCoverageRatio < 0.8) {
            return liveSeasonStats;
        }

        let wins = 0;
        let losses = 0;
        let ties = 0;
        let pf = 0;
        let pa = 0;
        completed.forEach(g => {
            const isHome = g.homeTeam === team.name || g.homeTeam === team.displayName || (team.id && g.homeTeamId === team.id);
            const scoreFor = parseInt(String((isHome ? g.homeScore : g.awayScore) ?? '0'), 10);
            const scoreAgainst = parseInt(String((isHome ? g.awayScore : g.homeScore) ?? '0'), 10);
            pf += scoreFor;
            pa += scoreAgainst;
            if (scoreFor > scoreAgainst) wins += 1;
            else if (scoreFor < scoreAgainst) losses += 1;
            else ties += 1;
        });

        const gp = completed.length;
        const seasonYear = typeof completed[0]?.seasonYear === 'number' ? completed[0].seasonYear : undefined;
        const coverage = hasReliableSeasonGp ? Math.max(0, Math.min(1, gp / seasonStatsGamesPlayed)) : undefined;
        const ppg = gp > 0 ? pf / gp : 0;
        const oppg = gp > 0 ? pa / gp : 0;
        const avgDiff = ppg - oppg;

        const next = [...liveSeasonStats];
        const upsert = (label: string, value: string, category: string) => {
            const idx = next.findIndex(s => s.label.toLowerCase() === label.toLowerCase());
            if (idx >= 0) {
                next[idx] = { ...next[idx], value, category, source: 'derived_schedule', sampleSize: gp, coverage, seasonYear };
            } else {
                next.push({ label, value, category, source: 'derived_schedule', sampleSize: gp, coverage, seasonYear });
            }
        };

        upsert('Wins', String(wins), 'General');
        upsert('Losses', String(losses), 'General');
        upsert('Games Played', String(gp), 'General');
        if (ties > 0) upsert('Ties', String(ties), 'General');
        upsert('Points', ppg.toFixed(1), 'Team');
        upsert('Opponent Points', oppg.toFixed(1), 'Opponent');
        upsert('Points Differential', avgDiff > 0 ? `+${avgDiff.toFixed(1)}` : avgDiff.toFixed(1), 'Differential');

        return next;
    }, [liveSeasonStats, seasonStatsGamesPlayed, completedSeasonGames, league, team.id, team.name, team.displayName]);

    const statsSourceSummary = useMemo(() => {
        const sourcePriority: TeamStatItem['source'][] = ['derived_schedule', 'internal_db', 'espn_api', 'cached', 'fallback_standings'];
        const labels: Record<NonNullable<TeamStatItem['source']>, string> = {
            derived_schedule: 'Derived Season Aggregate',
            internal_db: 'Internal Database',
            espn_api: 'ESPN API',
            cached: 'Cached Snapshot',
            fallback_standings: 'Standings Fallback',
        };
        const sources = Array.from(
            new Set(
                (seasonStatsForDisplay || [])
                    .map((s) => s.source)
                    .filter((s): s is NonNullable<TeamStatItem['source']> => Boolean(s)),
            ),
        );
        const selected = sourcePriority.find((source) => sources.includes(source)) || sources[0];
        const sampleSize = (seasonStatsForDisplay || []).reduce((max, stat) => {
            const sample = typeof stat.sampleSize === 'number' ? stat.sampleSize : 0;
            return Math.max(max, sample);
        }, 0);
        const coverageValues = (seasonStatsForDisplay || [])
            .map((stat) => (typeof stat.coverage === 'number' ? stat.coverage : null))
            .filter((value): value is number => value !== null);
        const coverage = coverageValues.length > 0
            ? coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length
            : null;

        return {
            source: selected,
            label: selected ? labels[selected] : 'Unknown Source',
            sourceCount: sources.length,
            sampleSize: sampleSize > 0 ? sampleSize : null,
            coverage,
        };
    }, [seasonStatsForDisplay]);

    const scheduleCoverageRatio = useMemo(() => {
        if (seasonStatsGamesPlayed <= 0) return null;
        return Math.max(0, Math.min(1.25, completedSeasonGames.length / seasonStatsGamesPlayed));
    }, [completedSeasonGames.length, seasonStatsGamesPlayed]);

    const integrityWarnings = useMemo(() => {
        const warnings: string[] = [];

        if (scheduleCoverageRatio !== null && scheduleCoverageRatio < 0.75) {
            warnings.push(`Finished-game coverage is ${Math.round(scheduleCoverageRatio * 100)}% of reported games played.`);
        }

        if (completedSeasonGames.length > 0 && (scheduleCoverageRatio === null || scheduleCoverageRatio >= 0.85)) {
            let pf = 0;
            let pa = 0;
            completedSeasonGames.forEach((g) => {
                const isHome = g.homeTeam === team.name || g.homeTeam === team.displayName || (team.id && g.homeTeamId === team.id);
                pf += parseInt(String((isHome ? g.homeScore : g.awayScore) ?? '0'), 10);
                pa += parseInt(String((isHome ? g.awayScore : g.homeScore) ?? '0'), 10);
            });
            const gp = completedSeasonGames.length;
            const calcPpg = gp > 0 ? pf / gp : 0;
            const calcOppg = gp > 0 ? pa / gp : 0;
            const statsPpg = parseStatFloat(seasonStatsForDisplay.find((s) => s.label.toLowerCase() === 'points')?.value);
            const statsOppg = parseStatFloat(seasonStatsForDisplay.find((s) => s.label.toLowerCase() === 'opponent points')?.value);

            if (statsPpg !== null && Math.abs(statsPpg - calcPpg) > 6) {
                warnings.push(`Points average mismatch detected (${statsPpg.toFixed(1)} shown vs ${calcPpg.toFixed(1)} from finished games).`);
            }
            if (statsOppg !== null && Math.abs(statsOppg - calcOppg) > 6) {
                warnings.push(`Opponent points average mismatch detected (${statsOppg.toFixed(1)} shown vs ${calcOppg.toFixed(1)} from finished games).`);
            }
        }

        return warnings;
    }, [scheduleCoverageRatio, completedSeasonGames, seasonStatsForDisplay, team.id, team.name, team.displayName]);

    const statsSections = useMemo(() => {
        if (!seasonStatsForDisplay || seasonStatsForDisplay.length === 0) return [] as { category: string; stats: TeamStatItem[] }[];

        const inferDisplayCategory = (stat: TeamStatItem): string => {
            const label = stat.label.toLowerCase();
            const sourceCategory = String(stat.category || '').trim();
            const sourceCategoryLower = sourceCategory.toLowerCase();

            const OFFENSE_SOURCE_CATEGORIES = new Set([
                'team',
                'offense',
                'passing',
                'rushing',
                'receiving',
                'shooting',
                'rebounding',
                'batting',
            ]);
            const DEFENSE_SOURCE_CATEGORIES = new Set([
                'defense',
                'opponent',
                'fielding',
                'pitching',
            ]);
            const OTHER_SOURCE_CATEGORIES = new Set([
                'general',
                'differential',
                'special teams',
                'ball control',
                'efficiency',
            ]);

            if (label === 'wins' || label === 'losses' || label === 'ties' || label === 'games played' || label === 'games' || label === 'gp') {
                return 'General';
            }
            if (label.includes('differential') || label.includes('margin')) return 'Differential';
            if (label.includes('opponent') || label.includes('allowed') || label.includes('against')) return 'Defense';
            if (label.includes('kick') || label.includes('punt') || label.includes('return')) return 'Special Teams';

            if (sourceCategoryLower && !OTHER_SOURCE_CATEGORIES.has(sourceCategoryLower)) {
                if (OFFENSE_SOURCE_CATEGORIES.has(sourceCategoryLower)) return 'Offense';
                if (DEFENSE_SOURCE_CATEGORIES.has(sourceCategoryLower)) return 'Defense';
            }

            if (league === 'NFL' || league === 'NCAAF') {
                if (label.includes('pass') || label.includes('rush') || label.includes('touchdown') || label.includes('yard') || label.includes('first down') || label.includes('play') || label.includes('drive')) return 'Offense';
                if (label.includes('interception') || label.includes('sack') || label.includes('fumble')) return 'Defense';
            }

            if (sourceCategoryLower === 'special teams') return 'Special Teams';
            if (sourceCategoryLower === 'ball control' || sourceCategoryLower === 'efficiency') return 'Efficiency';
            if (sourceCategoryLower === 'general') return 'General';
            if (sourceCategoryLower === 'differential') return 'Differential';

            if (label.includes('field goal') || label.includes('three point') || label.includes('free throw') || label.includes('rebound') || label.includes('assist') || label.includes('points in paint') || label.includes('fast break')) return 'Offense';
            if (label.includes('steal') || label.includes('block') || label.includes('foul') || label.includes('save') || label.includes('clearance') || label.includes('tackle') || label.includes('interception')) return 'Defense';
            if (label.includes('ratio') || label.includes('rate') || label.includes('per ') || label.includes('efficiency')) return 'Efficiency';
            if (label.includes('%')) return 'Efficiency';

            return 'Other';
        };

        const groups = new Map<string, TeamStatItem[]>();
        seasonStatsForDisplay.forEach(stat => {
            const category = inferDisplayCategory(stat);
            if (!groups.has(category)) groups.set(category, []);
            groups.get(category)!.push(stat);
        });

        const categoryPriority = [
            'Offense',
            'Defense',
            'Differential',
            'Efficiency',
            'Special Teams',
            'General',
            'Other',
        ];

        return Array.from(groups.entries())
            .map(([category, stats]) => ({
                category,
                stats: [...stats].sort((a, b) => {
                    const rankA = a.rank ?? 9999;
                    const rankB = b.rank ?? 9999;
                    if (rankA !== rankB) return rankA - rankB;
                    return a.label.localeCompare(b.label);
                })
            }))
            .sort((a, b) => {
                const aIdx = categoryPriority.indexOf(a.category);
                const bIdx = categoryPriority.indexOf(b.category);
                if (aIdx === -1 && bIdx === -1) return a.category.localeCompare(b.category);
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
            });
    }, [seasonStatsForDisplay]);

    const identity: IdentityItem[] = useMemo(() => {
        if (!seasonStatsForDisplay) return [];
        const sportCorrelations = STAT_CORRELATIONS[league] || [];
        return seasonStatsForDisplay.reduce((acc: IdentityItem[], stat) => {
            const config = findCorrelationConfig(stat.label, sportCorrelations);
            if (config && stat.rank) {
                let rating = 'Neutral';
                let color = 'text-slate-500';
                if (stat.rank <= 5) { rating = 'Elite'; color = 'text-emerald-500'; }
                else if (stat.rank <= 15) { rating = 'Strong'; color = 'text-emerald-400'; }
                else if (stat.rank >= 25) { rating = 'Weakness'; color = 'text-rose-500'; }
                if (rating !== 'Neutral') {
                    acc.push({
                        label: stat.label, value: stat.value, rank: stat.rank, rating, color, description: config.description
                    });
                }
            }
            return acc;
        }, [] as IdentityItem[]).sort((a, b) => a.rank - b.rank).slice(0, 4); 
    }, [seasonStatsForDisplay, league]);

    const { upcomingGames, pastGames } = useMemo(() => {
        const now = new Date();
        const upcoming = schedule.filter(g => new Date(g.dateTime) >= now || g.status === 'in_progress').sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
        const past = schedule.filter(g => new Date(g.dateTime) < now && g.status !== 'in_progress').sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
        return { upcomingGames: upcoming, pastGames: past };
    }, [schedule]);

    const computedStats = useMemo(() => {
        const completed = completedSeasonGames;
        if (completed.length === 0) return null;

        const hasReliableSeasonGp = seasonStatsGamesPlayed > 0;
        const scheduleCoverageRatio = hasReliableSeasonGp ? (completed.length / seasonStatsGamesPlayed) : 1;
        if (hasReliableSeasonGp && scheduleCoverageRatio < 0.8) {
            return null;
        }

        let wins = 0, losses = 0, ties = 0, pf = 0, pa = 0;
        let homeWins = 0, homeLosses = 0, homeTies = 0, awayWins = 0, awayLosses = 0, awayTies = 0;
        const streaks: ('W' | 'L' | 'T')[] = [];
        const chronological = [...completed].sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
        chronological.forEach(g => {
            const isHome = g.homeTeam === team.name || g.homeTeam === team.displayName || (team.id && g.homeTeamId === team.id);
            const scoreFor = parseInt(String((isHome ? g.homeScore : g.awayScore) ?? '0'), 10);
            const scoreAgainst = parseInt(String((isHome ? g.awayScore : g.homeScore) ?? '0'), 10);
            pf += scoreFor; pa += scoreAgainst;
            let result: 'W' | 'L' | 'T' = 'T';
            if (scoreFor > scoreAgainst) result = 'W'; else if (scoreFor < scoreAgainst) result = 'L';
            streaks.push(result);
            if (result === 'W') { wins++; if (isHome) homeWins++; else awayWins++; }
            else if (result === 'L') { losses++; if (isHome) homeLosses++; else awayLosses++; }
            else { ties++; if (isHome) homeTies++; else awayTies++; }
        });
        const gp = completed.length;
        const last5 = streaks.slice(-5).reverse();
        const l5Wins = last5.filter(r => r === 'W').length;
        const l5Losses = last5.filter(r => r === 'L').length;
        const l5Ties = last5.filter(r => r === 'T').length;
        let currentStreak = '';
        if (streaks.length > 0) {
            const last = streaks[streaks.length - 1];
            let count = 0;
            for (let i = streaks.length - 1; i >= 0; i--) { if (streaks[i] === last) count++; else break; }
            currentStreak = `${last}${count}`;
        }
        const avgDiffVal = (pf - pa) / gp;
        return {
            gp, wins, losses, ties, ppg: Math.round(pf / gp).toString(), oppg: Math.round(pa / gp).toString(), diff: (pf - pa).toString(), avgDiff: Math.abs(avgDiffVal) < 0.1 ? "0" : Math.round(avgDiffVal).toString(),
            homeRecord: `${homeWins}-${homeLosses}${homeTies > 0 ? `-${homeTies}` : ''}`, awayRecord: `${awayWins}-${awayLosses}${awayTies > 0 ? `-${awayTies}` : ''}`,
            last5: `${l5Wins}-${l5Losses}${l5Ties > 0 ? `-${l5Ties}` : ''}`, streak: currentStreak
        };
    }, [completedSeasonGames, seasonStatsGamesPlayed, team.name, team.displayName, team.id]);

    const displayRecord = useMemo(() => {
        if (!computedStats) return team.record;
        return `${computedStats.wins}-${computedStats.losses}${computedStats.ties > 0 ? `-${computedStats.ties}` : ''}`;
    }, [computedStats, team.record]);

    const isSoccer = ['EPL', 'Bundesliga', 'La Liga', 'Ligue 1', 'Serie A', 'MLS', 'UCL'].includes(league);
    const isNCAA = ['NCAAF', 'NCAAM', 'NCAAW'].includes(league);
    const hasEmbeddedRank = /^\s*(#|No\.)\s*\d+/i.test(team.name);
    const displayTeamName = (isNCAA && typeof team.rank === 'number' && team.rank > 0 && !hasEmbeddedRank)
        ? `#${team.rank} ${team.name}`
        : team.name;
    const hasUCL = useMemo(() => isSoccer && schedule.some(g => (g.context?.toLowerCase() || '').includes('champions league') || (g.leagueName?.toLowerCase() || '').includes('champions league') || g.league === 'UCL'), [schedule, isSoccer]);
    const rosterGroups = useMemo(() => {
        const groups: Record<string, Player[]> = {};
        team.roster.forEach(p => { const pos = p.position || 'Unknown'; if (!groups[pos]) groups[pos] = []; groups[pos].push(p); });
        return groups;
    }, [team.roster]);
    const sortedPositions = useMemo(() => Object.keys(rosterGroups).sort((a, b) => getPositionOrder(league, a) - getPositionOrder(league, b)), [rosterGroups, league]);

    useEffect(() => { if (schedule.length > 0) setScheduleFilter(upcomingGames.length === 0 && pastGames.length > 0 ? 'PAST' : 'UPCOMING'); }, [schedule, upcomingGames.length, pastGames.length]);
    const displayedGames = scheduleFilter === 'UPCOMING' ? upcomingGames : pastGames;

    const handlePlayerClick = async (playerId: string) => {
        setSelectedPlayerId(playerId); setIsPlayerLoading(true); setPlayerProfile(null);
        try { const profile = await fetchPlayerProfile(league, playerId); setPlayerProfile(profile); } 
        catch (e) { console.error(e); } finally { setIsPlayerLoading(false); }
    };

    const handleStatClick = (stat: any, viewMode: 'DETAILS' | 'LEADERBOARD') => {
        setSelectedStat({
            label: stat.label,
            value: cleanStatValue(stat.label, stat.value),
            rank: stat.rank,
            category: stat.category,
            initialView: viewMode
        });
    };

    const rosterPlayer = team.roster.find(p => p.id === selectedPlayerId);
    const displayPlayerInfo = playerProfile ? { displayName: playerProfile.name, headshot: playerProfile.headshot, position: playerProfile.position, jersey: playerProfile.jersey } : rosterPlayer ? { displayName: rosterPlayer.displayName, headshot: rosterPlayer.headshot, position: rosterPlayer.position, jersey: rosterPlayer.jersey } : { displayName: 'Loading...', headshot: undefined, position: '', jersey: '' };

    return (
        <div className="animate-fade-in space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm relative">
                <div className="absolute inset-0 opacity-10 dark:opacity-20 pointer-events-none" style={{ backgroundColor: team.color || '#262626' }}></div>
                <div className="relative p-8 flex flex-col md:flex-row items-center md:items-start gap-8">
                    <div className="w-24 h-24 md:w-32 md:h-32 bg-white dark:bg-slate-950 rounded-full p-4 shadow-lg border-4 border-white dark:border-slate-800 shrink-0 flex items-center justify-center">
                        {team.logo ? <img src={team.logo} alt={team.name} className="w-full h-full object-contain" /> : <div className="w-full h-full bg-slate-200 dark:bg-slate-800 rounded-full" />}
                    </div>
                    <div className="flex-1 text-center md:text-left space-y-2">
                        <h1 className="text-3xl md:text-4xl font-display font-bold text-slate-900 dark:text-white">{displayTeamName}</h1>
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-slate-600 dark:text-slate-400 font-medium">
                            <div className="flex items-center gap-1.5"><MapPin size={16} /><span>{team.location}</span></div>
                            {isSoccer && <div className="flex items-center gap-2"><div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-sm font-bold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700"><span>{getSoccerLeagueName(league, team.standingSummary)}</span></div>{hasUCL && <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full text-sm font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"><Trophy size={12} /><span>UCL</span></div>}</div>}
                            {displayRecord && <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-sm font-bold text-slate-800 dark:text-slate-200"><Hash size={14} /><span>{displayRecord}</span></div>}
                        </div>
                        {team.conferenceRank && team.conferenceName && !isSoccer && <div className="pt-2"><span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 px-2 py-1 rounded">{team.conferenceRank} in {team.conferenceName.replace('Conference', 'Conf').replace('League', 'Lg')}</span></div>}
                    </div>
                </div>
                {identity.length > 0 && <div className="relative z-10 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 p-6"><h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2"><Zap size={14} className="text-amber-500" /> Strategic Identity</h4><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{identity.map((item, idx) => <div key={idx} onClick={() => handleStatClick(item, 'DETAILS')} className="bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-1 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"><div className="flex justify-between items-start"><span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.description}</span><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${item.color.replace('text-', 'text-').replace('500', '700')} bg-opacity-10 border-opacity-20`}>{item.rating}</span></div><div className="flex items-end justify-between mt-1"><span className="text-lg font-mono font-bold text-slate-900 dark:text-white">{cleanStatValue(item.label, item.value)}</span><span className="text-xs font-bold text-slate-500">#{item.rank}</span></div></div>)}</div></div>}
                <div className="flex border-t border-slate-200 dark:border-slate-800 relative z-10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                    <button onClick={() => setActiveTab('SCHEDULE')} className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'SCHEDULE' ? 'text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white bg-slate-50/50 dark:bg-slate-800/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>Schedule</button>
                    <button onClick={() => setActiveTab('STATS')} className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'STATS' ? 'text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white bg-slate-50/50 dark:bg-slate-800/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>Stats</button>
                    <button onClick={() => setActiveTab('ROSTER')} className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'ROSTER' ? 'text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white bg-slate-50/50 dark:bg-slate-800/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>Roster</button>
                </div>
            </div>

            {activeTab === 'SCHEDULE' ? (
                <div className="space-y-6">
                    <div className="flex justify-center"><div className="flex w-full max-w-md bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800"><button onClick={() => setScheduleFilter('UPCOMING')} className={`flex-1 flex items-center justify-center px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all gap-2 ${scheduleFilter === 'UPCOMING' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>Upcoming <span className="opacity-60 text-[10px]">({upcomingGames.length})</span></button><button onClick={() => setScheduleFilter('PAST')} className={`flex-1 flex items-center justify-center px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all gap-2 ${scheduleFilter === 'PAST' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>Past <span className="opacity-60 text-[10px]">({pastGames.length})</span></button></div></div>
                    {displayedGames.length === 0 ? <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20"><p>No {scheduleFilter.toLowerCase()} games found for this season.</p></div> : <div className="space-y-4">{displayedGames.map(game => { const isSelected = selectedGameId === game.id; const displayGame = scheduleFilter === 'PAST' ? { ...game, status: 'finished' as const } : game; return (<div key={game.id} className="transition-all duration-300"><GameCard game={displayGame} onSelect={onGameSelect} isSelected={isSelected} onTeamClick={onTeamClick} isFollowed={isGameFollowed ? isGameFollowed(displayGame as Game) : false} onToggleFollow={onToggleFollowGame} />{isSelected && <div className="relative mt-4 ml-4 pl-6 border-l-2 border-slate-200 dark:border-slate-800 animate-fade-in"><div className="absolute -left-[9px] -top-4 w-4 h-8 rounded-bl-xl border-l-2 border-b-0 border-slate-200 dark:border-slate-800 bg-transparent opacity-0"></div>{isPredicting ? <div className="bg-white dark:bg-slate-900/60 rounded-3xl p-12 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center shadow-xl"><Loader2 size={48} className="text-slate-500 animate-spin mb-6" /><h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 font-display">Loading Data</h3><p className="text-slate-500 dark:text-slate-400 max-w-xs">Retrieving game details...</p></div> : (displayGame.status === 'finished' || scheduleFilter === 'PAST') ? <LiveGameView game={displayGame} gameDetails={gameDetails || null} prediction={null} isDarkMode={!!isDarkMode} onGenerateAnalysis={onGenerateAnalysis} onTeamClick={onTeamClick} /> : prediction ? (game.status === 'scheduled' ? <PredictionView game={game} prediction={prediction} isDarkMode={!!isDarkMode} onGenerateAnalysis={onGenerateAnalysis} onTeamClick={onTeamClick} /> : <LiveGameView game={game} gameDetails={gameDetails || null} prediction={prediction} isDarkMode={!!isDarkMode} onGenerateAnalysis={onGenerateAnalysis} onTeamClick={onTeamClick} />) : <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center"><p>Unable to load data.</p></div>}</div>}</div>); })}</div>}
                </div>
            ) : activeTab === 'STATS' ? (
                <div className="space-y-8 animate-fade-in">
                    {/* Consistent Layout for Team Stats matching League View */}
                    <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                                <Activity size={18} className="text-indigo-500" /> Season Statistics
                            </h3>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                    <Database size={11} />
                                    {statsSourceSummary.label}
                                </span>
                                {statsSourceSummary.sampleSize && (
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                        {statsSourceSummary.sampleSize} GP
                                    </span>
                                )}
                                {scheduleCoverageRatio !== null && (
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${scheduleCoverageRatio >= 0.85 ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'}`}>
                                        Coverage {Math.round(scheduleCoverageRatio * 100)}%
                                    </span>
                                )}
                            </div>
                        </div>
                        {integrityWarnings.length > 0 && (
                            <div className="px-6 py-3 border-b border-amber-100 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20">
                                {integrityWarnings.map((warning, idx) => (
                                    <div key={idx} className="text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2 leading-relaxed">
                                        <AlertTriangle size={12} className="shrink-0" />
                                        <span>{warning}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="p-6">
                            {isSeasonStatsLoading && statsSections.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 size={32} className="text-slate-500 animate-spin mb-3" />
                                    <p className="text-xs text-slate-500 font-medium">Loading season stat averages...</p>
                                </div>
                            ) : statsSections.length === 0 ? (
                                <div className="text-center text-sm text-slate-400 italic py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                    No season statistics available.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                    {statsSections.map(({ category, stats }) => (
                                        <div key={category} className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-3 sm:p-4">
                                            <h5 className="text-[10px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider mb-2 pl-2 border-l-2 border-slate-300 dark:border-slate-600">
                                                {category}
                                            </h5>
                                            <div className="space-y-2">
                                                {stats.map((stat, idx: number) => {
                                                    const leagueRank = (typeof stat.rank === 'number' && stat.rank > 0) ? stat.rank : undefined;
                                                    return (
                                                        <div 
                                                            key={idx} 
                                                            className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/70 bg-white/85 dark:bg-slate-900/65 hover:bg-white dark:hover:bg-slate-900 transition-colors cursor-pointer group"
                                                            onClick={() => handleStatClick(stat, 'DETAILS')}
                                                        >
                                                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate pr-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                                {stat.label}
                                                            </span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-base font-mono font-bold text-slate-900 dark:text-white">
                                                                    {cleanStatValue(stat.label, stat.value)}
                                                                </span>
                                                                {leagueRank && (
                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${getRankColor(leagueRank)}`}>
                                                                        Lg #{leagueRank}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Player Box Score Season Averages */}
                    {isStatsLoading ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 size={32} className="text-slate-500 animate-spin mb-3" />
                            <p className="text-xs text-slate-500 font-medium">Loading player box score averages...</p>
                        </div>
                    ) : teamStats?.categories && teamStats.categories.length > 0 ? (
                        <div className="space-y-6">
                            <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col gap-2">
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                                        <Target size={18} className="text-cyan-500" /> Player Box Score Season Averages
                                    </h3>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Player stats are cumulative season totals divided by games played (`GP`).
                                    </p>
                                </div>
                            </div>
                            {teamStats.categories.map((category: StatCategory, idx: number) => (
                                <div key={idx} className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">{category.displayName}</h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-right text-xs">
                                            <thead>
                                                <tr className="border-b border-slate-100 dark:border-slate-800/50 text-[10px] text-slate-400 font-bold uppercase bg-slate-50/30 dark:bg-slate-900/30">
                                                    <th className="px-6 py-3 text-left sticky left-0 bg-white dark:bg-slate-900 z-10 w-48 md:w-64">Player</th>
                                                    {(category.labels || []).map((label: string, i: number) => <th key={i} className="px-4 py-3 min-w-[60px] whitespace-nowrap">{label}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/30">
                                                {(category.athletes || []).map((ath: any, pIdx: number) => (
                                                    <tr key={pIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer group" onClick={() => handlePlayerClick(ath.player.id)}>
                                                        <td className="px-6 py-3 text-left font-medium text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/30 border-r border-transparent group-hover:border-slate-100 dark:group-hover:border-slate-800 transition-colors flex items-center gap-3">
                                                            <span className="font-mono text-slate-400 w-4 text-center">{pIdx + 1}</span>
                                                            <div className="truncate font-bold text-slate-900 dark:text-white">{ath.player.displayName}</div>
                                                            {ath.player.position && <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{ath.player.position}</span>}
                                                        </td>
                                                        {(ath.stats || []).map((statVal: string, sIdx: number) => (
                                                            <td key={sIdx} className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">{formatPlayerStatCell(category.labels?.[sIdx] || '', statVal)}</td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-sm text-slate-400 italic py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                            No player box score season averages available yet.
                        </div>
                    )}

                    {/* Record Split Card */}
                    {computedStats && (
                        <div className="bg-white dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6 flex items-center gap-2"><TrendingUp size={18} className="text-emerald-500" /> Record Split</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                <div className="space-y-1"><div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Points / Game</div><div className="text-3xl font-mono font-bold text-slate-900 dark:text-white">{computedStats.ppg}</div></div>
                                <div className="space-y-1"><div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Points Allowed</div><div className="text-3xl font-mono font-bold text-slate-900 dark:text-white">{computedStats.oppg}</div></div>
                                <div className="space-y-1"><div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Differential</div><div className={`text-3xl font-mono font-bold ${parseFloat(computedStats.avgDiff) > 0 ? 'text-emerald-500' : parseFloat(computedStats.avgDiff) < 0 ? 'text-rose-500' : 'text-slate-500'}`}>{parseFloat(computedStats.avgDiff) > 0 ? '+' : ''}{computedStats.avgDiff}</div></div>
                                <div className="space-y-1"><div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Current Streak</div><div className="text-3xl font-mono font-bold text-slate-900 dark:text-white">{computedStats.streak || '-'}</div></div>
                            </div>
                            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg"><span className="text-xs font-bold text-slate-500 uppercase">Home Record</span><span className="font-mono font-bold text-slate-800 dark:text-slate-200">{computedStats.homeRecord}</span></div>
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg"><span className="text-xs font-bold text-slate-500 uppercase">Away Record</span><span className="font-mono font-bold text-slate-800 dark:text-slate-200">{computedStats.awayRecord}</span></div>
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg"><span className="text-xs font-bold text-slate-500 uppercase">Last 5 Games</span><span className="font-mono font-bold text-slate-800 dark:text-slate-200">{computedStats.last5}</span></div>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-8">
                    {sortedPositions.map(pos => (
                        <div key={pos} className="animate-fade-in"><h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-3"><span className="bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">{pos}</span><div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div></h3><div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">{rosterGroups[pos].map(player => <div key={player.id} onClick={() => handlePlayerClick(player.id)} className="bg-white dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-500 cursor-pointer transition-all group shadow-sm hover:shadow-md flex items-center gap-4"><div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">{player.headshot ? <img src={player.headshot} alt={player.displayName} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-400"><User size={20} /></div>}</div><div className="flex-1 min-w-0"><h3 className="font-bold text-slate-900 dark:text-white group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors truncate">{player.displayName}</h3><div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">#{player.jersey || '00'}</span><span className="truncate">{player.position}</span></div></div><div className="p-2 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 group-hover:bg-slate-100 dark:group-hover:bg-slate-700 group-hover:text-slate-500 transition-all"><BarChart2 size={16} /></div></div>)}</div></div>
                    ))}
                    {sortedPositions.length === 0 && <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20"><p>No roster data available.</p></div>}
                </div>
            )}

            {selectedStat && (
                <StatDetailModal 
                    isOpen={true}
                    onClose={() => setSelectedStat(null)}
                    stat={selectedStat}
                    teamId={team.id}
                    teamName={team.name}
                    sport={league}
                    initialView={selectedStat.initialView}
                    onTeamClick={onTeamClick}
                />
            )}

            {selectedPlayerId && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative max-h-[90vh] flex flex-col">
                        <button onClick={() => setSelectedPlayerId(null)} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors z-10"><X size={18} /></button>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-6 flex flex-col items-center text-center border-b border-slate-200 dark:border-slate-800">
                            <div className="w-24 h-24 rounded-full bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-800 shadow-md mb-4 overflow-hidden">
                                {displayPlayerInfo.headshot ? <img src={displayPlayerInfo.headshot} alt={displayPlayerInfo.displayName} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600"><User size={48} /></div>}
                            </div>
                            <h2 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-1">{displayPlayerInfo.displayName}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{playerProfile?.team || team.name} • {displayPlayerInfo.jersey ? `#${displayPlayerInfo.jersey}` : displayPlayerInfo.position || ''}</p>
                            <div className="mt-3 flex gap-2 justify-center text-xs text-slate-400 dark:text-slate-500">
                                {playerProfile?.height && <span>{playerProfile.height}</span>}
                                {playerProfile?.weight && <span>• {playerProfile.weight} lbs</span>}
                                {playerProfile?.age && <span>• {playerProfile.age} yrs</span>}
                            </div>
                        </div>
                        <div className="overflow-y-auto p-6 max-h-[400px]">
                            {isPlayerLoading ? (
                                <div className="flex flex-col items-center justify-center py-8">
                                    <Loader2 size={24} className="text-slate-500 animate-spin mb-3" />
                                    <p className="text-xs text-slate-500">Retrieving season stats...</p>
                                </div>
                            ) : playerProfile?.stats && playerProfile.stats.length > 0 ? (
                                <div className="space-y-6">
                                    {playerProfile.stats.map((group, idx) => (
                                        <div key={idx}>
                                            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">{group.title}</h4>
                                            <div className="grid grid-cols-2 gap-3">
                                                {group.data.map((item, i) => (
                                                    <div key={i} className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">{item.label}</div>
                                                        <div className="text-lg font-mono font-bold text-slate-900 dark:text-white">{item.value}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-sm text-slate-400 italic py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                    No detailed season statistics available.
                                </div>
                            )}
                        </div>
                    </div>
                </div>, 
                document.body
            )}
        </div>
    );
};
