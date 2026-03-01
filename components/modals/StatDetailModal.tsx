import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LeagueStatRow, Sport } from '../../types';
import { getStatDefinition, getStatExplainer } from '../../services/probabilities/statDefinitions';
import { getDistribution } from '../../services/probabilities/rankings';
import { fetchStandings, getStoredLeagueStats } from '../../services/teamService';
import { isInverseMetricLabel } from '../../services/statDictionary';
import { X, Info, List, Loader2 } from 'lucide-react';

interface StatDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    stat: { label: string; value: string; rank?: number; category?: string };
    teamId: string;
    teamName: string;
    sport: Sport;
    initialView?: 'DETAILS' | 'LEADERBOARD';
    onTeamClick?: (teamId: string, league: Sport) => void;
}

interface LeaderboardRow {
    teamId: string;
    teamName: string;
    teamLogo?: string;
    value: string;
    numericValue: number | null;
    rank?: number;
    isCurrentTeam: boolean;
}

const parseVal = (v: string) => parseFloat(v.replace(/[^0-9.-]/g, ''));

const normalizeToken = (value: string | undefined): string =>
    String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const splitStatKey = (fullKey: string): { category: string; label: string } => {
    const separator = fullKey.indexOf('|');
    if (separator === -1) return { category: 'General', label: fullKey };
    return {
        category: fullKey.slice(0, separator) || 'General',
        label: fullKey.slice(separator + 1) || fullKey,
    };
};

const parseComparableValue = (value: string, key: string): number | null => {
    const raw = String(value || '').trim();
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
        const label = splitStatKey(key).label.toLowerCase();
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

    const numeric = parseFloat(raw.replace(/,/g, '').replace('%', '').replace('+', ''));
    if (!Number.isFinite(numeric)) return null;
    return raw.includes('%') && Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
};

const resolveStatKey = (rows: LeagueStatRow[], label: string, category?: string): string | null => {
    const allKeys = new Set<string>();
    rows.forEach((row) => Object.keys(row.stats || {}).forEach((key) => allKeys.add(key)));
    const keys = Array.from(allKeys);
    if (keys.length === 0) return null;

    const normalizedLabel = normalizeToken(label);
    const normalizedCategory = normalizeToken(category);

    if (normalizedCategory) {
        const exactCategoryMatch = keys.find((key) => {
            const parts = splitStatKey(key);
            return normalizeToken(parts.label) === normalizedLabel && normalizeToken(parts.category) === normalizedCategory;
        });
        if (exactCategoryMatch) return exactCategoryMatch;
    }

    const exactLabelMatch = keys.find((key) => normalizeToken(splitStatKey(key).label) === normalizedLabel);
    if (exactLabelMatch) return exactLabelMatch;

    const fuzzyLabelMatch = keys.find((key) => {
        const candidate = normalizeToken(splitStatKey(key).label);
        return candidate.includes(normalizedLabel) || normalizedLabel.includes(candidate);
    });
    return fuzzyLabelMatch || null;
};

