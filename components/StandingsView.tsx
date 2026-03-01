
import React, { useMemo } from 'react';
import { StandingsGroup, Sport, StandingsType, SOCCER_LEAGUES } from '../types';
import { Info, AlertCircle, Trophy, List, GitMerge } from 'lucide-react';

interface StandingsViewProps {
    groups: StandingsGroup[];
    sport: Sport;
    type?: 'STANDINGS' | 'RANKINGS';
    activeType?: StandingsType;
    onTypeChange?: (type: StandingsType) => void;
    onTeamClick?: (teamId: string, league: Sport) => void;
    isLoading?: boolean;
    useApiRankForNCAA?: boolean;
}

// Config to determine where the cutoff line goes
const CUTOFF_CONFIG: Partial<Record<Sport, { rank: number; label: string; secondaryRank?: number; secondaryLabel?: string }>> = {
    'NBA': { rank: 6, label: 'Playoffs', secondaryRank: 10, secondaryLabel: 'Play-In' },
    'NFL': { rank: 7, label: 'Playoffs' },
    'MLB': { rank: 6, label: 'Postseason' },
    'NHL': { rank: 8, label: 'Playoffs' }, 
    'EPL': { rank: 4, label: 'Champions League', secondaryRank: 5, secondaryLabel: 'Europa' },
    'Bundesliga': { rank: 4, label: 'Champions League' },
    'La Liga': { rank: 4, label: 'Champions League' },
    'Serie A': { rank: 4, label: 'Champions League' },
    'Ligue 1': { rank: 3, label: 'Champions League' },
    'MLS': { rank: 9, label: 'Playoffs' },
    'WNBA': { rank: 8, label: 'Playoffs' }
};

// Sports where conference record is a key display metric
const SHOW_CONF_RECORD_LEAGUES: Sport[] = ['NCAAF', 'NCAAM', 'NCAAW', 'WNBA', 'NHL', 'MLB'];

// Sports eligible for the toggle
const TOGGLE_ELIGIBLE_SPORTS: Sport[] = ['NFL', 'NBA', 'NHL', 'MLB', 'WNBA'];

