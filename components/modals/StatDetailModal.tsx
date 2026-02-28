
import React, { useMemo, useState } from 'react';
import { Sport } from '../../types';
import { getStatDefinition } from '../../services/probabilities/statDefinitions';
import { getDistribution, StatDistribution } from '../../services/probabilities/rankings';
import { X, Info, TrendingUp, TrendingDown, Minus, Trophy, Medal, List } from 'lucide-react';

interface StatDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    stat: { label: string; value: string; rank?: number };
    teamName: string;
    sport: Sport;
    initialView?: 'DETAILS' | 'LEADERBOARD';
}

const parseVal = (v: string) => parseFloat(v.replace(/[^0-9.-]/g, ''));

export const StatDetailModal: React.FC<StatDetailModalProps> = ({ isOpen, onClose, stat, teamName, sport, initialView = 'DETAILS' }) => {
    const [view, setView] = useState<'DETAILS' | 'LEADERBOARD'>(initialView);
    
    const def = useMemo(() => getStatDefinition(stat.label), [stat.label]);
    const dist = useMemo(() => getDistribution(sport, stat.label), [sport, stat.label]);
    const val = parseVal(stat.value);

    // Calculate percentiles and ranges if distribution exists
    const metrics = useMemo(() => {
        if (!dist) return null;
        
        const zScore = (val - dist.mean) / dist.stdDev;
        const leagueBest = dist.inverse ? dist.mean - (2.5 * dist.stdDev) : dist.mean + (2.5 * dist.stdDev);
        const leagueWorst = dist.inverse ? dist.mean + (2.5 * dist.stdDev) : dist.mean - (2.5 * dist.stdDev);
        
        // Normalize position 0-100 for the bar
        // If inverse (lower is better): Worst (High) -> Best (Low)
        // If normal (higher is better): Worst (Low) -> Best (High)
        
        let positionPct = 50;
        if (dist.inverse) {
            // Lower is better. Range: [Worst (High) ... Best (Low)]
            // If val is lower than mean, it's towards 100%
            positionPct = 50 + ((-zScore / 5) * 100); 
        } else {
            // Higher is better. Range: [Worst (Low) ... Best (High)]
            positionPct = 50 + ((zScore / 5) * 100);
        }
        
        positionPct = Math.max(5, Math.min(95, positionPct));

        return { zScore, leagueBest, leagueWorst, positionPct };
    }, [dist, val]);

    if (!isOpen) return null;

    // Generate Simulated Leaderboard Rows
    const leaderboardRows = useMemo(() => {
        if (!dist || !stat.rank) return [];
        const rows = [];
        const currentRank = stat.rank;
        const totalTeams = sport === 'NFL' ? 32 : sport === 'NBA' ? 30 : 20; // Approx
        
        // Add #1
        const bestZ = dist.inverse ? -2.2 : 2.2;
        const bestVal = dist.mean + (bestZ * dist.stdDev);
        rows.push({ rank: 1, name: 'League Leader', value: bestVal, isTeam: false });

        // Add Neighbors
        const startRank = Math.max(2, currentRank - 1);
        const endRank = Math.min(totalTeams - 1, currentRank + 1);

        for (let r = startRank; r <= endRank; r++) {
            if (r === currentRank) {
                rows.push({ rank: r, name: teamName, value: val, isTeam: true });
            } else {
                // Approximate Z based on rank percentile
                const pct = 1 - (r / totalTeams);
                // Inverse CDF approx or simple linear mapping for UI visual
                // Linear mapping z-score from +2 to -2 based on rank
                const estZ = 2 - ((r / totalTeams) * 4); 
                const finalZ = dist.inverse ? -estZ : estZ; // Flip if lower is better
                const estVal = dist.mean + (finalZ * dist.stdDev);
                rows.push({ rank: r, name: `${sport} Team`, value: estVal, isTeam: false });
            }
        }

        // Add Last Place
        if (endRank < totalTeams) {
             const worstZ = dist.inverse ? 2.2 : -2.2;
             const worstVal = dist.mean + (worstZ * dist.stdDev);
             rows.push({ rank: totalTeams, name: 'League Floor', value: worstVal, isTeam: false });
        }

        return rows.sort((a,b) => a.rank - b.rank);
    }, [dist, stat.rank, teamName, val, sport]);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white leading-none mb-1">{def.title}</h2>
                        <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{teamName}</span>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-100 dark:border-slate-800">
                    <button 
                        onClick={() => setView('DETAILS')}
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${view === 'DETAILS' ? 'bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'bg-slate-50 dark:bg-slate-900/30 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        Analysis
                    </button>
                    <button 
                        onClick={() => setView('LEADERBOARD')}
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${view === 'LEADERBOARD' ? 'bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'bg-slate-50 dark:bg-slate-900/30 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        Rankings
                    </button>
                </div>

                <div className="overflow-y-auto p-6">
                    {view === 'DETAILS' ? (
                        <div className="space-y-8">
                            {/* Definition */}
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                                <div className="flex gap-3">
                                    <Info className="text-indigo-600 dark:text-indigo-400 shrink-0" size={20} />
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100">Metric Definition</h4>
                                        <p className="text-xs text-indigo-800 dark:text-indigo-300 leading-relaxed">{def.fullDesc}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Main Stat Display */}
                            <div className="text-center">
                                <div className="text-5xl font-mono font-bold text-slate-900 dark:text-white tracking-tighter mb-2">
                                    {stat.value}
                                </div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                    {sport} Rank #{stat.rank || '-'}
                                </div>
                            </div>

                            {/* League Context Visualization */}
                            {metrics && dist ? (
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                                        <span>League Floor</span>
                                        <span>League Avg</span>
                                        <span>League Ceiling</span>
                                    </div>
                                    <div className="h-4 bg-slate-100 dark:bg-slate-900 rounded-full relative border border-slate-200 dark:border-slate-800 overflow-hidden">
                                        {/* Average Marker */}
                                        <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-300 dark:bg-slate-700 z-10"></div>
                                        
                                        {/* Team Marker */}
                                        <div 
                                            className="absolute top-0 bottom-0 w-2 bg-indigo-500 z-20 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-1000 ease-out"
                                            style={{ left: `${metrics.positionPct}%`, transform: 'translateX(-50%)' }}
                                        ></div>

                                        {/* Gradient Background */}
                                        <div className={`absolute inset-0 opacity-20 ${def.better === 'High' ? 'bg-gradient-to-r from-rose-500 via-yellow-500 to-emerald-500' : 'bg-gradient-to-r from-emerald-500 via-yellow-500 to-rose-500'}`}></div>
                                    </div>
                                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                                        <span>{dist.inverse ? dist.mean + (2*dist.stdDev) : dist.mean - (2*dist.stdDev)}</span>
                                        <span>{dist.mean}</span>
                                        <span>{dist.inverse ? dist.mean - (2*dist.stdDev) : dist.mean + (2*dist.stdDev)}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 text-center text-xs text-slate-400 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                    League distribution data unavailable for this specific metric.
                                </div>
                            )}

                            {/* Quick Stats Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Impact</div>
                                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        {def.better === 'High' ? 'Higher is Better' : 'Lower is Better'}
                                    </div>
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Confidence</div>
                                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        {dist ? 'High (Verified)' : 'Low (Estimated)'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 p-3 bg-slate-100 dark:bg-slate-900 rounded-xl text-xs text-slate-600 dark:text-slate-400 mb-4">
                                <List size={16} />
                                <span className="font-medium">
                                    Projected standings neighborhood based on statistical probability distributions.
                                </span>
                            </div>
                            
                            {leaderboardRows.length > 0 ? (
                                <div className="space-y-2">
                                    {leaderboardRows.map((row, idx) => (
                                        <div 
                                            key={idx} 
                                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                row.isTeam 
                                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 shadow-sm' 
                                                    : 'bg-white dark:bg-slate-900/30 border-slate-100 dark:border-slate-800'
                                            }`}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                                    row.rank === 1 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                    row.rank === 2 ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' :
                                                    row.rank === 3 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-500' :
                                                    'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-500'
                                                }`}>
                                                    {row.rank}
                                                </div>
                                                <span className={`text-sm font-bold ${row.isTeam ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-600 dark:text-slate-400'}`}>
                                                    {row.name}
                                                </span>
                                            </div>
                                            <div className="font-mono font-bold text-slate-900 dark:text-white">
                                                {row.value.toFixed(1)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-slate-400 text-sm">
                                    Ranking data not available for this metric.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
