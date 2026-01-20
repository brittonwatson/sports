
import React, { useState, useMemo } from 'react';
import { StandingsGroup, Sport, Standing } from '../types';
import { LOCAL_TEAMS } from '../data/teams';
import { ChevronRight, Filter, ChevronDown, Check } from 'lucide-react';

interface TeamsListViewProps {
    groups: StandingsGroup[];
    sport: Sport;
    onTeamClick: (teamId: string, league: Sport) => void;
    isLoading?: boolean;
}

// Extended interface to carry group name when flattened
interface DisplayStanding extends Standing {
    groupName?: string;
}

interface DisplayGroup {
    name: string;
    standings: DisplayStanding[];
}

export const TeamsListView: React.FC<TeamsListViewProps> = ({ groups, sport, onTeamClick, isLoading = false }) => {
    const [selectedConference, setSelectedConference] = useState<string>('ALL');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const isNCAA = ['NCAAF', 'NCAAM', 'NCAAW'].includes(sport);

    // Use groups if available, otherwise fallback to LOCAL_TEAMS to ensure directory always works
    const effectiveGroups = useMemo(() => {
        if (groups && groups.length > 0) return groups;
        
        // Fallback Logic
        const local = LOCAL_TEAMS[sport];
        if (local && local.length > 0) {
            // Construct a dummy group from local data
            return [{
                name: 'All Teams',
                standings: local.map((t, idx) => ({
                    team: {
                        id: t.id,
                        name: t.name,
                        abbreviation: t.name.substring(0, 3).toUpperCase(),
                        logo: t.logo
                    },
                    rank: idx + 1,
                    stats: {}
                }))
            }] as StandingsGroup[];
        }
        return [];
    }, [groups, sport]);

    // Get unique conference names for dropdown (only for NCAA)
    const conferences = useMemo(() => {
        if (!effectiveGroups) return [];
        return Array.from(new Set(effectiveGroups.map(g => g.name))).sort();
    }, [effectiveGroups]);

    // Process data for display
    const displayGroups: DisplayGroup[] = useMemo(() => {
        if (!effectiveGroups) return [];

        if (isNCAA) {
            // NCAA: Filter by dropdown, keep grouping, sort within groups
            let filtered = effectiveGroups;
            if (selectedConference !== 'ALL') {
                filtered = effectiveGroups.filter(g => g.name === selectedConference);
            }
            
            // Sort groups alphabetically
            const sortedGroups = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

            // Sort teams within groups alphabetically
            return sortedGroups.map(group => ({
                name: group.name,
                standings: [...group.standings].sort((a, b) => a.team.name.localeCompare(b.team.name))
            }));
        } else {
            // Non-NCAA: Flatten and sort all teams alphabetically
            // Attach group name to each team for context
            const allTeams: DisplayStanding[] = effectiveGroups.flatMap(g => 
                g.standings.map(s => ({ ...s, groupName: g.name }))
            );
            
            const sortedTeams = allTeams.sort((a, b) => a.team.name.localeCompare(b.team.name));
            
            // Return as a single "All Teams" group (name empty to hide header)
            return [{
                name: '',
                standings: sortedTeams
            }];
        }
    }, [effectiveGroups, isNCAA, selectedConference]);

    if (isLoading) {
        return (
            <div className="space-y-10 animate-fade-in pb-10 min-h-[50vh]">
                {[...Array(2)].map((_, idx) => (
                    <div key={idx}>
                        <div className="flex items-center gap-3 mb-6">
                            <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                            <div className="h-6 w-32 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse"></div>
                            <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {[...Array(8)].map((__, i) => (
                                <div key={i} className="bg-white dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse shrink-0"></div>
                                        <div className="space-y-2">
                                            <div className="h-4 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
                                            <div className="h-3 w-20 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (!effectiveGroups || effectiveGroups.length === 0) {
        return (
            <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20 animate-fade-in">
                <p>Team listing unavailable for {sport}.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10 min-h-[50vh]">
            {/* NCAA Conference Dropdown */}
            {isNCAA && (
                <div className="relative z-30 inline-block mb-2">
                    <button 
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm text-sm font-bold text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700 transition-all min-w-[240px] justify-between"
                    >
                        <span className="flex items-center gap-2">
                            <Filter size={16} className="text-slate-400" />
                            {selectedConference === 'ALL' ? 'All Conferences' : selectedConference}
                        </span>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isDropdownOpen && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)}></div>
                            <div className="absolute top-full left-0 mt-2 w-72 max-h-[400px] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-20 p-1 custom-scrollbar">
                                <button
                                    onClick={() => { setSelectedConference('ALL'); setIsDropdownOpen(false); }}
                                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-between ${selectedConference === 'ALL' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                                >
                                    All Conferences
                                    {selectedConference === 'ALL' && <Check size={14} className="text-emerald-500" />}
                                </button>
                                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1 mx-2"></div>
                                {conferences.map(conf => (
                                    <button
                                        key={conf}
                                        onClick={() => { setSelectedConference(conf); setIsDropdownOpen(false); }}
                                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-between ${selectedConference === conf ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                                    >
                                        <span className="truncate pr-2">{conf}</span>
                                        {selectedConference === conf && <Check size={14} className="text-emerald-500 shrink-0" />}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
            
            <div className="space-y-10">
                {displayGroups.map((group, idx) => (
                    <div key={idx}>
                        {group.name && (
                            <div className="flex items-center gap-3 mb-6">
                                <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                                <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-100 dark:bg-slate-900/50 px-4 py-1.5 rounded-full border border-slate-200 dark:border-slate-800">
                                    {group.name}
                                </h3>
                                <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                            </div>
                        )}
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {group.standings.map((team) => (
                                <div 
                                    key={team.team.id}
                                    onClick={() => onTeamClick(team.team.id, sport)}
                                    className="bg-white dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-all group shadow-sm hover:shadow-md flex items-center justify-between"
                                >
                                    <div className="flex items-center gap-4 overflow-hidden">
                                        <div className="w-12 h-12 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center p-2 border border-slate-100 dark:border-slate-700 shadow-sm shrink-0">
                                            {team.team.logo ? (
                                                <img src={team.team.logo} alt={team.team.name} className="w-full h-full object-contain" />
                                            ) : (
                                                <span className="text-lg font-bold text-slate-400">{team.team.name.charAt(0)}</span>
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <h4 className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-tight truncate">
                                                {team.team.name}
                                            </h4>
                                            
                                            {isNCAA ? (
                                                <div className="flex items-center gap-2 mt-1">
                                                    {team.stats.overallRecord && (
                                                        <span className="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                                            {team.stats.overallRecord}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-1 truncate">
                                                    {team.groupName || ''}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-slate-300 dark:text-slate-700 group-hover:translate-x-1 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition-all shrink-0">
                                        <ChevronRight size={20} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
