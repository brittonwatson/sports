
import React from 'react';
import { Sport, SOCCER_LEAGUES } from '../../types';
import { Radio } from 'lucide-react';

type ViewMode = 'LIVE' | 'UPCOMING' | 'SCORES' | 'STANDINGS' | 'BRACKET' | 'RANKINGS' | 'CALENDAR' | 'TEAMS';

interface ViewSelectorProps {
  viewMode: ViewMode;
  selectedTab: Sport | 'HOME' | 'METHODOLOGY';
  setViewMode: (mode: ViewMode) => void;
}

const RANKED_LEAGUES: Sport[] = ['NCAAF', 'NCAAM', 'NCAAW'];
const PLAYOFF_LEAGUES: string[] = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAM', 'NCAAW', 'MLS', 'WNBA', 'UCL'];

export const ViewSelector: React.FC<ViewSelectorProps> = ({ viewMode, selectedTab, setViewMode }) => {
  return (
    <div className={`bg-slate-100 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-200 dark:border-slate-800/60 ${selectedTab === 'HOME' ? 'w-full md:w-auto grid grid-cols-3 gap-1 md:flex md:gap-0' : 'flex overflow-x-auto no-scrollbar'}`}>
      <button
        onClick={() => setViewMode('LIVE')}
        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center gap-2 flex-1
            ${viewMode === 'LIVE' 
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
      >
        <Radio size={14} className={viewMode === 'LIVE' ? 'text-emerald-500 animate-pulse' : ''} />
        Live
      </button>

      <button
        onClick={() => setViewMode('UPCOMING')}
        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center flex-1
            ${viewMode === 'UPCOMING' 
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
      >
        Upcoming
      </button>

      <button
        onClick={() => setViewMode('SCORES')}
        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center flex-1
            ${viewMode === 'SCORES' 
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
      >
        Final Scores
      </button>
      
      {selectedTab !== 'HOME' && (
        <>
          <div className="w-px h-5 bg-slate-300 dark:bg-slate-700 mx-1 self-center"></div>

          <button
            onClick={() => setViewMode('STANDINGS')}
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center flex-1
                ${viewMode === 'STANDINGS' 
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
          >
            {SOCCER_LEAGUES.includes(selectedTab as Sport) ? 'Table' : 'Standings'}
          </button>
          
          <button
            onClick={() => setViewMode('TEAMS')}
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center flex-1
                ${viewMode === 'TEAMS' 
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
          >
            Teams
          </button>
          
          <button
            onClick={() => setViewMode('CALENDAR')}
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center flex-1
                ${viewMode === 'CALENDAR' 
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
          >
            Calendar
          </button>

          {PLAYOFF_LEAGUES.includes(selectedTab as string) && (
            <button
              onClick={() => setViewMode('BRACKET')}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center flex-1
                  ${viewMode === 'BRACKET' 
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
            >
              Bracket
            </button>
          )}

          {RANKED_LEAGUES.includes(selectedTab as Sport) && (
            <button
              onClick={() => setViewMode('RANKINGS')}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center justify-center flex-1
                  ${viewMode === 'RANKINGS' 
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
            >
              Rankings
            </button>
          )}
        </>
      )}
    </div>
  );
};