export const StatDetailModal: React.FC<StatDetailModalProps> = ({
    isOpen,
    onClose,
    stat,
    teamId,
    teamName,
    sport,
    initialView = 'DETAILS',
    onTeamClick,
}) => {
    const [view, setView] = useState<'DETAILS' | 'LEADERBOARD'>(initialView);
    const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
    const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
    const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
    const currentTeamRowRef = useRef<HTMLDivElement | null>(null);

    const def = useMemo(() => getStatDefinition(stat.label), [stat.label]);
    const explainer = useMemo(() => getStatExplainer(stat.label), [stat.label]);
    const dist = useMemo(() => getDistribution(sport, stat.label), [sport, stat.label]);
    const val = parseVal(stat.value);

    const metrics = useMemo(() => {
        if (!dist) return null;

        const zScore = (val - dist.mean) / dist.stdDev;
        const leagueBest = dist.inverse ? dist.mean - (2.5 * dist.stdDev) : dist.mean + (2.5 * dist.stdDev);
        const leagueWorst = dist.inverse ? dist.mean + (2.5 * dist.stdDev) : dist.mean - (2.5 * dist.stdDev);

        let positionPct = 50;
        if (dist.inverse) {
            positionPct = 50 + ((-zScore / 5) * 100);
        } else {
            positionPct = 50 + ((zScore / 5) * 100);
        }
        positionPct = Math.max(5, Math.min(95, positionPct));

        return { zScore, leagueBest, leagueWorst, positionPct };
    }, [dist, val]);

    useEffect(() => {
        if (!isOpen) return;
        setView(initialView);
    }, [isOpen, initialView, stat.label, stat.category]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;

        const loadLeaderboard = async () => {
            setIsLeaderboardLoading(true);
            setLeaderboardError(null);

            try {
                const groups = await fetchStandings(sport, 'DIVISION');
                const teamMap = new Map<string, { id: string; name: string; logo?: string }>();
                const fallbackMap = new Map<string, any>();

                groups.forEach((group) => {
                    group.standings.forEach((entry) => {
                        const id = String(entry.team?.id || '').trim();
                        if (!id) return;
                        if (!teamMap.has(id)) {
                            teamMap.set(id, { id, name: entry.team.name, logo: entry.team.logo });
                        }
                        fallbackMap.set(id, entry.stats);
                    });
                });

                const activeTeams = Array.from(teamMap.values());
                if (activeTeams.length === 0) {
                    if (!cancelled) {
                        setLeaderboardRows([]);
                        setLeaderboardError('No league teams available for ranking data.');
                    }
                    return;
                }

                const { rows } = await getStoredLeagueStats(sport, activeTeams, fallbackMap);
                const statKey = resolveStatKey(rows, stat.label, stat.category);
                if (!statKey) {
                    if (!cancelled) {
                        setLeaderboardRows([]);
                        setLeaderboardError(`No league ranking column found for "${stat.label}".`);
                    }
                    return;
                }

                const metricLabel = splitStatKey(statKey).label;
                const inverseMetric = isInverseMetricLabel(metricLabel);

                const mappedRows = rows.map((row) => {
                    const raw = row.stats?.[statKey];
                    const numericValue = raw === undefined || raw === null ? null : parseComparableValue(String(raw), statKey);
                    return {
                        teamId: row.team.id,
                        teamName: row.team.name,
                        teamLogo: row.team.logo,
                        value: raw === undefined || raw === null ? '-' : String(raw),
                        numericValue,
                        isCurrentTeam: row.team.id === teamId,
                    };
                });

                const rankedRows = mappedRows
                    .filter((row) => row.numericValue !== null)
                    .sort((a, b) => {
                        if (a.numericValue === null || b.numericValue === null) return 0;
                        return inverseMetric ? a.numericValue - b.numericValue : b.numericValue - a.numericValue;
                    })
                    .map((row, idx) => ({ ...row, rank: idx + 1 }));

                const rankMap = new Map<string, number>();
                rankedRows.forEach((row) => rankMap.set(row.teamId, row.rank || 0));

                const combinedRows: LeaderboardRow[] = mappedRows.map((row) => ({
                    ...row,
                    rank: rankMap.get(row.teamId),
                }));

                combinedRows.sort((a, b) => {
                    const aRank = a.rank ?? Number.MAX_SAFE_INTEGER;
                    const bRank = b.rank ?? Number.MAX_SAFE_INTEGER;
                    if (aRank !== bRank) return aRank - bRank;
                    return a.teamName.localeCompare(b.teamName);
                });

                if (!cancelled) {
                    setLeaderboardRows(combinedRows);
                }
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    setLeaderboardRows([]);
                    setLeaderboardError('Unable to load full league rankings right now.');
                }
            } finally {
                if (!cancelled) {
                    setIsLeaderboardLoading(false);
                }
            }
        };

        loadLeaderboard();
        return () => {
            cancelled = true;
        };
    }, [isOpen, sport, stat.label, stat.category, teamId]);

    useEffect(() => {
        if (!isOpen || view !== 'LEADERBOARD' || leaderboardRows.length === 0) return;
        requestAnimationFrame(() => {
            currentTeamRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }, [isOpen, view, leaderboardRows, teamId]);

    if (!isOpen) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white leading-none mb-1">{def.title}</h2>
                        <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{teamName}</span>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

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
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                                <div className="flex gap-3">
                                    <Info className="text-indigo-600 dark:text-indigo-400 shrink-0" size={20} />
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100">Metric Explainer</h4>
                                        <ul className="list-disc pl-4">
                                            <li className="text-xs text-indigo-800 dark:text-indigo-300 leading-relaxed">{explainer.bullet}</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div className="text-center">
                                <div className="text-5xl font-mono font-bold text-slate-900 dark:text-white tracking-tighter mb-2">{stat.value}</div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                    {sport} Rank #{stat.rank || '-'}
                                </div>
                            </div>

                            {metrics && dist ? (
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                                        <span>League Floor</span>
                                        <span>League Avg</span>
                                        <span>League Ceiling</span>
                                    </div>
                                    <div className="h-4 bg-slate-100 dark:bg-slate-900 rounded-full relative border border-slate-200 dark:border-slate-800 overflow-hidden">
                                        <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-300 dark:bg-slate-700 z-10"></div>
                                        <div
                                            className="absolute top-0 bottom-0 w-2 bg-indigo-500 z-20 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-1000 ease-out"
                                            style={{ left: `${metrics.positionPct}%`, transform: 'translateX(-50%)' }}
                                        ></div>
                                        <div className={`absolute inset-0 opacity-20 ${def.better === 'High' ? 'bg-gradient-to-r from-rose-500 via-yellow-500 to-emerald-500' : 'bg-gradient-to-r from-emerald-500 via-yellow-500 to-rose-500'}`}></div>
                                    </div>
                                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                                        <span>{dist.inverse ? dist.mean + (2 * dist.stdDev) : dist.mean - (2 * dist.stdDev)}</span>
                                        <span>{dist.mean}</span>
                                        <span>{dist.inverse ? dist.mean - (2 * dist.stdDev) : dist.mean + (2 * dist.stdDev)}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 text-center text-xs text-slate-400 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                    League distribution data unavailable for this specific metric.
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Impact Direction</div>
                                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{explainer.impactDirection}</div>
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Predictor Level</div>
                                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{explainer.predictorLevel}</div>
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Signal Type</div>
                                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{explainer.signalType}</div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 p-3 bg-slate-100 dark:bg-slate-900 rounded-xl text-xs text-slate-600 dark:text-slate-400">
                                <List size={16} />
                                <span className="font-medium">Full league rankings for this metric. Your team is highlighted and auto-centered.</span>
                            </div>

                            {isLeaderboardLoading ? (
                                <div className="flex items-center justify-center py-12 text-slate-500">
                                    <Loader2 size={20} className="animate-spin mr-2" />
                                    <span className="text-sm">Loading league rankings...</span>
                                </div>
                            ) : leaderboardError ? (
                                <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                    {leaderboardError}
                                </div>
                            ) : leaderboardRows.length > 0 ? (
                                <div className="max-h-[52vh] overflow-y-auto pr-1 space-y-2">
                                    {leaderboardRows.map((row) => (
                                        <div
                                            key={row.teamId}
                                            ref={row.isCurrentTeam ? currentTeamRowRef : undefined}
                                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                row.isCurrentTeam
                                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-800/50'
                                                    : 'bg-white dark:bg-slate-900/30 border-slate-100 dark:border-slate-800'
                                            } ${onTeamClick ? 'cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/60 dark:hover:bg-indigo-900/25' : ''}`}
                                            onClick={() => {
                                                if (!onTeamClick) return;
                                                onTeamClick(row.teamId, sport);
                                                onClose();
                                            }}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div
                                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                                        row.rank === 1 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                        row.rank === 2 ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' :
                                                        row.rank === 3 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-500' :
                                                        'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400'
                                                    }`}
                                                >
                                                    {row.rank || '-'}
                                                </div>
                                                {row.teamLogo ? (
                                                    <img src={row.teamLogo} alt="" className="w-6 h-6 object-contain shrink-0" />
                                                ) : (
                                                    <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                                                )}
                                                <div className="min-w-0">
                                                    <div className={`text-sm font-bold truncate ${row.isCurrentTeam ? 'text-indigo-800 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-300'}`}>
                                                        {row.teamName}
                                                    </div>
                                                    {row.isCurrentTeam && (
                                                        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Current Team</div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="font-mono font-bold text-slate-900 dark:text-white text-sm pl-3">{row.value}</div>
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
        </div>,
        document.body
    );
};