export const StandingsView: React.FC<StandingsViewProps> = ({ groups, sport, type = 'STANDINGS', activeType = 'PLAYOFF', onTypeChange, onTeamClick, isLoading = false, useApiRankForNCAA = false }) => {
    const config = CUTOFF_CONFIG[sport];
    const isNCAA = sport.startsWith('NCAA');
    const isRankings = type === 'RANKINGS';
    const isSoccer = SOCCER_LEAGUES.includes(sport);
    
    // Check if ANY team in the current view has valid conference record data. 
    // If not, hide the column to keep it clean, UNLESS it's NCAA where we expect it even if 0-0.
    const hasConfData = useMemo(() => {
        if (isNCAA) return true; // Always show for NCAA
        return groups.some(g => g.standings.some(s => s.stats.confRecord && s.stats.confRecord !== '-' && s.stats.confRecord !== '0-0'));
    }, [groups, isNCAA]);

    const showConf = SHOW_CONF_RECORD_LEAGUES.includes(sport) && !isRankings && hasConfData;
    const showToggle = TOGGLE_ELIGIBLE_SPORTS.includes(sport) && !isRankings && onTypeChange;

    const divisionLabel = ['NBA', 'WNBA', 'NFL', 'NCAAF'].includes(sport) ? 'Conference' : 'Division';

    if (isLoading) {
        return (
            <div className="space-y-6 animate-fade-in">
                {showToggle && (
                    <div className="flex justify-center mb-2">
                        <div className="w-full max-w-sm h-10 bg-slate-100 dark:bg-slate-900/80 rounded-xl animate-pulse"></div>
                    </div>
                )}
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="bg-slate-50/80 dark:bg-slate-900 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse"></div>
                        </div>
                        <div className="p-0">
                            {[...Array(8)].map((__, j) => (
                                <div key={j} className="flex items-center px-6 py-3 border-b border-slate-100 dark:border-slate-800/40">
                                    <div className="w-6 h-4 bg-slate-100 dark:bg-slate-800 rounded mr-6 animate-pulse"></div>
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse"></div>
                                        <div className="h-4 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
                                    </div>
                                    <div className="w-12 h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-4"></div>
                                    <div className="w-12 h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-4"></div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Toggle Control for Eligible Sports */}
            {showToggle && (
                <div className="flex justify-center mb-2">
                    <div className="flex w-full max-w-sm bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                        <button
                            onClick={() => onTypeChange?.('PLAYOFF')}
                            className={`flex-1 flex items-center justify-center px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                                ${activeType === 'PLAYOFF' 
                                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            Playoff Picture
                        </button>
                        <button
                            onClick={() => onTypeChange?.('DIVISION')}
                            className={`flex-1 flex items-center justify-center px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                                ${activeType === 'DIVISION' 
                                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            {divisionLabel} Standings
                        </button>
                    </div>
                </div>
            )}

            {!groups.length ? (
                <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20">
                    <p>Standings data not available for this view.</p>
                </div>
            ) : (
                groups.map((group, groupIdx) => {
                    // Sorting Logic: Enforce Conference Record Order for NCAA
                    const sortedStandings = [...group.standings].sort((a, b) => {
                        // For Rankings view (e.g. AP Top 25), rely strictly on rank
                        if (isRankings) return a.rank - b.rank;

                        // When the app requests NCAA Top-25 behavior inside standings views,
                        // keep API rank ordering so teams are not reshuffled by conference records.
                        if (isNCAA && useApiRankForNCAA) {
                            return a.rank - b.rank;
                        }

                        // For NCAA Conference Standings
                        if (isNCAA) {
                            // 1. Conference Winning Percentage
                            const getConfPct = (rec?: string) => {
                                if (!rec || rec === '-') return -1;
                                const [w, l] = rec.split('-').map(Number);
                                if (isNaN(w) || isNaN(l)) return -1;
                                const total = w + l;
                                return total === 0 ? 0 : w / total;
                            };
                            
                            const confPctA = getConfPct(a.stats.confRecord);
                            const confPctB = getConfPct(b.stats.confRecord);
                            
                            if (confPctA !== confPctB) return confPctB - confPctA; // Descending Pct

                            // 2. Overall Winning Percentage
                            const getOverPct = (pct?: string) => parseFloat(pct || '0');
                            const overPctA = getOverPct(a.stats.pct);
                            const overPctB = getOverPct(b.stats.pct);
                            if (overPctA !== overPctB) return overPctB - overPctA;

                            // 3. Fallback to Rank provided by API (often handles complex tie-breakers)
                            return a.rank - b.rank;
                        }

                        // Default for other leagues: Trust API Rank
                        return a.rank - b.rank;
                    });

                    return (
                    <div key={groupIdx} className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="bg-slate-50/80 dark:bg-slate-900 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider font-display">{group.name}</h3>
                            {/* Only show cutoff labels in Playoff mode or if it's a sport that doesn't have a toggle */}
                            {config && !isNCAA && !isRankings && (activeType === 'PLAYOFF' || !showToggle) && (
                                <div className="flex items-center gap-4 text-[10px] text-slate-500 dark:text-slate-500 font-semibold">
                                    {/* Playoff Line Legend */}
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-0 border-t-2 border-dashed ${config.secondaryRank ? 'border-blue-400 dark:border-blue-500' : 'border-rose-400 dark:border-rose-500'}`}></div>
                                        <span>{config.label}</span>
                                    </div>
                                    
                                    {/* Play-In Line Legend */}
                                    {config.secondaryRank && (
                                         <div className="flex items-center gap-2">
                                            <div className="w-6 h-0 border-t-2 border-dashed border-rose-400 dark:border-rose-500"></div>
                                            <span>{config.secondaryLabel}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800/80">
                                        <th className="px-6 py-3 w-16 text-center">Rk</th>
                                        <th className="px-6 py-3">Team</th>
                                        {showConf && <th className="px-6 py-3 text-right">Conf</th>}
                                        <th className="px-6 py-3 text-right">{isNCAA ? 'Overall' : `W-D-L`}</th>
                                        {(!isNCAA || isRankings) && (
                                            <th className="px-6 py-3 text-right">{isSoccer || sport === 'NHL' || isRankings ? 'Pts' : 'Pct'}</th>
                                        )}
                                        <th className="px-6 py-3 text-right hidden sm:table-cell">{isRankings ? 'Trend' : 'Diff/GB'}</th>
                                        {!isRankings && <th className="px-6 py-3 text-right hidden sm:table-cell">Strk</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedStandings.map((team, idx) => {
                                        // Calculate display rank dynamically based on sort order if API rank looks unordered or if we re-sorted
                                        const displayRank = isNCAA && !isRankings && !useApiRankForNCAA ? idx + 1 : team.rank;
                                        
                                        // Check if we need a cutoff border
                                        let borderClass = "border-b border-slate-100 dark:border-slate-800/40";
                                        
                                        // Cutoff logic: Only apply in Playoff mode or non-toggle sports
                                        if (config && !isNCAA && !isRankings && (activeType === 'PLAYOFF' || !showToggle)) {
                                            if (team.rank === config.rank) {
                                                const colorClass = config.secondaryRank ? 'border-blue-400 dark:border-blue-500' : 'border-rose-400 dark:border-rose-500';
                                                borderClass = `border-b-2 ${colorClass} border-dashed relative`;
                                            } else if (config.secondaryRank && team.rank === config.secondaryRank) {
                                                 borderClass = "border-b-2 border-rose-400 dark:border-rose-500 border-dashed relative";
                                            }
                                        }
                                        
                                        // Remove border from last item if not a cutoff
                                        if (idx === group.standings.length - 1 && !borderClass.includes('dashed')) {
                                            borderClass = "border-none";
                                        }

                                        return (
                                            <React.Fragment key={team.team.id}>
                                                <tr className={`group hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-sm ${borderClass}`}>
                                                    <td className="px-6 py-3 text-center font-mono text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 relative font-medium">
                                                        {displayRank}
                                                        {team.clincher && !team.isChampion && sport !== 'NFL' && (
                                                            <span className="ml-1 text-[9px] align-top text-slate-900 dark:text-white font-bold" title="Clinched Playoff Spot">{team.clincher}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        <div className="flex flex-col gap-1">
                                                            <div 
                                                                className={`flex items-center gap-3 ${onTeamClick ? 'cursor-pointer' : ''}`}
                                                                onClick={() => onTeamClick?.(team.team.id, sport)}
                                                            >
                                                                {team.team.logo && (
                                                                    <img src={team.team.logo} alt="" className="w-6 h-6 object-contain drop-shadow-sm" loading="lazy" />
                                                                )}
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-semibold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                                                                        {team.team.name}
                                                                    </span>
                                                                    {/* Champion Trophy Icon - Hidden for NFL */}
                                                                    {team.isChampion && sport !== 'NFL' && (
                                                                        <Trophy size={14} className="text-yellow-500 drop-shadow-sm" fill="currentColor" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {/* Tie-breaker Note */}
                                                            {team.note && !isRankings && (
                                                                <div className="flex items-start gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 italic pl-9 opacity-80 group-hover:opacity-100">
                                                                    <Info size={10} className="mt-0.5 shrink-0" />
                                                                    <span>{team.note}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {showConf && (
                                                        <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-400 align-top pt-3.5 font-medium">
                                                            {team.stats.confRecord || '0-0'}
                                                        </td>
                                                    )}

                                                    <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-400 align-top pt-3.5 font-medium">
                                                        {isSoccer 
                                                            ? `${team.stats.wins || 0}-${team.stats.ties || 0}-${team.stats.losses || 0}` 
                                                            : sport === 'NHL' 
                                                                ? `${team.stats.wins || 0}-${team.stats.losses || 0}-${team.stats.ties || 0}`
                                                                : (team.stats.overallRecord || `${team.stats.wins || 0}-${team.stats.losses || 0}${team.stats.ties !== undefined && team.stats.ties > 0 ? `-${team.stats.ties}` : ''}`)
                                                        }
                                                    </td>
                                                    
                                                    {(!isNCAA || isRankings) && (
                                                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200 align-top pt-3.5">
                                                            {isSoccer || sport === 'NHL' || isRankings 
                                                                ? team.stats.points 
                                                                : team.stats.pct}
                                                        </td>
                                                    )}
                                                    
                                                    {isRankings ? (
                                                         <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-500 hidden sm:table-cell text-xs align-top pt-3.5">
                                                            {team.note || '-'}
                                                        </td>
                                                    ) : (
                                                        <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-500 hidden sm:table-cell align-top pt-3.5">
                                                            {team.stats.gamesBehind || (team.stats.pointDifferential && team.stats.pointDifferential > 0 ? `+${team.stats.pointDifferential}` : team.stats.pointDifferential) || '-'}
                                                        </td>
                                                    )}

                                                    {!isRankings && (
                                                        <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-500 hidden sm:table-cell text-xs align-top pt-3.5">
                                                            {team.stats.streak || '-'}
                                                        </td>
                                                    )}
                                                </tr>
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )})
            )}
            
            {!isRankings && !isLoading && (
                <div className="flex items-start gap-3 p-5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-400">
                    <AlertCircle size={16} className="mt-0.5 shrink-0 text-slate-400" />
                    <p className="leading-relaxed">
                        Playoff picture is projected based on current standings and league rules. 
                        Tie-breaker information is provided where applicable by the league data source.
                    </p>
                </div>
            )}
        </div>
    );
};
