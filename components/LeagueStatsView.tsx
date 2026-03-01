import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sport, StandingsGroup, LeagueStatRow } from '../types';
import { getStoredLeagueStats } from '../services/teamService';
import { dbEvents } from '../services/statsDb';
import { Loader2, ArrowUp, ArrowDown, Activity, Database, CheckCircle2, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import { isInverseMetricLabel } from '../services/statDictionary';
import { auditInternalSportData, SportIntegrityReport } from '../services/dataIntegrity';
import { StatDetailModal } from './modals/StatDetailModal';
import { formatSeasonLabel } from '../services/seasonScope';

interface LeagueStatsViewProps {
    groups: StandingsGroup[];
    sport: Sport;
    onTeamClick: (teamId: string, league: Sport) => void;
    seasonYear?: number;
}

const parseVal = (v: string, key?: string): number | null => {
    const raw = String(v || '').trim();
    if (!raw) return null;

    const timeMatch = raw.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
        if (timeMatch[3] !== undefined) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
            return (hours * 60) + minutes + (seconds / 60);
        }
        const minutes = parseInt(timeMatch[1], 10);
        const seconds = parseInt(timeMatch[2], 10);
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
        return minutes + (seconds / 60);
    }

    const pairedMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*[-/]\s*(-?\d+(?:\.\d+)?)$/);
    if (pairedMatch) {
        const made = parseFloat(pairedMatch[1]);
        const attempts = parseFloat(pairedMatch[2]);
        if (!Number.isFinite(made) || !Number.isFinite(attempts)) return null;
        if (attempts === 0) return 0;
        const label = String((key || '').split('|')[1] || key || '').toLowerCase();
        const looksLikeRatePair =
            label.includes('%') ||
            label.includes('pct') ||
            label.includes('percent') ||
            label.includes('rate') ||
            label.includes('ratio') ||
            label.includes('completion') ||
            label.includes('conversions') ||
            label.includes('on target') ||
            label.includes('field goal') ||
            label.includes('free throw') ||
            label.includes('three point') ||
            label.includes('3-point') ||
            label.includes('3pt') ||
            label.includes('power play') ||
            label.includes('penalty kill');
        return looksLikeRatePair ? (made / attempts) * 100 : null;
    }

    const n = parseFloat(raw.replace(/,/g, '').replace('%', '').replace('+', ''));
    if (!Number.isFinite(n)) return null;
    return raw.includes('%') && Math.abs(n) <= 1 ? n * 100 : n;
};

const CATEGORY_ORDER = ['Offense', 'Defense', 'Differential', 'Efficiency', 'Special Teams', 'General', 'Other'];

const SPORT_PRIORITY_LABELS: Record<string, string[]> = {
    NBA: [
        'Points', 'Opponent Points', 'Points Differential',
        'Rebounds', 'Opponent Rebounds', 'Rebounds Differential',
        'Assists', 'Turnovers', 'Steals', 'Blocks',
        'Field Goal %', 'Opponent Field Goal %', '3-Point %'
    ],
    WNBA: [
        'Points', 'Opponent Points', 'Points Differential',
        'Rebounds', 'Opponent Rebounds', 'Rebounds Differential',
        'Assists', 'Turnovers', 'Steals', 'Blocks',
        'Field Goal %', 'Opponent Field Goal %', '3-Point %'
    ],
    NCAAM: [
        'Points', 'Opponent Points', 'Points Differential',
        'Rebounds', 'Opponent Rebounds', 'Rebounds Differential',
        'Assists', 'Turnovers', 'Steals', 'Blocks',
        'Field Goal %', 'Opponent Field Goal %', '3-Point %'
    ],
    NCAAW: [
        'Points', 'Opponent Points', 'Points Differential',
        'Rebounds', 'Opponent Rebounds', 'Rebounds Differential',
        'Assists', 'Turnovers', 'Steals', 'Blocks',
        'Field Goal %', 'Opponent Field Goal %', '3-Point %'
    ],
    NFL: [
        'Points', 'Opponent Points', 'Points Differential',
        'Total Yards', 'Total Yards Allowed',
        'Passing Yards', 'Passing Yards Allowed',
        'Rushing Yards', 'Rushing Yards Allowed',
        'First Downs', 'Sacks', 'Interceptions',
        'Turnover Differential'
    ],
    NCAAF: [
        'Points', 'Opponent Points', 'Points Differential',
        'Total Yards', 'Total Yards Allowed',
        'Passing Yards', 'Passing Yards Allowed',
        'Rushing Yards', 'Rushing Yards Allowed',
        'First Downs', 'Sacks', 'Interceptions',
        'Turnover Differential'
    ]
};

