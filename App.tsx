
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SPORTS, Sport, Game, PredictionResult, GroundingChunk, StandingsGroup, GameDetails, UserProfile, TeamOption, PredictionStats, StandingsType, TeamProfile, SOCCER_LEAGUES, RACING_LEAGUES, RacingDriverSeasonResults, RacingEventBundle, RacingStandingsPayload, SeasonState } from './types';
import { fetchUpcomingGames, fetchBracketGames, fetchGameDetails } from './services/gameService';
import { fetchStandings, fetchRankings, fetchTeamProfile, fetchTeamSchedule, syncFullDatabase } from './services/teamService';
import { fetchRacingDriverSeasonResults, fetchRacingEventBundle, fetchRacingStandingsPayload } from './services/racingService';
import { recordCompletedGames } from './services/internalDbService';
import { generateAIAnalysis } from './services/aiService';
import { getSeasonKeyForGame, listSeasonOptionsFromGames } from './services/seasonScope';
import { GameCard } from './components/GameCard';
import { PredictionView } from './components/PredictionView';
import { LiveGameView } from './components/LiveGameView';
import { StandingsView } from './components/StandingsView';
import { BracketView } from './components/BracketView';
import { MethodologyView } from './components/MethodologyView';
import { TeamDetailView } from './components/TeamDetailView';
import { CalendarView } from './components/CalendarView';
import { TeamsListView } from './components/TeamsListView';
import { LeagueStatsView } from './components/LeagueStatsView';
import { RacingEventPanel } from './components/RacingEventPanel';
import { RacingStandingsView } from './components/RacingStandingsView';
import { RacingDriverSeasonPanel } from './components/RacingDriverSeasonPanel';
import { Calendar, Trophy, CalendarOff, Loader2 } from 'lucide-react';
import { LOCAL_TEAMS } from './data/teams';

// Import new modular components
import { Navbar } from './components/App/Navbar';
import { ViewSelector } from './components/App/ViewSelector';
import { FilterBar } from './components/App/FilterBar';
import { MenuDrawer } from './components/App/MenuDrawer';
import { SearchModal } from './components/App/SearchModal';
import { SettingsModal } from './components/App/SettingsModal';
import { FollowingBar } from './components/App/FollowingBar';
import { OnboardingModal } from './components/App/OnboardingModal';

type Tab = Sport | 'HOME' | 'METHODOLOGY';
type ViewMode = 'LIVE' | 'UPCOMING' | 'SCORES' | 'STANDINGS' | 'BRACKET' | 'RANKINGS' | 'CALENDAR' | 'TEAMS' | 'LEAGUE_STATS';
type ThemeMode = 'light' | 'dark' | 'system';
type TeamSelection = { id: string, league: Sport };

interface NavState {
  tab: Tab;
  view: ViewMode;
  team: TeamSelection | null;
  gameId: string | null;
}

interface LeagueActivityState {
  seasonState: SeasonState;
  hasLiveEvent: boolean;
  nextEventDate?: string;
}

const RANKED_LEAGUES: Sport[] = ['NCAAF', 'NCAAM', 'NCAAW'];
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || '';
const ENABLE_RUNTIME_SYNC = import.meta.env.VITE_ENABLE_RUNTIME_SYNC === 'true';
const ALL_VIEW_MODES: ViewMode[] = ['LIVE', 'UPCOMING', 'SCORES', 'STANDINGS', 'BRACKET', 'RANKINGS', 'CALENDAR', 'TEAMS', 'LEAGUE_STATS'];
const PREDICTION_MODEL_VERSION = '2026-03-01-r7';
const GAME_RENDER_BATCH = 36;
const RACING_VIEW_BLOCKLIST: ViewMode[] = ['BRACKET', 'RANKINGS', 'TEAMS', 'LEAGUE_STATS'];

type ProbabilityModule = typeof import('./services/probabilities/index');
let probabilityModulePromise: Promise<ProbabilityModule> | null = null;
const loadProbabilityModule = async (): Promise<ProbabilityModule> => {
  if (!probabilityModulePromise) {
    probabilityModulePromise = import('./services/probabilities/index');
  }
  return probabilityModulePromise;
};

const hasRenderableGameDetails = (details: GameDetails | null | undefined): boolean => {
  if (!details) return false;
  return (
    (details.linescores?.length || 0) > 0 ||
    (details.stats?.length || 0) > 0 ||
    (details.scoringPlays?.length || 0) > 0 ||
    (details.plays?.length || 0) > 0 ||
    (details.boxscore?.some((team) => (team.groups || []).some((group) => (group.players || []).length > 0)) || false) ||
    (details.leaders?.length || 0) > 0 ||
    (details.injuries?.length || 0) > 0
  );
};

const getOnboardingStorageKey = (userSub?: string): string =>
  userSub ? `onboarding_complete_${userSub}` : 'onboarding_complete';

const readOnboardingComplete = (userSub?: string): boolean => {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(getOnboardingStorageKey(userSub)) === '1';
};

const markOnboardingComplete = (userSub?: string): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getOnboardingStorageKey(userSub), '1');
};

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system';

const isTab = (value: string | null): value is Tab =>
  value === 'HOME' ||
  value === 'METHODOLOGY' ||
  (typeof value === 'string' && SPORTS.includes(value as Sport));

const isViewMode = (value: string | null): value is ViewMode =>
  typeof value === 'string' && ALL_VIEW_MODES.includes(value as ViewMode);

const readNavStateFromLocation = (): NavState => {
  if (typeof window === 'undefined') return { tab: 'HOME', view: 'LIVE', team: null, gameId: null };

  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  const viewParam = params.get('view');
  const leagueParam = params.get('league');
  const teamIdParam = params.get('team');
  const gameParam = params.get('game');
  const gameId = gameParam?.trim() ? gameParam.trim() : null;

  const team = leagueParam && teamIdParam && SPORTS.includes(leagueParam as Sport)
    ? { id: teamIdParam, league: leagueParam as Sport }
    : null;

  let tab: Tab = isTab(tabParam) ? tabParam : (team ? team.league : 'HOME');
  let view: ViewMode = isViewMode(viewParam) ? viewParam : 'LIVE';

  if (tab === 'METHODOLOGY') {
    view = 'LIVE';
    return { tab, view, team: null, gameId: null };
  }

  return { tab, view, team, gameId };
};

const buildNavSearch = (state: NavState): string => {
  const params = new URLSearchParams();
  const { tab, view, team, gameId } = state;

  if (tab !== 'HOME' || team) params.set('tab', tab);
  if (view !== 'LIVE') params.set('view', view);
  if (team) {
    params.set('league', team.league);
    params.set('team', team.id);
  }
  if (gameId) params.set('game', gameId);

  const query = params.toString();
  return query ? `?${query}` : '';
};

const isUserProfile = (value: unknown): value is UserProfile => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserProfile>;
  return (
    typeof candidate.sub === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.picture === 'string'
  );
};

const parseJson = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const parseFavoriteLeagues = (raw: string | null): Set<Sport> => {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return new Set(SPORTS);

  const leagues = parsed.filter(
    (league): league is Sport =>
      typeof league === 'string' && SPORTS.includes(league as Sport),
  );
  return new Set(leagues);
};

const parseFavoriteTeams = (raw: string | null): Set<string> => {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
};

const parseFollowedGames = (raw: string | null): Set<string> => {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return new Set();
  return new Set(
    parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
};

const parseUserSession = (raw: string | null): UserProfile | null => {
  const parsed = parseJson<unknown>(raw, null);
  return isUserProfile(parsed) ? parsed : null;
};

// Helper to decode JWT from Google
const decodeJwt = (token: string): UserProfile | null => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    const parsed = JSON.parse(jsonPayload);
    return isUserProfile(parsed) ? parsed : null;
  } catch (e) {
    console.error("Failed to decode JWT", e);
    return null;
  }
};

