
import React, { useState, useEffect } from 'react';
import { Game, Sport } from '../types';
import { fetchGamesForDate, fetchGameDatesForMonth } from '../services/gameService';
import { GameCard } from './GameCard';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2, RefreshCw } from 'lucide-react';

interface CalendarViewProps {
  sport: Sport;
  onGameSelect: (game: Game) => void;
  selectedGameId?: string;
  onTeamClick?: (teamId: string, league: Sport) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ sport, onGameSelect, selectedGameId, onTeamClick }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // State for active dots
  const [activeDays, setActiveDays] = useState<Set<number>>(new Set());

  // Fetch dots for the entire month
  useEffect(() => {
      const loadMonthDots = async () => {
          setActiveDays(new Set());
          try {
              const days = await fetchGameDatesForMonth(
                  sport, 
                  currentMonth.getFullYear(), 
                  currentMonth.getMonth()
              );
              setActiveDays(days);
          } catch(e) {
              console.error("Failed to load calendar dots", e);
          }
      };
      loadMonthDots();
  }, [currentMonth, sport]);

  // Fetch games for selected date
  useEffect(() => {
    const fetchGames = async () => {
      setIsLoading(true);
      setError(null);
      setGames([]);
      try {
        const fetchedGames = await fetchGamesForDate(sport, selectedDate);
        setGames(fetchedGames);
      } catch (err) {
        setError("Failed to load games for this date.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchGames();
  }, [selectedDate, sport]);

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

    // Weekday headers
    const header = weekDays.map(day => (
      <div key={day} className="text-center text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 py-2">
        {day}
      </div>
    ));

    // Empty cells for start of month
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-10 sm:h-12"></div>);
    }

    // Days
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
          
          {/* Indicators */}
          <div className="flex items-center gap-1 h-1.5">
              {/* Today Dot (if selected, hide because bg is solid) */}
              {isToday && !isSelected && <span className="w-1 h-1 rounded-full bg-indigo-500"></span>}
              
              {/* Game Exists Dot (Secondary) */}
              {hasGame && !isSelected && (
                  <span className={`w-1 h-1 rounded-full ${isToday ? 'bg-slate-400' : 'bg-emerald-500'}`}></span>
              )}
              {/* If selected, dots are tricky on dark/light bg, simpler to hide or use contrasting color */}
              {hasGame && isSelected && (
                  <span className="w-1 h-1 rounded-full bg-white/50 dark:bg-slate-900/50"></span>
              )}
          </div>
        </button>
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
                  <div key={i} className="h-40 bg-slate-100 dark:bg-slate-900/50 rounded-2xl animate-pulse"></div>
              ))}
           </div>
        ) : error ? (
            <div className="p-12 text-center border-2 border-dashed border-rose-200 dark:border-rose-900/30 rounded-2xl bg-rose-50 dark:bg-rose-900/10">
                <p className="text-rose-500 text-sm font-medium mb-2">{error}</p>
                <button 
                    onClick={() => { setIsLoading(true); setError(null); fetchGamesForDate(sport, selectedDate).then(setGames).catch(() => setError("Retry failed")).finally(() => setIsLoading(false)); }}
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
                    />
                ))}
            </div>
        )}
      </div>
    </div>
  );
};
