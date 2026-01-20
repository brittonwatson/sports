
import React, { useState } from 'react';
import { Sport, TeamOption } from '../../types';
import { X, Search, Star, BookOpen, Settings } from 'lucide-react';

interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  favoriteTeams: TeamOption[];
  menuSports: Sport[];
  favoriteLeagues: Set<Sport>;
  inactiveLeagues: Set<Sport>;
  selectedTab: Sport | 'HOME' | 'METHODOLOGY';
  onNavigate: (sport: Sport | 'HOME' | 'METHODOLOGY') => void;
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

export const MenuDrawer: React.FC<MenuDrawerProps> = ({
  isOpen, onClose, favoriteTeams, menuSports, favoriteLeagues, inactiveLeagues,
  selectedTab, onNavigate, onTeamClick, onToggleFavoriteTeam, onToggleFavoriteLeague,
  onOpenSettings, menuTeamResults, menuSearchTerm, setMenuSearchTerm, theme, setTheme
}) => {
  if (!isOpen) return null;

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
                    autoFocus
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
          
          {/* Leagues List */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Your Leagues</h3>
            <div className="grid grid-cols-2 gap-2">
              {menuSports.filter(s => favoriteLeagues.has(s)).map((sport) => {
                let containerClass = "bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-sm";
                if (selectedTab === sport) {
                  containerClass = "bg-slate-100 dark:bg-slate-800 border-slate-400 dark:border-slate-600 shadow-md ring-1 ring-slate-400 dark:ring-slate-600";
                }
                return (
                  <div 
                    key={sport} 
                    className={`flex items-center justify-between p-2 rounded-xl border transition-all ${containerClass}`}
                  >
                    <button
                      onClick={() => onNavigate(sport)}
                      className="flex-1 text-left font-bold text-xs truncate mr-2 text-slate-800 dark:text-slate-200"
                    >
                      {sport}
                    </button>
                    <button
                      onClick={(e) => onToggleFavoriteLeague(sport, e)}
                      className="p-1.5 rounded-full transition-colors text-slate-900 dark:text-white bg-slate-200 dark:bg-slate-700"
                    >
                      <Star size={12} fill="currentColor" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Other Leagues</h3>
            <div className="grid grid-cols-2 gap-2">
              {menuSports.filter(s => !favoriteLeagues.has(s)).map((sport) => {
                const isInactive = inactiveLeagues.has(sport);
                let containerClass = "border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700";
                let textClass = "text-slate-600 dark:text-slate-400";
                let opacityClass = "opacity-100";
                
                if (selectedTab === sport) {
                  containerClass = "bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-sm";
                  textClass = "text-slate-900 dark:text-white";
                } else if (isInactive) {
                  opacityClass = "opacity-40 grayscale";
                  textClass = "text-slate-500 dark:text-slate-500";
                }
                return (
                  <div 
                    key={sport} 
                    className={`flex items-center justify-between p-2 rounded-xl border transition-all ${containerClass} ${opacityClass}`}
                  >
                    <button
                      onClick={() => onNavigate(sport)}
                      className={`flex-1 text-left font-bold text-xs truncate mr-2 ${textClass}`}
                    >
                      {sport}
                    </button>
                    <button
                      onClick={(e) => onToggleFavoriteLeague(sport, e)}
                      className="p-1.5 rounded-full transition-colors text-slate-300 hover:text-slate-500"
                    >
                      <Star size={12} fill="none" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
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
          {/* Theme Toggles in Menu (duplicated from settings for ease) */}
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
