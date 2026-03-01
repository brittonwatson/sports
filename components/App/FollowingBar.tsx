import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Game } from '../../types';
import { BellRing, ChevronDown, ChevronUp, Clock3, Radio, X } from 'lucide-react';
import { getRealtimeLiveStatus, LiveStatusSeed } from '../../services/uiUtils';

interface FollowingBarProps {
  games: Game[];
  isOpen: boolean;
  selectedGameId?: string | null;
  onOpen: () => void;
  onClose: () => void;
  onGameClick: (game: Game) => void;
  onCloseActiveGame: () => void;
}

const displayTeam = (name: string, abbreviation?: string) => abbreviation || name;

const compactTeamLabel = (name: string, abbreviation?: string) => {
  if (abbreviation && abbreviation.trim().length > 0) return abbreviation;
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return name;
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((word) => word[0]).join('').slice(0, 4).toUpperCase();
};

export const FollowingBar: React.FC<FollowingBarProps> = ({
  games,
  isOpen,
  selectedGameId,
  onOpen,
  onClose,
  onGameClick,
  onCloseActiveGame,
}) => {
  const liveSeedRef = useRef<Map<string, LiveStatusSeed & { startedAtMs: number }>>(new Map());
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    const nowMs = Date.now();
    const nextMap = new Map<string, LiveStatusSeed & { startedAtMs: number }>();
    games.forEach((game) => {
      if (game.status !== 'in_progress') return;
      const prev = liveSeedRef.current.get(game.id);
      if (prev && prev.baseClock === game.clock && prev.baseStatus === game.gameStatus) {
        nextMap.set(game.id, prev);
        return;
      }
      nextMap.set(game.id, {
        baseClock: game.clock,
        baseStatus: game.gameStatus,
        startedAtMs: nowMs,
      });
    });
    liveSeedRef.current = nextMap;
  }, [games]);

  const liveCount = useMemo(
    () => games.filter((game) => game.status === 'in_progress').length,
    [games],
  );

  useEffect(() => {
    if (liveCount === 0) return;
    const timerId = window.setInterval(() => {
      setLiveTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [liveCount]);

  const orderedGames = useMemo(
    () => [...games].sort((a, b) => {
      if (a.id === selectedGameId) return -1;
      if (b.id === selectedGameId) return 1;
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
      return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    }),
    [games, selectedGameId, liveTick],
  );

  if (games.length === 0) return null;

  return (
    <section className="border-t border-slate-200 dark:border-slate-800/70">
      <div className="py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
            <BellRing size={13} className="text-emerald-500" />
            Following
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-700 dark:text-slate-200">
              {games.length}
            </span>
            {liveCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                <Radio size={10} className="animate-pulse" />
                {liveCount} Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {selectedGameId && (
              <button
                type="button"
                onClick={onCloseActiveGame}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
                title="Close active game view"
              >
                <X size={11} />
                Close View
              </button>
            )}
            {isOpen ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900"
                aria-label="Collapse following list"
                title="Collapse following list"
              >
                <ChevronUp size={12} />
                Hide
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpen}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900"
                aria-label="Open followed games"
                title="Open followed games"
              >
                <ChevronDown size={12} />
                Show
              </button>
            )}
          </div>
        </div>

        <div
          className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out ${
            isOpen ? 'max-h-[11.5rem] opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-1'
          }`}
        >
          <div className="mt-2 overflow-x-auto no-scrollbar pb-1">
            <div className="flex items-stretch gap-2 min-w-max pr-1">
              {orderedGames.map((game) => {
                const isSelected = selectedGameId === game.id;
                const isLive = game.status === 'in_progress';
                const isFinished = game.status === 'finished';
                const liveSeed = liveSeedRef.current.get(game.id);
                const elapsedSeconds = liveSeed ? Math.floor((Date.now() - liveSeed.startedAtMs) / 1000) : 0;
                const liveStatusLabel = isLive
                  ? getRealtimeLiveStatus(
                      game,
                      liveSeed || { baseClock: game.clock, baseStatus: game.gameStatus },
                      elapsedSeconds,
                    )
                  : '';
                return (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => onGameClick(game)}
                    className={`text-left rounded-xl border px-3 py-2 transition-all min-w-[184px] sm:min-w-[240px] ${
                      isSelected
                        ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                    aria-label={`Open followed game ${game.awayTeam} at ${game.homeTeam}`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {game.league}
                      </span>
                      {isLive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          <Radio size={11} className="animate-pulse" />
                          LIVE
                        </span>
                      ) : isFinished ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          Final
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          <Clock3 size={11} />
                          {game.time}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {game.awayTeamLogo && <img src={game.awayTeamLogo} alt="" className="h-4 w-4 object-contain" />}
                        <span className="hidden sm:inline text-sm font-bold text-slate-900 dark:text-white">
                          {displayTeam(game.awayTeam, game.awayTeamAbbreviation)}
                        </span>
                        <span className="sm:hidden text-sm font-bold text-slate-900 dark:text-white">
                          {compactTeamLabel(game.awayTeam, game.awayTeamAbbreviation)}
                        </span>
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">@</span>
                        {game.homeTeamLogo && <img src={game.homeTeamLogo} alt="" className="h-4 w-4 object-contain" />}
                        <span className="hidden sm:inline text-sm font-bold text-slate-900 dark:text-white">
                          {displayTeam(game.homeTeam, game.homeTeamAbbreviation)}
                        </span>
                        <span className="sm:hidden text-sm font-bold text-slate-900 dark:text-white">
                          {compactTeamLabel(game.homeTeam, game.homeTeamAbbreviation)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1 text-xs font-mono text-slate-600 dark:text-slate-300">
                      {isLive || isFinished
                        ? `${game.awayScore || '0'}-${game.homeScore || '0'}${isLive && liveStatusLabel ? ` • ${liveStatusLabel}` : ''}`
                        : `${game.date} • ${game.time}`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
