
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Game, RACING_LEAGUES, SOCCER_LEAGUES, Sport } from '../types';
import { Calendar, Clock, ChevronDown, Radio, Tv, MapPin, CloudSun, Bell, BellRing } from 'lucide-react';
import { getRealtimeLiveStatus } from '../services/uiUtils';

interface GameCardProps {
  game: Game;
  onSelect: (game: Game) => void;
  isSelected: boolean;
  onTeamClick?: (teamId: string, league: Sport) => void;
  isFollowed?: boolean;
  onToggleFollow?: (game: Game, e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const GameCard: React.FC<GameCardProps> = ({ game, onSelect, isSelected, onTeamClick, isFollowed = false, onToggleFollow }) => {
  const isLive = game.status === 'in_progress';
  const isFinished = game.status === 'finished';
  const isSoccer = SOCCER_LEAGUES.includes(game.league as Sport);
  const isRacing = RACING_LEAGUES.includes(game.league as Sport);
  const isPreseason = game.seasonType === 1;
  const contextText = (game.context || '').trim();
  const contextLower = contextText.toLowerCase();
  const showContext = !!contextText &&
    contextText !== game.gameStatus &&
    !(isPreseason && contextLower.includes('preseason'));
  const hasRacingOrder = isRacing && (isLive || isFinished);
  const racingOrderRows = hasRacingOrder
    ? (
      (game.racingOrderSnapshot && game.racingOrderSnapshot.length > 0)
        ? game.racingOrderSnapshot
            .slice(0, 5)
            .map((row, index) => ({
              key: `${row.competitorId || row.name}-${row.position || index + 1}`,
              name: row.name,
              logo: row.logo,
              abbreviation: row.abbreviation,
              position: String(row.position || index + 1),
            }))
        : [
            {
              key: `${game.homeTeamId || 'home'}-${game.homeScore || ''}`,
              name: game.homeTeam,
              logo: game.homeTeamLogo,
              abbreviation: game.homeTeamAbbreviation,
              position: game.homeScore || '1',
            },
            {
              key: `${game.awayTeamId || 'away'}-${game.awayScore || ''}`,
              name: game.awayTeam,
              logo: game.awayTeamLogo,
              abbreviation: game.awayTeamAbbreviation,
              position: game.awayScore || '2',
            },
          ]
      ).filter((row, index, rows) => row.name && rows.findIndex((candidate) => candidate.name === row.name) === index)
    : [];

  const liveSeedRef = useRef<{ baseClock?: string; baseStatus?: string; startedAtMs: number }>({
    baseClock: game.clock,
    baseStatus: game.gameStatus,
    startedAtMs: Date.now(),
  });
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    liveSeedRef.current = {
      baseClock: game.clock,
      baseStatus: game.gameStatus,
      startedAtMs: Date.now(),
    };
    setLiveTick(0);
  }, [game.id, game.status, game.clock, game.gameStatus]);

