
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SPORTS, Sport, Game, PredictionResult, GroundingChunk, StandingsGroup, GameDetails, UserProfile, TeamOption, PredictionStats, StandingsType, TeamProfile, SOCCER_LEAGUES } from './types';
import { fetchUpcomingGames, fetchBracketGames, fetchGameDetails } from './services/gameService';
import { fetchStandings, fetchRankings, fetchTeamProfile, fetchTeamSchedule, syncFullDatabase } from './services/teamService';
import { calculateWinProbability } from './services/probabilities/index';
import { generateAIAnalysis } from './services/aiService';
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
import { Calendar, Trophy, CalendarOff, Loader2 } from 'lucide-react';
import { LOCAL_TEAMS } from './data/teams';

// Import new modular components
import { Navbar } from './components/App/Navbar';
import { ViewSelector } from './components/App/ViewSelector';
import { FilterBar } from './components/App/FilterBar';
import { MenuDrawer } from './components/App/MenuDrawer';
import { SearchModal } from './components/App/SearchModal';
import { SettingsModal } from './components/App/SettingsModal';

type Tab = Sport | 'HOME' | 'METHODOLOGY';
type ViewMode = 'LIVE' | 'UPCOMING' | 'SCORES' | 'STANDINGS' | 'BRACKET' | 'RANKINGS' | 'CALENDAR' | 'TEAMS' | 'LEAGUE_STATS';
type ThemeMode = 'light' | 'dark' | 'system';

const RANKED_LEAGUES: Sport[] = ['NCAAF', 'NCAAM', 'NCAAW'];
const PLAYOFF_LEAGUES: string[] = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAM', 'NCAAW', 'MLS', 'WNBA', 'UCL'];

// Helper to decode JWT from Google
const decodeJwt = (token: string): UserProfile | null => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload) as UserProfile;
  } catch (e) {
    console.error("Failed to decode JWT", e);
    return null;
  }
};