const isInverseMetricKey = (key: string): boolean => {
    const label = key.split('|')[1] || key;
    return isInverseMetricLabel(label);
};

const splitStatKey = (fullKey: string): { sourceCategory: string; label: string } => {
    const separator = fullKey.indexOf('|');
    if (separator === -1) {
        return { sourceCategory: 'General', label: fullKey };
    }
    return {
        sourceCategory: fullKey.slice(0, separator) || 'General',
        label: fullKey.slice(separator + 1) || fullKey,
    };
};

const inferDisplayCategory = (sourceCategory: string, label: string, sport: Sport): string => {
    const lowerLabel = label.toLowerCase();
    const sourceCategoryLower = sourceCategory.toLowerCase().trim();

    const offenseSourceCategories = new Set([
        'team',
        'offense',
        'passing',
        'rushing',
        'receiving',
        'shooting',
        'rebounding',
        'batting',
    ]);
    const defenseSourceCategories = new Set([
        'defense',
        'opponent',
        'fielding',
        'pitching',
    ]);
    const otherSourceCategories = new Set([
        'general',
        'differential',
        'special teams',
        'ball control',
        'efficiency',
    ]);

    if (
        lowerLabel === 'wins' ||
        lowerLabel === 'losses' ||
        lowerLabel === 'ties' ||
        lowerLabel === 'games played' ||
        lowerLabel === 'games' ||
        lowerLabel === 'gp'
    ) {
        return 'General';
    }
    if (lowerLabel.includes('differential') || lowerLabel.includes('margin')) return 'Differential';
    if (lowerLabel.includes('opponent') || lowerLabel.includes('allowed') || lowerLabel.includes('against')) return 'Defense';
    if (lowerLabel.includes('kick') || lowerLabel.includes('punt') || lowerLabel.includes('return')) return 'Special Teams';

    if (sourceCategoryLower && !otherSourceCategories.has(sourceCategoryLower)) {
        if (offenseSourceCategories.has(sourceCategoryLower)) return 'Offense';
        if (defenseSourceCategories.has(sourceCategoryLower)) return 'Defense';
    }

    if (sport === 'NFL' || sport === 'NCAAF') {
        if (
            lowerLabel.includes('pass') ||
            lowerLabel.includes('rush') ||
            lowerLabel.includes('touchdown') ||
            lowerLabel.includes('yard') ||
            lowerLabel.includes('first down') ||
            lowerLabel.includes('play') ||
            lowerLabel.includes('drive')
        ) {
            return 'Offense';
        }
        if (lowerLabel.includes('interception') || lowerLabel.includes('sack') || lowerLabel.includes('fumble')) return 'Defense';
    }

    if (sourceCategoryLower === 'special teams') return 'Special Teams';
    if (sourceCategoryLower === 'ball control' || sourceCategoryLower === 'efficiency') return 'Efficiency';
    if (sourceCategoryLower === 'general') return 'General';
    if (sourceCategoryLower === 'differential') return 'Differential';

    if (
        lowerLabel.includes('field goal') ||
        lowerLabel.includes('three point') ||
        lowerLabel.includes('free throw') ||
        lowerLabel.includes('rebound') ||
        lowerLabel.includes('assist') ||
        lowerLabel.includes('points in paint') ||
        lowerLabel.includes('fast break')
    ) {
        return 'Offense';
    }
    if (
        lowerLabel.includes('steal') ||
        lowerLabel.includes('block') ||
        lowerLabel.includes('foul') ||
        lowerLabel.includes('save') ||
        lowerLabel.includes('clearance') ||
        lowerLabel.includes('tackle') ||
        lowerLabel.includes('interception')
    ) {
        return 'Defense';
    }
    if (lowerLabel.includes('ratio') || lowerLabel.includes('rate') || lowerLabel.includes('per ') || lowerLabel.includes('efficiency')) return 'Efficiency';
    if (lowerLabel.includes('%')) return 'Efficiency';

    return 'Other';
};

