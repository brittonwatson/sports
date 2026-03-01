import React from 'react';
import { Sport, TeamOption } from '../../types';
import { Search, Star, Trophy } from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  leagues: Sport[];
  selectedLeagues: Set<Sport>;
  onToggleLeague: (sport: Sport) => void;
  teamSearch: string;
  onTeamSearchChange: (term: string) => void;
  teamResults: TeamOption[];
  isTeamSelected: (teamId: string, league: Sport) => boolean;
  onToggleTeam: (team: TeamOption) => void;
  onComplete: () => void;
  onUseAllLeagues: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  leagues,
  selectedLeagues,
  onToggleLeague,
  teamSearch,
  onTeamSearchChange,
  teamResults,
  isTeamSelected,
  onToggleTeam,
  onComplete,
  onUseAllLeagues,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-2xl flex flex-col">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xl font-bold font-display text-slate-900 dark:text-white">Choose Your Favorites</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Select leagues and teams to personalize your home feed and reduce unnecessary loading.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300 flex items-center gap-2">
                <Trophy size={14} className="text-indigo-500" />
                Favorite Leagues
              </h3>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {selectedLeagues.size} selected
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {leagues.map((sport) => {
                const selected = selectedLeagues.has(sport);
                return (
                  <button
                    key={sport}
                    type="button"
                    onClick={() => onToggleLeague(sport)}
                    className={`px-3 py-2 rounded-lg border text-xs font-bold transition-colors ${
                      selected
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                        : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {sport}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300 mb-3 flex items-center gap-2">
              <Star size={14} className="text-amber-500" />
              Favorite Teams (Optional)
            </h3>
            <div className="relative mb-3">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={14} className="text-slate-400" />
              </div>
              <input
                type="text"
                value={teamSearch}
                onChange={(e) => onTeamSearchChange(e.target.value)}
                placeholder="Search teams..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>

            {teamSearch.trim() ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {teamResults.map((team) => {
                  const selected = isTeamSelected(team.id, team.league);
                  return (
                    <button
                      key={`${team.league}-${team.id}`}
                      type="button"
                      onClick={() => onToggleTeam(team)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-colors ${
                        selected
                          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {team.logo ? (
                          <img src={team.logo} alt="" className="w-6 h-6 object-contain shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{team.name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">{team.league}</div>
                        </div>
                      </div>
                      <Star size={14} className={selected ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'} fill={selected ? 'currentColor' : 'none'} />
                    </button>
                  );
                })}
                {teamResults.length === 0 && (
                  <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                    No teams match your search.
                  </div>
                )}
              </div>
            ) : (
              <div className="py-5 text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-center">
                Start typing to add teams.
              </div>
            )}
          </section>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onUseAllLeagues}
            className="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Use All Leagues
          </button>
          <button
            type="button"
            onClick={onComplete}
            disabled={selectedLeagues.size === 0}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