  useEffect(() => {
    if (!isLive) return;
    const timerId = window.setInterval(() => {
      setLiveTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isLive, game.id]);

  const liveStatusLabel = useMemo(() => {
    if (!isLive) return game.gameStatus || game.clock || 'Live';
    const seed = liveSeedRef.current;
    const elapsedSeconds = Math.floor((Date.now() - seed.startedAtMs) / 1000);
    return getRealtimeLiveStatus(game, seed, elapsedSeconds);
  }, [isLive, game, liveTick]);

  const handleTeamClick = (e: React.MouseEvent, teamId: string | undefined) => {
      e.stopPropagation();
      if (teamId && onTeamClick) {
          onTeamClick(teamId, game.league as Sport);
      }
  };

  const HomeTeamRow = (
    <div className="flex justify-between items-center">
      <div 
        className={`flex items-center gap-4 ${onTeamClick && game.homeTeamId ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        onClick={(e) => handleTeamClick(e, game.homeTeamId)}
      >
        {game.homeTeamLogo && (
            <div className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center">
              <img 
                  src={game.homeTeamLogo} 
                  alt={`${game.homeTeam} logo`}
                  className="w-full h-full object-contain drop-shadow-sm transition-all duration-300"
                  loading="lazy"
              />
            </div>
        )}
        <span className={`text-lg sm:text-xl font-display font-bold transition-colors flex items-center gap-2 ${isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white'}`}>
          {game.homeTeamRank && (
            <span className="text-xs sm:text-sm font-semibold text-slate-400 dark:text-slate-500">#{game.homeTeamRank}</span>
          )}
          {game.homeTeam}
        </span>
      </div>
      {isLive || isFinished ? (
          <span className={`text-2xl font-display font-bold tracking-tight ${isLive || isFinished ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>{game.homeScore}</span>
      ) : (
          <span className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 font-semibold tracking-wider">HOME</span>
      )}
    </div>
  );

  const AwayTeamRow = (
    <div className="flex justify-between items-center">
      <div 
        className={`flex items-center gap-4 ${onTeamClick && game.awayTeamId ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        onClick={(e) => handleTeamClick(e, game.awayTeamId)}
      >
        {game.awayTeamLogo && (
            <div className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center">
              <img 
                  src={game.awayTeamLogo} 
                  alt={`${game.awayTeam} logo`}
                  className="w-full h-full object-contain drop-shadow-sm transition-all duration-300"
                  loading="lazy"
              />
            </div>
        )}
        <span className={`text-lg sm:text-xl font-display font-bold transition-colors flex items-center gap-2 ${isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white'}`}>
          {game.awayTeamRank && (
            <span className="text-xs sm:text-sm font-semibold text-slate-400 dark:text-slate-500">#{game.awayTeamRank}</span>
          )}
          {game.awayTeam}
        </span>
      </div>
      {isLive || isFinished ? (
          <span className={`text-2xl font-display font-bold tracking-tight ${isLive || isFinished ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>{game.awayScore}</span>
      ) : (
          <span className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 font-semibold tracking-wider">AWAY</span>
      )}
    </div>
  );

  return (
    <div 
      onClick={() => onSelect(game)}
      className={`
        cursor-pointer rounded-2xl p-5 sm:p-6 border transition-all duration-300 group relative overflow-hidden
        ${isSelected 
          ? 'bg-white dark:bg-slate-800 border-slate-900/20 dark:border-white/20 shadow-xl dark:shadow-none' 
          : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-md dark:hover:bg-slate-800/60'
        }
      `}
    >
      <div className="relative z-10 flex flex-col gap-6">
        {/* Header: League & Status */}
        <div className="flex justify-between items-start -mb-2">
            <div className="flex items-center gap-3">
                <span className="text-[10px] sm:text-xs font-bold tracking-wider text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800">
                {game.league}
                </span>
                {isPreseason && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                    PRESEASON
                </span>
                )}
                {isLive && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/50 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                    <Radio size={12} className="text-emerald-500 animate-pulse" />
                    <span>{liveStatusLabel}</span>
                </span>
                )}
                {/* Show title/context if available (e.g. Playoff Series Name) */}
                {/* Hide if it's just a duplicate of the live status (e.g. "12:34 - 1st") to prevent showing time twice */}
                {showContext && (
                <span className={`text-xs text-slate-600 dark:text-slate-400 font-medium px-2 py-0.5 border border-transparent bg-slate-50 dark:bg-slate-800 rounded ${isPreseason ? 'inline-block' : 'hidden sm:inline-block'}`}>{contextText}</span>
                )}
            </div>

            <div className="flex items-center gap-2">
                {onToggleFollow && (
                    <button
                        type="button"
                        onClick={(e) => onToggleFollow(game, e)}
                        aria-label={isFollowed ? 'Following game' : 'Follow game'}
                        title={isFollowed ? 'Following game' : 'Follow game'}
                        className={`p-1.5 rounded-md border transition-colors ${
                            isFollowed
                                ? 'text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30'
                                : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        {isFollowed ? <BellRing size={14} /> : <Bell size={14} />}
                    </button>
                )}

                {/* Mobile Chevron */}
                <div className="sm:hidden">
                <ChevronDown 
                    size={20} 
                    className={`transition-transform duration-300 ${isSelected ? 'rotate-180 text-slate-900 dark:text-white' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} 
                />
                </div>
            </div>
        </div>

        {/* Teams / Racing Order */}
        <div className="flex-1">
            {isRacing ? (
                <div className="flex flex-col gap-3 mb-4">
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {game.racingSessionType === 'qualifying'
                            ? 'Qualifying Session'
                            : game.racingSessionType === 'practice'
                              ? 'Practice Session'
                              : game.racingSessionType === 'race'
                                ? 'Race Session'
                                : 'Racing Session'}
                        </p>
                        <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white mt-1">
                            {contextText || game.gameStatus || game.leagueName || 'Session'}
                        </p>
                    </div>

                    {racingOrderRows.length > 0 ? (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 overflow-hidden">
                            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/60 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {isFinished ? 'Top 5 Finishers' : 'Live Top 5 Snapshot'}
                            </div>
                            <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                                {racingOrderRows.map((row) => (
                                    <div key={row.key} className="flex items-center justify-between px-3 py-2.5">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 w-8">
                                                P{row.position}
                                            </span>
                                            {row.logo && (
                                                <div className="w-6 h-6 flex items-center justify-center">
                                                    <img
                                                        src={row.logo}
                                                        alt=""
                                                        className="w-full h-full object-contain"
                                                        loading="lazy"
                                                    />
                                                </div>
                                            )}
                                            <span className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">
                                                {row.name}
                                            </span>
                                        </div>
                                        {row.abbreviation && (
                                            <span className="text-[10px] sm:text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/80 px-2 py-1 rounded-md">
                                                {row.abbreviation}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                            Full-field order, gap, and pit telemetry load when you expand this event.
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-3 sm:gap-4 mb-4">
                    {/* For Soccer: Home First. For US Sports: Away First */}
                    {isSoccer ? HomeTeamRow : AwayTeamRow}
                    
                    <div className="w-full h-px bg-slate-100 dark:bg-slate-700/50"></div>
                    
                    {isSoccer ? AwayTeamRow : HomeTeamRow}
                </div>
            )}

            {/* Footer: Date/Time/Clock + Network */}
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 w-full gap-2 flex-wrap sm:flex-nowrap">
            
                <div className="flex items-center gap-2">
                    {/* Date - Always Show */}
                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/50 px-2 py-1 rounded text-slate-600 dark:text-slate-400">
                        <Calendar size={13} />
                        <span className="font-medium">{game.date}</span>
                    </div>

                    {/* Time: Only show for scheduled games (non-live, non-finished) */}
                    {!isFinished && !isLive && (
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/50 px-2 py-1 rounded text-slate-600 dark:text-slate-400">
                            <Clock size={13} />
                            <span className="font-medium">{game.time}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Network */}
                    {game.broadcast && (
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/50 px-2 py-1 rounded text-slate-600 dark:text-slate-400">
                            <Tv size={13} />
                            <span className="font-medium">{game.broadcast}</span>
                        </div>
                    )}
                    <div className="hidden sm:block">
                        <ChevronDown 
                            size={20} 
                            className={`transition-transform duration-300 ${isSelected ? 'rotate-180 text-slate-900 dark:text-white' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} 
                        />
                    </div>
                </div>
            </div>

            {/* Expanded Info: Venue & Weather */}
            {isSelected && (game.venue || game.weather) && (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/50 flex flex-wrap gap-2 animate-fade-in">
                    {game.venue && (
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/50 px-2 py-1 rounded text-xs text-slate-600 dark:text-slate-400">
                            <MapPin size={12} />
                            <span className="font-medium">{game.venue}{game.location ? ` in ${game.location}` : ''}</span>
                        </div>
                    )}
                    {game.weather && (
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/50 px-2 py-1 rounded text-xs text-slate-600 dark:text-slate-400">
                            <CloudSun size={12} />
                            <span className="font-medium">{game.temperature ? `${game.temperature} • ` : ''}{game.weather}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