export const App: React.FC = () => {
  const [selectedTab, setSelectedTab] = useState<Tab>('HOME');
  const [viewMode, setViewMode] = useState<ViewMode>('LIVE');
  const [standingsType, setStandingsType] = useState<StandingsType>('PLAYOFF');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  
  // Team Page State
  const [selectedTeam, setSelectedTeam] = useState<{ id: string, league: Sport } | null>(null);
  const [teamProfile, setTeamProfile] = useState<TeamProfile | null>(null);
  const [teamSchedule, setTeamSchedule] = useState<Game[]>([]);
  const [isTeamLoading, setIsTeamLoading] = useState(false);

  // Theme State
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [isDarkMode, setIsDarkMode] = useState(true);
  
  // Auth State
  const [user, setUser] = useState<UserProfile | null>(null);
  
  // Favorites State
  const [favoriteLeagues, setFavoriteLeagues] = useState<Set<Sport>>(new Set(SPORTS));
  const [favoriteTeams, setFavoriteTeams] = useState<Set<string>>(new Set());
  
  // Team Search State
  const [teamSearchTerm, setTeamSearchTerm] = useState('');
  const [menuSearchTerm, setMenuSearchTerm] = useState('');
  const [allTeams, setAllTeams] = useState<Map<string, TeamOption>>(new Map());
  const [areTeamsLoaded, setAreTeamsLoaded] = useState(false);

  // Data State
  const [games, setGames] = useState<Game[]>([]);
  const [bracketGames, setBracketGames] = useState<Game[]>([]);
  const [standings, setStandings] = useState<StandingsGroup[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  
  const predictionCache = useRef<Map<string, { prediction: PredictionResult | null; details: GameDetails | null }>>(new Map());
  const activeRequestId = useRef<string | null>(null);
  const isTabSwitch = useRef(true);
  const lastScrolledGameId = useRef<string | null>(null);

  // Filter State
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [conferenceMap, setConferenceMap] = useState<Map<string, string>>(new Map());
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  
  // Menu Organization State
  const [menuSports, setMenuSports] = useState<Sport[]>(SPORTS);
  const [inactiveLeagues, setInactiveLeagues] = useState<Set<Sport>>(new Set());

  // Loading/Error State
  const [isLoading, setIsLoading] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as ThemeMode;
    if (savedTheme) {
      setTheme(savedTheme);
    }
  }, []);

  // Nightly Database Sync Logic
  useEffect(() => {
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
    const savedUser = localStorage.getItem('user_session');
    let currentUser: UserProfile | null = null;
    if (savedUser) {
        currentUser = JSON.parse(savedUser) as UserProfile;
        setUser(currentUser);
    }

    const loadFavorites = () => {
        const key = currentUser ? `favorites_${currentUser.sub}` : 'favorites';
        const saved = localStorage.getItem(key);
        if (saved) {
            setFavoriteLeagues(new Set(JSON.parse(saved) as Sport[]));
        } else {
            setFavoriteLeagues(new Set(SPORTS));
        }

        const teamKey = currentUser ? `favorite_teams_${currentUser.sub}` : 'favorite_teams';
        const savedTeams = localStorage.getItem(teamKey);
        if (savedTeams) {
            setFavoriteTeams(new Set(JSON.parse(savedTeams as string) as string[]));
        }
    };
    loadFavorites();

    const initGoogle = () => {
        // @ts-ignore
        if (window.google) {
            // @ts-ignore
            window.google.accounts.id.initialize({
                client_id: process.env.GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER",
                callback: handleCredentialResponse,
                auto_select: false
            });
        }
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
  }, [selectedTab]);

  useEffect(() => {
      let intervalId: ReturnType<typeof setInterval>;

      if (selectedTeam) {
          const loadTeamData = async (background = false) => {
              if (!background) setIsTeamLoading(true);
              try {
                  const [profile, schedule] = await Promise.all([
                      fetchTeamProfile(selectedTeam.league, selectedTeam.id),
                      fetchTeamSchedule(selectedTeam.league, selectedTeam.id)
                  ]);
                  setTeamProfile(profile);
                  setTeamSchedule(schedule);
              } catch (e) {
                  console.error("Failed to load team data", e);
              } finally {
                  if (!background) setIsTeamLoading(false);
              }
          };
          
          loadTeamData();
          window.scrollTo({ top: 0, behavior: 'smooth' });

          intervalId = setInterval(() => {
              loadTeamData(true);
          }, 30000);
      } else {
          setTeamProfile(null);
          setTeamSchedule([]);
      }

      return () => {
          if (intervalId) clearInterval(intervalId);
      }
  }, [selectedTeam]);

  const handleCredentialResponse = (response: any) => {
      const profile = decodeJwt(response.credential);
      if (profile) {
          setUser(profile);
          localStorage.setItem('user_session', JSON.stringify(profile));
          
          const cloudKey = `favorites_${profile.sub}`;
          const cloudFavs = localStorage.getItem(cloudKey);
          if (cloudFavs) {
              setFavoriteLeagues(new Set(JSON.parse(cloudFavs) as Sport[]));
          } else {
              const localFavs = localStorage.getItem('favorites');
              if (localFavs) setFavoriteLeagues(new Set(JSON.parse(localFavs) as Sport[]));
              else setFavoriteLeagues(new Set(SPORTS));
          }

          const teamKey = `favorite_teams_${profile.sub}`;
          const cloudTeams = localStorage.getItem(teamKey);
          if (cloudTeams) {
              setFavoriteTeams(new Set(JSON.parse(cloudTeams) as string[]));
          } else {
              const localTeams = localStorage.getItem('favorite_teams');
              if (localTeams) setFavoriteTeams(new Set(JSON.parse(localTeams) as string[]));
          }

          setIsSettingsOpen(false);
      }
  };

  const handleLogout = () => {
      // @ts-ignore
      if (window.google) window.google.accounts.id.disableAutoSelect();
      setUser(null);
      localStorage.removeItem('user_session');
      const localFavs = localStorage.getItem('favorites');
      if (localFavs) setFavoriteLeagues(new Set(JSON.parse(localFavs) as Sport[]));
      else setFavoriteLeagues(new Set(SPORTS));

      const localTeams = localStorage.getItem('favorite_teams');
      if (localTeams) setFavoriteTeams(new Set(JSON.parse(localTeams) as string[]));
      else setFavoriteTeams(new Set());

      setIsSettingsOpen(false);
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

  const loadData = async (tab: Tab, mode: ViewMode, isBackground = false) => {
    if (tab === 'METHODOLOGY' || selectedTeam || mode === 'CALENDAR') return;

    if (!isBackground) {
        setIsLoading(true);
        setError(null);
        if (mode === 'STANDINGS' || mode === 'RANKINGS' || mode === 'TEAMS' || mode === 'LEAGUE_STATS') setStandings([]);
        if (mode === 'BRACKET') setBracketGames([]);
        if (mode !== 'LIVE' && mode !== 'UPCOMING' && mode !== 'SCORES') setGames([]);
    }
    
    try {
        if (mode === 'STANDINGS' && tab !== 'HOME') {
            const standingsData = await fetchStandings(tab, standingsType);
            setStandings(standingsData);
        } else if ((mode === 'TEAMS' || mode === 'LEAGUE_STATS') && tab !== 'HOME') {
            const standingsData = await fetchStandings(tab, 'DIVISION');
            setStandings(standingsData);
        } else if (mode === 'RANKINGS' && tab !== 'HOME') {
            const rankingsData = await fetchRankings(tab);
            setStandings(rankingsData);
        } else if (mode === 'BRACKET' && tab !== 'HOME') {
            const bracketData = await fetchBracketGames(tab);
            setBracketGames(bracketData);
        } else {
            let fetchedGames: Game[] = [];
      
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
                  const chunkResults = await Promise.all(chunk.map((sport: Sport) => fetchUpcomingGames(sport)));
                  
                  chunkResults.forEach((result, idx) => {
                      const sportName = chunk[idx];
                      if (result.games.length > 0 || result.isSeasonActive) {
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
                          next.set(homeKey, { id: g.homeTeamId, name: g.homeTeam, logo: g.homeTeamLogo, league: g.league as Sport });
                      }
                      const awayKey = `${g.awayTeam}-${g.league}`;
                      if (!next.has(awayKey) && g.awayTeamId) {
                          next.set(awayKey, { id: g.awayTeamId, name: g.awayTeam, logo: g.awayTeamLogo, league: g.league as Sport });
                      }
                  });
                  return next;
              });
      
            } else {
              const { games } = await fetchUpcomingGames(tab as Sport, true);
              fetchedGames = games;
            }
      
            setGames(fetchedGames);

            if (isTabSwitch.current && !isBackground) {
                const hasLive = fetchedGames.some(g => g.status === 'in_progress');
                if (mode === 'LIVE' && !hasLive) {
                    setViewMode('UPCOMING');
                    isTabSwitch.current = false;
                } else {
                    isTabSwitch.current = false;
                }
            }

            if (isBackground && activeRequestId.current) {
                const liveGame = fetchedGames.find(g => g.id === activeRequestId.current);
                if (liveGame && liveGame.status === 'in_progress') {
                    try {
                        const details = await fetchGameDetails(liveGame.id, liveGame.league as Sport);
                        const stats = calculateWinProbability(liveGame, details);
                        
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
        loadData(selectedTab, viewMode);
    }
    
    setSelectedGame(null);
    setPrediction(null);
    setGameDetails(null);
    activeRequestId.current = null;
    
    // Auto-refresh logic for Live/Scores
    const intervalId = setInterval(() => {
        if (!selectedTeam && selectedTab !== 'METHODOLOGY') {
            // Only auto-refresh if we are in a view that benefits from live updates
            if (viewMode === 'LIVE' || viewMode === 'UPCOMING' || viewMode === 'SCORES') {
                loadData(selectedTab, viewMode, true);
            }
        }
    }, 15000);

    return () => clearInterval(intervalId);
  }, [selectedTab, viewMode, favoriteLeagues, standingsType, selectedTeam]); 

  const handleTabChange = (tab: Tab) => {
      setSelectedTab(tab);
      setViewMode('LIVE');
      setIsMenuOpen(false);
      setSelectedTeam(null);
      setIsFilterDropdownOpen(false);
      isTabSwitch.current = true;
  };

  const handleGameToggle = async (game: Game) => {
      if (selectedGame?.id === game.id) {
          setSelectedGame(null);
          setPrediction(null);
          setGameDetails(null);
          activeRequestId.current = null;
      } else {
          setSelectedGame(game);
          setPrediction(null);
          setGameDetails(null);
          activeRequestId.current = game.id;

          if (predictionCache.current.has(game.id)) {
              const cached = predictionCache.current.get(game.id);
              setPrediction(cached?.prediction || null);
              setGameDetails(cached?.details || null);
              
              if (cached?.details?.odds) {
                  setSelectedGame(prev => prev ? { ...prev, odds: cached.details!.odds } : null);
              }
              
              if (game.status !== 'in_progress') return;
          }

          setIsPredicting(true);
          try {
              const details = await fetchGameDetails(game.id, game.league as Sport);
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
              }
              
              const gameWithLatestOdds = { ...game, odds: details?.odds || game.odds };

              if (game.status !== 'finished') {
                  const stats = calculateWinProbability(gameWithLatestOdds, details);
                  const result = { analysis: [], stats, groundingChunks: [] };
                  
                  if (activeRequestId.current === game.id) {
                      setPrediction(result);
                      predictionCache.current.set(game.id, { prediction: result, details });
                  }
              } else {
                  if (activeRequestId.current === game.id) {
                      setPrediction(null);
                      predictionCache.current.set(game.id, { prediction: null, details });
                  }
              }
          } catch (e) {
              console.error(e);
          } finally {
              if (activeRequestId.current === game.id) {
                  setIsPredicting(false);
              }
          }
      }
  };

  const handleTeamClick = (teamId: string, league: Sport) => {
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

  const parsedFavoriteTeams = (Array.from(favoriteTeams) as string[]).map(s => {
      try { return JSON.parse(s as string) as TeamOption; } catch { return null; }
  }).filter(t => t !== null) as TeamOption[];

  const availableConferencesList = useMemo(() => {
      if (!RANKED_LEAGUES.includes(selectedTab as Sport)) return [];
      
      if (viewMode === 'STANDINGS' || viewMode === 'TEAMS' || viewMode === 'LEAGUE_STATS') {
          return standings.map(g => g.name).sort();
      } else {
          if (conferenceMap.size === 0) return [];
          const confSet = new Set<string>();
          games.forEach(g => {
              if (g.homeTeamId && conferenceMap.has(g.homeTeamId)) confSet.add(conferenceMap.get(g.homeTeamId)!);
              if (g.awayTeamId && conferenceMap.has(g.awayTeamId)) confSet.add(conferenceMap.get(g.awayTeamId)!);
          });
          return Array.from(confSet).sort();
      }
  }, [games, standings, conferenceMap, selectedTab, viewMode]);

  let finalDisplayGames = games;

  if (viewMode === 'LIVE') {
      finalDisplayGames = games.filter(g => g.status === 'in_progress');
  } else if (viewMode === 'UPCOMING') {
      finalDisplayGames = games
        .filter(g => g.status === 'scheduled')
        .sort((a, b) => {
            if (a.isPlayoff !== b.isPlayoff) return a.isPlayoff ? -1 : 1;
            return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
        });
  } else if (viewMode === 'SCORES') {
      finalDisplayGames = games
        .filter(g => g.status === 'finished')
        .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
  }

  if (selectedTab !== 'HOME' && viewMode !== 'STANDINGS' && viewMode !== 'TEAMS' && viewMode !== 'LEAGUE_STATS') {
      if (RANKED_LEAGUES.includes(selectedTab as Sport)) {
          if (activeFilter === 'TOP25') {
              finalDisplayGames = finalDisplayGames.filter(g => (g.homeTeamRank && g.homeTeamRank <= 25) || (g.awayTeamRank && g.awayTeamRank <= 25));
          } else if (activeFilter !== 'ALL') {
              finalDisplayGames = finalDisplayGames.filter(g => {
                  const homeConf = g.homeTeamId ? conferenceMap.get(g.homeTeamId) : undefined;
                  const awayConf = g.awayTeamId ? conferenceMap.get(g.awayTeamId) : undefined;
                  return homeConf === activeFilter || awayConf === activeFilter;
              });
          }
      }
  }

  let displayStandings = standings;
  if ((viewMode === 'STANDINGS' || viewMode === 'TEAMS' || viewMode === 'LEAGUE_STATS') && RANKED_LEAGUES.includes(selectedTab as Sport) && activeFilter !== 'ALL') {
      if (activeFilter === 'TOP25') {
          displayStandings = standings.map(group => ({
              ...group,
              standings: group.standings.filter(s => s.rank <= 25)
          })).filter(group => group.standings.length > 0);
      } else {
          displayStandings = standings.filter(group => group.name === activeFilter);
      }
  }

  const currentLeagueLogo = selectedTab !== 'HOME' && selectedTab !== 'METHODOLOGY' 
      ? games.find(g => g.league === selectedTab)?.leagueLogo 
      : undefined;

  const playoffGames = finalDisplayGames.filter(g => g.isPlayoff);
  const regularGames = finalDisplayGames.filter(g => !g.isPlayoff);

  const hasPlayoffs = playoffGames.length > 0;
  const hasRegular = regularGames.length > 0;

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
                         onTeamClick={handleTeamClick}
                     />
                     
                     {isSelected && (
                         <div className="relative mt-4 ml-4 pl-6 border-l-2 border-slate-200 dark:border-slate-800 animate-fade-in">
                             <div className="absolute -left-[9px] -top-4 w-4 h-8 rounded-bl-xl border-l-2 border-b-0 border-slate-200 dark:border-slate-800 bg-transparent opacity-0"></div>
                             
                             {isPredicting ? (
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
      />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
         {selectedTeam ? (
             <div>
                <button 
                    onClick={() => setSelectedTeam(null)}
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
                        setViewMode={(mode) => { setViewMode(mode); setSelectedGame(null); }}
                     />
                 </div>

                 {error && (
                     <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-slate-800 p-4 rounded-xl text-center mb-8">
                         <p className="text-rose-600 dark:text-rose-400 text-sm font-medium">{error}</p>
                     </div>
                 )}

                 {RANKED_LEAGUES.includes(selectedTab as Sport) && selectedTab !== 'HOME' && ['LIVE', 'UPCOMING', 'SCORES', 'STANDINGS', 'LEAGUE_STATS'].includes(viewMode) && (
                     <FilterBar 
                        activeFilter={activeFilter}
                        setActiveFilter={setActiveFilter}
                        availableConferences={availableConferencesList}
                        isOpen={isFilterDropdownOpen}
                        setIsOpen={setIsFilterDropdownOpen}
                     />
                 )}

                 {/* CONTENT AREA */}
                 {viewMode === 'STANDINGS' ? (
                     <StandingsView 
                        groups={displayStandings} 
                        sport={selectedTab as Sport} 
                        activeType={standingsType} 
                        onTypeChange={setStandingsType} 
                        onTeamClick={handleTeamClick}
                        isLoading={isLoading}
                     />
                 ) : viewMode === 'RANKINGS' ? (
                     <StandingsView 
                        groups={standings} 
                        sport={selectedTab as Sport} 
                        type="RANKINGS" 
                        onTeamClick={handleTeamClick}
                        isLoading={isLoading}
                     />
                 ) : viewMode === 'BRACKET' ? (
                     <div className="space-y-6">
                         <BracketView 
                            games={bracketGames} 
                            onGameSelect={handleGameToggle} 
                            selectedGameId={selectedGame?.id} 
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
    </div>
  );
};
