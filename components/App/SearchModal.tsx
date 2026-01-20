
import React, { useRef, useEffect } from 'react';
import { TeamOption, Sport } from '../../types';
import { Search, X, Trophy, Star } from 'lucide-react';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filteredLeagues: Sport[];
  filteredTeams: TeamOption[];
  onNavigateLeague: (sport: Sport) => void;
  onNavigateTeam: (team: TeamOption) => void;
  favoriteTeams: TeamOption[];
  isTeamFavorite: (teamId: string, league: Sport) => boolean;
  toggleFavoriteTeam: (team: TeamOption, e: React.MouseEvent) => void;
  menuSports: Sport[]; // Used for suggestions
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen, onClose, searchTerm, setSearchTerm, filteredLeagues, filteredTeams,
  onNavigateLeague, onNavigateTeam, favoriteTeams, isTeamFavorite, toggleFavoriteTeam, menuSports
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-950 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-4 px-6 py-5 border-b border-slate-100 dark:border-slate-800">
          <Search className="text-slate-400" size={24} />
          <input 
            ref={searchInputRef}
            autoFocus
            type="text" 
            placeholder="Search teams, leagues, or matchups..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent border-none text-xl font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-0 p-0 outline-none"
          />
          <button 
            onClick={() => {
              if (searchTerm) {
                setSearchTerm('');
                searchInputRef.current?.focus();
              } else {
                onClose();
              }
            }}
            className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
            title={searchTerm ? "Clear" : "Close"}
          >
            <X size={24} />
          </button>
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {searchTerm ? (
            <div className="space-y-4">
              {/* Leagues */}
              {filteredLeagues.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Leagues</h3>
                  <div className="grid grid-cols-1 gap-1">
                    {filteredLeagues.map(sport => (
                      <button
                        key={sport}
                        onClick={() => { onNavigateLeague(sport); onClose(); setSearchTerm(''); }}
                        className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition-all text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                            <Trophy size={14} />
                          </div>
                          <span className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {sport}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Teams */}
              {filteredTeams.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Teams</h3>
                  <div className="grid grid-cols-1 gap-1">
                    {filteredTeams.map(team => {
                      const isFav = isTeamFavorite(team.id, team.league);
                      return (
                        <button 
                          key={`${team.id}-${team.league}`}
                          onClick={() => { onNavigateTeam(team); onClose(); setSearchTerm(''); }}
                          className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition-all text-left group"
                        >
                          <div className="flex items-center gap-3">
                            {team.logo ? (
                              <img src={team.logo} alt="" className="w-8 h-8 object-contain" />
                            ) : (
                              <div className="w-8 h-8 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-500 font-bold text-xs">{team.name.charAt(0)}</div>
                            )}
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">{team.name}</div>
                              <div className="text-xs text-slate-500">{team.league}</div>
                            </div>
                          </div>
                          <div 
                            onClick={(e) => { e.stopPropagation(); toggleFavoriteTeam(team, e); }}
                            className={`p-2 rounded-full transition-colors ${isFav ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400'}`}
                          >
                            <Star size={18} fill={isFav ? "currentColor" : "none"} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {filteredLeagues.length === 0 && filteredTeams.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-slate-500 dark:text-slate-400 italic">No results found for "{searchTerm}"</p>
                </div>
              )}
            </div>
          ) : (
            // Default View (Suggestions)
            <div className="space-y-6">
              {favoriteTeams.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-2">
                    <Star size={12} className="text-amber-500" fill="currentColor"/> Quick Access
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {favoriteTeams.map(team => (
                      <button 
                        key={`${team.id}-${team.league}`}
                        onClick={() => { onNavigateTeam(team); onClose(); }}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition-all text-left"
                      >
                        {team.logo ? (
                          <img src={team.logo} alt="" className="w-6 h-6 object-contain" />
                        ) : (
                          <div className="w-6 h-6 bg-slate-200 dark:bg-slate-800 rounded-full" />
                        )}
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{team.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Popular Leagues</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['NFL', 'NBA', 'EPL', 'UCL', 'MLB', 'NHL', 'NCAAF', 'F1'].filter(l => menuSports.includes(l as Sport)).map(sport => (
                    <button
                      key={sport}
                      onClick={() => { onNavigateLeague(sport as Sport); onClose(); }}
                      className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-800"
                    >
                      {sport}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
