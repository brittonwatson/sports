
import React, { useEffect, useState } from 'react';
import {
  RacingCalendarEvent,
  RacingPreSeasonData,
  RacingStandingsEntry,
  RacingStandingsPayload,
  RACING_LEAGUES,
  SeasonState,
  Sport,
  TeamOption,
} from '../../types';
import {
  ensureInternalSportLoaded,
  getInternalRacingCalendar,
  getInternalRacingPreSeason,
  getInternalRacingStandings,
} from '../../services/internalDbService';
import { X, Search, Star, BookOpen, Settings, CalendarOff } from 'lucide-react';

type ViewMode = 'LIVE' | 'UPCOMING' | 'SCORES' | 'STANDINGS' | 'BRACKET' | 'RANKINGS' | 'CALENDAR' | 'TEAMS' | 'LEAGUE_STATS';

interface RacingSeriesSummary {
  completedEvents: number;
  totalEvents: number;
  leader?: {
    name: string;
    teamLabel?: string;
    vehicleNumber?: string;
    points?: string;
    wins?: string;
    avgFinish?: string;
    gapToSecond?: string;
  };
  lastResult?: {
    eventLabel: string;
    winnerLabel?: string;
    podiumLabels: string[];
  };
  nextEvent?: {
    eventLabel: string;
    date: string;
    venue?: string;
  };
  preseason?: {
    leaderLabel: string;
    teamLabel: string;
    vehicleNumber?: string;
    bestLap?: string;
    totalLaps?: number;
    note?: string;
  };
}

interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  favoriteTeams: TeamOption[];
  menuSports: Sport[];
  favoriteLeagues: Set<Sport>;
  inactiveLeagues: Set<Sport>;
  leagueActivity: Partial<Record<Sport, { seasonState: SeasonState; hasLiveEvent: boolean; nextEventDate?: string }>>;
  selectedTab: Sport | 'HOME' | 'METHODOLOGY';
  selectedViewMode: ViewMode;
  onNavigate: (sport: Sport | 'HOME' | 'METHODOLOGY', viewMode?: ViewMode) => void;
  onTeamClick: (team: TeamOption) => void;
  onToggleFavoriteTeam: (team: TeamOption, e: React.MouseEvent) => void;
  onToggleFavoriteLeague: (sport: Sport, e: React.MouseEvent) => void;
  onOpenSettings: () => void;
  menuTeamResults: TeamOption[];
  menuSearchTerm: string;
  setMenuSearchTerm: (term: string) => void;
  theme: string;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

const RACING_QUICK_VIEWS: Array<{ label: string; view: ViewMode }> = [
  { label: 'Standings', view: 'STANDINGS' },
  { label: 'Stats', view: 'LEAGUE_STATS' },
  { label: 'Results', view: 'SCORES' },
  { label: 'Calendar', view: 'CALENDAR' },
];

const getRacingDriverTable = (standings: RacingStandingsPayload | null): RacingStandingsPayload['tables'][number] | null => {
  if (!standings || standings.tables.length === 0) return null;
  return standings.tables.find((table) => table.category === 'driver') || standings.tables[0] || null;
};

const getDriverStat = (entry: RacingStandingsEntry | undefined, key: string): string | undefined => {
  if (!entry) return undefined;
  return entry.stats.find((stat) => String(stat.key || '').toLowerCase() === key.toLowerCase())?.value;
};

const parseStatNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const normalized = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(normalized) ? normalized : null;
};

const toCompetitorLabel = (value: { abbreviation?: string; shortName?: string; name?: string }): string => {
  return value.abbreviation || value.shortName || value.name || 'TBD';
};

const formatDateTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatDateOnly = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

