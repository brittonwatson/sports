import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sport, StandingsGroup, LeagueStatRow } from '../types';
import { getStoredLeagueStats } from '../services/teamService';
import { dbEvents } from '../services/statsDb';
import { Loader2, ArrowUp, ArrowDown, Activity, Database, CheckCircle2, RefreshCw } from 'lucide-react';

interface LeagueStatsViewProps {
    groups: StandingsGroup[];
    sport: Sport;
    onTeamClick: (teamId: string, league: Sport) => void;
}

const parseVal = (v: string) => parseFloat(v.replace(/,/g, '').replace('%', '').replace('+', ''));

export const LeagueStatsView: React.FC<LeagueStatsViewProps> = ({ groups, sport, onTeamClick }) => {
    const [statsData, setStatsData] = useState<LeagueStatRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Filter teams based on groups (e.g. if filtered by Conference in generic view)
    const activeTeams = useMemo(() => {
        return groups.flatMap(g => g.standings.map(s => s.team));
    }, [groups]);

    const fallbackMap = useMemo(() => {
        const map = new Map<string, any>();
        groups.forEach(g => {
            g.standings.forEach(s => {
                map.set(s.team.id, s.stats);
            });
        });
        return map;
    }, [groups]);

    const loadFromDB = async (showLoading = true) => {
        if (showLoading) setIsLoading(true);
        try {
            const { rows, lastUpdated: ts } = await getStoredLeagueStats(
                sport, 
                activeTeams.map(t => ({ id: t.id, name: t.name, logo: t.logo })),
                fallbackMap
            );
            
            if (rows.length > 0) {
                // Calculate Ranks Client-Side
                const allKeys = new Set<string>();
                rows.forEach(row => Object.keys(row.stats).forEach(k => allKeys.add(k)));
                
                const rankedRows = [...rows];
                allKeys.forEach(key => {
                    const label = key.split('|')[1]?.toLowerCase() || key.toLowerCase();
                    const inverse = label.includes('allowed') || label.includes('against') || label.includes('turnover') || label.includes('interception') || label.includes('era');
                    
                    const sortedIndices = rankedRows.map((_, i) => i).sort((a, b) => {
                        const valA = parseVal(rankedRows[a].stats[key] || '0');
                        const valB = parseVal(rankedRows[b].stats[key] || '0');
                        if (isNaN(valA) && isNaN(valB)) return 0;
                        if (isNaN(valA)) return 1;
                        if (isNaN(valB)) return -1;
                        return inverse ? valA - valB : valB - valA;
                    });
                    
                    sortedIndices.forEach((rowIndex, rankZeroIndex) => {
                        if (!rankedRows[rowIndex].ranks) rankedRows[rowIndex].ranks = {};
                        rankedRows[rowIndex].ranks[key] = rankZeroIndex + 1;
                    });
                });
                
                setStatsData(rankedRows);
                setLastUpdated(ts);
            } else {
                setStatsData([]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            if (showLoading) setIsLoading(false);
        }
    };

    // Initial Load & Event Listener
    useEffect(() => {
        if (activeTeams.length === 0) return;

        loadFromDB(true);

        const handleUpdate = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.sport === sport) {
                loadFromDB(false); // Silent refresh
            }
        };

        dbEvents.addEventListener('stats_updated', handleUpdate);
        return () => dbEvents.removeEventListener('stats_updated', handleUpdate);
    }, [activeTeams, sport]);

    // Group stats by Category with strict layouts
    const categorizedColumns = useMemo<Record<string, string[]>>(() => {
        if (statsData.length === 0) return {};
        
        const isBasketball = ['NBA', 'WNBA', 'NCAAM', 'NCAAW'].includes(sport);
        const isFootball = ['NFL', 'NCAAF'].includes(sport);
        
        const allKeys = new Set<string>();
        statsData.forEach(row => Object.keys(row.stats).forEach(k => {
            if (k.includes('|')) allKeys.add(k);
        }));
        const uniqueKeys = Array.from(allKeys);
        
        const findKey = (suffix: string) => uniqueKeys.find(k => k.endsWith(suffix) || k.split('|')[1] === suffix);

        if (isBasketball) {
            return {
                'Team': [
                    findKey('Points') || 'Team|Points',
                    findKey('Rebounds') || 'Team|Rebounds',
                    findKey('Field Goal %') || 'Team|Field Goal %'
                ].filter(Boolean) as string[],
                
                'Opponent': [
                    findKey('Opponent Points') || 'Opponent|Opponent Points',
                    findKey('Opponent Rebounds') || 'Opponent|Opponent Rebounds',
                    findKey('Opponent Field Goal %') || 'Opponent|Opponent Field Goal %'
                ].filter(Boolean) as string[],
                
                'Differential': [
                    findKey('Points Differential') || 'Differential|Points Differential',
                    findKey('Rebounds Differential') || 'Differential|Rebounds Differential',
                    findKey('Field Goal % Differential') || 'Differential|Field Goal % Differential'
                ].filter(Boolean) as string[]
            };
        }

        if (isFootball) {
            return {
                'Offense': [
                    findKey('Points') || 'Team|Points',
                    findKey('Total Yards') || 'Team|Total Yards',
                    findKey('Passing Yards') || 'Team|Passing Yards',
                    findKey('Rushing Yards') || 'Team|Rushing Yards',
                    findKey('First Downs') || 'Team|First Downs'
                ].filter(Boolean) as string[],

                'Defense': [
                    findKey('Opponent Points') || 'Opponent|Opponent Points',
                    findKey('Total Yards Allowed') || 'Opponent|Total Yards Allowed',
                    findKey('Passing Yards Allowed') || 'Opponent|Passing Yards Allowed',
                    findKey('Rushing Yards Allowed') || 'Opponent|Rushing Yards Allowed',
                    findKey('Sacks') || 'Team|Sacks', // Sacks by defense
                    findKey('Interceptions') || 'Team|Interceptions' // Defensive INTs
                ].filter(Boolean) as string[],

                'Special Teams': [
                    findKey('Field Goal %') || 'Team|Field Goal %',
                    findKey('Punting Average') || 'Team|Punting Average',
                    findKey('Kick Return Average') || 'Team|Kick Return Average'
                ].filter(Boolean) as string[],

                'Differential': [
                    findKey('Points Differential') || 'Differential|Points Differential',
                    findKey('Turnover Differential') || 'Differential|Turnover Differential'
                ].filter(Boolean) as string[]
            };
        }

        // Default Layout for other sports (Soccer, Hockey, Baseball)
        const categories: Record<string, string[]> = {};
        const PREFERRED_ORDER = ['Overview', 'Offense', 'Defense', 'Scoring', 'Passing', 'Rushing', 'Shooting', 'Efficiency', 'Special Teams', 'General'];
        
        uniqueKeys.forEach(fullKey => {
            const [cat, label] = fullKey.split('|');
            const category = cat || 'General';
            
            if (label === 'Wins' || label === 'Points' || label === 'Differential') {
                if (!categories['Overview']) categories['Overview'] = [];
                if (!categories['Overview'].includes(fullKey)) categories['Overview'].push(fullKey);
            } else {
                if (!categories[category]) categories[category] = [];
                categories[category].push(fullKey);
            }
        });

        const sortedCats: Record<string, string[]> = {};
        const sortedKeys = Object.keys(categories).sort((a, b) => {
            const idxA = PREFERRED_ORDER.indexOf(a);
            const idxB = PREFERRED_ORDER.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        sortedKeys.forEach(k => sortedCats[k] = categories[k]);
        return sortedCats;
    }, [statsData, sport]);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        } else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        } else {
            const label = key.split('|')[1]?.toLowerCase() || '';
            const inverse = label.includes('allowed') || label.includes('against') || label.includes('turnover') || label.includes('interception') || label.includes('era');
            direction = inverse ? 'asc' : 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData: LeagueStatRow[] = useMemo(() => {
        if (!sortConfig) return statsData;
        return [...statsData].sort((a, b) => {
            const valA = parseVal(a.stats[sortConfig.key] || '0');
            const valB = parseVal(b.stats[sortConfig.key] || '0');
            return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        });
    }, [statsData, sortConfig]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 min-h-[50vh] animate-fade-in">
                <Loader2 size={40} className="text-slate-400 animate-spin mb-4" />
                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">Initializing Database</h3>
                <p className="text-sm text-slate-500">Retrieving team statistics...</p>
            </div>
        );
    }

    if (statsData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 min-h-[50vh] animate-fade-in text-center px-4">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mb-6 text-slate-400 dark:text-slate-500">
                    <Database size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Data Unavailable</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-md">
                    Unable to load statistics for {sport} at this time. Please check your connection.
                </p>
            </div>
        );
    }

    const hasDetailedStats = Object.keys(categorizedColumns).length > 1;
    const isSyncing = !hasDetailedStats || statsData.some(r => Object.keys(r.stats).length < 5);

    return (
        <div className="animate-fade-in space-y-4 pb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
                <div className="flex items-center gap-3">
                    <Activity size={16} className="text-emerald-500" />
                    <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Season Team Statistics
                    </h3>
                </div>
                <div className="flex items-center gap-4">
                    {isSyncing ? (
                        <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1.5 animate-pulse">
                            <RefreshCw size={12} className="animate-spin" />
                            Hydrating Data...
                        </span>
                    ) : (
                        <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5">
                            <CheckCircle2 size={12} />
                            Database Active
                        </span>
                    )}
                </div>
            </div>

            <div className="relative border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900/40 shadow-sm flex flex-col">
                <div ref={scrollContainerRef} className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-max">
                        <thead>
                            <tr className="bg-slate-50/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900 p-4 min-w-[200px] border-r border-slate-100 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.2)]">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Team</span>
                                </th>
                                {Object.entries(categorizedColumns).map(([category, keys]) => (
                                    <React.Fragment key={category}>
                                        {(keys as string[]).map((key, idx) => {
                                            const label = key.split('|')[1];
                                            const isSort = sortConfig?.key === key;
                                            return (
                                                <th 
                                                    key={key} 
                                                    onClick={() => handleSort(key)}
                                                    className={`p-3 min-w-[100px] cursor-pointer transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 group relative ${idx === 0 ? 'border-l border-slate-100 dark:border-slate-800' : ''}`}
                                                >
                                                    <div className="flex flex-col gap-1">
                                                        {idx === 0 && (
                                                            <span className="absolute top-1 left-3 text-[9px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest whitespace-nowrap">
                                                                {category}
                                                            </span>
                                                        )}
                                                        <div className={`flex items-center gap-1 mt-3 text-xs font-bold whitespace-nowrap ${isSort ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200'}`}>
                                                            {label}
                                                            {isSort && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                        </div>
                                                    </div>
                                                </th>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                            {sortedData.map((row) => (
                                <tr key={row.team.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                    <td className="sticky left-0 z-10 bg-white dark:bg-slate-950 group-hover:bg-slate-50 dark:group-hover:bg-slate-900 p-3 border-r border-slate-100 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.2)]">
                                        <div 
                                            className="flex items-center gap-3 cursor-pointer"
                                            onClick={() => onTeamClick(row.team.id, sport)}
                                        >
                                            {row.team.logo ? (
                                                <img src={row.team.logo} alt="" className="w-8 h-8 object-contain" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800" />
                                            )}
                                            <span className="font-bold text-sm text-slate-800 dark:text-slate-200 truncate max-w-[140px] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                {row.team.name}
                                            </span>
                                        </div>
                                    </td>
                                    {Object.entries(categorizedColumns).map(([category, keys]) => (
                                        <React.Fragment key={category}>
                                            {(keys as string[]).map((key, idx) => {
                                                const val = row.stats[key];
                                                const rank = row.ranks[key];
                                                if (val === undefined || val === null) {
                                                    return (
                                                        <td key={key} className={`p-3 text-center ${idx === 0 ? 'border-l border-slate-100 dark:border-slate-800' : ''}`}>
                                                            <span className="text-slate-300 dark:text-slate-700 font-mono text-xs">-</span>
                                                        </td>
                                                    );
                                                }
                                                const isTop3 = rank <= 3;
                                                const isBottom3 = rank >= sortedData.length - 2;
                                                
                                                return (
                                                    <td key={key} className={`p-3 text-center ${idx === 0 ? 'border-l border-slate-100 dark:border-slate-800' : ''}`}>
                                                        <div className="flex flex-col items-center">
                                                            <span className={`font-mono text-sm font-bold ${isTop3 ? 'text-emerald-600 dark:text-emerald-400' : isBottom3 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-300'}`}>
                                                                {val}
                                                            </span>
                                                            {rank && (
                                                                <span className={`text-[9px] font-bold px-1.5 rounded ${isTop3 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}`}>
                                                                    #{rank}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </React.Fragment>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};