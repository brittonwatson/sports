

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Game, Player, TeamProfile, Sport, PlayerProfile, TeamStatistics, PredictionResult, GameDetails } from '../types';
import { GameCard } from './GameCard';
import { PredictionView } from './PredictionView';
import { LiveGameView } from './LiveGameView';
import { User, Calendar, List, MapPin, Hash, BarChart2, X, Loader2, Trophy, Activity, TrendingUp, Target } from 'lucide-react';
import { fetchPlayerProfile } from '../services/playerService';
import { fetchTeamStatistics } from '../services/teamService';

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
    // Fallback logic for similar sports
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
    if (summary && summary.includes(' in ')) {
        return summary.split(' in ')[1];
    }
    const map: Record<string, string> = {
        'EPL': 'Premier League',
        'MLS': 'Major League Soccer',
        'UCL': 'Champions League',
        'Bundesliga': 'Bundesliga',
        'La Liga': 'La Liga',
        'Serie A': 'Serie A',
        'Ligue 1': 'Ligue 1'
    };
    return map[sport] || sport;
};

const cleanStatValue = (label: string, value: string | number | undefined | null): string => {
    if (value === null || value === undefined) return '-';
    
    // Ensure value is a string before manipulation to prevent "value.replace is not a function"
    const strValue = String(value);
    
    // If value contains letters (and isn't just scientific notation e), return as is (e.g. "10-2")
    if (/[a-zA-Z]/.test(strValue) && !strValue.toLowerCase().includes('e')) return strValue;
    
    // Remove commas and % for parsing
    const rawNum = parseFloat(strValue.replace(/,/g, '').replace('%', ''));
    if (isNaN(rawNum)) return strValue;

    const lowerLabel = label.toLowerCase();
    const isPercent = strValue.includes('%') || 
                      lowerLabel.includes('pct') || 
                      lowerLabel.includes('percentage') || 
                      lowerLabel.includes('%') ||
                      lowerLabel.includes('rate');

    if (isPercent) {
        let finalNum = rawNum;
        // Heuristic: If it's a decimal <= 1 (e.g. 0.455) and no % sign was present in input, 
        // we assume it needs conversion to percentage (45.5%).
        // If input was "45.5", we assume it is already a percentage value.
        if (!strValue.includes('%') && Math.abs(rawNum) <= 1.0 && rawNum !== 0) {
            finalNum = rawNum * 100;
        }
        return `${finalNum.toFixed(1)}%`;
    }

    // Otherwise round to nearest whole number
    return Math.round(rawNum).toLocaleString();
};

