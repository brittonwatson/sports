
import React, { useRef, useEffect } from 'react';
import { Game, SOCCER_LEAGUES, Sport } from '../types';
import { Trophy, CalendarClock, ChevronRight } from 'lucide-react';

interface BracketViewProps {
  games: Game[];
  onGameSelect?: (game: Game) => void;
  selectedGameId?: string | null;
  onTeamClick?: (teamId: string, league: Sport) => void;
}

// Helper to determine NCAAF Round based on date (Fallback for when API text is just "Rose Bowl")
// 2024-25 Playoff Schedule Logic
const getNCAAFRoundFromDate = (dateStr: string): { rank: number; name: string } | null => {
    const d = new Date(dateStr);
    const month = d.getUTCMonth(); // 0-11. Dec=11, Jan=0
    const day = d.getUTCDate();
    
    // Dec 2024
    if (month === 11) {
        if (day >= 19 && day <= 22) return { rank: 1, name: 'First Round' };
        if (day >= 30) return { rank: 2, name: 'Quarterfinals' }; // Dec 31 games often show up late Dec
    }
    // Jan 2025
    if (month === 0) {
        if (day <= 2) return { rank: 2, name: 'Quarterfinals' }; // Jan 1 games
        if (day >= 8 && day <= 11) return { rank: 3, name: 'Semifinals' };
        if (day >= 18) return { rank: 4, name: 'National Championship' };
    }
    return null;
};

// Helper to determine NFL Round based on date (Strict Manual Overrides)
// Uses UTC/Month logic, adjusted for the specific manual request ranges:
const getNFLRoundFromDate = (dateStr: string): { rank: number; name: string } | null => {
    const d = new Date(dateStr);
    const month = d.getUTCMonth(); // 0-11. Jan=0, Feb=1
    const day = d.getUTCDate();
    
    // Jan
    if (month === 0) {
        if (day >= 16 && day <= 22) return { rank: 2, name: 'Divisional Round' };
        if (day >= 23 && day <= 30) return { rank: 3, name: 'Conf. Championships' };
        if (day < 16) return { rank: 1, name: 'Wild Card' };
    }
    // Feb
    if (month === 1) {
        return { rank: 4, name: 'Super Bowl' };
    }
    return null;
};

// Map normalized round IDs to a display name and order
const getRoundInfo = (game: Game): { rank: number; name: string } => {
    const c = (game.context || '').toLowerCase();
    const league = game.league;
    
    // --- NFL Specific ---
    if (league === 'NFL') {
        // Prioritize explicit context from API (Headline)
        if (c.includes('super bowl')) return { rank: 4, name: 'Super Bowl' };
        if (c.includes('championship') && (c.includes('conference') || c.includes('afc') || c.includes('nfc'))) return { rank: 3, name: 'Conf. Championships' };
        if (c.includes('divisional')) return { rank: 2, name: 'Divisional Round' };
        if (c.includes('wild card')) return { rank: 1, name: 'Wild Card' };
        
        // Fallback to date guessing only if context is generic
        const dateGuess = getNFLRoundFromDate(game.dateTime);
        if (dateGuess) return dateGuess;
    }

    // --- NCAAF Specific (12-team playoff) ---
    if (league === 'NCAAF') {
        if (c.includes('national championship')) return { rank: 4, name: 'National Championship' };
        if (c.includes('semifinal') || c.includes('semi')) return { rank: 3, name: 'Semifinals' };
        if (c.includes('quarter') || c.includes('quarterfinal')) return { rank: 2, name: 'Quarterfinals' };
        if (c.includes('first round') || c.includes('1st round')) return { rank: 1, name: 'First Round' };
        if (c.includes('orange bowl') || c.includes('cotton bowl')) return { rank: 3, name: 'Semifinals' };
        if (c.includes('fiesta bowl') || c.includes('peach bowl') || c.includes('rose bowl') || c.includes('sugar bowl')) return { rank: 2, name: 'Quarterfinals' };
        const dateGuess = getNCAAFRoundFromDate(game.dateTime);
        if (dateGuess) return dateGuess;
        if (c.includes('cfp') && c.includes('bowl')) return { rank: 2, name: 'Quarterfinals' }; 
    }

    // --- NBA / NHL / General 4-Round Format ---
    if (league === 'NBA' || league === 'NHL') {
        if (c.includes('final') && !c.includes('conference')) return { rank: 4, name: 'Finals' };
        if (c.includes('conference final') || c.includes('semifinals')) return { rank: 3, name: 'Conf. Finals' }; 
        if (c.includes('conference semi') || c.includes('round 2') || c.includes('second round')) return { rank: 2, name: 'Semifinals' };
        if (c.includes('first round') || c.includes('round 1')) return { rank: 1, name: 'First Round' };
    }

    // --- NCAAM / Generic Tournament ---
    if (c.includes('championship') || c.includes('final')) return { rank: 10, name: 'Championship' };
    if (c.includes('semi') || c.includes('final four')) return { rank: 9, name: 'Final Four' };
    if (c.includes('elite')) return { rank: 8, name: 'Elite 8' };
    if (c.includes('sweet')) return { rank: 7, name: 'Sweet 16' };
    if (c.includes('second') || c.includes('32')) return { rank: 6, name: 'Round of 32' };
    if (c.includes('first') || c.includes('64')) return { rank: 5, name: 'Round of 64' };

    return { rank: 0, name: 'Playoffs' };
};

