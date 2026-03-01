import React, { useEffect, useMemo, useState } from 'react';
import { Table } from 'lucide-react';
import { Game, GameDetails, TeamBoxScore, Sport, SOCCER_LEAGUES } from '../../types';
import { getGameTeamAbbreviation } from '../../services/teamAbbreviation';

interface CurrentBoxScoreProps {
    game: Game;
    gameDetails: GameDetails | null;
    onPlayerClick?: (playerId: string) => void;
    onTeamClick?: (teamId: string, league: Sport) => void;
}

const resolveTeamBox = (game: Game, boxscore: TeamBoxScore[]) => {
    const findById = (teamId: string | undefined) => {
        if (!teamId) return undefined;
        return boxscore.find(team => String(team.teamId) === String(teamId));
    };

    const awayById = findById(game.awayTeamId);
    const homeById = findById(game.homeTeamId);

    const away = awayById || boxscore[0];
    const home = homeById || boxscore.find(team => String(team.teamId) !== String(away?.teamId)) || boxscore[1];

    return { away, home };
};

const groupPriority = [
    'goal contributions',
    'discipline',
    'key leaders',
    'totals',
    'overall',
    'offense',
    'offensive',
    'scoring',
    'batting',
    'pitching',
    'passing',
    'rushing',
    'receiving',
];

const getDefaultGroupIndex = (groups: TeamBoxScore['groups']) => {
    if (groups.length === 0) return 0;
    const lowered = groups.map(group => (group.label || '').toLowerCase());
    for (const key of groupPriority) {
        const index = lowered.findIndex(label => label.includes(key));
        if (index >= 0) return index;
    }
    return 0;
};

