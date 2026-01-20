
import React from 'react';
import { Filter, ChevronDown, Check, Trophy } from 'lucide-react';

interface FilterBarProps {
  activeFilter: string;
  setActiveFilter: (filter: string) => void;
  availableConferences: string[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({ 
  activeFilter, 
  setActiveFilter, 
  availableConferences, 
  isOpen, 
  setIsOpen 
}) => {
  return (
    <div className="mb-6 relative z-20 inline-block">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm text-sm font-bold text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700 transition-all min-w-[220px]"
      >
        <span className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          {activeFilter === 'ALL' ? 'All Conferences' : activeFilter === 'TOP25' ? 'Top 25 Ranked' : activeFilter}
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)}></div>
          <div className="absolute top-full left-0 mt-2 w-64 max-h-[300px] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-20 p-1 custom-scrollbar animate-fade-in">
            <button
              onClick={() => { setActiveFilter('ALL'); setIsOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-between ${activeFilter === 'ALL' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
            >
              All Conferences
              {activeFilter === 'ALL' && <Check size={14} className="text-emerald-500" />}
            </button>
            <button
              onClick={() => { setActiveFilter('TOP25'); setIsOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-between ${activeFilter === 'TOP25' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
            >
              <span className="flex items-center gap-2"><Trophy size={14} className={activeFilter === 'TOP25' ? 'text-amber-500' : 'text-slate-400'} /> Top 25</span>
              {activeFilter === 'TOP25' && <Check size={14} className="text-emerald-500" />}
            </button>
            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1 mx-2"></div>
            {availableConferences.map(conf => (
              <button
                key={conf}
                onClick={() => { setActiveFilter(conf); setIsOpen(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-between ${activeFilter === conf ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
              >
                {conf}
                {activeFilter === conf && <Check size={14} className="text-emerald-500" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