export const App: React.FC = () => {
  const initialNavRef = useRef<NavState>(readNavStateFromLocation());

  const [selectedTab, setSelectedTab] = useState<Tab>(initialNavRef.current.tab);
  const [viewMode, setViewMode] = useState<ViewMode>(initialNavRef.current.view);
  const [standingsType, setStandingsType] = useState<StandingsType>('PLAYOFF');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  
  // Team Page State
  const [selectedTeam, setSelectedTeam] = useState<TeamSelection | null>(initialNavRef.current.team);
  const [teamProfile, setTeamProfile] = useState<TeamProfile | null>(null);
  const [teamSchedule, setTeamSchedule] = useState<Game[]>([]);
  const [isTeamLoading, setIsTeamLoading] = useState(false);

  // Theme State
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [isDarkMode, setIsDarkMode] = useState(true);
  
  // Auth State
  const [user, setUser] = useState<UserProfile | null>(null);
  
  // Favorites State
  const [favoriteLeagues, setFavoriteLeagues] = useState<Set<Sport>>(new Set());
  const [favoriteTeams, setFavoriteTeams] = useState<Set<string>>(new Set());
  const [followedGames, setFollowedGames] = useState<Set<string>>(new Set());
  const [isFollowingBarOpen, setIsFollowingBarOpen] = useState(true);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [onboardingLeagues, setOnboardingLeagues] = useState<Set<Sport>>(new Set());
  const [onboardingTeams, setOnboardingTeams] = useState<Set<string>>(new Set());
  const [onboardingTeamSearch, setOnboardingTeamSearch] = useState('');
  
  // Team Search State
  const [teamSearchTerm, setTeamSearchTerm] = useState('');
  const [menuSearchTerm, setMenuSearchTerm] = useState('');
  const [allTeams, setAllTeams] = useState<Map<string, TeamOption>>(new Map());
  const [areTeamsLoaded, setAreTeamsLoaded] = useState(false);

  // Data State
  const [games, setGames] = useState<Game[]>([]);
  const [bracketGames, setBracketGames] = useState<Game[]>([]);
  const [standings, setStandings] = useState<StandingsGroup[]>([]);
  const [gameRegistry, setGameRegistry] = useState<Map<string, Game>>(new Map());
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [navigatedGameId, setNavigatedGameId] = useState<string | null>(initialNavRef.current.gameId);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [racingEventBundle, setRacingEventBundle] = useState<RacingEventBundle | null>(null);
  const [racingStandings, setRacingStandings] = useState<RacingStandingsPayload | null>(null);
  const [selectedRacingDriver, setSelectedRacingDriver] = useState<{ sport: Sport; driverId: string; driverName: string } | null>(null);
  const [racingDriverSeason, setRacingDriverSeason] = useState<RacingDriverSeasonResults | null>(null);
  const [isRacingDriverLoading, setIsRacingDriverLoading] = useState(false);
  
  const predictionCache = useRef<Map<string, {
    prediction: PredictionResult | null;
    details: GameDetails | null;
    modelVersion?: string;
  }>>(new Map());
  const activeRequestId = useRef<string | null>(null);
  const isTabSwitch = useRef(true);
  const lastScrolledGameId = useRef<string | null>(null);
  const isApplyingPopState = useRef(false);
  const lastKnownUrl = useRef<string>('');
  const loadRequestVersionRef = useRef(0);
  const liveDetailRequestVersionRef = useRef<Map<string, number>>(new Map());
  const forceLiveRefreshOnNextLoad = useRef(false);
  const seenFinishedSnapshots = useRef<Map<string, string>>(new Map());

  // Filter State
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [conferenceMap, setConferenceMap] = useState<Map<string, string>>(new Map());
  const [top25RankedTeamIds, setTop25RankedTeamIds] = useState<Set<string>>(new Set());
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [selectedLeagueSeasonKey, setSelectedLeagueSeasonKey] = useState<string | null>(null);
  
  // Menu Organization State
  const [menuSports, setMenuSports] = useState<Sport[]>(SPORTS);
  const [inactiveLeagues, setInactiveLeagues] = useState<Set<Sport>>(new Set());
  const [leagueActivity, setLeagueActivity] = useState<Partial<Record<Sport, LeagueActivityState>>>({});

  // Loading/Error State
  const [isLoading, setIsLoading] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleGameCount, setVisibleGameCount] = useState(GAME_RENDER_BATCH);

  const upsertGamesInRegistry = useCallback((incoming: Game[]) => {
    if (incoming.length === 0) return;
    const completedToRecord: Game[] = [];
    incoming.forEach((game) => {
      if (game.status !== 'finished') return;
      const gameId = String(game.id || `${game.dateTime}-${game.homeTeamId || 'home'}-${game.awayTeamId || 'away'}`);
      const snapshot = `${game.homeScore || ''}|${game.awayScore || ''}|${game.gameStatus || ''}`;
      const existing = seenFinishedSnapshots.current.get(gameId);
      if (existing === snapshot) return;
      seenFinishedSnapshots.current.set(gameId, snapshot);
      completedToRecord.push(game);
    });
    if (completedToRecord.length > 0) {
      recordCompletedGames(completedToRecord);
    }

    if (seenFinishedSnapshots.current.size > 6000) {
      const keys = Array.from(seenFinishedSnapshots.current.keys());
      keys.slice(0, seenFinishedSnapshots.current.size - 4000).forEach((key) => {
        seenFinishedSnapshots.current.delete(key);
      });
    }

    setGameRegistry((prev) => {
      const next = new Map(prev);
      incoming.forEach((game) => {
        const existing = next.get(game.id);
        next.set(game.id, existing ? { ...existing, ...game } : game);
      });

      const staleFinishedCutoffMs = Date.now() - (14 * 24 * 60 * 60 * 1000);
      for (const [id, game] of next.entries()) {
        const gameTime = new Date(game.dateTime).getTime();
        if (game.status === 'finished' && Number.isFinite(gameTime) && gameTime < staleFinishedCutoffMs) {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  const bumpLiveDetailVersion = useCallback((gameId: string): number => {
    const next = (liveDetailRequestVersionRef.current.get(gameId) || 0) + 1;
    liveDetailRequestVersionRef.current.set(gameId, next);
    return next;
  }, []);

  const isLiveDetailVersionCurrent = useCallback((gameId: string, version: number): boolean => {
    return (liveDetailRequestVersionRef.current.get(gameId) || 0) === version;
  }, []);

  // Initialize Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (isThemeMode(savedTheme)) {
      setTheme(savedTheme);
    }
  }, []);

  // Nightly Database Sync Logic
  useEffect(() => {
    if (!ENABLE_RUNTIME_SYNC) return;

    const checkAndSync = async () => {
        const lastFullSync = localStorage.getItem('last_full_sync');
        const now = new Date();
        const todayString = now.toDateString(); 
        
        let needsSync = false;
        if (!lastFullSync) {
            needsSync = true;
        } else {
            const lastSyncDate = new Date(parseInt(lastFullSync));
            // If the last sync was yesterday (or earlier), we need to sync today
            if (lastSyncDate.toDateString() !== todayString) {
                needsSync = true;
            }
        }

        if (needsSync) {
            console.log("Starting Daily Stats Database Sync...");
            try {
                await syncFullDatabase();
                localStorage.setItem('last_full_sync', Date.now().toString());
                console.log("Daily Stats Database Sync Completed");
            } catch (e) {
                console.error("Daily Stats Database Sync Failed", e);
            }
        }
    };

    // 1. Check immediately on mount
    checkAndSync();

    // 2. Schedule next check for exactly 12:00 AM tonight
    const now = new Date();
    const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1, // Tomorrow
        0, 0, 0 // 00:00:00
    );
    const msToMidnight = night.getTime() - now.getTime();

    const timer = setTimeout(() => {
        checkAndSync();
        // After the first midnight execution, we rely on component remounts or just assume the user will reload eventually.
        // For a truly long-running dashboard, we could set an interval here.
    }, msToMidnight);

    return () => clearTimeout(timer);
  }, []);

  // Initialize Auth & Favorites
  useEffect(() => {
    const currentUser = parseUserSession(localStorage.getItem('user_session'));
    if (currentUser) setUser(currentUser);

    const loadFavorites = () => {
        const key = currentUser ? `favorites_${currentUser.sub}` : 'favorites';
        const saved = localStorage.getItem(key);
        const parsedLeagues = saved ? parseFavoriteLeagues(saved) : new Set<Sport>();
        const onboardingComplete = readOnboardingComplete(currentUser?.sub);
        setFavoriteLeagues(parsedLeagues);
        setOnboardingLeagues(new Set(parsedLeagues));
        setIsOnboardingOpen(!onboardingComplete && parsedLeagues.size === 0);

        const teamKey = currentUser ? `favorite_teams_${currentUser.sub}` : 'favorite_teams';
        const parsedTeams = parseFavoriteTeams(localStorage.getItem(teamKey));
        setFavoriteTeams(parsedTeams);
        setOnboardingTeams(new Set(parsedTeams));

        const followKey = currentUser ? `followed_games_${currentUser.sub}` : 'followed_games';
        setFollowedGames(parseFollowedGames(localStorage.getItem(followKey)));
    };
    loadFavorites();

    const initGoogle = () => {
        if (!window.google || !GOOGLE_CLIENT_ID) return;
        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
            auto_select: false
        });
    };
    
    const timer = setTimeout(initGoogle, 1000);
    return () => clearTimeout(timer);

  }, []);

  useEffect(() => {
    const key = user ? `favorites_${user.sub}` : 'favorites';
    localStorage.setItem(key, JSON.stringify(Array.from(favoriteLeagues)));
  }, [favoriteLeagues, user]);

  useEffect(() => {
    const key = user ? `favorite_teams_${user.sub}` : 'favorite_teams';
    localStorage.setItem(key, JSON.stringify(Array.from(favoriteTeams)));
  }, [favoriteTeams, user]);

  useEffect(() => {
    const key = user ? `followed_games_${user.sub}` : 'followed_games';
    localStorage.setItem(key, JSON.stringify(Array.from(followedGames)));
  }, [followedGames, user]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    
    let resolvedDark = false;

    if (theme === 'system') {
      resolvedDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(resolvedDark ? 'dark' : 'light');
      localStorage.removeItem('theme');
    } else {
      resolvedDark = theme === 'dark';
      root.classList.add(theme);
      localStorage.setItem('theme', theme);
    }
    
    setIsDarkMode(resolvedDark);

  }, [theme]);

  useEffect(() => {
    if (theme === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => {
             const root = window.document.documentElement;
             root.classList.remove('light', 'dark');
             root.classList.add(e.matches ? 'dark' : 'light');
             setIsDarkMode(e.matches);
        };
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  useEffect(() => {
      if (!isMenuOpen) {
          setMenuSearchTerm('');
      }
  }, [isMenuOpen]);

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
              e.preventDefault();
              setIsSearchOpen(prev => !prev);
          }
          if (e.key === 'Escape') {
              setIsSearchOpen(false);
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const targetUrl = `${window.location.pathname}${buildNavSearch({
      tab: selectedTab,
      view: viewMode,
      team: selectedTeam,
      gameId: selectedGame?.id ?? navigatedGameId,
    })}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (!lastKnownUrl.current) {
      if (targetUrl !== currentUrl) {
        window.history.replaceState(null, '', targetUrl);
        lastKnownUrl.current = targetUrl;
      } else {
        lastKnownUrl.current = currentUrl;
      }
      return;
    }

    if (isApplyingPopState.current) {
      isApplyingPopState.current = false;
      lastKnownUrl.current = targetUrl;
      return;
    }

    if (targetUrl !== lastKnownUrl.current) {
      window.history.pushState(null, '', targetUrl);
      lastKnownUrl.current = targetUrl;
    }
  }, [selectedTab, viewMode, selectedTeam?.id, selectedTeam?.league, selectedGame?.id, navigatedGameId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      const next = readNavStateFromLocation();
      isApplyingPopState.current = true;
      setSelectedTab(next.tab);
      setViewMode(next.view);
      setSelectedTeam(next.team);
      setNavigatedGameId(next.gameId);
      setSelectedGame(null);
      setPrediction(null);
      setGameDetails(null);
      activeRequestId.current = null;
      setIsMenuOpen(false);
      setIsFilterDropdownOpen(false);
      isTabSwitch.current = true;
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (selectedGame && selectedGame.id !== lastScrolledGameId.current) {
        lastScrolledGameId.current = selectedGame.id;
        setTimeout(() => {
            const el = document.getElementById(`game-card-${selectedGame.id}`);
            if (el) {
                const headerOffset = 100;
                const elementPosition = el.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.scrollY - headerOffset;
                window.scrollTo({
                    top: offsetPosition,
                    behavior: "smooth"
                });
            }
        }, 150);
    } else if (!selectedGame) {
        lastScrolledGameId.current = null;
    }
  }, [selectedGame]);

  useEffect(() => {
      if (!areTeamsLoaded) {
          const seedTeams = new Map<string, TeamOption>();
          Object.entries(LOCAL_TEAMS).forEach(([sport, teams]) => {
              teams.forEach(t => {
                  const key = `${t.name}-${sport}`;
                  seedTeams.set(key, t);
              });
          });
          setAllTeams(seedTeams);
          
          if (isSearchOpen || isMenuOpen) {
              const loadTeamsFromSources = async () => {
                  for (const sport of SPORTS) {
                      try {
                           const groups = await fetchStandings(sport, 'DIVISION');
                           setAllTeams(prev => {
                               const next = new Map(prev);
                               groups.forEach(g => {
                                   g.standings.forEach(s => {
                                       const key = `${s.team.name}-${sport}`;
                                       if (!next.has(key)) {
                                           next.set(key, { 
                                               id: s.team.id, 
                                               name: s.team.name, 
                                               abbreviation: s.team.abbreviation,
                                               logo: s.team.logo, 
                                               league: sport 
                                           });
                                       }
                                   });
                               });
                               return next;
                           });
                      } catch (e) {
                      }
                  }
                  setAreTeamsLoaded(true);
              };
              loadTeamsFromSources();
          }
      }
  }, [isMenuOpen, isSearchOpen, areTeamsLoaded]);

  useEffect(() => {
      if (RANKED_LEAGUES.includes(selectedTab as Sport)) {
          const loadConferences = async () => {
              try {
                  const groups = await fetchStandings(selectedTab as Sport, 'DIVISION');
                  const map = new Map<string, string>();
                  groups.forEach(group => {
                      group.standings.forEach(team => {
                          map.set(team.team.id, group.name);
                      });
                  });
                  setConferenceMap(map);
              } catch (e) {
                  console.error("Failed to load conference map", e);
              }
          };
          loadConferences();
      } else {
          setConferenceMap(new Map());
      }
      setActiveFilter('ALL');
      setSelectedLeagueSeasonKey(null);
  }, [selectedTab]);

  useEffect(() => {
      let cancelled = false;
      const shouldLoadTop25 =
          RANKED_LEAGUES.includes(selectedTab as Sport) &&
          activeFilter === 'TOP25';

      if (!shouldLoadTop25) {
          setTop25RankedTeamIds(new Set());
          return () => {
              cancelled = true;
          };
      }

      const loadTop25 = async () => {
          try {
              const rankingGroups = await fetchRankings(selectedTab as Sport);
              const preferredGroup =
                  rankingGroups.find(g => /ap top 25/i.test(g.name)) ||
                  rankingGroups.find(g => /top 25/i.test(g.name)) ||
                  rankingGroups[0];

              const ids = new Set<string>();
              (preferredGroup?.standings || []).forEach((entry) => {
                  const rankNum = Number(entry.rank);
                  if (!entry.team?.id) return;
                  if (!Number.isFinite(rankNum) || rankNum <= 0 || rankNum > 25) return;
                  ids.add(String(entry.team.id));
              });

              if (!cancelled) setTop25RankedTeamIds(ids);
          } catch {
              if (!cancelled) setTop25RankedTeamIds(new Set());
          }
      };

      loadTop25();
      return () => {
          cancelled = true;
      };
  }, [selectedTab, activeFilter]);

  useEffect(() => {
      let intervalId: ReturnType<typeof setInterval>;
      let cancelled = false;

      if (selectedTeam) {
          const loadTeamData = async (background = false, forceRefresh = false) => {
              if (!background && !cancelled) setIsTeamLoading(true);
              try {
                  const [profile, recentSchedule] = await Promise.all([
                      fetchTeamProfile(selectedTeam.league, selectedTeam.id),
                      fetchTeamSchedule(selectedTeam.league, selectedTeam.id, {
                          scope: 'recent',
                          forceLiveRefresh: forceRefresh,
                      }),
                  ]);
                  if (cancelled) return;
                  setTeamProfile(profile);
                  setTeamSchedule(recentSchedule);
                  upsertGamesInRegistry(recentSchedule);

                  if (!background) {
                      fetchTeamSchedule(selectedTeam.league, selectedTeam.id, { scope: 'all' })
                          .then((fullSchedule) => {
                              if (cancelled || !Array.isArray(fullSchedule) || fullSchedule.length === 0) return;
                              setTeamSchedule((prev) => (fullSchedule.length > prev.length ? fullSchedule : prev));
                              upsertGamesInRegistry(fullSchedule);
                          })
                          .catch(() => {});
                  }
              } catch (e) {
                  console.error("Failed to load team data", e);
              } finally {
                  if (!background && !cancelled) setIsTeamLoading(false);
              }
          };
          
          loadTeamData(false, true);
          window.scrollTo({ top: 0, behavior: 'smooth' });

          intervalId = setInterval(() => {
              loadTeamData(true, true);
          }, 30000);
      } else {
          setTeamProfile(null);
          setTeamSchedule([]);
      }

      return () => {
          cancelled = true;
          if (intervalId) clearInterval(intervalId);
      }
  }, [selectedTeam, upsertGamesInRegistry]);

  useEffect(() => {
      let cancelled = false;

      if (!selectedRacingDriver) {
          setRacingDriverSeason(null);
          setIsRacingDriverLoading(false);
          return () => {
              cancelled = true;
          };
      }

      const loadDriverSeason = async () => {
          setIsRacingDriverLoading(true);
          try {
              const payload = await fetchRacingDriverSeasonResults(
                  selectedRacingDriver.sport,
                  selectedRacingDriver.driverId,
              );
              if (cancelled) return;
              setRacingDriverSeason(payload);
          } catch {
              if (!cancelled) setRacingDriverSeason(null);
          } finally {
              if (!cancelled) setIsRacingDriverLoading(false);
          }
      };

      loadDriverSeason();
      return () => {
          cancelled = true;
      };
  }, [selectedRacingDriver?.sport, selectedRacingDriver?.driverId]);

  const handleCredentialResponse = (response: GoogleCredentialResponse) => {
      if (!response?.credential) return;
      const profile = decodeJwt(response.credential);
      if (profile) {
          setUser(profile);
          localStorage.setItem('user_session', JSON.stringify(profile));
          const onboardingComplete = readOnboardingComplete(profile.sub);
          
          const cloudKey = `favorites_${profile.sub}`;
          const cloudFavs = localStorage.getItem(cloudKey);
          let resolvedLeagues = new Set<Sport>();
          if (cloudFavs) {
              resolvedLeagues = parseFavoriteLeagues(cloudFavs);
          } else {
              const localFavs = localStorage.getItem('favorites');
              if (localFavs) resolvedLeagues = parseFavoriteLeagues(localFavs);
          }
          setFavoriteLeagues(resolvedLeagues);
          setOnboardingLeagues(new Set(resolvedLeagues));

          const teamKey = `favorite_teams_${profile.sub}`;
          const cloudTeams = localStorage.getItem(teamKey);
          let resolvedTeams = new Set<string>();
          if (cloudTeams) {
              resolvedTeams = parseFavoriteTeams(cloudTeams);
          } else {
              const localTeams = localStorage.getItem('favorite_teams');
              resolvedTeams = parseFavoriteTeams(localTeams);
          }
          setFavoriteTeams(resolvedTeams);
          setOnboardingTeams(new Set(resolvedTeams));

          const followKey = `followed_games_${profile.sub}`;
          const cloudFollowed = localStorage.getItem(followKey);
          if (cloudFollowed) {
              setFollowedGames(parseFollowedGames(cloudFollowed));
          } else {
              const localFollowed = localStorage.getItem('followed_games');
              setFollowedGames(parseFollowedGames(localFollowed));
          }

          setIsSettingsOpen(false);
          setIsOnboardingOpen(!onboardingComplete && resolvedLeagues.size === 0);
      }
  };

  const handleLogout = () => {
      if (window.google) window.google.accounts.id.disableAutoSelect();
      setUser(null);
      localStorage.removeItem('user_session');
      const onboardingComplete = readOnboardingComplete();
      const localFavs = localStorage.getItem('favorites');
      const resolvedLeagues = localFavs ? parseFavoriteLeagues(localFavs) : new Set<Sport>();
      setFavoriteLeagues(resolvedLeagues);
      setOnboardingLeagues(new Set(resolvedLeagues));

      const localTeams = localStorage.getItem('favorite_teams');
      const resolvedTeams = parseFavoriteTeams(localTeams);
      setFavoriteTeams(resolvedTeams);
      setOnboardingTeams(new Set(resolvedTeams));

      const localFollowed = localStorage.getItem('followed_games');
      setFollowedGames(parseFollowedGames(localFollowed));

      setIsSettingsOpen(false);
      setIsOnboardingOpen(!onboardingComplete && resolvedLeagues.size === 0);
  };

  const getScoreGroupLabel = (game: Game) => {
      const label = game.context || '';
      const isStatus = label === game.gameStatus;
      if (game.league === 'NFL' && label && !isStatus) {
          return label;
      }
      if (!isStatus && (game.isPlayoff || label.includes('Week'))) {
          return label;
      }
      return game.date;
  };

  const loadData = async (tab: Tab, mode: ViewMode, isBackground = false, forceLiveRefresh = false) => {
    const requestVersion = ++loadRequestVersionRef.current;
    if (tab === 'METHODOLOGY' || selectedTeam || mode === 'CALENDAR') return;

    if (!isBackground) {
        setIsLoading(true);
        setError(null);
        if (mode === 'STANDINGS' || mode === 'RANKINGS' || mode === 'TEAMS' || mode === 'LEAGUE_STATS') setStandings([]);
        if (mode !== 'STANDINGS' || tab === 'HOME' || !RACING_LEAGUES.includes(tab as Sport)) setRacingStandings(null);
        if (mode === 'BRACKET') setBracketGames([]);
        if (mode !== 'LIVE' && mode !== 'UPCOMING' && mode !== 'SCORES') setGames([]);
    }
    
    try {
        if (mode === 'STANDINGS' && tab !== 'HOME') {
            if (RACING_LEAGUES.includes(tab as Sport)) {
                const racingData = await fetchRacingStandingsPayload(tab as Sport);
                setRacingStandings(racingData);
                setStandings([]);
            } else {
                const standingsData = await fetchStandings(tab, standingsType);
                setStandings(standingsData);
                setRacingStandings(null);
            }
        } else if ((mode === 'TEAMS' || mode === 'LEAGUE_STATS') && tab !== 'HOME') {
            const standingsData = await fetchStandings(tab, 'DIVISION');
            setStandings(standingsData);
        } else if (mode === 'RANKINGS' && tab !== 'HOME') {
            const rankingsData = await fetchRankings(tab);
            setStandings(rankingsData);
        } else if (mode === 'BRACKET' && tab !== 'HOME') {
            const bracketData = await fetchBracketGames(tab);
            setBracketGames(bracketData);
            upsertGamesInRegistry(bracketData);
        } else {
            let fetchedGames: Game[] = [];
            const leagueActivityUpdates: Partial<Record<Sport, LeagueActivityState>> = {};
      
            if (tab === 'HOME') {
              const active: Sport[] = [];
              const inactive: Sport[] = [];
              const allGames: Game[] = [];
              const leaguesToFetch = SPORTS.filter(s => favoriteLeagues.has(s));
              const chunkSize = 4;
              const chunks: Sport[][] = [];
              for (let i = 0; i < leaguesToFetch.length; i += chunkSize) {
                  chunks.push(leaguesToFetch.slice(i, i + chunkSize));
              }

              for (const chunk of chunks) {
                  const chunkResults = await Promise.all(
                      chunk.map((sport: Sport) =>
                          fetchUpcomingGames(sport, false, { forceLiveRefresh }),
                      ),
                  );
                  
                  chunkResults.forEach((result, idx) => {
                      const sportName = chunk[idx];
                      const seasonState: SeasonState = result.seasonState || (result.isSeasonActive ? 'in_season' : 'offseason');
                      leagueActivityUpdates[sportName] = {
                          seasonState,
                          hasLiveEvent: Boolean(result.hasLiveEvent || result.games.some((game) => game.status === 'in_progress')),
                          nextEventDate: result.nextEventDate,
                      };
                      if (seasonState !== 'offseason') {
                          active.push(sportName);
                      } else {
                          inactive.push(sportName);
                      }
                      allGames.push(...result.games);
                  });
              }
      
              if (!isBackground) {
                  const inactiveSet = new Set(inactive);
                  setInactiveLeagues(inactiveSet);
                  
                  const sortedSports = [...SPORTS].sort((a, b) => {
                      const aInactive = inactiveSet.has(a);
                      const bInactive = inactiveSet.has(b);
                      const aFav = favoriteLeagues.has(a);
                      const bFav = favoriteLeagues.has(b);
                      if (aInactive !== bInactive) return aInactive ? 1 : -1;
                      if (aFav !== bFav) return aFav ? -1 : 1;
                      return a.localeCompare(b);
                  });

                  setMenuSports(sortedSports);
              }
      
              const now = new Date();
              const today = new Date(now);
              const yesterday = new Date(now);
              yesterday.setDate(yesterday.getDate() - 1);
              const weekAgo = new Date(now);
              weekAgo.setDate(weekAgo.getDate() - 7);
              
              const isSameDate = (d1: Date, d2: Date) => 
                  d1.getFullYear() === d2.getFullYear() &&
                  d1.getMonth() === d2.getMonth() &&
                  d1.getDate() === d2.getDate();
              
              fetchedGames = allGames.filter(game => {
                const gameDate = new Date(game.dateTime);
                const isLive = game.status === 'in_progress';
                const isFinished = game.status === 'finished';
                if (isFinished) return gameDate >= weekAgo;
                if (isLive) return true;
                if (isSameDate(gameDate, today)) return true;
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                if (isSameDate(gameDate, tomorrow)) return true;
                if (gameDate > now && game.isPlayoff) return true;
                return false;
              });
      
              setAllTeams(prev => {
                  const next = new Map(prev);
                  fetchedGames.forEach(g => {
                      const homeKey = `${g.homeTeam}-${g.league}`;
                      if (!next.has(homeKey) && g.homeTeamId) {
                          next.set(homeKey, {
                              id: g.homeTeamId,
                              name: g.homeTeam,
                              abbreviation: g.homeTeamAbbreviation,
                              logo: g.homeTeamLogo,
                              league: g.league as Sport,
                          });
                      }
                      const awayKey = `${g.awayTeam}-${g.league}`;
                      if (!next.has(awayKey) && g.awayTeamId) {
                          next.set(awayKey, {
                              id: g.awayTeamId,
                              name: g.awayTeam,
                              abbreviation: g.awayTeamAbbreviation,
                              logo: g.awayTeamLogo,
                              league: g.league as Sport,
                          });
                      }
                  });
                  return next;
              });
      
            } else {
              const needsFullHistory = mode === 'SCORES' || mode === 'LEAGUE_STATS';
              const response = await fetchUpcomingGames(tab as Sport, needsFullHistory, { forceLiveRefresh });
              fetchedGames = response.games;
              leagueActivityUpdates[tab as Sport] = {
                  seasonState: response.seasonState || (response.isSeasonActive ? 'in_season' : 'offseason'),
                  hasLiveEvent: Boolean(response.hasLiveEvent || response.games.some((game) => game.status === 'in_progress')),
                  nextEventDate: response.nextEventDate,
              };
            }
      
            if (requestVersion !== loadRequestVersionRef.current) return;
            setGames(fetchedGames);
            upsertGamesInRegistry(fetchedGames);
            if (Object.keys(leagueActivityUpdates).length > 0) {
                setLeagueActivity((prev) => ({ ...prev, ...leagueActivityUpdates }));
            }

	            if (isTabSwitch.current && !isBackground) {
	                const hasLive = fetchedGames.some(g => g.status === 'in_progress');
	                if (mode === 'LIVE' && !hasLive) {
	                    setViewMode('UPCOMING');
                      setNavigatedGameId(null);
	                    isTabSwitch.current = false;
	                } else {
	                    isTabSwitch.current = false;
	                }
	            }

            if (isBackground && activeRequestId.current) {
                const liveGame = fetchedGames.find(g => g.id === activeRequestId.current);
                if (liveGame && liveGame.status === 'in_progress') {
                    try {
                        if (RACING_LEAGUES.includes(liveGame.league as Sport)) {
                            const bundle = await fetchRacingEventBundle(liveGame.league as Sport, liveGame.id);
                            if (requestVersion !== loadRequestVersionRef.current) return;
                            if (activeRequestId.current === liveGame.id) {
                                setRacingEventBundle(bundle);
                            }
                            return;
                        }
                        const detailVersion = bumpLiveDetailVersion(liveGame.id);
                        const details = await fetchGameDetails(liveGame.id, liveGame.league as Sport);
                        if (requestVersion !== loadRequestVersionRef.current) return;
                        if (!isLiveDetailVersionCurrent(liveGame.id, detailVersion)) return;
                        const { calculateWinProbability } = await loadProbabilityModule();
                        const stats = calculateWinProbability(liveGame, details, { latencyMode: 'background' });
                        
                        if (activeRequestId.current === liveGame.id) {
                            setPrediction(prev => prev ? { ...prev, stats } : { analysis: [], stats, groundingChunks: [] });
                            
                            if (details) {
                                setGameDetails(details);
                                setGames(prev => prev.map(g => {
                                    if (g.id === liveGame.id) {
                                        return {
                                            ...g,
                                            clock: details.clock,
                                            period: details.period,
                                            homeScore: details.homeScore,
                                            awayScore: details.awayScore,
                                            situation: details.situation || g.situation
                                        };
                                    }
                                    return g;
                                }));
                                
                                setSelectedGame(prev => prev ? {
                                    ...prev,
                                    clock: details.clock,
                                    period: details.period,
                                    homeScore: details.homeScore,
                                    awayScore: details.awayScore,
                                    situation: details.situation || prev.situation
                                } : null);
                                upsertGamesInRegistry([{
                                    ...liveGame,
                                    clock: details.clock,
                                    period: details.period,
                                    homeScore: details.homeScore,
                                    awayScore: details.awayScore,
                                    situation: details.situation || liveGame.situation,
                                }]);
                            }
                        }
                    } catch (err) {
                        console.error("Failed to auto-update live game prediction", err);
                    }
                }
            }
        }
    } catch (e) {
      console.error(e);
      if (!isBackground) {
         setError("Failed to connect to sports database. This may be due to network restrictions or ad blockers.");
      }
    } finally {
      if (!isBackground) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!selectedTeam) {
        const forceRefresh = forceLiveRefreshOnNextLoad.current;
        forceLiveRefreshOnNextLoad.current = false;
        loadData(selectedTab, viewMode, false, forceRefresh);
    }
    
    setSelectedGame(null);
    setPrediction(null);
    setGameDetails(null);
    setRacingEventBundle(null);
    activeRequestId.current = null;
    
    // Auto-refresh logic for Live/Scores
    const refreshIntervalMs = viewMode === 'LIVE' ? 5000 : 12000;
    const intervalId = setInterval(() => {
        if (!selectedTeam && selectedTab !== 'METHODOLOGY') {
            // Only auto-refresh if we are in a view that benefits from live updates
            if (viewMode === 'LIVE' || viewMode === 'UPCOMING') {
                const shouldForceLiveRefresh = viewMode === 'LIVE' && selectedTab !== 'HOME';
                loadData(selectedTab, viewMode, true, shouldForceLiveRefresh);
            }
        }
    }, refreshIntervalMs);

    return () => clearInterval(intervalId);
  }, [selectedTab, viewMode, favoriteLeagues, standingsType, selectedTeam]); 

  useEffect(() => {
      if (selectedTab === 'HOME' || selectedTab === 'METHODOLOGY') return;
      if (!RACING_LEAGUES.includes(selectedTab as Sport)) return;
      if (!RACING_VIEW_BLOCKLIST.includes(viewMode)) return;
      setViewMode('LIVE');
      setSelectedTeam(null);
      setNavigatedGameId(null);
  }, [selectedTab, viewMode]);

  useEffect(() => {
      if (!selectedRacingDriver) return;
      if (selectedTab === 'HOME' || selectedTab === 'METHODOLOGY') return;
      if (selectedTab !== selectedRacingDriver.sport) {
          setSelectedRacingDriver(null);
          setRacingDriverSeason(null);
      }
  }, [selectedTab, selectedRacingDriver?.sport]);

  const handleTabChange = (tab: Tab) => {
      const isRepeatSelection = tab === selectedTab && !selectedTeam && viewMode === 'LIVE';
      forceLiveRefreshOnNextLoad.current = true;
      setSelectedTab(tab);
      setViewMode('LIVE');
      setIsMenuOpen(false);
      setSelectedTeam(null);
      setNavigatedGameId(null);
      setSelectedRacingDriver(null);
      setRacingDriverSeason(null);
      setIsFilterDropdownOpen(false);
      isTabSwitch.current = true;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (isRepeatSelection) {
          forceLiveRefreshOnNextLoad.current = false;
          loadData(tab, 'LIVE', false, true);
      }
  };

  const handleRacingDriverClick = useCallback((sport: Sport, driverId: string, driverName: string) => {
      setSelectedRacingDriver((prev) => {
          if (prev && prev.sport === sport && prev.driverId === driverId) {
              return null;
          }
          return { sport, driverId, driverName };
      });
  }, []);

  const handleGameToggle = async (game: Game) => {
      if (selectedGame?.id === game.id) {
          setNavigatedGameId(null);
          setSelectedGame(null);
          setPrediction(null);
          setGameDetails(null);
          setRacingEventBundle(null);
          activeRequestId.current = null;
      } else {
          const isRacingGame = RACING_LEAGUES.includes(game.league as Sport);
          if (!selectedTeam && selectedTab !== 'HOME' && selectedTab !== 'METHODOLOGY') {
              const selectedGameSeason = getSeasonKeyForGame(game, selectedTab as Sport);
              if (selectedGameSeason !== 'unknown') {
                  setSelectedLeagueSeasonKey(selectedGameSeason);
              }
          }
          setNavigatedGameId(game.id);
          setSelectedGame(game);
          upsertGamesInRegistry([game]);
          setPrediction(null);
          setGameDetails(null);
          setRacingEventBundle(null);
          activeRequestId.current = game.id;

          if (isRacingGame) {
              setIsPredicting(true);
              try {
                  const bundle = await fetchRacingEventBundle(game.league as Sport, game.id);
                  if (activeRequestId.current === game.id) {
                      setRacingEventBundle(bundle);
                      setPrediction(null);
                      setGameDetails(null);
                  }
              } catch (e) {
                  console.error(e);
              } finally {
                  if (activeRequestId.current === game.id) {
                      setIsPredicting(false);
                  }
              }
              return;
          }

          const cached = predictionCache.current.get(game.id);
          const cachedDetails = cached?.details || null;

          if (cached) {
              setPrediction(cached?.prediction || null);
              setGameDetails(cachedDetails);
              
              if (cachedDetails?.odds) {
                  setSelectedGame(prev => prev ? { ...prev, odds: cachedDetails.odds } : null);
              }
              
              // Force recomputation for scheduled/finished games when model version changed
              // so stale predictions cannot persist across probability-engine updates.
              const cacheIsCurrent = cached?.modelVersion === PREDICTION_MODEL_VERSION;
              const hasUsableFinishedDetails = hasRenderableGameDetails(cachedDetails);
              const canSkipFetch =
                  game.status !== 'in_progress' &&
                  cacheIsCurrent &&
                  (game.status !== 'finished' || hasUsableFinishedDetails);
              if (canSkipFetch) return;
          }

          setIsPredicting(true);
          try {
              const detailVersion = bumpLiveDetailVersion(game.id);
              const fetchedDetails = await fetchGameDetails(game.id, game.league as Sport);
              const details = fetchedDetails || cachedDetails;
              if (activeRequestId.current !== game.id) return;
              if (!isLiveDetailVersionCurrent(game.id, detailVersion)) return;
              setGameDetails(details);
              
              if (details) {
                  const updatedOdds = details.odds || game.odds;
                  setGames(prev => prev.map(g => {
                      if (g.id === game.id) {
                          return {
                              ...g,
                              clock: details.clock,
                              period: details.period,
                              homeScore: details.homeScore,
                              awayScore: details.awayScore,
                              situation: details.situation || g.situation,
                              odds: updatedOdds
                          };
                      }
                      return g;
                  }));
                  
                  setSelectedGame(prev => prev ? {
                      ...prev,
                      clock: details.clock,
                      period: details.period,
                      homeScore: details.homeScore,
                      awayScore: details.awayScore,
                      situation: details.situation || prev.situation,
                      odds: updatedOdds
                  } : null);
                  upsertGamesInRegistry([{
                      ...game,
                      clock: details.clock,
                      period: details.period,
                      homeScore: details.homeScore,
                      awayScore: details.awayScore,
                      situation: details.situation || game.situation,
                      odds: updatedOdds,
                  }]);
              }
              
              const gameWithLatestOdds = { ...game, odds: details?.odds || game.odds };

              if (game.status !== 'finished') {
                  const { calculateWinProbability } = await loadProbabilityModule();
                  const stats = calculateWinProbability(gameWithLatestOdds, details, { latencyMode: 'interactive' });
                  const result = { analysis: [], stats, groundingChunks: [] };
                  
                  if (activeRequestId.current === game.id) {
                      setPrediction(result);
                      predictionCache.current.set(game.id, {
                        prediction: result,
                        details,
                        modelVersion: PREDICTION_MODEL_VERSION,
                      });
                  }
              } else {
                  if (activeRequestId.current === game.id) {
                      setPrediction(null);
                      predictionCache.current.set(game.id, {
                        prediction: null,
                        details,
                        modelVersion: PREDICTION_MODEL_VERSION,
                      });
                  }
              }
          } catch (e) {
              console.error(e);
              if (activeRequestId.current === game.id && cachedDetails) {
                  setGameDetails(cachedDetails);
              }
          } finally {
              if (activeRequestId.current === game.id) {
                  setIsPredicting(false);
              }
          }
      }
  };

  useEffect(() => {
      if (!navigatedGameId || selectedTab === 'METHODOLOGY') return;

      const sourceGames = selectedTeam
        ? teamSchedule
        : viewMode === 'BRACKET'
          ? bracketGames
          : games;

      if (sourceGames.length === 0) return;

      const targetGame = sourceGames.find(game => game.id === navigatedGameId);
      if (!targetGame) return;
      if (selectedGame?.id === targetGame.id) return;

      handleGameToggle(targetGame);
  }, [
      navigatedGameId,
      selectedTab,
      selectedTeam?.id,
      viewMode,
      games,
      bracketGames,
      teamSchedule,
      selectedGame?.id,
  ]);

  const handleTeamClick = (teamId: string, league: Sport) => {
      if (RACING_LEAGUES.includes(league)) return;
      setNavigatedGameId(null);
      setSelectedTeam({ id: teamId, league });
      setIsMenuOpen(false);
  };

  const handleGenerateAnalysis = async () => {
    if (!selectedGame || !prediction) return;
    setIsPredicting(true);
    try {
        const { analysis, groundingChunks } = await generateAIAnalysis(selectedGame, prediction.stats);
        setPrediction(prev => prev ? { ...prev, analysis, groundingChunks } : null);
    } catch(e) { console.error(e); }
    finally { setIsPredicting(false); }
  };

  const navigateToTeam = (team: TeamOption) => {
      handleTeamClick(team.id, team.league);
  };

  const toggleFavoriteTeam = (team: TeamOption, e: React.MouseEvent) => {
      e.stopPropagation();
      const teamStr = JSON.stringify({
          id: team.id,
          name: team.name,
          league: team.league,
          logo: team.logo
      });
      setFavoriteTeams(prev => {
          const next = new Set(prev);
          let existingStr = null;
          for (const s of Array.from(next) as string[]) {
              try {
                  const t = JSON.parse(s as string);
                  if (t.id === team.id && t.league === team.league) {
                      existingStr = s;
                      break;
                  }
              } catch(e) {}
          }

          if (existingStr) {
              next.delete(existingStr);
          } else {
              next.add(teamStr);
          }
          return next;
      });
  };

  const isTeamFavorite = (teamId: string, league: Sport) => {
      for (const s of Array.from(favoriteTeams) as string[]) {
          try {
              const t = JSON.parse(s);
              if (t.id === teamId && t.league === league) return true;
          } catch(e) {}
      }
      return false;
  };

  const toggleFavoriteLeague = (sport: Sport, e: React.MouseEvent) => {
      e.stopPropagation();
      setFavoriteLeagues(prev => {
          const next = new Set(prev);
          if (next.has(sport)) {
              next.delete(sport);
          } else {
              next.add(sport);
          }
          return next;
      });
  };

  const filteredLeagues = useMemo(() => {
    if (!teamSearchTerm) return [];
    const search = teamSearchTerm.toLowerCase();
    return SPORTS.filter(s => s.toLowerCase().includes(search));
  }, [teamSearchTerm]);

  const filteredTeams: TeamOption[] = useMemo(() => {
    if (!teamSearchTerm) return [];
    const search = teamSearchTerm.toLowerCase();
    return (Array.from(allTeams.values()) as TeamOption[]).filter(team => {
      return team.name.toLowerCase().includes(search);
    }).slice(0, 50);
  }, [teamSearchTerm, allTeams]);

  const menuTeamResults = useMemo(() => {
    if (!menuSearchTerm) return [];
    const search = menuSearchTerm.toLowerCase();
    return (Array.from(allTeams.values()) as TeamOption[]).filter(team => {
      return team.name.toLowerCase().includes(search);
    }).slice(0, 15);
  }, [menuSearchTerm, allTeams]);

  const parsedFavoriteTeams = useMemo(() => {
    return (Array.from(favoriteTeams) as string[])
      .map((s) => {
        try {
          return JSON.parse(s as string) as TeamOption;
        } catch {
          return null;
        }
      })
      .filter((t): t is TeamOption => t !== null);
  }, [favoriteTeams]);

  const onboardingTeamResults = useMemo(() => {
      const query = onboardingTeamSearch.trim().toLowerCase();
      if (!query) return [] as TeamOption[];
      return (Array.from(allTeams.values()) as TeamOption[])
          .filter((team) => {
              const matchesName = team.name.toLowerCase().includes(query);
              const matchesLeague = team.league.toLowerCase().includes(query);
              const inSelectedLeague = onboardingLeagues.size === 0 || onboardingLeagues.has(team.league);
              return inSelectedLeague && (matchesName || matchesLeague);
          })
          .slice(0, 24);
  }, [allTeams, onboardingTeamSearch, onboardingLeagues]);

  const onboardingTeamKeySet = useMemo(() => {
      const keySet = new Set<string>();
      (Array.from(onboardingTeams) as string[]).forEach((entry) => {
          try {
              const parsed = JSON.parse(entry) as TeamOption;
              if (parsed?.id && parsed?.league) keySet.add(`${parsed.league}|${parsed.id}`);
          } catch {
          }
      });
      return keySet;
  }, [onboardingTeams]);

  const isOnboardingTeamSelected = useCallback((teamId: string, league: Sport) => {
      return onboardingTeamKeySet.has(`${league}|${teamId}`);
  }, [onboardingTeamKeySet]);

  const toggleOnboardingLeague = useCallback((league: Sport) => {
      setOnboardingLeagues((prev) => {
          const next = new Set(prev);
          if (next.has(league)) next.delete(league);
          else next.add(league);
          return next;
      });
  }, []);

  const toggleOnboardingTeam = useCallback((team: TeamOption) => {
      const teamStr = JSON.stringify({
          id: team.id,
          name: team.name,
          league: team.league,
          logo: team.logo
      });
      setOnboardingTeams((prev) => {
          const next = new Set(prev);
          let existingStr: string | null = null;
          for (const entry of Array.from(next) as string[]) {
              try {
                  const parsed = JSON.parse(entry);
                  if (parsed.id === team.id && parsed.league === team.league) {
                      existingStr = entry;
                      break;
                  }
              } catch {
              }
          }
          if (existingStr) next.delete(existingStr);
          else next.add(teamStr);
          return next;
      });
  }, []);

  const completeOnboarding = useCallback(() => {
      if (onboardingLeagues.size === 0) return;
      setFavoriteLeagues(new Set(onboardingLeagues));
      setFavoriteTeams(new Set(onboardingTeams));
      markOnboardingComplete(user?.sub);
      setOnboardingTeamSearch('');
      setIsOnboardingOpen(false);
  }, [onboardingLeagues, onboardingTeams, user?.sub]);

  const useAllLeaguesForOnboarding = useCallback(() => {
      const all = new Set<Sport>(SPORTS);
      setOnboardingLeagues(all);
      setFavoriteLeagues(all);
      setFavoriteTeams(new Set(onboardingTeams));
      markOnboardingComplete(user?.sub);
      setOnboardingTeamSearch('');
      setIsOnboardingOpen(false);
  }, [onboardingTeams, user?.sub]);

  const favoriteTeamKeySet = useMemo(() => {
    const keys = new Set<string>();
    parsedFavoriteTeams.forEach((team) => {
      keys.add(`${team.league}|${team.id}`);
    });
    return keys;
  }, [parsedFavoriteTeams]);

  const autoFollowGameIds = useMemo(() => {
    const ids = new Set<string>();
    gameRegistry.forEach((game) => {
      if (game.status === 'finished') return;
      const league = game.league as Sport;
      const homeKey = game.homeTeamId ? `${league}|${game.homeTeamId}` : '';
      const awayKey = game.awayTeamId ? `${league}|${game.awayTeamId}` : '';
      if ((homeKey && favoriteTeamKeySet.has(homeKey)) || (awayKey && favoriteTeamKeySet.has(awayKey))) {
        ids.add(game.id);
      }
    });
    return ids;
  }, [gameRegistry, favoriteTeamKeySet]);

  const followedGamesForBar = useMemo(() => {
    const ids = new Set<string>([...Array.from(followedGames), ...Array.from(autoFollowGameIds)]);
    const tracked = new Map(gameRegistry);
    if (selectedGame) tracked.set(selectedGame.id, selectedGame);
    games.forEach((game) => {
      const existing = tracked.get(game.id);
      tracked.set(game.id, existing ? { ...existing, ...game } : game);
    });
    teamSchedule.forEach((game) => {
      const existing = tracked.get(game.id);
      tracked.set(game.id, existing ? { ...existing, ...game } : game);
    });

    return Array.from(ids)
      .map((id) => tracked.get(id))
      .filter((game): game is Game => Boolean(game) && game.status !== 'finished')
      .sort((a, b) => {
        const aLive = a.status === 'in_progress' ? 0 : 1;
        const bLive = b.status === 'in_progress' ? 0 : 1;
        if (aLive !== bLive) return aLive - bLive;
        return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
      });
  }, [autoFollowGameIds, followedGames, gameRegistry, games, selectedGame, teamSchedule]);

  const isGameFollowed = useCallback((game: Game) => {
    return followedGames.has(game.id) || autoFollowGameIds.has(game.id);
  }, [followedGames, autoFollowGameIds]);

  const toggleFollowGame = useCallback((game: Game, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFollowedGames((prev) => {
      const next = new Set(prev);
      if (next.has(game.id)) next.delete(game.id);
      else next.add(game.id);
      return next;
    });
    setIsFollowingBarOpen(true);
    upsertGamesInRegistry([game]);
  }, [upsertGamesInRegistry]);

  const openFollowedGame = useCallback((game: Game) => {
    forceLiveRefreshOnNextLoad.current = true;
    setIsMenuOpen(false);
    setSelectedTeam(null);
    const targetLeague = SPORTS.includes(game.league as Sport) ? (game.league as Sport) : 'HOME';
    setSelectedTab(targetLeague);
    setViewMode(game.status === 'in_progress' ? 'LIVE' : 'UPCOMING');
    setNavigatedGameId(game.id);
    if (selectedGame?.id !== game.id) {
      handleGameToggle(game);
    }
  }, [handleGameToggle, selectedGame?.id]);

  const closeActiveGameButKeepFollowing = useCallback(() => {
    setNavigatedGameId(null);
    setSelectedGame(null);
    setPrediction(null);
    setGameDetails(null);
    setRacingEventBundle(null);
    activeRequestId.current = null;
  }, []);

  const leagueSeasonOptions = useMemo(() => {
      if (selectedTab === 'HOME' || selectedTab === 'METHODOLOGY') return [];
      return listSeasonOptionsFromGames(games, selectedTab as Sport);
  }, [games, selectedTab]);

  const effectiveLeagueSeasonKey = useMemo(() => {
      if (selectedTab === 'HOME' || selectedTab === 'METHODOLOGY') return null;
      if (
          selectedLeagueSeasonKey &&
          leagueSeasonOptions.some((option) => option.key === selectedLeagueSeasonKey)
      ) {
          return selectedLeagueSeasonKey;
      }
      return leagueSeasonOptions[0]?.key ?? null;
  }, [selectedTab, selectedLeagueSeasonKey, leagueSeasonOptions]);

  const selectedLeagueSeasonYear = useMemo(() => {
      if (!effectiveLeagueSeasonKey) return undefined;
      const parsed = Number(effectiveLeagueSeasonKey);
      if (!Number.isFinite(parsed)) return undefined;
      return Math.trunc(parsed);
  }, [effectiveLeagueSeasonKey]);

  useEffect(() => {
      if (selectedTab === 'HOME' || selectedTab === 'METHODOLOGY') {
          if (selectedLeagueSeasonKey !== null) setSelectedLeagueSeasonKey(null);
          return;
      }
      if (leagueSeasonOptions.length === 0) {
          if (selectedLeagueSeasonKey !== null) setSelectedLeagueSeasonKey(null);
          return;
      }
      const hasSelected =
          selectedLeagueSeasonKey &&
          leagueSeasonOptions.some((option) => option.key === selectedLeagueSeasonKey);
      if (!hasSelected) {
          setSelectedLeagueSeasonKey(leagueSeasonOptions[0].key);
      }
  }, [selectedTab, selectedLeagueSeasonKey, leagueSeasonOptions]);

  const seasonScopedGames = useMemo(() => {
      if (selectedTab === 'HOME' || selectedTab === 'METHODOLOGY') return games;
      if (!effectiveLeagueSeasonKey) return games;
      return games.filter((game) => getSeasonKeyForGame(game, selectedTab as Sport) === effectiveLeagueSeasonKey);
  }, [games, selectedTab, effectiveLeagueSeasonKey]);

  const availableConferencesList = useMemo(() => {
      if (!RANKED_LEAGUES.includes(selectedTab as Sport)) return [];
      
      if (viewMode === 'STANDINGS' || viewMode === 'TEAMS' || viewMode === 'LEAGUE_STATS') {
          return standings.map(g => g.name).sort();
      } else {
          if (conferenceMap.size === 0) return [];
          const confSet = new Set<string>();
          seasonScopedGames.forEach(g => {
              if (g.homeTeamId && conferenceMap.has(g.homeTeamId)) confSet.add(conferenceMap.get(g.homeTeamId)!);
              if (g.awayTeamId && conferenceMap.has(g.awayTeamId)) confSet.add(conferenceMap.get(g.awayTeamId)!);
          });
          return Array.from(confSet).sort();
      }
  }, [seasonScopedGames, standings, conferenceMap, selectedTab, viewMode]);

  const finalDisplayGames = useMemo(() => {
      let next = seasonScopedGames;

      if (viewMode === 'LIVE') {
          next = seasonScopedGames.filter((g) => g.status === 'in_progress');
      } else if (viewMode === 'UPCOMING') {
          next = seasonScopedGames
              .filter((g) => g.status === 'scheduled')
              .sort((a, b) => {
                  if (a.isPlayoff !== b.isPlayoff) return a.isPlayoff ? -1 : 1;
                  return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
              });
      } else if (viewMode === 'SCORES') {
          next = seasonScopedGames
              .filter((g) => g.status === 'finished')
              .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
      }

      if (selectedTab !== 'HOME' && viewMode !== 'STANDINGS' && viewMode !== 'TEAMS' && viewMode !== 'LEAGUE_STATS') {
          if (RANKED_LEAGUES.includes(selectedTab as Sport)) {
              if (activeFilter === 'TOP25') {
                  if (top25RankedTeamIds.size > 0) {
                      next = next.filter((g) => {
                          const homeId = g.homeTeamId ? String(g.homeTeamId) : '';
                          const awayId = g.awayTeamId ? String(g.awayTeamId) : '';
                          return top25RankedTeamIds.has(homeId) || top25RankedTeamIds.has(awayId);
                      });
                  } else {
                      next = next.filter((g) => (g.homeTeamRank && g.homeTeamRank <= 25) || (g.awayTeamRank && g.awayTeamRank <= 25));
                  }
              } else if (activeFilter !== 'ALL') {
                  next = next.filter((g) => {
                      const homeConf = g.homeTeamId ? conferenceMap.get(g.homeTeamId) : undefined;
                      const awayConf = g.awayTeamId ? conferenceMap.get(g.awayTeamId) : undefined;
                      return homeConf === activeFilter || awayConf === activeFilter;
                  });
              }
          }
      }

      return next;
  }, [seasonScopedGames, viewMode, selectedTab, activeFilter, top25RankedTeamIds, conferenceMap]);

  const displayStandings = useMemo(() => {
      let next = standings;
      if ((viewMode === 'STANDINGS' || viewMode === 'TEAMS' || viewMode === 'LEAGUE_STATS') && RANKED_LEAGUES.includes(selectedTab as Sport) && activeFilter !== 'ALL') {
          if (activeFilter === 'TOP25') {
              next = standings.map((group) => ({
                  ...group,
                  standings: group.standings.filter((s) => top25RankedTeamIds.has(String(s.team.id))),
              })).filter((group) => group.standings.length > 0);
          } else {
              next = standings.filter((group) => group.name === activeFilter);
          }
      }
      return next;
  }, [standings, viewMode, selectedTab, activeFilter, top25RankedTeamIds]);

  useEffect(() => {
      setVisibleGameCount(GAME_RENDER_BATCH);
  }, [selectedTab, viewMode, activeFilter, selectedTeam?.id, selectedTeam?.league, effectiveLeagueSeasonKey]);

  useEffect(() => {
      if (!selectedGame) return;
      const selectedIndex = finalDisplayGames.findIndex((game) => game.id === selectedGame.id);
      if (selectedIndex >= 0 && selectedIndex + 1 > visibleGameCount) {
          const nextBatch = Math.ceil((selectedIndex + 1) / GAME_RENDER_BATCH) * GAME_RENDER_BATCH;
          setVisibleGameCount(nextBatch);
      }
  }, [selectedGame?.id, finalDisplayGames, visibleGameCount]);

  const visibleGames = useMemo(
      () => finalDisplayGames.slice(0, visibleGameCount),
      [finalDisplayGames, visibleGameCount],
  );
  const hasMoreGames = visibleGames.length < finalDisplayGames.length;

  const currentLeagueLogo = useMemo(
      () => (
          selectedTab !== 'HOME' && selectedTab !== 'METHODOLOGY'
              ? games.find((g) => g.league === selectedTab)?.leagueLogo
              : undefined
      ),
      [selectedTab, games],
  );

  const playoffGames = useMemo(() => visibleGames.filter((g) => g.isPlayoff), [visibleGames]);
  const regularGames = useMemo(() => visibleGames.filter((g) => !g.isPlayoff), [visibleGames]);

  const hasPlayoffs = playoffGames.length > 0;
  const hasRegular = regularGames.length > 0;
  const showRankedFilterBar =
      RANKED_LEAGUES.includes(selectedTab as Sport) &&
      selectedTab !== 'HOME' &&
      ['LIVE', 'UPCOMING', 'SCORES', 'STANDINGS', 'LEAGUE_STATS'].includes(viewMode);
  const showSeasonSelector =
      selectedTab !== 'HOME' &&
      selectedTab !== 'METHODOLOGY' &&
      ['LIVE', 'UPCOMING', 'SCORES', 'LEAGUE_STATS'].includes(viewMode) &&
      leagueSeasonOptions.length > 0;

  const renderGameList = (gamesToRender: Game[]) => (
      <div className={`grid gap-4 transition-all duration-500 ${selectedGame ? 'grid-cols-1 max-w-3xl mx-auto' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
         {gamesToRender.map((game, index) => {
             const isSelected = selectedGame?.id === game.id;
             
             const currentLabel = viewMode === 'SCORES' 
                ? getScoreGroupLabel(game) 
                : game.date;
             
             const prevGame = index > 0 ? gamesToRender[index - 1] : null;
             const prevLabel = prevGame 
                ? (viewMode === 'SCORES' ? getScoreGroupLabel(prevGame) : prevGame.date) 
                : null;

             const showHeader = (viewMode === 'UPCOMING' || viewMode === 'SCORES') && (index === 0 || currentLabel !== prevLabel);
             
             return (
             <React.Fragment key={game.id}>
                 {showHeader && (
                     <div className="col-span-full pt-6 pb-2 first:pt-0">
                         <div className="flex items-center gap-3">
                             <div className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400">
                                <Calendar size={14} />
                             </div>
                             <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                                 {currentLabel}
                             </h3>
                             <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800/60"></div>
                         </div>
                     </div>
                 )}
                 <div id={`game-card-${game.id}`} className={`transition-all duration-500 ${isSelected ? 'col-span-1' : ''}`}>
                     <GameCard 
                         game={game} 
                         onSelect={handleGameToggle} 
                         isSelected={isSelected} 
                         onTeamClick={RACING_LEAGUES.includes(game.league as Sport) ? undefined : handleTeamClick}
                         isFollowed={isGameFollowed(game)}
                         onToggleFollow={toggleFollowGame}
                     />
                     
                     {isSelected && (
                        <div className="relative mt-4 pl-4 sm:pl-6 sm:ml-4 border-l-2 border-slate-200 dark:border-slate-800 animate-fade-in">
                             <div className="absolute -left-[9px] -top-4 w-4 h-8 rounded-bl-xl border-l-2 border-b-0 border-slate-200 dark:border-slate-800 bg-transparent opacity-0"></div>
                             
                             {RACING_LEAGUES.includes(game.league as Sport) ? (
                                 <div className="space-y-4">
                                     <RacingEventPanel
                                         event={racingEventBundle}
                                         isLoading={isPredicting}
                                         selectedDriverId={selectedRacingDriver?.driverId || null}
                                         onDriverClick={handleRacingDriverClick}
                                     />
                                     {selectedRacingDriver && selectedRacingDriver.sport === (game.league as Sport) && (
                                         <RacingDriverSeasonPanel
                                             data={racingDriverSeason}
                                             isLoading={isRacingDriverLoading}
                                             onClose={() => {
                                                 setSelectedRacingDriver(null);
                                                 setRacingDriverSeason(null);
                                             }}
                                         />
                                     )}
                                 </div>
                             ) : isPredicting ? (
                                 <div className="bg-white dark:bg-slate-900/60 rounded-3xl p-12 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center shadow-xl">
                                     <Loader2 size={48} className="text-slate-500 animate-spin mb-6" />
                                     <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 font-display">Loading Data</h3>
                                     <p className="text-slate-500 dark:text-slate-400 max-w-xs">
                                         Retrieving game details...
                                     </p>
                                 </div>
                             ) : selectedGame.status === 'finished' ? (
                                  <LiveGameView 
                                     game={selectedGame}
                                     gameDetails={gameDetails}
                                     prediction={null} 
                                     isDarkMode={isDarkMode}
                                     onGenerateAnalysis={handleGenerateAnalysis}
                                     onTeamClick={handleTeamClick}
                                  />
                             ) : prediction ? (
                                selectedGame.status === 'scheduled' ? (
                                     <PredictionView 
                                        game={selectedGame} 
                                        prediction={prediction} 
                                        isDarkMode={isDarkMode} 
                                        onGenerateAnalysis={handleGenerateAnalysis}
                                        gameDetails={gameDetails}
                                        onTeamClick={handleTeamClick}
                                     />
                                ) : (
                                     <LiveGameView 
                                        game={selectedGame}
                                        gameDetails={gameDetails}
                                        prediction={prediction} 
                                        isDarkMode={isDarkMode}
                                        onGenerateAnalysis={handleGenerateAnalysis}
                                        onTeamClick={handleTeamClick}
                                     />
                                )
                             ) : (
                                 <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center">
                                     <p>Unable to load data.</p>
                                 </div>
                             )}
                         </div>
                     )}
                 </div>
             </React.Fragment>
             );
         })}
     </div>
  );

  return (
    <div className="min-h-screen transition-colors duration-300 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans selection:bg-slate-500/30">
      <Navbar 
        selectedTab={selectedTab}
        favoriteLeagues={favoriteLeagues}
        onTabChange={handleTabChange}
        onSearchClick={() => setIsSearchOpen(true)}
        onMenuClick={() => setIsMenuOpen(true)}
        followingContent={
          <FollowingBar
            games={followedGamesForBar}
            isOpen={isFollowingBarOpen}
            selectedGameId={selectedGame?.id || null}
            onOpen={() => setIsFollowingBarOpen(true)}
            onClose={() => setIsFollowingBarOpen(false)}
            onGameClick={openFollowedGame}
            onCloseActiveGame={closeActiveGameButKeepFollowing}
          />
        }
      />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
         {selectedTeam ? (
             <div>
	                <button 
	                    onClick={() => {
                        forceLiveRefreshOnNextLoad.current = true;
                        setSelectedTeam(null);
                        setNavigatedGameId(null);
                      }}
	                    className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
	                >
                    Back to Dashboard
                </button>
                {isTeamLoading ? (
                    <div className="flex flex-col items-center justify-center py-24">
                        <Loader2 size={40} className="text-slate-500 animate-spin mb-4" />
                        <p className="text-slate-500 font-medium">Analyzing Team Data...</p>
                    </div>
                ) : teamProfile ? (
                    <TeamDetailView 
                        team={teamProfile} 
                        schedule={teamSchedule} 
                        league={selectedTeam.league}
                        onGameSelect={handleGameToggle}
                        selectedGameId={selectedGame?.id}
                        prediction={prediction}
                        gameDetails={gameDetails}
                        isPredicting={isPredicting}
                        isDarkMode={isDarkMode}
                        onGenerateAnalysis={handleGenerateAnalysis}
                        onTeamClick={handleTeamClick}
                        isGameFollowed={isGameFollowed}
                        onToggleFollowGame={toggleFollowGame}
                    />
                ) : (
                    <div className="text-center py-20 text-slate-500">Failed to load team data.</div>
                )}
             </div>
         ) : selectedTab === 'METHODOLOGY' ? (
             <MethodologyView />
         ) : (
             <div className="animate-fade-in">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                     <div className="flex items-center gap-4">
                         {currentLeagueLogo && (
                             <img src={currentLeagueLogo} alt="" className="w-12 h-12 object-contain" />
                         )}
                         <div>
                             <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                                 {selectedTab === 'HOME' ? 'Dashboard' : selectedTab}
                             </h1>
                             <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                                 {selectedTab === 'HOME' ? 'Live & Upcoming Action' : 
                                  viewMode === 'STANDINGS' && SOCCER_LEAGUES.includes(selectedTab as Sport) ? 'League Table' :
                                  viewMode === 'LEAGUE_STATS' ? 'Season Statistics' :
                                  `${viewMode === 'LIVE' ? 'Live Games' : viewMode === 'UPCOMING' ? 'Scheduled Matchups' : viewMode === 'SCORES' ? 'Final Scores' : viewMode === 'CALENDAR' ? 'Season Calendar' : viewMode === 'TEAMS' ? 'Team Directory' : viewMode.charAt(0) + viewMode.slice(1).toLowerCase()}`}
                             </p>
                         </div>
                     </div>

	                     <ViewSelector 
	                        viewMode={viewMode}
	                        selectedTab={selectedTab}
	                        setViewMode={(mode) => {
                                forceLiveRefreshOnNextLoad.current = true;
                                setViewMode(mode);
                                setSelectedGame(null);
                                setNavigatedGameId(null);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                if (mode === viewMode && !selectedTeam && selectedTab !== 'METHODOLOGY') {
                                    forceLiveRefreshOnNextLoad.current = false;
                                    loadData(selectedTab, mode, false, true);
                                }
                            }}
	                     />
                 </div>

                 {error && (
                     <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-slate-800 p-4 rounded-xl text-center mb-8">
                         <p className="text-rose-600 dark:text-rose-400 text-sm font-medium">{error}</p>
                     </div>
                 )}

                 {(showRankedFilterBar || showSeasonSelector) && (
                     <div className="mb-6 flex flex-wrap items-center gap-3">
                         {showRankedFilterBar && (
                             <FilterBar 
                                activeFilter={activeFilter}
                                setActiveFilter={setActiveFilter}
                                availableConferences={availableConferencesList}
                                isOpen={isFilterDropdownOpen}
                                setIsOpen={setIsFilterDropdownOpen}
                             />
                         )}
                         {showSeasonSelector && (
                             <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                 <span className="uppercase tracking-wider text-slate-500 dark:text-slate-400">Season</span>
                                 <select
                                     className="bg-transparent border-0 focus:outline-none focus:ring-0 font-bold text-slate-900 dark:text-white cursor-pointer"
                                     value={effectiveLeagueSeasonKey ?? ''}
                                     onChange={(e) => setSelectedLeagueSeasonKey(e.target.value || null)}
                                 >
                                     {leagueSeasonOptions.map((option) => (
                                         <option key={option.key} value={option.key}>
                                             {option.label}
                                         </option>
                                     ))}
                                 </select>
                             </label>
                         )}
                     </div>
                 )}

                 {/* CONTENT AREA */}
                 {viewMode === 'STANDINGS' ? (
                     RACING_LEAGUES.includes(selectedTab as Sport) ? (
                         <div className="space-y-6">
                             <RacingStandingsView
                                sport={selectedTab as Sport}
                                standings={racingStandings}
                                isLoading={isLoading}
                                selectedDriverId={selectedRacingDriver?.driverId || null}
                                onDriverClick={handleRacingDriverClick}
                             />
                             {selectedRacingDriver && selectedRacingDriver.sport === (selectedTab as Sport) && (
                                <RacingDriverSeasonPanel
                                    data={racingDriverSeason}
                                    isLoading={isRacingDriverLoading}
                                    onClose={() => {
                                        setSelectedRacingDriver(null);
                                        setRacingDriverSeason(null);
                                    }}
                                />
                             )}
                         </div>
                     ) : (
                         <StandingsView 
                            groups={displayStandings} 
                            sport={selectedTab as Sport} 
                            activeType={standingsType} 
                            onTypeChange={setStandingsType} 
                            onTeamClick={RACING_LEAGUES.includes(selectedTab as Sport) ? undefined : handleTeamClick}
                            useApiRankForNCAA={activeFilter === 'TOP25'}
                            isLoading={isLoading}
                         />
                     )
                 ) : viewMode === 'RANKINGS' ? (
                     <StandingsView 
                        groups={standings} 
                        sport={selectedTab as Sport} 
                        type="RANKINGS" 
                        onTeamClick={RACING_LEAGUES.includes(selectedTab as Sport) ? undefined : handleTeamClick}
                        isLoading={isLoading}
                     />
                 ) : viewMode === 'BRACKET' ? (
                     <div className="space-y-6">
                         <BracketView 
                            games={bracketGames} 
                            onGameSelect={handleGameToggle} 
                            selectedGameId={selectedGame?.id}
                            onTeamClick={handleTeamClick}
                         />
                         
                         {selectedGame && (
                            <div className="max-w-3xl mx-auto animate-fade-in border-t border-slate-200 dark:border-slate-800 pt-8 mt-8">
                                <div className="mb-6 flex items-center gap-3 justify-center">
                                    <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Matchup Analysis</h3>
                                    <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                                </div>
                                <div id={`game-card-${selectedGame.id}`}>
                                    <GameCard 
                                        game={selectedGame} 
                                        onSelect={() => {}} // Already selected
                                        isSelected={true} 
                                        onTeamClick={handleTeamClick}
                                        isFollowed={isGameFollowed(selectedGame)}
                                        onToggleFollow={toggleFollowGame}
                                    />
                                    <div className="relative mt-4 border-t border-slate-100 dark:border-slate-800 pt-6">
                                         {isPredicting ? (
                                             <div className="bg-white dark:bg-slate-900/60 rounded-3xl p-12 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center shadow-xl">
                                                 <Loader2 size={48} className="text-slate-500 animate-spin mb-6" />
                                                 <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 font-display">Loading Data</h3>
                                                 <p className="text-slate-500 dark:text-slate-400 max-w-xs">Retrieving game details...</p>
                                             </div>
                                         ) : selectedGame.status === 'finished' ? (
                                              <LiveGameView 
                                                 game={selectedGame}
                                                 gameDetails={gameDetails}
                                                 prediction={null} 
                                                 isDarkMode={isDarkMode}
                                                 onGenerateAnalysis={handleGenerateAnalysis}
                                                 onTeamClick={handleTeamClick}
                                              />
                                         ) : prediction ? (
                                            selectedGame.status === 'scheduled' ? (
                                                 <PredictionView 
                                                    game={selectedGame} 
                                                    prediction={prediction} 
                                                    isDarkMode={isDarkMode} 
                                                    onGenerateAnalysis={handleGenerateAnalysis}
                                                    gameDetails={gameDetails}
                                                    onTeamClick={handleTeamClick}
                                                 />
                                            ) : (
                                                 <LiveGameView 
                                                    game={selectedGame}
                                                    gameDetails={gameDetails}
                                                    prediction={prediction} 
                                                    isDarkMode={isDarkMode}
                                                    onGenerateAnalysis={handleGenerateAnalysis}
                                                    onTeamClick={handleTeamClick}
                                                 />
                                            )
                                         ) : (
                                             <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center">
                                                 <p>Unable to load data.</p>
                                             </div>
                                         )}
                                    </div>
                                </div>
                            </div>
                         )}
                     </div>
                 ) : viewMode === 'CALENDAR' ? (
                     <CalendarView 
                        sport={selectedTab as Sport}
                        onGameSelect={handleGameToggle}
                        selectedGameId={selectedGame?.id}
                        onTeamClick={handleTeamClick}
                        isGameFollowed={isGameFollowed}
                        onToggleFollowGame={toggleFollowGame}
                     />
                 ) : viewMode === 'TEAMS' ? (
                     <TeamsListView 
                        groups={standings}
                        sport={selectedTab as Sport}
                        onTeamClick={handleTeamClick}
                        isLoading={isLoading}
                     />
                 ) : viewMode === 'LEAGUE_STATS' ? (
                     <LeagueStatsView 
                        groups={displayStandings}
                        sport={selectedTab as Sport}
                        onTeamClick={handleTeamClick}
                        seasonYear={selectedLeagueSeasonYear}
                     />
                 ) : (
                     <div className="relative">
                         {isLoading ? (
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                 {[...Array(6)].map((_, i) => (
                                     <div key={i} className="h-40 bg-slate-100 dark:bg-slate-900/50 rounded-2xl animate-pulse"></div>
                                 ))}
                             </div>
                         ) : finalDisplayGames.length === 0 ? (
                             <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                                 <div className="w-16 h-16 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 dark:text-slate-600">
                                     <CalendarOff size={32} />
                                 </div>
                                 <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">No Games Found</h3>
                                 <p className="text-slate-500 dark:text-slate-400">There are no {viewMode.toLowerCase()} games available matching your {activeFilter !== 'ALL' ? activeFilter : ''} criteria.</p>
                             </div>
                         ) : (
                             <>
                                {hasPlayoffs && (
                                    <>
                                        <div className="mb-4 flex items-center gap-3">
                                            <Trophy size={16} className="text-emerald-500" />
                                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Playoffs / Tournaments</span>
                                            <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                                        </div>
                                        {renderGameList(playoffGames)}
                                    </>
                                )}

                                {hasPlayoffs && hasRegular && (
                                    <div className="my-8 flex items-center gap-3">
                                        <Calendar size={16} className="text-slate-400" />
                                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Regular Season</span>
                                        <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1"></div>
                                    </div>
                                )}

                                {hasRegular && renderGameList(regularGames)}

                                {hasMoreGames && (
                                    <div className="mt-8 flex justify-center">
                                        <button
                                            type="button"
                                            onClick={() => setVisibleGameCount((count) => count + GAME_RENDER_BATCH)}
                                            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                        >
                                            Load More Games
                                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                                ({finalDisplayGames.length - visibleGames.length} remaining)
                                            </span>
                                        </button>
                                    </div>
                                )}
                             </>
                         )}
                     </div>
                 )}
             </div>
         )}
      </main>
      
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
        onLogout={handleLogout}
        theme={theme}
        setTheme={setTheme}
        isDarkMode={isDarkMode}
      />

      <SearchModal 
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        searchTerm={teamSearchTerm}
        setSearchTerm={setTeamSearchTerm}
        filteredLeagues={filteredLeagues}
        filteredTeams={filteredTeams}
        onNavigateLeague={(sport) => { handleTabChange(sport); }}
        onNavigateTeam={navigateToTeam}
        favoriteTeams={parsedFavoriteTeams}
        isTeamFavorite={isTeamFavorite}
        toggleFavoriteTeam={toggleFavoriteTeam}
        menuSports={menuSports}
      />

      <MenuDrawer 
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        favoriteTeams={parsedFavoriteTeams}
        menuSports={menuSports}
        favoriteLeagues={favoriteLeagues}
        inactiveLeagues={inactiveLeagues}
        leagueActivity={leagueActivity}
        selectedTab={selectedTab}
        onNavigate={handleTabChange}
        onTeamClick={navigateToTeam}
        onToggleFavoriteTeam={toggleFavoriteTeam}
        onToggleFavoriteLeague={toggleFavoriteLeague}
        onOpenSettings={() => setIsSettingsOpen(true)}
        menuTeamResults={menuTeamResults}
        menuSearchTerm={menuSearchTerm}
        setMenuSearchTerm={setMenuSearchTerm}
        theme={theme}
        setTheme={setTheme}
      />

      <OnboardingModal
        isOpen={isOnboardingOpen}
        leagues={SPORTS}
        selectedLeagues={onboardingLeagues}
        onToggleLeague={toggleOnboardingLeague}
        teamSearch={onboardingTeamSearch}
        onTeamSearchChange={setOnboardingTeamSearch}
        teamResults={onboardingTeamResults}
        isTeamSelected={isOnboardingTeamSelected}
        onToggleTeam={toggleOnboardingTeam}
        onComplete={completeOnboarding}
        onUseAllLeagues={useAllLeaguesForOnboarding}
      />
    </div>
  );
};
