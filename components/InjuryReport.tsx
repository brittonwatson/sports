import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Game, Injury, Sport } from '../types';
import { getGameTeamAbbreviation } from '../services/teamAbbreviation';

interface InjuryReportProps {
    game: Game;
    injuries?: Injury[] | null;
    onTeamClick?: (teamId: string, league: Sport) => void;
}

interface NormalizedInjury {
    athleteId: string;
    displayName: string;
    position?: string;
    status: string;
    teamKey: 'home' | 'away' | 'other';
}

const normalizeInjuryStatus = (status: unknown): string => {
    if (typeof status === 'string' && status.trim()) return status.trim();
    if (status && typeof status === 'object') {
        const rec = status as Record<string, unknown>;
        const candidates = [
            rec.type,
            rec.abbreviation,
            rec.shortDetail,
            rec.displayName,
            rec.name,
            rec.description,
            rec.detail,
        ];
        const match = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
        if (typeof match === 'string') return match.trim();
    }
    return 'Unavailable';
};

const getStatusWeight = (status: string): number => {
    const s = status.toLowerCase();
    if (s.includes('out') || s.includes('inactive') || s.includes('suspend') || s === 'ir') return 3;
    if (s.includes('doubt') || s.includes('question')) return 2;
    if (s.includes('day') || s.includes('probable') || s.includes('game-time')) return 1;
    return 0;
};

const getStatusClasses = (status: string): string => {
    const weight = getStatusWeight(status);
    if (weight >= 3) return 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300';
    if (weight === 2) return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300';
    if (weight === 1) return 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-900/40 text-sky-700 dark:text-sky-300';
    return 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200';
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const InjuryReport: React.FC<InjuryReportProps> = ({ game, injuries, onTeamClick }) => {
    const homeTeamId = game.homeTeamId ? String(game.homeTeamId) : '';
    const awayTeamId = game.awayTeamId ? String(game.awayTeamId) : '';

    const { away, home, other, total } = useMemo(() => {
        const grouped: { away: NormalizedInjury[]; home: NormalizedInjury[]; other: NormalizedInjury[] } = {
            away: [],
            home: [],
            other: [],
        };

        for (const injury of injuries || []) {
            const teamId = injury.teamId ? String(injury.teamId) : '';
            const entry: NormalizedInjury = {
                athleteId: injury.athlete?.id || `${teamId}-${injury.athlete?.displayName || 'unknown'}`,
                displayName: normalizeWhitespace(injury.athlete?.displayName || 'Unknown player'),
                position: injury.athlete?.position,
                status: normalizeInjuryStatus((injury as Injury & { status?: unknown }).status),
                teamKey:
                    teamId && awayTeamId && teamId === awayTeamId
                        ? 'away'
                        : teamId && homeTeamId && teamId === homeTeamId
                            ? 'home'
                            : 'other',
            };
            grouped[entry.teamKey].push(entry);
        }

        grouped.away.sort((a, b) => getStatusWeight(b.status) - getStatusWeight(a.status));
        grouped.home.sort((a, b) => getStatusWeight(b.status) - getStatusWeight(a.status));
        grouped.other.sort((a, b) => getStatusWeight(b.status) - getStatusWeight(a.status));

        return {
            away: grouped.away,
            home: grouped.home,
            other: grouped.other,
            total: grouped.away.length + grouped.home.length + grouped.other.length,
        };
    }, [injuries, awayTeamId, homeTeamId]);

    if (total === 0) return null;

    const awayAbbr = getGameTeamAbbreviation(game, 'away');
    const homeAbbr = getGameTeamAbbreviation(game, 'home');
    const showOther = other.length > 0;

    return (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-600 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle size={14} className="text-amber-500" />
                    Injury Report
                </h4>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300">
                    {total} listed
                </span>
            </div>
            <div className={`p-4 grid gap-4 ${showOther ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
                <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/45 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div
                            className={`flex items-center gap-2 ${onTeamClick && game.awayTeamId ? 'cursor-pointer hover:underline' : ''}`}
                            onClick={() => {
                                if (onTeamClick && game.awayTeamId) onTeamClick(game.awayTeamId, game.league as Sport);
                            }}
                        >
                            {game.awayTeamLogo ? (
                                <img src={game.awayTeamLogo} alt={game.awayTeam} className="w-5 h-5 object-contain" />
                            ) : (
                                <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700" />
                            )}
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{awayAbbr}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">{away.length}</span>
                    </div>
                    {away.length === 0 ? (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">No reported injuries</p>
                    ) : (
                        <ul className="space-y-2">
                            {away.map((injury, idx) => (
                                <li key={`${injury.athleteId}-${injury.status}-${idx}`} className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{injury.displayName}</p>
                                        {injury.position && (
                                            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                {injury.position}
                                            </p>
                                        )}
                                    </div>
                                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${getStatusClasses(injury.status)}`}>
                                        {injury.status}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/45 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div
                            className={`flex items-center gap-2 ${onTeamClick && game.homeTeamId ? 'cursor-pointer hover:underline' : ''}`}
                            onClick={() => {
                                if (onTeamClick && game.homeTeamId) onTeamClick(game.homeTeamId, game.league as Sport);
                            }}
                        >
                            {game.homeTeamLogo ? (
                                <img src={game.homeTeamLogo} alt={game.homeTeam} className="w-5 h-5 object-contain" />
                            ) : (
                                <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700" />
                            )}
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{homeAbbr}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">{home.length}</span>
                    </div>
                    {home.length === 0 ? (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">No reported injuries</p>
                    ) : (
                        <ul className="space-y-2">
                            {home.map((injury, idx) => (
                                <li key={`${injury.athleteId}-${injury.status}-${idx}`} className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{injury.displayName}</p>
                                        {injury.position && (
                                            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                {injury.position}
                                            </p>
                                        )}
                                    </div>
                                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${getStatusClasses(injury.status)}`}>
                                        {injury.status}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {showOther && (
                    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/45 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Unassigned Team</span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">{other.length}</span>
                        </div>
                        <ul className="space-y-2">
                            {other.map((injury, idx) => (
                                <li key={`${injury.athleteId}-${injury.status}-${idx}`} className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{injury.displayName}</p>
                                        {injury.position && (
                                            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                {injury.position}
                                            </p>
                                        )}
                                    </div>
                                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${getStatusClasses(injury.status)}`}>
                                        {injury.status}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </div>
    );
};
