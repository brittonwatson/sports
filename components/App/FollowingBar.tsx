import React from 'react';
import { Game } from '../../types';
import { BellRing, Clock3, Radio, X } from 'lucide-react';

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

export const FollowingBar: React.FC<FollowingBarProps> = ({
  games,
  isOpen,
  selectedGameId,
  onOpen,
  onClose,
  onGameClick,
  onCloseActiveGame,
}) => {
  if (games.length === 0) return null;

  if (!isOpen) {
    return (
      <div className="fixed top-20 right-4 z-40">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-lg backdrop-blur"
          aria-label="Open followed games"
          title="Open followed games"
        >
          <BellRing size={14} className="text-emerald-500" />
          Following ({games.length})
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-16 inset-x-0 z-40 pointer-events-none">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pointer-events-auto">
        <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              <BellRing size={13} className="text-emerald-500" />
              Following
            </div>
            <div className="flex items-center gap-1">
              {selectedGameId && (
                <button
                  type="button"
                  onClick={onCloseActiveGame}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
                >
                  <X size={11} />
                  Close View
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900"
                aria-label="Collapse following bar"
                title="Collapse following bar"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto no-scrollbar">
            <div className="flex items-stretch gap-2 p-2 min-w-max">
              {games.map((game) => {
                const isSelected = selectedGameId === game.id;
                const isLive = game.status === 'in_progress';
                return (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => onGameClick(game)}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors min-w-[220px] ${
                      isSelected
                        ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                    aria-label={`Open followed game ${game.awayTeam} at ${game.homeTeam}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {game.league}
                      </span>
                      {isLive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          <Radio size={11} className="animate-pulse" />
                          LIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          <Clock3 size={11} />
                          {game.time}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {displayTeam(game.awayTeam, game.awayTeamAbbreviation)} @ {displayTeam(game.homeTeam, game.homeTeamAbbreviation)}
                    </div>
                    {isLive && (
                      <div className="mt-1 text-xs font-mono text-slate-600 dark:text-slate-300">
                        {(game.awayScore || '0')} - {(game.homeScore || '0')} {game.clock ? `• ${game.clock}` : ''}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