export const CurrentBoxScore: React.FC<CurrentBoxScoreProps> = ({ game, gameDetails, onPlayerClick, onTeamClick }) => {
    const teamBoxes = gameDetails?.boxscore || [];
    const isSoccer = SOCCER_LEAGUES.includes(game.league as Sport);
    const { away: awayTeamBox, home: homeTeamBox } = useMemo(() => resolveTeamBox(game, teamBoxes), [game, teamBoxes]);
    const awayShort = getGameTeamAbbreviation(game, 'away');
    const homeShort = getGameTeamAbbreviation(game, 'home');
    const [viewTeam, setViewTeam] = useState<'away' | 'home'>('away');
    const [activeGroupIndex, setActiveGroupIndex] = useState(0);

    useEffect(() => {
        if (viewTeam === 'away' && !awayTeamBox && homeTeamBox) setViewTeam('home');
        if (viewTeam === 'home' && !homeTeamBox && awayTeamBox) setViewTeam('away');
    }, [awayTeamBox, homeTeamBox, viewTeam]);

    const activeTeamBox = viewTeam === 'away' ? awayTeamBox : homeTeamBox;
    const activeGroups = useMemo(() => {
        if (!activeTeamBox) return [];
        return activeTeamBox.groups.filter(group => (group.players || []).length > 0);
    }, [activeTeamBox]);

    useEffect(() => {
        setActiveGroupIndex(getDefaultGroupIndex(activeGroups));
    }, [activeTeamBox?.teamId]);

    useEffect(() => {
        if (activeGroupIndex >= activeGroups.length) {
            setActiveGroupIndex(0);
        }
    }, [activeGroupIndex, activeGroups.length]);

    const activeGroup = activeGroups[activeGroupIndex] || activeGroups[0];
    const columnCount = useMemo(() => {
        if (!activeGroup) return 0;
        const labelCount = activeGroup.labels?.length || 0;
        const statCount = activeGroup.players.reduce((max, playerEntry) => Math.max(max, playerEntry.stats.length), 0);
        return Math.max(labelCount, statCount);
    }, [activeGroup]);

    const columnLabels = useMemo(() => {
        if (!activeGroup) return [];
        return Array.from({ length: columnCount }).map((_, index) => activeGroup.labels?.[index] || `Stat ${index + 1}`);
    }, [activeGroup, columnCount]);

    if (!gameDetails) return null;
    if (teamBoxes.length === 0) {
        if (!isSoccer) return null;
        return (
            <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/65">
                    <h4 className="text-xs font-bold text-slate-600 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <Table size={14} /> Current Box Score
                    </h4>
                </div>
                <div className="p-6 text-center text-xs text-slate-600 dark:text-slate-300">
                    Player event box score is not available from the live feed yet. Live score, team stats, and play-by-play remain active.
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/65">
                <div className="flex flex-col gap-3">
                    <h4 className="text-xs font-bold text-slate-600 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <Table size={14} /> Current Box Score
                    </h4>
                    <div className="flex justify-center">
                        <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5 w-full max-w-md">
                            <button
                                onClick={() => setViewTeam('away')}
                                disabled={!awayTeamBox}
                                className={`flex-1 px-2 sm:px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all min-w-0 ${
                                    viewTeam === 'away'
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 disabled:opacity-40'
                                }`}
                            >
                                <span
                                    className={`flex items-center justify-center gap-1.5 min-w-0 ${onTeamClick && game.awayTeamId ? 'cursor-pointer' : ''}`}
                                    onClick={(e) => {
                                        if (!onTeamClick || !game.awayTeamId) return;
                                        e.stopPropagation();
                                        onTeamClick(game.awayTeamId, game.league as Sport);
                                    }}
                                >
                                    {game.awayTeamLogo ? (
                                        <img
                                            src={game.awayTeamLogo}
                                            alt={`${game.awayTeam} logo`}
                                            className={`w-4 h-4 object-contain shrink-0 ${onTeamClick && game.awayTeamId ? 'hover:opacity-80' : ''}`}
                                        />
                                    ) : null}
                                    <span className={`sm:hidden truncate ${onTeamClick && game.awayTeamId ? 'hover:underline' : ''}`}>
                                        {awayShort}
                                    </span>
                                    <span className={`hidden sm:inline truncate ${onTeamClick && game.awayTeamId ? 'hover:underline' : ''}`}>
                                        {game.awayTeam}
                                    </span>
                                </span>
                            </button>
                            <button
                                onClick={() => setViewTeam('home')}
                                disabled={!homeTeamBox}
                                className={`flex-1 px-2 sm:px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all min-w-0 ${
                                    viewTeam === 'home'
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 disabled:opacity-40'
                                }`}
                            >
                                <span
                                    className={`flex items-center justify-center gap-1.5 min-w-0 ${onTeamClick && game.homeTeamId ? 'cursor-pointer' : ''}`}
                                    onClick={(e) => {
                                        if (!onTeamClick || !game.homeTeamId) return;
                                        e.stopPropagation();
                                        onTeamClick(game.homeTeamId, game.league as Sport);
                                    }}
                                >
                                    {game.homeTeamLogo ? (
                                        <img
                                            src={game.homeTeamLogo}
                                            alt={`${game.homeTeam} logo`}
                                            className={`w-4 h-4 object-contain shrink-0 ${onTeamClick && game.homeTeamId ? 'hover:opacity-80' : ''}`}
                                        />
                                    ) : null}
                                    <span className={`sm:hidden truncate ${onTeamClick && game.homeTeamId ? 'hover:underline' : ''}`}>
                                        {homeShort}
                                    </span>
                                    <span className={`hidden sm:inline truncate ${onTeamClick && game.homeTeamId ? 'hover:underline' : ''}`}>
                                        {game.homeTeam}
                                    </span>
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {!activeTeamBox || activeGroups.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-300">Box score not available yet.</div>
            ) : (
                <>
                    {activeGroups.length > 1 && (
                        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/35">
                            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                {activeGroups.map((group, index) => (
                                    <button
                                        key={`${group.label}-${index}`}
                                        onClick={() => setActiveGroupIndex(index)}
                                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap transition-colors ${
                                            activeGroupIndex === index
                                                ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
                                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                                        }`}
                                    >
                                        {group.label || `Group ${index + 1}`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="max-h-[420px] overflow-auto custom-scrollbar">
                        <table className="w-full min-w-[620px] text-xs border-collapse">
                            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900">
                                <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                    <th className="px-3 py-2 text-left sticky left-0 bg-slate-100 dark:bg-slate-900 min-w-[180px]">
                                        Player
                                    </th>
                                    {columnLabels.map((label, index) => (
                                        <th key={`${label}-${index}`} className="px-3 py-2 text-center font-mono min-w-[64px]">
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {activeGroup.players.map((entry, index) => {
                                    const canClick = !!onPlayerClick && !!entry.player.id;
                                    return (
                                        <tr
                                            key={`${entry.player.id || entry.player.displayName}-${index}`}
                                            onClick={() => {
                                                if (canClick) onPlayerClick(entry.player.id);
                                            }}
                                            className={`border-b border-slate-100 dark:border-slate-800/70 ${
                                                canClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/45' : ''
                                            }`}
                                        >
                                            <td className="px-3 py-2.5 sticky left-0 bg-white dark:bg-slate-900/95">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    {entry.player.headshot ? (
                                                        <img
                                                            src={entry.player.headshot}
                                                            alt={entry.player.displayName}
                                                            className="w-8 h-8 rounded-full object-cover bg-slate-100 dark:bg-slate-800 shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0">
                                                            {entry.player.jersey || entry.player.displayName.charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="text-slate-800 dark:text-slate-100 font-semibold truncate">{entry.player.displayName}</div>
                                                        <div className="text-[10px] text-slate-600 dark:text-slate-300">
                                                            {entry.player.position || '-'}
                                                            {entry.player.jersey ? ` • #${entry.player.jersey}` : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            {columnLabels.map((_, statIndex) => (
                                                <td
                                                    key={`${entry.player.id || index}-${statIndex}`}
                                                    className="px-3 py-2.5 text-center font-mono text-slate-700 dark:text-slate-200"
                                                >
                                                    {entry.stats[statIndex] ?? '-'}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};