export const TeamDetailView: React.FC<TeamDetailViewProps> = ({ 
    team, 
    schedule, 
    league, 
    onGameSelect, 
    selectedGameId,
    prediction,
    gameDetails,
    isPredicting,
    isDarkMode = true,
    onGenerateAnalysis
}) => {
    const [activeTab, setActiveTab] = useState<'SCHEDULE' | 'ROSTER' | 'STATS'>('SCHEDULE');
    const [scheduleFilter, setScheduleFilter] = useState<'UPCOMING' | 'PAST'>('UPCOMING');
    
    // Player Modal State
    const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
    const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
    const [isPlayerLoading, setIsPlayerLoading] = useState(false);

    // Team Statistics State
    const [teamStats, setTeamStats] = useState<TeamStatistics | null>(null);
    const [isStatsLoading, setIsStatsLoading] = useState(false);

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

    // Memoize filtered lists to prevent re-calc on every render
    const { upcomingGames, pastGames } = useMemo(() => {
        const now = new Date();
        const upcoming = schedule
            .filter(g => new Date(g.dateTime) >= now || g.status === 'in_progress')
            .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
        
        const past = schedule
            .filter(g => new Date(g.dateTime) < now && g.status !== 'in_progress')
            .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
            
        return { upcomingGames: upcoming, pastGames: past };
    }, [schedule]);

    // Computed Season Stats from Schedule
    const computedStats = useMemo(() => {
        const completed = schedule.filter(g => g.status === 'finished');
        if (completed.length === 0) return null;

        let wins = 0, losses = 0, ties = 0;
        let pf = 0, pa = 0;
        let homeWins = 0, homeLosses = 0, homeTies = 0;
        let awayWins = 0, awayLosses = 0, awayTies = 0;
        const streaks: ('W' | 'L' | 'T')[] = [];

        // Sort chronologically for streak calc
        const chronological = [...completed].sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

        chronological.forEach(g => {
            const isHome = g.homeTeam === team.name || g.homeTeam === team.displayName || (team.id && g.homeTeamId === team.id);
            const scoreFor = parseInt((isHome ? g.homeScore : g.awayScore) || '0');
            const scoreAgainst = parseInt((isHome ? g.awayScore : g.homeScore) || '0');
            
            pf += scoreFor;
            pa += scoreAgainst;

            let result: 'W' | 'L' | 'T' = 'T';
            if (scoreFor > scoreAgainst) result = 'W';
            else if (scoreFor < scoreAgainst) result = 'L';

            streaks.push(result);

            if (result === 'W') {
                wins++;
                if (isHome) homeWins++; else awayWins++;
            } else if (result === 'L') {
                losses++;
                if (isHome) homeLosses++; else awayLosses++;
            } else {
                ties++;
                if (isHome) homeTies++; else awayTies++;
            }
        });

        const gp = completed.length;
        // Last 5
        const last5 = streaks.slice(-5).reverse();
        const l5Wins = last5.filter(r => r === 'W').length;
        const l5Losses = last5.filter(r => r === 'L').length;
        const l5Ties = last5.filter(r => r === 'T').length;
        
        // Current Streak
        let currentStreak = '';
        if (streaks.length > 0) {
            const last = streaks[streaks.length - 1];
            let count = 0;
            for (let i = streaks.length - 1; i >= 0; i--) {
                if (streaks[i] === last) count++;
                else break;
            }
            currentStreak = `${last}${count}`;
        }

        const avgDiffVal = (pf - pa) / gp;

        return {
            gp,
            wins, losses, ties,
            ppg: Math.round(pf / gp).toString(),
            oppg: Math.round(pa / gp).toString(),
            diff: (pf - pa).toString(),
            avgDiff: Math.abs(avgDiffVal) < 0.1 ? "0" : Math.round(avgDiffVal).toString(),
            homeRecord: `${homeWins}-${homeLosses}${homeTies > 0 ? `-${homeTies}` : ''}`,
            awayRecord: `${awayWins}-${awayLosses}${awayTies > 0 ? `-${awayTies}` : ''}`,
            last5: `${l5Wins}-${l5Losses}${l5Ties > 0 ? `-${l5Ties}` : ''}`,
            streak: currentStreak
        };
    }, [schedule, team.name, team.displayName, team.id]);

    const isSoccer = ['EPL', 'Bundesliga', 'La Liga', 'Ligue 1', 'Serie A', 'MLS', 'UCL'].includes(league);
    
    const hasUCL = useMemo(() => {
        if (!isSoccer) return false;
        // Check schedule for UCL games
        return schedule.some(g => {
            const context = g.context?.toLowerCase() || '';
            const leagueName = g.leagueName?.toLowerCase() || '';
            const leagueCode = g.league;
            
            return (
                context.includes('champions league') || 
                leagueName.includes('champions league') ||
                leagueName.includes('ucl') ||
                leagueCode === 'UCL'
            );
        });
    }, [schedule, isSoccer]);

    // Roster Grouping Logic
    const rosterGroups = useMemo(() => {
        const groups: Record<string, Player[]> = {};
        team.roster.forEach(p => {
            const pos = p.position || 'Unknown';
            if (!groups[pos]) groups[pos] = [];
            groups[pos].push(p);
        });
        return groups;
    }, [team.roster]);

    const sortedPositions = useMemo(() => {
        return Object.keys(rosterGroups).sort((a, b) => {
            return getPositionOrder(league, a) - getPositionOrder(league, b);
        });
    }, [rosterGroups, league]);

    // Auto-switch filter when schedule loads
    useEffect(() => {
        if (schedule.length > 0) {
            if (upcomingGames.length === 0 && pastGames.length > 0) {
                setScheduleFilter('PAST');
            } else {
                setScheduleFilter('UPCOMING');
            }
        }
    }, [schedule, upcomingGames.length, pastGames.length]);

    const displayedGames = scheduleFilter === 'UPCOMING' ? upcomingGames : pastGames;

    // Handle Player Click (Open Modal)
    const handlePlayerClick = async (playerId: string) => {
        setSelectedPlayerId(playerId);
        setIsPlayerLoading(true);
        setPlayerProfile(null);
        
        try {
            // Use the passed league prop to ensure we hit the correct API endpoint
            const profile = await fetchPlayerProfile(league, playerId);
            setPlayerProfile(profile);
        } catch (e) {
            console.error("Failed to load player profile", e);
        } finally {
            setIsPlayerLoading(false);
        }
    };

    // Derived Display Info for Modal
    const rosterPlayer = team.roster.find(p => p.id === selectedPlayerId);
    const displayPlayerInfo = playerProfile ? {
        displayName: playerProfile.name,
        headshot: playerProfile.headshot,
        position: playerProfile.position,
        jersey: playerProfile.jersey
    } : rosterPlayer ? {
        displayName: rosterPlayer.displayName,
        headshot: rosterPlayer.headshot,
        position: rosterPlayer.position,
        jersey: rosterPlayer.jersey
    } : { displayName: 'Loading...', headshot: undefined, position: '', jersey: '' };

    return (
        <div className="animate-fade-in space-y-8">
            {/* Header / Banner */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm relative">
                {/* Background wash with team color */}
                <div 
                    className="absolute inset-0 opacity-10 dark:opacity-20 pointer-events-none" 
                    style={{ backgroundColor: team.color || '#262626' }}
                ></div>

                <div className="relative p-8 flex flex-col md:flex-row items-center md:items-start gap-8">
                    {/* Logo */}
                    <div className="w-24 h-24 md:w-32 md:h-32 bg-white dark:bg-slate-950 rounded-full p-4 shadow-lg border-4 border-white dark:border-slate-800 shrink-0 flex items-center justify-center">
                        {team.logo ? (
                            <img src={team.logo} alt={team.name} className="w-full h-full object-contain" />
                        ) : (
                            <div className="w-full h-full bg-slate-200 dark:bg-slate-800 rounded-full" />
                        )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 text-center md:text-left space-y-2">
                        <div className="flex flex-col md:flex-row md:items-baseline gap-2 justify-center md:justify-start">
                             <h1 className="text-3xl md:text-4xl font-display font-bold text-slate-900 dark:text-white">{team.name}</h1>
                        </div>
                        
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-slate-600 dark:text-slate-400 font-medium">
                            <div className="flex items-center gap-1.5">
                                <MapPin size={16} />
                                <span>{team.location}</span>
                            </div>
                            
                            {/* Soccer Specific: League Name & UCL Badge */}
                            {isSoccer && (
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-sm font-bold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                                         <span>{getSoccerLeagueName(league, team.standingSummary)}</span>
                                    </div>
                                    {hasUCL && (
                                        <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full text-sm font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                            <Trophy size={12} />
                                            <span>UCL</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {team.record && !isSoccer && (
                                <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-sm font-bold text-slate-800 dark:text-slate-200">
                                    <Hash size={14} />
                                    <span>{team.record}</span>
                                </div>
                            )}
                             {/* Keep record for soccer too? Usually "W-D-L" is good to show, but separate block to be cleaner */}
                             {isSoccer && team.record && (
                                <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-sm font-bold text-slate-800 dark:text-slate-200">
                                    <Hash size={14} />
                                    <span>{team.record}</span>
                                </div>
                             )}
                        </div>
                        
                        {/* NEW: Conference Rank Badge (US Sports) */}
                        {team.conferenceRank && team.conferenceName && !isSoccer && (
                            <div className="pt-2">
                                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 px-2 py-1 rounded">
                                    {team.conferenceRank} in {team.conferenceName.replace('Conference', 'Conf').replace('League', 'Lg')}
                                </span>
                            </div>
                        )}

                        {team.standingSummary && !isSoccer && (
                            <div className="pt-2">
                                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-500 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded">
                                    {team.standingSummary}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="flex border-t border-slate-200 dark:border-slate-800 relative z-10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                    <button
                        onClick={() => setActiveTab('SCHEDULE')}
                        className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'SCHEDULE' ? 'text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white bg-slate-50/50 dark:bg-slate-800/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        Schedule
                    </button>
                    <button
                        onClick={() => setActiveTab('STATS')}
                        className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'STATS' ? 'text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white bg-slate-50/50 dark:bg-slate-800/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        Stats
                    </button>
                    <button
                        onClick={() => setActiveTab('ROSTER')}
                        className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'ROSTER' ? 'text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white bg-slate-50/50 dark:bg-slate-800/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        Roster
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {activeTab === 'SCHEDULE' ? (
                <div className="space-y-6">
                    {/* Toggle Past/Upcoming */}
                    <div className="flex justify-center">
                        <div className="flex w-full max-w-md bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                            <button
                                onClick={() => setScheduleFilter('UPCOMING')}
                                className={`flex-1 flex items-center justify-center px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all gap-2
                                    ${scheduleFilter === 'UPCOMING' 
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                Upcoming <span className="opacity-60 text-[10px]">({upcomingGames.length})</span>
                            </button>
                            <button
                                onClick={() => setScheduleFilter('PAST')}
                                className={`flex-1 flex items-center justify-center px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all gap-2
                                    ${scheduleFilter === 'PAST' 
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                Past <span className="opacity-60 text-[10px]">({pastGames.length})</span>
                            </button>
                        </div>
                    </div>

                    {displayedGames.length === 0 ? (
                        <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20">
                            <p>No {scheduleFilter.toLowerCase()} games found for this season.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {displayedGames.map(game => {
                                const isSelected = selectedGameId === game.id;
                                // Force status to 'finished' for past games view to ensure score rendering in GameCard
                                const displayGame = scheduleFilter === 'PAST' 
                                    ? { ...game, status: 'finished' as const } 
                                    : game;

                                return (
                                <div key={game.id} className="transition-all duration-300">
                                    <GameCard 
                                        game={displayGame} 
                                        onSelect={onGameSelect} 
                                        isSelected={isSelected} 
                                        // Don't pass onTeamClick here to prevent navigating to same page or loop
                                    />
                                    {isSelected && (
                                        <div className="relative mt-4 ml-4 pl-6 border-l-2 border-slate-200 dark:border-slate-800 animate-fade-in">
                                             {/* Connecting visual element */}
                                             <div className="absolute -left-[9px] -top-4 w-4 h-8 rounded-bl-xl border-l-2 border-b-0 border-slate-200 dark:border-slate-800 bg-transparent opacity-0"></div>
                                             
                                             {isPredicting ? (
                                                 <div className="bg-white dark:bg-slate-900/60 rounded-3xl p-12 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center shadow-xl">
                                                     <Loader2 size={48} className="text-slate-500 animate-spin mb-6" />
                                                     <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 font-display">Loading Data</h3>
                                                     <p className="text-slate-500 dark:text-slate-400 max-w-xs">
                                                         Retrieving game details...
                                                     </p>
                                                 </div>
                                             ) : (displayGame.status === 'finished' || scheduleFilter === 'PAST') ? (
                                                  <LiveGameView 
                                                     // Ensure finished state for the expanded view as well
                                                     game={displayGame}
                                                     gameDetails={gameDetails || null}
                                                     prediction={null} 
                                                     isDarkMode={!!isDarkMode}
                                                     onGenerateAnalysis={onGenerateAnalysis}
                                                     onTeamClick={() => { /* No-op in team view to prevent loop */ }}
                                                  />
                                             ) : prediction ? (
                                                game.status === 'scheduled' ? (
                                                     <PredictionView 
                                                        game={game} 
                                                        prediction={prediction} 
                                                        isDarkMode={!!isDarkMode} 
                                                        onGenerateAnalysis={onGenerateAnalysis}
                                                     />
                                                ) : (
                                                     <LiveGameView 
                                                        game={game}
                                                        gameDetails={gameDetails || null}
                                                        prediction={prediction} 
                                                        isDarkMode={!!isDarkMode}
                                                        onGenerateAnalysis={onGenerateAnalysis}
                                                        onTeamClick={() => { /* No-op in team view */ }}
                                                     />
                                                )
                                             ) : (
                                                 <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center">
                                                     <p>Unable to load data.</p>
                                                 </div>
                                             )}
                                        </div>
                                    )}
                                </div>
                            )})}
                        </div>
                    )}
                </div>
            ) : activeTab === 'STATS' ? (
                <div className="space-y-8">
                    {/* Live Calculated Stats (Summary) */}
                    {computedStats && (
                        <div className="bg-white dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6 flex items-center gap-2">
                                <Activity size={18} className="text-emerald-500" />
                                Season Overview
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                <div className="space-y-1">
                                    <div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Points / Game</div>
                                    <div className="text-3xl font-mono font-bold text-slate-900 dark:text-white">{computedStats.ppg}</div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Points Allowed</div>
                                    <div className="text-3xl font-mono font-bold text-slate-900 dark:text-white">{computedStats.oppg}</div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Differential</div>
                                    <div className={`text-3xl font-mono font-bold ${parseFloat(computedStats.avgDiff) > 0 ? 'text-emerald-500' : parseFloat(computedStats.avgDiff) < 0 ? 'text-rose-500' : 'text-slate-500'}`}>
                                        {parseFloat(computedStats.avgDiff) > 0 ? '+' : ''}{computedStats.avgDiff}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Current Streak</div>
                                    <div className="text-3xl font-mono font-bold text-slate-900 dark:text-white">{computedStats.streak || '-'}</div>
                                </div>
                            </div>
                            
                            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Home Record</span>
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{computedStats.homeRecord}</span>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Away Record</span>
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{computedStats.awayRecord}</span>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Last 5 Games</span>
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{computedStats.last5}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Detailed Player Stats Tables */}
                    {isStatsLoading ? (
                        <div className="flex flex-col items-center justify-center py-24">
                            <Loader2 size={40} className="text-slate-500 animate-spin mb-4" />
                            <p className="text-slate-500 font-medium">Loading Player Statistics...</p>
                        </div>
                    ) : teamStats?.categories && teamStats.categories.length > 0 ? (
                        <div className="space-y-8">
                            {teamStats.categories.map((category, idx) => (
                                <div key={idx} className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                            {category.displayName}
                                        </h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-right text-xs">
                                            <thead>
                                                <tr className="border-b border-slate-100 dark:border-slate-800/50 text-[10px] text-slate-400 font-bold uppercase bg-slate-50/30 dark:bg-slate-900/30">
                                                    <th className="px-6 py-3 text-left sticky left-0 bg-white dark:bg-slate-900 z-10 w-48 md:w-64">Player</th>
                                                    {category.labels.map((label, i) => (
                                                        <th key={i} className="px-4 py-3 min-w-[60px] whitespace-nowrap">{label}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-5 dark:divide-slate-800/30">
                                                {category.athletes.map((ath, pIdx) => (
                                                    <tr 
                                                        key={pIdx} 
                                                        className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer group"
                                                        onClick={() => handlePlayerClick(ath.player.id)}
                                                    >
                                                        <td className="px-6 py-3 text-left font-medium text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/30 border-r border-transparent group-hover:border-slate-100 dark:group-hover:border-slate-800 transition-colors flex items-center gap-3">
                                                            <span className="font-mono text-slate-400 w-4 text-center">{pIdx + 1}</span>
                                                            <div className="truncate font-bold text-slate-900 dark:text-white">{ath.player.displayName}</div>
                                                            {ath.player.position && <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{ath.player.position}</span>}
                                                        </td>
                                                        {ath.stats.map((statVal, sIdx) => (
                                                            <td key={sIdx} className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                                                                {statVal}
                                                            </td>
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
                         // Fallback to existing official summary stats if detailed player stats fail
                         team.seasonStats && team.seasonStats.length > 0 && (
                            <div className="bg-white dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                 <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6 flex items-center gap-2">
                                    <Target size={18} className="text-indigo-500" />
                                    Official Metrics & Rankings
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                    {team.seasonStats.map((stat, idx) => (
                                        <div key={idx} className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 relative group hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 truncate" title={stat.label}>
                                                {stat.label}
                                            </div>
                                            <div className="text-xl font-mono font-bold text-slate-800 dark:text-slate-200">
                                                {cleanStatValue(stat.label, stat.value)}
                                            </div>
                                            {stat.rank && (
                                                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-white dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500 border border-slate-200 dark:border-slate-700 shadow-sm">
                                                    #{stat.rank}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    )}
                </div>
            ) : (
                <div className="space-y-8">
                    {sortedPositions.map(pos => (
                        <div key={pos} className="animate-fade-in">
                            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-3">
                                <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">{pos}</span>
                                <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {rosterGroups[pos].map(player => (
                                    <div 
                                        key={player.id}
                                        onClick={() => handlePlayerClick(player.id)}
                                        className="bg-white dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-500 cursor-pointer transition-all group shadow-sm hover:shadow-md flex items-center gap-4"
                                    >
                                        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">
                                            {player.headshot ? (
                                                <img src={player.headshot} alt={player.displayName} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                    <User size={20} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-slate-900 dark:text-white group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors truncate">
                                                {player.displayName}
                                            </h3>
                                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                                <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">#{player.jersey || '00'}</span>
                                                <span className="truncate">{player.position}</span>
                                            </div>
                                        </div>
                                        <div className="p-2 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 group-hover:bg-slate-100 dark:group-hover:bg-slate-700 group-hover:text-slate-500 transition-all">
                                            <BarChart2 size={16} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                    
                    {sortedPositions.length === 0 && (
                         <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20">
                            <p>No roster data available.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Player Profile Modal */}
            {selectedPlayerId && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative max-h-[90vh] flex flex-col">
                        <button 
                            onClick={() => setSelectedPlayerId(null)}
                            className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors z-10"
                        >
                            <X size={18} />
                        </button>

                        {/* Modal Header */}
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-6 flex flex-col items-center text-center border-b border-slate-200 dark:border-slate-800">
                            <div className="w-24 h-24 rounded-full bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-800 shadow-md mb-4 overflow-hidden">
                                {displayPlayerInfo.headshot ? (
                                    <img src={displayPlayerInfo.headshot} alt={displayPlayerInfo.displayName} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                                        <User size={48} />
                                    </div>
                                )}
                            </div>
                            <h2 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-1">{displayPlayerInfo.displayName}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                                {playerProfile?.team || team.name} • {displayPlayerInfo.jersey ? `#${displayPlayerInfo.jersey}` : displayPlayerInfo.position || ''}
                            </p>
                            <div className="mt-3 flex gap-2 justify-center text-xs text-slate-400 dark:text-slate-500">
                                {playerProfile?.height && <span>{playerProfile.height}</span>}
                                {playerProfile?.weight && <span>• {playerProfile.weight} lbs</span>}
                                {playerProfile?.age && <span>• {playerProfile.age} yrs</span>}
                            </div>
                        </div>

                        {/* Stats Content */}
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