export const BracketView: React.FC<BracketViewProps> = ({ games, onGameSelect, selectedGameId, onTeamClick }) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Group series by Matchup Key (Dedup logic)
    const seriesMap = new Map<string, Game>();

    games.forEach(game => {
        const teams = [game.homeTeam, game.awayTeam].sort();
        const key = (game.homeTeam === 'TBD' || game.awayTeam === 'TBD') 
            ? game.id 
            : `${teams[0]}-${teams[1]}`;

        const existing = seriesMap.get(key);

        if (!existing) {
            seriesMap.set(key, game);
        } else {
            const existingTime = new Date(existing.dateTime).getTime();
            const newTime = new Date(game.dateTime).getTime();
            if (game.status === 'in_progress' && existing.status !== 'in_progress') {
                seriesMap.set(key, game);
            } else if (existing.status !== 'in_progress' && newTime > existingTime) {
                seriesMap.set(key, game);
            }
        }
    });

    const allSeries = Array.from(seriesMap.values());
    const roundsMap = new Map<number, { name: string, games: Game[] }>();
    
    allSeries.forEach(game => {
        const { rank, name } = getRoundInfo(game);
        const groupKey = rank === 0 ? 0 : Math.ceil(rank); 
        if (!roundsMap.has(groupKey)) {
            roundsMap.set(groupKey, { name, games: [] });
        }
        roundsMap.get(groupKey)?.games.push(game);
    });

    const sortedRounds = Array.from(roundsMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(e => e[1]);

    useEffect(() => {
        if (scrollContainerRef.current && sortedRounds.length > 0) {
            const activeRoundIndex = sortedRounds.findIndex(r => r.games.some(g => g.status !== 'finished'));
            const focusIndex = activeRoundIndex === -1 ? sortedRounds.length - 1 : activeRoundIndex;
            const activeElement = document.getElementById(`round-column-${focusIndex}`);
            if (activeElement) {
                activeElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        }
    }, [games, sortedRounds.length]);

    if (allSeries.length === 0) {
        return (
            <div className="p-16 text-center text-slate-500 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20">
                <Trophy size={48} className="mx-auto mb-4 opacity-20" />
                <p>No playoff matchups scheduled yet.</p>
            </div>
        );
    }
    
    const league = allSeries[0]?.league || '';
    const isSoccer = SOCCER_LEAGUES.includes(league as Sport);

    return (
        <div className="animate-fade-in">
             <div className="flex items-center gap-2 mb-6 px-1">
                 <Trophy size={16} className="text-slate-400 dark:text-slate-500" />
                 <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                     {league} Playoffs
                 </h3>
             </div>
             
             <div 
                ref={scrollContainerRef}
                className="overflow-x-auto pb-8 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide snap-x snap-mandatory flex gap-6 sm:gap-12"
             >
                {sortedRounds.map((round, rIdx) => (
                    <div 
                        key={rIdx} 
                        id={`round-column-${rIdx}`}
                        className="flex-none w-[300px] sm:w-[340px] snap-center flex flex-col"
                    >
                        <div className="sticky left-0 text-center mb-6">
                            <div className="inline-block px-4 py-1.5 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide shadow-sm">
                                {round.name}
                            </div>
                        </div>
                        
                        <div className="flex flex-col gap-4">
                            {round.games
                              .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
                              .map(game => {
                                const homeScore = parseInt(game.homeScore || '0');
                                const awayScore = parseInt(game.awayScore || '0');
                                const isFinished = game.status === 'finished';
                                const homeWin = isFinished && homeScore > awayScore;
                                const awayWin = isFinished && awayScore > homeScore;
                                const homeClass = isFinished && !homeWin ? 'opacity-40 grayscale' : '';
                                const awayClass = isFinished && !awayWin ? 'opacity-40 grayscale' : '';
                                const isSelected = selectedGameId === game.id;

                                const renderTeamRow = (type: 'home' | 'away') => {
                                    const isHome = type === 'home';
                                    const win = isHome ? homeWin : awayWin;
                                    const cls = isHome ? homeClass : awayClass;
                                    const rank = isHome ? game.homeTeamRank : game.awayTeamRank;
                                    const name = isHome ? game.homeTeam : game.awayTeam;
                                    const logo = isHome ? game.homeTeamLogo : game.awayTeamLogo;
                                    const score = isHome ? game.homeScore : game.awayScore;
                                    const teamId = isHome ? game.homeTeamId : game.awayTeamId;
                                    const clickable = !!onTeamClick && !!teamId;
                                    
                                    return (
                                        <div className={`flex justify-between items-center p-1.5 -mx-1.5 rounded ${win ? 'bg-green-50/50 dark:bg-green-900/10' : ''} ${cls}`}>
                                            <div
                                                className={`flex items-center gap-2 overflow-hidden ${clickable ? 'cursor-pointer hover:underline' : ''}`}
                                                onClick={(e) => {
                                                    if (!onTeamClick || !teamId) return;
                                                    e.stopPropagation();
                                                    onTeamClick(teamId, game.league as Sport);
                                                }}
                                            >
                                                {rank && (
                                                    <span className="flex items-center justify-center w-5 h-5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 shrink-0 border border-slate-200 dark:border-slate-700">
                                                        {rank}
                                                    </span>
                                                )}
                                                {logo && (
                                                    <img src={logo} alt="" className="w-4 h-4 object-contain shrink-0" />
                                                )}
                                                <span className={`truncate font-bold text-sm ${win ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>{name}</span>
                                            </div>
                                            <span className={`font-mono font-bold text-sm ${win ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{score}</span>
                                        </div>
                                    );
                                };

                                return (
                                    <div 
                                        key={game.id} 
                                        className="relative group cursor-pointer"
                                        onClick={() => onGameSelect && onGameSelect(game)}
                                    >
                                        <div className={`w-full bg-white dark:bg-slate-900 border rounded-xl shadow-sm text-xs relative z-10 overflow-hidden transition-all duration-300 ${isSelected ? 'border-slate-900 dark:border-white ring-1 ring-slate-900 dark:ring-white' : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'}`}>
                                            {/* Header */}
                                            <div className="bg-slate-50 dark:bg-slate-950 px-3 py-2 text-[10px] text-slate-500 flex justify-between items-center border-b border-slate-100 dark:border-slate-800/50">
                                                <div className="flex items-center gap-1.5">
                                                    <CalendarClock size={10} />
                                                    <span>{game.date} • {game.time}</span>
                                                </div>
                                                <span className="font-semibold text-slate-600 dark:text-slate-400 truncate max-w-[120px]">
                                                    {game.status === 'in_progress' ? 'LIVE' : game.context || game.seriesSummary || game.status}
                                                </span>
                                            </div>
                                            
                                            {/* Teams */}
                                            <div className="p-3 space-y-2">
                                                {/* If Soccer: Home First. If US Sports: Away First. */}
                                                {isSoccer ? renderTeamRow('home') : renderTeamRow('away')}
                                                
                                                <div className="w-full h-px bg-slate-100 dark:bg-slate-800/50"></div>

                                                {isSoccer ? renderTeamRow('away') : renderTeamRow('home')}
                                            </div>
                                        </div>
                                        
                                        {rIdx < sortedRounds.length - 1 && (
                                            <div className="absolute top-1/2 -right-6 transform -translate-y-1/2 text-slate-300 dark:text-slate-700 hidden sm:block">
                                                <ChevronRight size={16} />
                                            </div>
                                        )}
                                    </div>
                                );
                              })}
                        </div>
                    </div>
                ))}
                
                <div className="w-4 flex-none"></div>
             </div>
        </div>
    );
};