const formatLapTime = (seconds?: number): string | undefined => {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return undefined;
  const totalSeconds = Number(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds - (minutes * 60);
  return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`;
};

const buildRacingSeriesSummary = (
  standings: RacingStandingsPayload | null,
  preseason: RacingPreSeasonData | null,
  events: RacingCalendarEvent[],
): RacingSeriesSummary => {
  const allUpcoming = events
    .filter((event) => event.status !== 'finished')
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const allFinished = events
    .filter((event) => event.status === 'finished')
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const targetSeasonYear = allUpcoming[0]?.seasonYear || allFinished[0]?.seasonYear;
  const seasonEvents = targetSeasonYear
    ? events.filter((event) => event.seasonYear === targetSeasonYear)
    : events;

  const driverTable = getRacingDriverTable(standings);
  const leader = driverTable?.entries[0];
  const challenger = driverTable?.entries[1];
  const leaderPoints = getDriverStat(leader, 'points');
  const leaderWins = getDriverStat(leader, 'wins');
  const leaderAvgFinish = getDriverStat(leader, 'avgFinish');
  const leaderGapValue = (() => {
    const lead = parseStatNumber(leaderPoints);
    const second = parseStatNumber(getDriverStat(challenger, 'points'));
    if (lead === null || second === null) return undefined;
    return String(Math.max(0, lead - second));
  })();

  const completedEvents = seasonEvents.filter((event) => event.status === 'finished').length;
  const totalEvents = seasonEvents.length;
  const sortedFinished = seasonEvents
    .filter((event) => event.status === 'finished')
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const sortedUpcoming = seasonEvents
    .filter((event) => event.status !== 'finished')
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latestResult = sortedFinished[0];
  const nextEvent = sortedUpcoming[0];
  const testingLeader = preseason?.entries[0];

  return {
    completedEvents,
    totalEvents,
    leader: leader ? {
      name: leader.name,
      teamLabel: leader.teamName || leader.manufacturer,
      vehicleNumber: leader.vehicleNumber,
      points: leaderPoints,
      wins: leaderWins,
      avgFinish: leaderAvgFinish,
      gapToSecond: leaderGapValue,
    } : undefined,
    lastResult: latestResult ? {
      eventLabel: latestResult.shortName || latestResult.name,
      winnerLabel: latestResult.topFinishers[0] ? toCompetitorLabel(latestResult.topFinishers[0]) : undefined,
      podiumLabels: latestResult.topFinishers.slice(0, 3).map((finisher) => toCompetitorLabel(finisher)),
    } : undefined,
    nextEvent: nextEvent ? {
      eventLabel: nextEvent.shortName || nextEvent.name,
      date: nextEvent.date,
      venue: nextEvent.venue,
    } : undefined,
    preseason: testingLeader ? {
      leaderLabel: testingLeader.name,
      teamLabel: testingLeader.teamName || testingLeader.manufacturer,
      vehicleNumber: testingLeader.vehicleNumber,
      bestLap: formatLapTime(testingLeader.bestLapTime),
      totalLaps: testingLeader.totalLaps,
      note: testingLeader.testingNote,
    } : undefined,
  };
};

export const MenuDrawer: React.FC<MenuDrawerProps> = ({
  isOpen, onClose, favoriteTeams, menuSports, favoriteLeagues, inactiveLeagues,
  leagueActivity,
  selectedTab, selectedViewMode, onNavigate, onTeamClick, onToggleFavoriteTeam, onToggleFavoriteLeague,
  onOpenSettings, menuTeamResults, menuSearchTerm, setMenuSearchTerm, theme, setTheme
}) => {
  const [racingSummaries, setRacingSummaries] = useState<Partial<Record<Sport, RacingSeriesSummary>>>({});

  const getSeasonState = (sport: Sport): SeasonState => {
      const explicit = leagueActivity[sport]?.seasonState;
      if (explicit) return explicit;
      return inactiveLeagues.has(sport) ? 'offseason' : 'in_season';
  };

  const formatNextEventDate = (value?: string): string => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
      });
  };

  // Group leagues logic (non-racing)
  const nonRacingLeagues = menuSports.filter(s => !RACING_LEAGUES.includes(s));
  const activeMyLeagues = nonRacingLeagues.filter(s => favoriteLeagues.has(s) && getSeasonState(s) !== 'offseason');
  const activeOtherLeagues = nonRacingLeagues.filter(s => !favoriteLeagues.has(s) && getSeasonState(s) !== 'offseason');
  const offSeasonLeagues = nonRacingLeagues.filter(s => getSeasonState(s) === 'offseason');
  const racingLeagues = menuSports.filter(s => RACING_LEAGUES.includes(s));
  const racingLeagueKey = racingLeagues.join('|');

  useEffect(() => {
    if (!isOpen || racingLeagues.length === 0) return;

    let cancelled = false;
    const loadRacingSummaries = async () => {
      await Promise.allSettled(racingLeagues.map((sport) => ensureInternalSportLoaded(sport)));
      if (cancelled) return;

      const next: Partial<Record<Sport, RacingSeriesSummary>> = {};
      racingLeagues.forEach((sport) => {
        const calendar = getInternalRacingCalendar(sport);
        const standings = getInternalRacingStandings(sport);
        const preseason = getInternalRacingPreSeason(sport);
        next[sport] = buildRacingSeriesSummary(standings, preseason, calendar?.events || []);
      });
      setRacingSummaries(next);
    };

    loadRacingSummaries();
    return () => {
      cancelled = true;
    };
  }, [isOpen, racingLeagueKey]);

  if (!isOpen) return null;

  const renderLeagueItem = (
      sport: Sport,
      opts?: { isOffSeason?: boolean; statusLabel?: string; nextEventDate?: string; isRacing?: boolean; isLive?: boolean },
  ) => {
      const isOffSeason = Boolean(opts?.isOffSeason);
      const isRacing = Boolean(opts?.isRacing);
      const isFav = favoriteLeagues.has(sport);
      const isSelected = selectedTab === sport;
      const racingSummary = isRacing ? racingSummaries[sport] : undefined;
      const seasonState = getSeasonState(sport);
      const showPreseasonCard = isRacing && Boolean(racingSummary?.preseason) && (seasonState === 'preseason' || racingSummary?.completedEvents === 0);
      const showChampionshipLeader = isRacing && Boolean(racingSummary?.leader) && (Boolean(racingSummary?.completedEvents) || !racingSummary?.nextEvent);
      
      let containerClass = "border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/50";
      let textClass = "text-slate-600 dark:text-slate-400";
      
      if (isSelected) {
          containerClass = "bg-slate-100 dark:bg-slate-800 border-slate-400 dark:border-slate-600 shadow-md ring-1 ring-slate-400 dark:ring-slate-600";
          textClass = "text-slate-900 dark:text-white";
      } else if (isOffSeason) {
          containerClass = "bg-slate-50 dark:bg-slate-950/50 border-slate-100 dark:border-slate-800/50";
          textClass = "text-slate-400 dark:text-slate-600";
      } else if (isFav) {
          containerClass = "bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-sm";
          textClass = "text-slate-800 dark:text-slate-200";
      }

      const quickStatValueClass = "mt-1 text-sm font-bold text-slate-900 dark:text-white";
      const quickStatLabelClass = "text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400";

      return (
        <div
          key={sport}
          className={`rounded-xl border transition-all ${containerClass} ${isRacing ? 'p-3' : 'p-2'}`}
        >
          <div className="flex items-start justify-between gap-2">
            <button
              onClick={() => onNavigate(sport)}
              className={`flex-1 text-left ${textClass}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs truncate">{sport}</span>
                {opts?.statusLabel && (
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                      opts?.isLive
                        ? 'bg-rose-500/20 text-rose-500 border-rose-500/30'
                        : opts.statusLabel === 'Preseason'
                          ? 'bg-cyan-500/10 text-cyan-500 border-cyan-500/30'
                          : opts.statusLabel === 'In Season'
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {opts?.isLive ? 'Live' : opts.statusLabel}
                  </span>
                )}
              </div>

              {isRacing ? (
                <div className="mt-3 space-y-2.5">
                  {racingSummary && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 px-2.5 py-2">
                        <div className={quickStatLabelClass}>Season</div>
                        <div className={quickStatValueClass}>
                          {racingSummary.totalEvents > 0 ? `${racingSummary.completedEvents}/${racingSummary.totalEvents}` : '--'}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                          {racingSummary.totalEvents > 0
                            ? `${Math.max(racingSummary.totalEvents - racingSummary.completedEvents, 0)} weekends to run`
                            : 'Schedule loading'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 px-2.5 py-2">
                        <div className={quickStatLabelClass}>
                          {showChampionshipLeader ? 'Leader' : showPreseasonCard ? 'Testing' : 'Weekend'}
                        </div>
                        <div className={quickStatValueClass}>
                          {showChampionshipLeader
                            ? `${racingSummary.leader?.points || '--'} PTS`
                            : showPreseasonCard
                              ? racingSummary?.preseason?.bestLap || '--'
                              : formatDateOnly(racingSummary?.nextEvent?.date) || '--'}
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                          {showChampionshipLeader
                            ? racingSummary.leader?.gapToSecond
                              ? `+${racingSummary.leader.gapToSecond} to P2`
                              : racingSummary.leader?.wins
                                ? `${racingSummary.leader.wins} wins`
                                : 'Championship'
                            : showPreseasonCard
                              ? `${racingSummary?.preseason?.totalLaps || 0} laps`
                              : racingSummary?.nextEvent?.venue || 'Next weekend'}
                        </div>
                      </div>
                    </div>
                  )}

                  {showChampionshipLeader && racingSummary?.leader && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/40 px-2.5 py-2">
                      <div className={quickStatLabelClass}>Points Leader</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {racingSummary.leader.name}
                        {racingSummary.leader.vehicleNumber ? ` #${racingSummary.leader.vehicleNumber}` : ''}
                      </div>
                      {racingSummary.leader.teamLabel && (
                        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                          {racingSummary.leader.teamLabel}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                        {racingSummary.leader.points && (
                          <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 px-2 py-1">
                            PTS {racingSummary.leader.points}
                          </span>
                        )}
                        {racingSummary.leader.wins && (
                          <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 px-2 py-1">
                            W {racingSummary.leader.wins}
                          </span>
                        )}
                        {racingSummary.leader.avgFinish && (
                          <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 px-2 py-1">
                            AVG {racingSummary.leader.avgFinish}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {showPreseasonCard && racingSummary?.preseason ? (
                    <div className="rounded-lg border border-cyan-200 dark:border-cyan-900/50 bg-cyan-50/80 dark:bg-cyan-950/20 px-2.5 py-2">
                      <div className={quickStatLabelClass}>Testing Leader</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {racingSummary.preseason.leaderLabel}
                        {racingSummary.preseason.vehicleNumber ? ` #${racingSummary.preseason.vehicleNumber}` : ''}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {racingSummary.preseason.teamLabel}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                        {racingSummary.preseason.bestLap && (
                          <span className="rounded-full border border-cyan-200 dark:border-cyan-800/60 bg-white/70 dark:bg-slate-950/40 px-2 py-1">
                            BEST {racingSummary.preseason.bestLap}
                          </span>
                        )}
                        {typeof racingSummary.preseason.totalLaps === 'number' && (
                          <span className="rounded-full border border-cyan-200 dark:border-cyan-800/60 bg-white/70 dark:bg-slate-950/40 px-2 py-1">
                            LAPS {racingSummary.preseason.totalLaps}
                          </span>
                        )}
                      </div>
                      {racingSummary.preseason.note && (
                        <div className="mt-2 text-[10px] leading-relaxed text-slate-600 dark:text-slate-300">
                          {racingSummary.preseason.note}
                        </div>
                      )}
                    </div>
                  ) : racingSummary?.lastResult ? (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/40 px-2.5 py-2">
                      <div className={quickStatLabelClass}>Latest Result</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {racingSummary.lastResult.eventLabel}
                      </div>
                      {racingSummary.lastResult.winnerLabel && (
                        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                          Winner: {racingSummary.lastResult.winnerLabel}
                        </div>
                      )}
                      {racingSummary.lastResult.podiumLabels.length > 0 && (
                        <div className="mt-2 text-[10px] text-slate-600 dark:text-slate-300">
                          Podium: {racingSummary.lastResult.podiumLabels.join(' • ')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 px-2.5 py-2 text-[10px] text-slate-500 dark:text-slate-400">
                      Results and field stats populate as soon as the series data loads.
                    </div>
                  )}

                  {(racingSummary?.nextEvent || opts?.nextEventDate) && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-2.5 py-2">
                      <div className={quickStatLabelClass}>{opts?.isLive ? 'Current Weekend' : 'Next Event'}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {racingSummary?.nextEvent?.eventLabel || sport}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {formatDateTime(racingSummary?.nextEvent?.date || opts?.nextEventDate)}
                        {(racingSummary?.nextEvent?.venue) ? ` • ${racingSummary.nextEvent.venue}` : ''}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {!isRacing && opts?.nextEventDate && (
                <div className="text-[10px] mt-1 text-slate-500 dark:text-slate-400 font-medium">
                  Next: {formatNextEventDate(opts.nextEventDate)}
                </div>
              )}
            </button>
            <button
              onClick={(e) => onToggleFavoriteLeague(sport, e)}
              className={`p-1.5 rounded-full transition-colors ${isFav ? 'text-slate-900 dark:text-white bg-slate-200 dark:bg-slate-700' : 'text-slate-300 dark:text-slate-700 hover:text-slate-500'}`}
            >
              <Star size={12} fill={isFav ? "currentColor" : "none"} />
            </button>
          </div>

          {isRacing && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {RACING_QUICK_VIEWS.map((quickView) => {
                const isActiveView = isSelected && selectedViewMode === quickView.view;
                return (
                  <button
                    key={`${sport}-${quickView.view}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(sport, quickView.view);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      isActiveView
                        ? 'border-slate-400 dark:border-slate-600 bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    {quickView.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-950 w-full max-w-sm h-full flex flex-col shadow-2xl animate-fade-in border-l border-slate-200 dark:border-slate-800">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-md">
          <span className="text-lg font-bold font-display text-slate-900 dark:text-white">Menu</span>
          <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6">
          
          {/* Favorite Teams Section */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              {favoriteTeams.length > 0 ? "Favorite Teams" : "Add Favorite Teams"}
            </h3>
            
            {favoriteTeams.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {favoriteTeams.map(team => (
                  <button 
                    key={`${team.id}-${team.league}`}
                    onClick={() => onTeamClick(team)}
                    className="flex items-center justify-between p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/50 transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      {team.logo ? (
                        <img src={team.logo} alt="" className="w-6 h-6 object-contain" />
                      ) : (
                        <div className="w-6 h-6 bg-slate-200 dark:bg-slate-800 rounded-full" />
                      )}
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{team.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                        {team.league}
                      </span>
                      <div 
                        onClick={(e) => onToggleFavoriteTeam(team, e)}
                        className="p-1.5 text-slate-900 dark:text-white hover:text-amber-500 transition-colors"
                      >
                        <Star size={14} fill="currentColor" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              // Inline Search Logic
              <div className="relative">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search size={16} className="text-slate-400" />
                  </div>
                  <input 
                    type="text" 
                    value={menuSearchTerm}
                    onChange={(e) => setMenuSearchTerm(e.target.value)}
                    placeholder="Search to add teams..." 
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  {menuSearchTerm && (
                    <button 
                      onClick={() => setMenuSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                
                {/* Menu Search Results */}
                {menuSearchTerm && (
                  <div className="mt-2 space-y-1 animate-fade-in">
                    {menuTeamResults.length > 0 ? (
                      menuTeamResults.map(team => (
                        <button 
                          key={`${team.id}-${team.league}`}
                          onClick={(e) => onToggleFavoriteTeam(team, e)}
                          className="w-full flex items-center justify-between p-2 rounded-xl border border-transparent hover:bg-slate-50 dark:hover:bg-slate-900 transition-all text-left group"
                        >
                          <div className="flex items-center gap-3">
                            {team.logo ? (
                              <img src={team.logo} alt="" className="w-6 h-6 object-contain" />
                            ) : (
                              <div className="w-6 h-6 bg-slate-200 dark:bg-slate-800 rounded-full" />
                            )}
                            <div>
                              <div className="text-sm font-bold text-slate-900 dark:text-white">{team.name}</div>
                              <div className="text-[10px] text-slate-500">{team.league}</div>
                            </div>
                          </div>
                          <div className="p-1.5 text-slate-300 dark:text-slate-600 group-hover:text-amber-500 transition-colors">
                            <Star size={16} />
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="p-4 text-center text-xs text-slate-400 italic">No teams found.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="w-full h-px bg-slate-200 dark:bg-slate-800"></div>

          {/* Racing Series */}
          {racingLeagues.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Racing Series</h3>
              <div className="grid grid-cols-1 gap-2">
                {racingLeagues.map((sport) => {
                  const state = getSeasonState(sport);
                  const live = Boolean(leagueActivity[sport]?.hasLiveEvent);
                  const statusLabel =
                    state === 'preseason'
                      ? 'Preseason'
                      : state === 'in_season'
                        ? 'In Season'
                        : 'Off-Season';
                  return renderLeagueItem(sport, {
                    isOffSeason: state === 'offseason',
                    isRacing: true,
                    isLive: live,
                    statusLabel,
                    nextEventDate: leagueActivity[sport]?.nextEventDate,
                  });
                })}
              </div>
            </div>
          )}

          <div className="w-full h-px bg-slate-200 dark:bg-slate-800"></div>
          
          {/* Active Your Leagues */}
          {activeMyLeagues.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Your Leagues</h3>
              <div className="grid grid-cols-2 gap-2">
                {activeMyLeagues.map(sport => renderLeagueItem(sport))}
              </div>
            </div>
          )}

          {/* Active Other Leagues */}
          {activeOtherLeagues.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Other Leagues</h3>
              <div className="grid grid-cols-2 gap-2">
                {activeOtherLeagues.map(sport => renderLeagueItem(sport))}
              </div>
            </div>
          )}

          {/* Off-Season Leagues */}
          {offSeasonLeagues.length > 0 && (
            <>
              <div className="flex items-center gap-3 py-2">
                  <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                  <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                      <CalendarOff size={10} /> Off-Season
                  </span>
                  <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
              </div>
              <div className="grid grid-cols-2 gap-2 opacity-60 hover:opacity-100 transition-opacity duration-300 grayscale hover:grayscale-0">
                {offSeasonLeagues.map(sport => renderLeagueItem(sport, { isOffSeason: true }))}
              </div>
            </>
          )}

          <div className="w-full h-px bg-slate-200 dark:bg-slate-800"></div>
          
          <div className="space-y-2">
            <button 
              onClick={() => { onNavigate('METHODOLOGY'); onClose(); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl font-bold transition-colors ${selectedTab === 'METHODOLOGY' ? 'bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'}`}
            >
              <BookOpen size={18} />
              Methodology
            </button>
            <button 
              onClick={() => { onOpenSettings(); onClose(); }}
              className="w-full flex items-center gap-3 p-3 rounded-xl font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <Settings size={18} />
              Settings & Profile
            </button>
          </div>
          
          {/* Theme Toggles */}
          <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 mt-2">
            {(['light', 'system', 'dark'] as const).map(m => (
              <button
                key={m}
                onClick={() => setTheme(m)}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold capitalize transition-all ${theme === m ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <span className="hidden sm:inline">{m}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