export const LeagueStatsView: React.FC<LeagueStatsViewProps> = ({ groups, sport, onTeamClick, seasonYear }) => {
    const [statsData, setStatsData] = useState<LeagueStatRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
    const [integrityReport, setIntegrityReport] = useState<SportIntegrityReport | null>(null);
    const [selectedStat, setSelectedStat] = useState<{
        label: string;
        value: string;
        rank?: number;
        category?: string;
        teamId: string;
        teamName: string;
        initialView?: 'DETAILS' | 'LEADERBOARD';
    } | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
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
                fallbackMap,
                seasonYear,
            );
            
            if (rows.length > 0) {
                // Calculate Ranks Client-Side
                const allKeys = new Set<string>();
                rows.forEach(row => Object.keys(row.stats).forEach(k => allKeys.add(k)));
                
                const rankedRows = [...rows];
                allKeys.forEach(key => {
                    const inverse = isInverseMetricKey(key);

                    const comparableIndices = rankedRows
                        .map((_, i) => i)
                        .filter((i) => parseVal(rankedRows[i].stats[key] || '', key) !== null);

                    const sortedIndices = comparableIndices.sort((a, b) => {
                        const valA = parseVal(rankedRows[a].stats[key] || '', key);
                        const valB = parseVal(rankedRows[b].stats[key] || '', key);
                        if (valA === null && valB === null) return 0;
                        if (valA === null) return 1;
                        if (valB === null) return -1;
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

    const loadIntegrity = async () => {
        try {
            const report = await auditInternalSportData(sport);
            setIntegrityReport(report);
        } catch (e) {
            console.error(e);
            setIntegrityReport(null);
        }
    };

    // Initial Load & Event Listener
    useEffect(() => {
        if (activeTeams.length === 0) return;

        loadFromDB(true);
        loadIntegrity();

        const handleUpdate = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.sport === sport) {
                loadFromDB(false); // Silent refresh
                loadIntegrity();
            }
        };

        dbEvents.addEventListener('stats_updated', handleUpdate);
        return () => dbEvents.removeEventListener('stats_updated', handleUpdate);
    }, [activeTeams, sport, seasonYear]);

    // Group stats by category and surface every tracked stat column from the internal dataset.
    const categorizedColumns = useMemo<Record<string, string[]>>(() => {
        if (statsData.length === 0) return {};
        const keyMeta = new Map<string, { sourceCategory: string; displayCategory: string; label: string; coverage: number }>();

        statsData.forEach(row => {
            const seen = new Set<string>();
            Object.keys(row.stats).forEach(fullKey => {
                if (seen.has(fullKey)) return;
                seen.add(fullKey);
                const { sourceCategory, label } = splitStatKey(fullKey);
                const safeLabel = (label || sourceCategory || 'Unknown').trim();
                if (!safeLabel) return;
                const displayCategory = inferDisplayCategory(sourceCategory, safeLabel, sport);

                const existing = keyMeta.get(fullKey);
                if (existing) {
                    existing.coverage += 1;
                } else {
                    keyMeta.set(fullKey, { sourceCategory, displayCategory, label: safeLabel, coverage: 1 });
                }
            });
        });

        const allMetas = Array.from(keyMeta.entries()).map(([key, meta]) => ({ key, ...meta }));
        if (allMetas.length === 0) return {};

        const priorityLabels = SPORT_PRIORITY_LABELS[sport] || [];
        const priorityIndex = new Map<string, number>();
        priorityLabels.forEach((label, idx) => {
            priorityIndex.set(label.toLowerCase(), idx);
        });

        const categories = new Map<string, string[]>();
        const addKey = (category: string, key: string) => {
            if (!categories.has(category)) categories.set(category, []);
            const keys = categories.get(category)!;
            if (!keys.includes(key)) keys.push(key);
        };

        const sortByPriorityCoverage = (a: { label: string; coverage: number }, b: { label: string; coverage: number }) => {
            const pA = priorityIndex.get(a.label.toLowerCase());
            const pB = priorityIndex.get(b.label.toLowerCase());
            if (pA !== undefined && pB !== undefined && pA !== pB) return pA - pB;
            if (pA !== undefined) return -1;
            if (pB !== undefined) return 1;
            if (a.coverage !== b.coverage) return b.coverage - a.coverage;
            return a.label.localeCompare(b.label);
        };

        allMetas
            .sort(sortByPriorityCoverage)
            .forEach(meta => {
                const category = meta.displayCategory || 'Other';
                addKey(category, meta.key);
            });

        const output: Record<string, string[]> = {};
        Array.from(categories.keys())
            .sort((a, b) => {
                const idxA = CATEGORY_ORDER.indexOf(a);
                const idxB = CATEGORY_ORDER.indexOf(b);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.localeCompare(b);
            })
            .forEach(category => {
                const keys = categories.get(category) || [];
                output[category] = [...keys].sort((keyA, keyB) => {
                    const metaA = keyMeta.get(keyA);
                    const metaB = keyMeta.get(keyB);
                    if (!metaA || !metaB) return keyA.localeCompare(keyB);
                    return sortByPriorityCoverage(metaA, metaB);
                });
            });

        return output;
    }, [statsData, sport]);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        } else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        } else {
            direction = isInverseMetricKey(key) ? 'asc' : 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData: LeagueStatRow[] = useMemo(() => {
        if (!sortConfig) return statsData;
        return [...statsData].sort((a, b) => {
            const valA = parseVal(a.stats[sortConfig.key] || '', sortConfig.key);
            const valB = parseVal(b.stats[sortConfig.key] || '', sortConfig.key);
            if (valA === null && valB === null) return 0;
            if (valA === null) return 1;
            if (valB === null) return -1;
            return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        });
    }, [statsData, sortConfig]);

    const openStatModal = (row: LeagueStatRow, key: string, viewMode: 'DETAILS' | 'LEADERBOARD') => {
        const rawValue = row.stats[key];
        if (rawValue === undefined || rawValue === null) return;
        const { sourceCategory, label } = splitStatKey(key);
        setSelectedStat({
            label,
            value: String(rawValue),
            rank: row.ranks[key],
            category: sourceCategory,
            teamId: row.team.id,
            teamName: row.team.name,
            initialView: viewMode,
        });
    };

    const openColumnExplainer = (key: string) => {
        const row = sortedData.find((candidate) => candidate.stats[key] !== undefined && candidate.stats[key] !== null);
        if (!row) return;
        openStatModal(row, key, 'DETAILS');
    };

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
                    Unable to load statistics for {sport} ({typeof seasonYear === 'number' ? formatSeasonLabel(sport, seasonYear) : 'current season'}) at this time. Please check your connection.
                </p>
            </div>
        );
    }

    const hasDetailedStats = Object.keys(categorizedColumns).length > 1;
    const isSyncing = !hasDetailedStats || statsData.some(r => Object.keys(r.stats).length < 5);
    const seasonLabel = typeof seasonYear === 'number' ? formatSeasonLabel(sport, seasonYear) : 'Current Season';

    return (
        <div ref={rootRef} className="animate-fade-in space-y-4 pb-8 scroll-mt-24">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
                <div className="flex items-center gap-3">
                    <Activity size={16} className="text-emerald-500" />
                    <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Season Team Statistics
                    </h3>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300">
                        {seasonLabel}
                    </span>
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
                    {integrityReport && integrityReport.issues.length > 0 && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1.5">
                            <AlertTriangle size={12} />
                            {integrityReport.issues.length} Integrity Warning{integrityReport.issues.length === 1 ? '' : 's'}
                        </span>
                    )}
                </div>
            </div>
            {integrityReport && (
                <div className={`rounded-xl border px-3 py-2 text-[11px] ${
                    integrityReport.issues.length > 0
                        ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300'
                        : 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                }`}>
                    {integrityReport.issues.length > 0
                        ? `Integrity audit: ${integrityReport.teamsAudited} teams checked, ${integrityReport.issues.length} warning(s), average coverage ${(integrityReport.averageCoverage * 100).toFixed(0)}%.`
                        : `Integrity audit: ${integrityReport.teamsAudited} teams checked with no active warnings (coverage ${(integrityReport.averageCoverage * 100).toFixed(0)}%).`}
                </div>
            )}

            <div className="relative border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900/40 shadow-sm flex flex-col">
                <div ref={scrollContainerRef} className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-max">
                        <thead>
                            <tr className="bg-slate-50/80 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900 p-4 min-w-[220px] border-r border-slate-100 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.2)]">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Team</span>
                                </th>
                                {Object.entries(categorizedColumns).map(([category, keys]) => (
                                    <React.Fragment key={category}>
                                        {(keys as string[]).map((key, idx) => {
                                            const { label } = splitStatKey(key);
                                            const isSort = sortConfig?.key === key;
                                            return (
                                                <th
                                                    key={key} 
                                                    onClick={() => handleSort(key)}
                                                    className={`p-3 min-w-[110px] cursor-pointer transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 group relative ${idx === 0 ? 'border-l border-slate-100 dark:border-slate-800' : ''}`}
                                                >
                                                    <div className="flex flex-col gap-1">
                                                        {idx === 0 && (
                                                            <span className="absolute top-1 left-3 text-[9px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest whitespace-nowrap">
                                                                {category}
                                                            </span>
                                                        )}
                                                        <div className={`flex items-center gap-1 mt-3 text-[11px] font-bold whitespace-nowrap ${isSort ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100'}`}>
                                                            {label}
                                                            {isSort && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    openColumnExplainer(key);
                                                                }}
                                                                className="p-0.5 rounded text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                                                aria-label={`Explain ${label}`}
                                                                title={`Explain ${label}`}
                                                            >
                                                                <Info size={11} />
                                                            </button>
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
                            {sortedData.map((row, rowIndex) => (
                                <tr key={row.team.id} className={`group transition-colors ${rowIndex % 2 === 0 ? 'bg-white/70 dark:bg-slate-950/45' : 'bg-slate-50/45 dark:bg-slate-900/20'} hover:bg-slate-50 dark:hover:bg-slate-800/30`}>
                                    <td className="sticky left-0 z-10 bg-white dark:bg-slate-950 group-hover:bg-slate-50 dark:group-hover:bg-slate-900 p-3 border-r border-slate-100 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.2)]">
                                        <button
                                            type="button"
                                            onClick={() => onTeamClick(row.team.id, sport)}
                                            aria-label={`Open ${row.team.name} team page`}
                                            className="w-full flex items-center gap-3 text-left cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded-md"
                                        >
                                            {row.team.logo ? (
                                                <img src={row.team.logo} alt="" className="w-8 h-8 object-contain" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800" />
                                            )}
                                            <span className="font-bold text-[15px] text-slate-800 dark:text-slate-200 truncate max-w-[150px] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                {row.team.name}
                                            </span>
                                        </button>
                                    </td>
                                    {Object.entries(categorizedColumns).map(([category, keys]) => (
                                        <React.Fragment key={category}>
                                            {(keys as string[]).map((key, idx) => {
                                                const { label } = splitStatKey(key);
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
                                                        <div className="flex flex-col items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => openStatModal(row, key, 'DETAILS')}
                                                                className={`font-mono text-base font-bold hover:underline underline-offset-2 decoration-dotted ${
                                                                    isTop3
                                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                                        : isBottom3
                                                                            ? 'text-rose-500'
                                                                            : 'text-slate-700 dark:text-slate-200'
                                                                }`}
                                                                aria-label={`Open ${label} details for ${row.team.name}`}
                                                            >
                                                                {val}
                                                            </button>
                                                            {rank && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openStatModal(row, key, 'LEADERBOARD')}
                                                                    className={`text-[10px] font-bold px-1.5 rounded hover:opacity-90 transition-opacity ${
                                                                        isTop3
                                                                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                                                            : 'text-slate-500 dark:text-slate-400'
                                                                    }`}
                                                                    aria-label={`Open ${label} league rankings`}
                                                                >
                                                                    #{rank}
                                                                </button>
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
            {selectedStat && (
                <StatDetailModal
                    isOpen={true}
                    onClose={() => setSelectedStat(null)}
                    stat={{
                        label: selectedStat.label,
                        value: selectedStat.value,
                        rank: selectedStat.rank,
                        category: selectedStat.category,
                    }}
                    teamId={selectedStat.teamId}
                    teamName={selectedStat.teamName}
                    sport={sport}
                    initialView={selectedStat.initialView}
                    onTeamClick={onTeamClick}
                />
            )}
        </div>
    );
};
