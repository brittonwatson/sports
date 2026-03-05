import React, { useMemo, useState, useEffect } from 'react';
import { Game, RACING_LEAGUES, RacingCalendarEvent, RacingCalendarPayload, RacingCalendarSession, RacingEventBundle, Sport } from '../types';
import { fetchGamesForDate, fetchGameDatesForMonth, fetchUpcomingGames } from '../services/gameService';
import { fetchRacingCalendarPayload, fetchRacingEventBundle } from '../services/racingService';
import { GameCard } from './GameCard';
import { RacingEventPanel } from './RacingEventPanel';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2, RefreshCw, Flag, Trophy, Timer } from 'lucide-react';

interface CalendarViewProps {
  sport: Sport;
  onGameSelect: (game: Game) => void;
  selectedGameId?: string;
  onTeamClick?: (teamId: string, league: Sport) => void;
  isGameFollowed?: (game: Game) => boolean;
  onToggleFollowGame?: (game: Game, e: React.MouseEvent<HTMLButtonElement>) => void;
  racingUpcomingMode?: 'calendar' | 'list';
}

const isRacingSport = (sport: Sport): boolean => RACING_LEAGUES.includes(sport);

const formatDateTime = (value: string): string => {
  if (!value) return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const toLocalDateKey = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface RacingUpcomingSessionItem {
  event: RacingCalendarEvent;
  session: RacingCalendarSession;
  date: string;
}

const inferRacingSessionType = (sessionName: string): 'race' | 'qualifying' | 'practice' | 'other' => {
  const normalized = String(sessionName || '').toLowerCase();
  if (normalized.includes('race')) return 'race';
  if (normalized.includes('qualifying') || normalized.includes('shootout')) return 'qualifying';
  if (normalized.includes('practice') || normalized.startsWith('fp') || normalized.includes('warmup')) return 'practice';
  return 'other';
};

const getRacingSessionStatusOrder = (status: RacingCalendarSession['status']): number => {
  if (status === 'in_progress') return 0;
  if (status === 'scheduled') return 1;
  return 2;
};

const getRacingSessionTypeOrder = (name: string): number => {
  const type = inferRacingSessionType(name);
  if (type === 'practice') return 0;
  if (type === 'qualifying') return 1;
  if (type === 'race') return 2;
  return 3;
};

const sortRacingSessionsForDisplay = (sessions: RacingCalendarSession[]): RacingCalendarSession[] => {
  return [...sessions].sort((a, b) => {
    const statusDiff = getRacingSessionStatusOrder(a.status) - getRacingSessionStatusOrder(b.status);
    if (statusDiff !== 0) return statusDiff;
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    if (a.status === 'finished') {
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    } else if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    const typeDiff = getRacingSessionTypeOrder(a.name) - getRacingSessionTypeOrder(b.name);
    if (typeDiff !== 0) return typeDiff;
    return a.name.localeCompare(b.name);
  });
};

const sessionPillClass = (status: RacingCalendarSession['status']): string => {
  if (status === 'in_progress') {
    return 'border-amber-400/50 bg-amber-500/20 text-amber-200';
  }
  if (status === 'finished') {
    return 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200';
  }
  return 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300';
};

const toFallbackRacingGame = (sport: Sport, event: RacingCalendarEvent): Game => {
  const topA = event.topFinishers[0];
  const topB = event.topFinishers[1];
  const date = new Date(event.date);
  return {
    id: event.eventId,
    homeTeam: topA?.name || event.shortName,
    homeTeamAbbreviation: topA?.abbreviation,
    homeTeamId: topA?.competitorId,
    homeTeamLogo: topA?.logo,
    homeScore: topA ? String(topA.rank) : undefined,
    awayTeam: topB?.name || 'Field',
    awayTeamAbbreviation: topB?.abbreviation,
    awayTeamId: topB?.competitorId,
    awayTeamLogo: topB?.logo,
    awayScore: topB ? String(topB.rank) : undefined,
    date: Number.isNaN(date.getTime())
      ? event.date
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    time: Number.isNaN(date.getTime())
      ? 'TBD'
      : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    dateTime: event.date,
    league: sport,
    context: event.shortName,
    gameStatus: event.statusText,
    status: event.status,
    clock: undefined,
    period: undefined,
    isPlayoff: false,
    seasonYear: event.seasonYear,
    seasonType: event.seasonType,
    racingSessionType: 'race',
    racingOrderSnapshot: event.topFinishers.slice(0, 5).map((finisher) => ({
      competitorId: finisher.competitorId,
      name: finisher.name,
      abbreviation: finisher.abbreviation,
      logo: finisher.logo,
      vehicleNumber: finisher.vehicleNumber,
      position: finisher.rank,
      statusText: finisher.statusText,
    })),
    venue: event.venue,
    location: event.location,
  };
};

export const CalendarView: React.FC<CalendarViewProps> = ({
  sport,
  onGameSelect,
  selectedGameId,
  onTeamClick,
  isGameFollowed,
  onToggleFollowGame,
  racingUpcomingMode = 'calendar',
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State for active dots
  const [activeDays, setActiveDays] = useState<Set<number>>(new Set());

  const [racingCalendar, setRacingCalendar] = useState<RacingCalendarPayload | null>(null);
  const [racingGamesById, setRacingGamesById] = useState<Map<string, Game>>(new Map());
  const [isRacingLoading, setIsRacingLoading] = useState(false);
  const [racingError, setRacingError] = useState<string | null>(null);
  const [expandedCompletedEvents, setExpandedCompletedEvents] = useState<Set<string>>(new Set());
  const [completedEventBundles, setCompletedEventBundles] = useState<Map<string, RacingEventBundle | null>>(new Map());
  const [completedEventLoadingIds, setCompletedEventLoadingIds] = useState<Set<string>>(new Set());

  const racingMode = isRacingSport(sport);
  const isRacingListMode = racingMode && racingUpcomingMode === 'list';

  useEffect(() => {
    if (!racingMode) return;

    let cancelled = false;
    const loadRacingCalendar = async () => {
      setIsRacingLoading(true);
      setRacingError(null);
      try {
        const [calendarPayload, fullSchedule] = await Promise.all([
          fetchRacingCalendarPayload(sport),
          fetchUpcomingGames(sport, true, { forceLiveRefresh: true }),
        ]);
        if (cancelled) return;
        setRacingCalendar(calendarPayload);
        const gameMap = new Map<string, Game>();
        (fullSchedule.games || []).forEach((game) => {
          gameMap.set(game.id, game);
        });
        setRacingGamesById(gameMap);
      } catch {
        if (!cancelled) {
          setRacingCalendar(null);
          setRacingError('Failed to load racing season calendar.');
        }
      } finally {
        if (!cancelled) setIsRacingLoading(false);
      }
    };

    loadRacingCalendar();
    return () => {
      cancelled = true;
    };
  }, [racingMode, sport]);

  // Fetch dots for the entire month
  useEffect(() => {
    if (racingMode) return;

    const loadMonthDots = async () => {
      setActiveDays(new Set());
      try {
        const days = await fetchGameDatesForMonth(
          sport,
          currentMonth.getFullYear(),
          currentMonth.getMonth(),
        );
        setActiveDays(days);
      } catch (e) {
        console.error('Failed to load calendar dots', e);
      }
    };
    loadMonthDots();
  }, [currentMonth, racingMode, sport]);

  // Fetch games for selected date
  useEffect(() => {
    if (racingMode) return;

    const fetchGames = async () => {
      setIsLoading(true);
      setError(null);
      setGames([]);
      try {
        const fetchedGames = await fetchGamesForDate(sport, selectedDate);
        setGames(fetchedGames);
      } catch {
        setError('Failed to load games for this date.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchGames();
  }, [selectedDate, racingMode, sport]);

  const upcomingRacingEvents = useMemo(
    () => (racingCalendar?.events || []).filter((event) => event.status !== 'finished'),
    [racingCalendar],
  );

  const groupedUpcomingRacingEvents = useMemo(() => {
    const grouped = new Map<string, RacingCalendarEvent[]>();
    upcomingRacingEvents.forEach((event) => {
      const date = new Date(event.date);
      const label = Number.isNaN(date.getTime())
        ? 'Unknown Month'
        : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const existing = grouped.get(label);
      if (existing) existing.push(event);
      else grouped.set(label, [event]);
    });
    return Array.from(grouped.entries()).map(([label, events]) => ({
      label,
      events: events.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    }));
  }, [upcomingRacingEvents]);

  const completedRacingEvents = useMemo(
    () => (racingCalendar?.events || [])
      .filter((event) => event.status === 'finished')
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [racingCalendar],
  );

  const upcomingRacingSessions = useMemo<RacingUpcomingSessionItem[]>(() => {
    const items: RacingUpcomingSessionItem[] = [];
    upcomingRacingEvents.forEach((event) => {
      const sessions = event.sessions.length > 0
        ? sortRacingSessionsForDisplay(event.sessions)
        : [{
          id: `${event.eventId}-race`,
          name: 'Race',
          date: event.date,
          status: event.status,
          statusText: event.statusText,
        } as RacingCalendarSession];

      sessions.forEach((session) => {
        if (session.status === 'finished') return;
        const sessionDate = session.date || event.date;
        if (!toLocalDateKey(sessionDate)) return;
        items.push({
          event,
          session,
          date: sessionDate,
        });
      });
    });

    return items.sort((a, b) => {
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeA - timeB;

      const statusDiff = getRacingSessionStatusOrder(a.session.status) - getRacingSessionStatusOrder(b.session.status);
      if (statusDiff !== 0) return statusDiff;

      const typeDiff = getRacingSessionTypeOrder(a.session.name) - getRacingSessionTypeOrder(b.session.name);
      if (typeDiff !== 0) return typeDiff;

      return a.event.shortName.localeCompare(b.event.shortName);
    });
  }, [upcomingRacingEvents]);

  const upcomingRacingSessionsByDate = useMemo(() => {
    const grouped = new Map<string, RacingUpcomingSessionItem[]>();
    upcomingRacingSessions.forEach((item) => {
      const key = toLocalDateKey(item.date);
      if (!key) return;
      const existing = grouped.get(key);
      if (existing) existing.push(item);
      else grouped.set(key, [item]);
    });
    return grouped;
  }, [upcomingRacingSessions]);

  const selectedDateKey = useMemo(() => toLocalDateKey(selectedDate), [selectedDate]);

  const selectedDateRacingSessions = useMemo(
    () => upcomingRacingSessionsByDate.get(selectedDateKey) || [],
    [selectedDateKey, upcomingRacingSessionsByDate],
  );

  useEffect(() => {
    if (!racingMode) return;
    const days = new Set<number>();
    upcomingRacingSessions.forEach((item) => {
      const date = new Date(item.date);
      if (Number.isNaN(date.getTime())) return;
      if (
        date.getFullYear() === currentMonth.getFullYear()
        && date.getMonth() === currentMonth.getMonth()
      ) {
        days.add(date.getDate());
      }
    });
    setActiveDays(days);
  }, [currentMonth, racingMode, upcomingRacingSessions]);

  useEffect(() => {
    if (!racingMode || upcomingRacingSessions.length === 0) return;
    if (selectedDateKey && upcomingRacingSessionsByDate.has(selectedDateKey)) return;
    const next = new Date(upcomingRacingSessions[0].date);
    if (Number.isNaN(next.getTime())) return;
    setSelectedDate(new Date(next.getFullYear(), next.getMonth(), next.getDate()));
    setCurrentMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }, [racingMode, selectedDateKey, upcomingRacingSessions, upcomingRacingSessionsByDate]);

  const openRacingEvent = (event: RacingCalendarEvent) => {
    const mapped = racingGamesById.get(event.eventId) || toFallbackRacingGame(sport, event);
    onGameSelect(mapped);
  };

  const loadCompletedEventBundle = async (eventId: string) => {
    if (!eventId) return;
    if (completedEventBundles.get(eventId) || completedEventLoadingIds.has(eventId)) return;

    setCompletedEventLoadingIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });

    try {
      const bundle = await fetchRacingEventBundle(sport, eventId);
      if (bundle) {
        setCompletedEventBundles((prev) => {
          const next = new Map(prev);
          next.set(eventId, bundle);
          return next;
        });
      }
    } finally {
      setCompletedEventLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    }
  };

  const toggleCompletedEventExpansion = (eventId: string) => {
    const willExpand = !expandedCompletedEvents.has(eventId);
    setExpandedCompletedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });

    if (willExpand) {
      void loadCompletedEventBundle(eventId);
    }
  };

  useEffect(() => {
    setExpandedCompletedEvents(new Set());
    setCompletedEventBundles(new Map());
    setCompletedEventLoadingIds(new Set());
  }, [sport]);

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const changeMonth = (delta: number) => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    setCurrentMonth(newMonth);
  };

  const handleDateClick = (day: number) => {
    const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    setSelectedDate(newDate);
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const today = new Date();

    const days = [];
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const header = weekDays.map(day => (
      <div key={day} className="text-center text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 py-2">
        {day}
      </div>
    ));

    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-10 sm:h-12" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const isSelected = date.toDateString() === selectedDate.toDateString();
      const isToday = date.toDateString() === today.toDateString();
      const hasGame = activeDays.has(day);

      days.push(
        <button
          key={day}
          onClick={() => handleDateClick(day)}
          className={`
            h-10 sm:h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 relative transition-all
            ${isSelected
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-lg scale-105 z-10'
              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }
            ${isToday && !isSelected ? 'ring-1 ring-indigo-500 font-bold text-indigo-500' : ''}
          `}
        >
          <span className={`text-sm ${isSelected ? 'font-bold' : 'font-medium'}`}>{day}</span>

          <div className="flex items-center gap-1 h-1.5">
            {isToday && !isSelected && <span className="w-1 h-1 rounded-full bg-indigo-500" />}

            {hasGame && !isSelected && (
              <span className={`w-1 h-1 rounded-full ${isToday ? 'bg-slate-400' : 'bg-emerald-500'}`} />
            )}
            {hasGame && isSelected && (
              <span className="w-1 h-1 rounded-full bg-white/50 dark:bg-slate-900/50" />
            )}
          </div>
        </button>,
      );
    }

    return (
      <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm mb-8">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => changeMonth(-1)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white uppercase tracking-wider">
            {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h2>
          <button
            onClick={() => changeMonth(1)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400 transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {header}
          {days}
        </div>
      </div>
    );
  };

  if (racingMode) {
    return (
      <div className="animate-fade-in max-w-6xl mx-auto space-y-6">
        <section className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white">
                {sport} {racingCalendar ? `${racingCalendar.seasonYear}` : ''} {isRacingListMode ? 'Upcoming Events' : 'Season Calendar'}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {isRacingListMode ? 'All upcoming race weekends and sessions for the season.' : 'Full schedule plus completed-race top 5 finishers.'}
              </p>
            </div>
            <div className="text-right text-xs text-slate-500 dark:text-slate-400">
              <div>Upcoming Weekends: {upcomingRacingEvents.length}</div>
              <div>Upcoming Sessions: {upcomingRacingSessions.length}</div>
              <div>Completed: {completedRacingEvents.length}</div>
            </div>
          </div>
        </section>

        {isRacingLoading ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-12 text-center">
            <Loader2 size={24} className="mx-auto animate-spin text-slate-500 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading full racing calendar...</p>
          </div>
        ) : racingError ? (
          <div className="p-8 text-center border-2 border-dashed border-rose-200 dark:border-rose-900/30 rounded-2xl bg-rose-50 dark:bg-rose-900/10">
            <p className="text-rose-500 text-sm font-medium mb-2">{racingError}</p>
            <button
              onClick={() => {
                setIsRacingLoading(true);
                setRacingError(null);
                Promise.all([fetchRacingCalendarPayload(sport), fetchUpcomingGames(sport, true, { forceLiveRefresh: true })])
                  .then(([calendarPayload, fullSchedule]) => {
                    setRacingCalendar(calendarPayload);
                    const map = new Map<string, Game>();
                    (fullSchedule.games || []).forEach((game) => map.set(game.id, game));
                    setRacingGamesById(map);
                  })
                  .catch(() => setRacingError('Retry failed.'))
                  .finally(() => setIsRacingLoading(false));
              }}
              className="inline-flex items-center gap-2 text-xs font-bold uppercase text-rose-600 dark:text-rose-400 hover:underline"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Flag size={14} /> {isRacingListMode ? 'Upcoming Races' : 'Upcoming Sessions'}
              </div>

              {(isRacingListMode ? upcomingRacingEvents.length === 0 : upcomingRacingSessions.length === 0) ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                  {isRacingListMode ? 'No upcoming race weekends found.' : 'No upcoming sessions found.'}
                </div>
              ) : (
                isRacingListMode ? (
                  groupedUpcomingRacingEvents.map((group) => (
                    <div key={group.label} className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{group.label}</h3>
                      <div className="space-y-3">
                        {group.events.map((event) => {
                          const openGame = racingGamesById.get(event.eventId) || toFallbackRacingGame(sport, event);
                          const isSelected = selectedGameId === openGame.id;
                          return (
                            <button
                              key={event.eventId}
                              type="button"
                              onClick={() => openRacingEvent(event)}
                              className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                                isSelected
                                  ? 'border-cyan-400/60 bg-cyan-50 dark:bg-cyan-950/20 dark:border-cyan-700/60'
                                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                              }`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-bold text-slate-900 dark:text-white">{event.shortName}</div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{event.venue || 'Venue TBD'}{event.location ? `, ${event.location}` : ''}</div>
                                </div>
                                <div className="text-right text-xs">
                                  <div className="font-semibold text-slate-700 dark:text-slate-300">{formatDateTime(event.date)}</div>
                                  <div className={`mt-1 inline-flex px-2 py-0.5 rounded-full border uppercase tracking-wider text-[10px] ${
                                    event.status === 'in_progress'
                                      ? 'text-amber-300 bg-amber-500/20 border-amber-400/40'
                                      : 'text-slate-400 bg-slate-700/30 border-slate-600'
                                  }`}>
                                    {event.statusText}
                                  </div>
                                </div>
                              </div>

                              {event.sessions.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {sortRacingSessionsForDisplay(event.sessions).map((session) => (
                                    <span
                                      key={`${event.eventId}-${session.id}`}
                                      className={`text-[10px] uppercase tracking-wider rounded-md border px-2 py-1 ${sessionPillClass(session.status)}`}
                                    >
                                      {session.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    {renderCalendar()}

                    <div className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Sessions for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </h3>

                      {selectedDateRacingSessions.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 px-6 py-6 text-center text-slate-500 dark:text-slate-400">
                          No upcoming sessions on this date.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedDateRacingSessions.map((item) => {
                            const openGame = racingGamesById.get(item.event.eventId) || toFallbackRacingGame(sport, item.event);
                            const isSelected = selectedGameId === openGame.id;
                            return (
                              <button
                                key={`${item.event.eventId}-${item.session.id}`}
                                type="button"
                                onClick={() => openRacingEvent(item.event)}
                                className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                                  isSelected
                                    ? 'border-cyan-400/60 bg-cyan-50 dark:bg-cyan-950/20 dark:border-cyan-700/60'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-white">{item.event.shortName}</div>
                                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1">{item.session.name}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                      {item.event.venue || 'Venue TBD'}{item.event.location ? `, ${item.event.location}` : ''}
                                    </div>
                                  </div>
                                  <div className="text-right text-xs">
                                    <div className="font-semibold text-slate-700 dark:text-slate-300">{formatDateTime(item.date)}</div>
                                    <div className={`mt-1 inline-flex px-2 py-0.5 rounded-full border uppercase tracking-wider text-[10px] ${sessionPillClass(item.session.status)}`}>
                                      {item.session.statusText || item.session.status}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )
              )}
            </section>

            {!isRacingListMode && (
            <section className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Trophy size={14} /> Completed Races
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Most recent weekends first. Expand a finished event for race, qualifying, and practice results.
              </p>

              {completedRacingEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                  Completed race results are not posted yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {completedRacingEvents.map((event) => {
                    const openGame = racingGamesById.get(event.eventId) || toFallbackRacingGame(sport, event);
                    const isSelected = selectedGameId === openGame.id;
                    const isExpanded = expandedCompletedEvents.has(event.eventId);
                    const isBundleLoading = completedEventLoadingIds.has(event.eventId);
                    const bundle = completedEventBundles.get(event.eventId) || null;
                    return (
                      <div
                        key={event.eventId}
                        className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                          isSelected
                            ? 'border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-700/60'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <button type="button" onClick={() => openRacingEvent(event)} className="text-left flex-1 min-w-[220px]">
                            <div className="text-sm font-bold text-slate-900 dark:text-white">{event.shortName}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatDateTime(event.date)} • {event.venue || 'Venue TBD'}</div>
                          </button>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border border-emerald-400/50 bg-emerald-500/20 text-emerald-300">
                              {event.statusText}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleCompletedEventExpansion(event.eventId)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                              aria-expanded={isExpanded}
                            >
                              <span>{isExpanded ? 'Hide Sessions' : 'Session Results'}</span>
                              <ChevronRight size={13} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          </div>
                        </div>

                        {event.topFinishers.length > 0 ? (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                            {event.topFinishers.slice(0, 5).map((finisher) => (
                              <div key={`${event.eventId}-${finisher.competitorId}-${finisher.rank}`} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-2.5 py-2">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">P{finisher.rank}</div>
                                <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                  <span className="truncate">{finisher.name}</span>
                                  {finisher.vehicleNumber && (
                                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">#{finisher.vehicleNumber}</span>
                                  )}
                                </div>
                                {(finisher.teamName || finisher.manufacturer) && (
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                    {finisher.teamName || finisher.manufacturer}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                            <Timer size={12} /> Finishing order is not available yet.
                          </div>
                        )}

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                            {isBundleLoading ? (
                              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500 dark:text-slate-400">
                                <Loader2 size={20} className="mx-auto animate-spin mb-3" />
                                Loading full session results...
                              </div>
                            ) : bundle ? (
                              <RacingEventPanel event={bundle} showEventHeader={false} />
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                Session results are not available for this weekend yet.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      {renderCalendar()}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <CalendarIcon size={16} />
            Games for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          {isLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 bg-slate-100 dark:bg-slate-900/50 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-12 text-center border-2 border-dashed border-rose-200 dark:border-rose-900/30 rounded-2xl bg-rose-50 dark:bg-rose-900/10">
            <p className="text-rose-500 text-sm font-medium mb-2">{error}</p>
            <button
              onClick={() => {
                setIsLoading(true);
                setError(null);
                fetchGamesForDate(sport, selectedDate)
                  .then(setGames)
                  .catch(() => setError('Retry failed'))
                  .finally(() => setIsLoading(false));
              }}
              className="inline-flex items-center gap-2 text-xs font-bold uppercase text-rose-600 dark:text-rose-400 hover:underline"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : games.length === 0 ? (
          <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20">
            <p>No games scheduled for this date.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {games.map(game => (
              <GameCard
                key={game.id}
                game={game}
                onSelect={onGameSelect}
                isSelected={selectedGameId === game.id}
                onTeamClick={onTeamClick}
                isFollowed={isGameFollowed ? isGameFollowed(game) : false}
                onToggleFollow={onToggleFollowGame}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
