
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Game, GameDetails, PredictionResult, SOCCER_LEAGUES, Sport, PlayerProfile, ScoringPlay, Play, TeamStat } from '../types';
import { Target, Activity, ChevronDown, ChevronUp, Brain, List, Sparkles, X, Loader2, User as UserIcon, BarChart2, DollarSign, Layout } from 'lucide-react';
import { fetchPlayerProfile } from '../services/playerService';
import { PredictionView } from './PredictionView';
import { GroundingSources } from './GroundingSources';
import { getScoringPlayPoints } from '../services/uiUtils';
import { getGameTeamAbbreviation } from '../services/teamAbbreviation';

// Modular Components
import { FootballField } from './live/FootballField';
import { BaseballDiamond } from './live/BaseballDiamond';
import { ActiveLineupList } from './live/ActiveLineupList';
import { ScoreboardTable } from './live/ScoreboardTable';
import { CurrentBoxScore } from './live/CurrentBoxScore';

interface LiveGameViewProps {
  game: Game;
  gameDetails: GameDetails | null;
  prediction: PredictionResult | null;
  isDarkMode: boolean;
  onGenerateAnalysis?: () => void;
  onTeamClick?: (teamId: string, league: Sport) => void;
}

const parseStatValue = (val: string): number => {
    if (!val) return 0;
    const clean = val.replace(/,/g, '').replace('%', '');
    if (clean.includes(':')) {
        const parts = clean.split(':');
        return parseInt(parts[0]) + (parseInt(parts[1]) / 60);
    }
    return parseFloat(clean) || 0;
};

export const LiveGameView: React.FC<LiveGameViewProps> = ({ game, gameDetails, prediction, isDarkMode, onGenerateAnalysis, onTeamClick }) => {
  const [activeTab, setActiveTab] = useState<'ACTION' | 'PREDICTION'>('ACTION');
  const [showLiveStats, setShowLiveStats] = useState(true);
  const [showAllPlays, setShowAllPlays] = useState(false); 
  const [mounted, setMounted] = useState(false);
  
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState<PlayerProfile | null>(null);
  const [isPlayerLoading, setIsPlayerLoading] = useState(false);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(true);

  useEffect(() => { setMounted(true); }, []);

  const isSoccer = SOCCER_LEAGUES.includes(game.league as Sport);
  const isFootball = game.league === 'NFL' || game.league === 'NCAAF';
  const isBaseball = game.league === 'MLB';
  const isHockey = game.league === 'NHL';
  const isBasketball = ['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(game.league);
  
  const isFinished = game.status === 'finished';
  const isLive = game.status === 'in_progress';
  
  const stats = prediction?.stats;
  const homeAbbr = getGameTeamAbbreviation(game, 'home');
  const awayAbbr = getGameTeamAbbreviation(game, 'away');

  // Categorize Stats
  const categorizedStats = useMemo(() => {
      if (!gameDetails?.stats) return {} as Record<string, TeamStat[]>;
      
      const getNormLabel = (label: string) => {
          return label.toLowerCase()
              .replace('points per game', 'points')
              .replace('points allowed', 'opponent points')
              .replace('opp ppg', 'opponent points')
              .replace('avg', 'average')
              .replace('percentage', 'pct')
              .replace('%', 'pct')
              .trim();
      };

      // Filter duplicates
      const uniqueStats = gameDetails.stats.reduce((acc, current) => {
          const norm = getNormLabel(current.label);
          if (!acc.some(s => getNormLabel(s.label) === norm)) {
              acc.push(current);
          }
          return acc;
      }, [] as TeamStat[]);

      const categories: Record<string, TeamStat[]> = { 
          'Offense': [], 
          'Defense': [], 
          'Shooting': [], 
          'Rebounding': [], 
          'Ball Control': [],
          'Passing': [], 
          'Rushing': [], 
          'Efficiency': [], 
          'Special Teams': [], 
          'Other': [] 
      };

      uniqueStats.forEach(stat => {
          const l = stat.label.toLowerCase();
          
          if (isBasketball) {
              if (l.includes('opponent') || l.includes('allowed') || l.includes('defens') || l.includes('block') || l.includes('steal')) {
                  categories['Defense'].push(stat);
              } else if (l.includes('field goal') || l.includes('three point') || l.includes('free throw') || l.includes('fg') || l.includes('3p') || l.includes('ft') || l.includes('shooting')) {
                  categories['Shooting'].push(stat);
              } else if (l.includes('rebound')) {
                  categories['Rebounding'].push(stat);
              } else if (l.includes('assist') || l.includes('turnover') || l.includes('ratio')) {
                  categories['Ball Control'].push(stat);
              } else if (l.includes('points') || l.includes('score') || l.includes('margin')) {
                  categories['Offense'].push(stat);
              } else {
                  categories['Other'].push(stat);
              }
          } else {
              if (l.includes('pass') || l.includes('air') || l.includes('completion') || l.includes('qb')) categories['Passing'].push(stat);
              else if (l.includes('rush') || l.includes('ground') || l.includes('carry')) categories['Rushing'].push(stat);
              else if (l.includes('allowed') || l.includes('opponent') || l.includes('defens') || l.includes('sack') || l.includes('tackle') || l.includes('interception')) categories['Defense'].push(stat);
              else if (l.includes('efficiency') || l.includes('pct') || l.includes('down') || l.includes('red zone') || l.includes('possession') || l.includes('penalty') || l.includes('turnover')) categories['Efficiency'].push(stat);
              else if (l.includes('kick') || l.includes('punt') || l.includes('return') || l.includes('fg')) categories['Special Teams'].push(stat);
              else if (l.includes('yards') || l.includes('score') || l.includes('touchdown') || l.includes('points')) categories['Offense'].push(stat);
              else categories['Other'].push(stat);
          }
      });
      
      Object.keys(categories).forEach(key => { if (categories[key].length === 0) delete categories[key]; });
      
      if (isBasketball) {
          const ordered: Record<string, TeamStat[]> = {};
          if (categories['Offense']) ordered['Offense'] = categories['Offense'];
          if (categories['Shooting']) ordered['Shooting'] = categories['Shooting'];
          if (categories['Defense']) ordered['Defense'] = categories['Defense'];
          if (categories['Rebounding']) ordered['Rebounding'] = categories['Rebounding'];
          if (categories['Ball Control']) ordered['Ball Control'] = categories['Ball Control'];
          Object.keys(categories).forEach(k => { if (!ordered[k]) ordered[k] = categories[k]; });
          return ordered;
      }

      return categories;
  }, [gameDetails, isBasketball]);

  const displayOdds = stats?.marketOdds || game.odds;

  const handleTeamNavigate = (e: React.MouseEvent, side: 'home' | 'away') => {
      if (!onTeamClick) return;
      const teamId = side === 'home' ? game.homeTeamId : game.awayTeamId;
      if (!teamId) return;
      e.stopPropagation();
      onTeamClick(teamId, game.league as Sport);
  };

  const renderProjectedScoreRow = (type: 'home' | 'away') => {
      const isHome = type === 'home';
      const logo = isHome ? game.homeTeamLogo : game.awayTeamLogo;
      const name = isHome ? game.homeTeam : game.awayTeam;
      const score = isFinished ? (isHome ? game.homeScore : game.awayScore) : (isHome ? stats?.predictedScoreHome : stats?.predictedScoreAway);
      const teamId = isHome ? game.homeTeamId : game.awayTeamId;
      return (
        <div className="flex items-center justify-between">
            <div
                className={`flex items-center gap-3 ${onTeamClick && teamId ? 'cursor-pointer hover:opacity-80' : ''}`}
                onClick={onTeamClick && teamId ? (e) => handleTeamNavigate(e, isHome ? 'home' : 'away') : undefined}
            >
                {logo ? (<img src={logo} alt={name} className="w-6 h-6 object-contain" />) : (<div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700"></div>)}
                <span className="font-bold text-slate-700 dark:text-slate-200 text-sm font-display">{name}</span>
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-white font-mono">{score}</span>
        </div>
      );
  };

  const activePlayerGameData = selectedPlayerId && gameDetails?.boxscore ? (() => { for (const team of gameDetails.boxscore) { for (const group of team.groups) { const pEntry = group.players.find(p => p.player.id === selectedPlayerId); if (pEntry) return { player: pEntry.player, stats: pEntry.stats, labels: group.labels, groupName: group.label }; } } return null; })() : null;
  const displayPlayerInfo = activePlayerGameData?.player || { id: selectedPlayerId || '', displayName: selectedPlayerProfile?.name || 'Unknown Player', headshot: selectedPlayerProfile?.headshot, position: selectedPlayerProfile?.position, jersey: selectedPlayerProfile?.jersey };
  
  const allPlays = gameDetails?.plays || [];
  const scoredPlays = gameDetails?.scoringPlays || [];
  let playsToShow: (ScoringPlay | Play)[] = showAllPlays ? allPlays : (scoredPlays.length > 0 ? scoredPlays : allPlays.filter(p => ('scoringPlay' in p ? p.scoringPlay : false) || p.type?.toLowerCase().includes('score') || p.text?.toLowerCase().match(/\b(goal|touchdown|td|safety|field goal|fg|home run|hr)\b/))); // Removed 'run' and 'points' to be strict
  if (isHockey && !showAllPlays && playsToShow.length === allPlays.length) playsToShow = playsToShow.filter(p => p.type.toLowerCase().includes('goal') || p.text.toLowerCase().includes('goal'));
  const sortedPlays = [...playsToShow].reverse();
  
  let displaySituation = gameDetails?.situation || game.situation || {};
  
  if (isFootball && sortedPlays.length > 0 && (isLive || isFinished)) {
      const allPlaysSorted = [...(gameDetails?.plays || [])].reverse(); 
      const lastPlay = allPlaysSorted[0]; 
      if (lastPlay && lastPlay.down !== undefined && lastPlay.distance !== undefined) {
          displaySituation = {
              ...displaySituation,
              down: lastPlay.down,
              distance: lastPlay.distance,
              yardLine: lastPlay.yardLine,
              downDistanceText: lastPlay.downDistanceText
          };
      }
  }

  // Always try to show scoreboard if game is live or finished, defaulting to empty structure if linescores missing
  const shouldShowScoreboard = (isLive || isFinished) && !!gameDetails;

  const getPlayTeamInfo = (tId: string | undefined) => {
      if (!tId) return null;
      // Robust comparison
      if (tId === game.homeTeamId || String(tId) === String(game.homeTeamId)) {
          return { name: game.homeTeam, logo: game.homeTeamLogo, abbr: homeAbbr, isHome: true };
      }
      if (tId === game.awayTeamId || String(tId) === String(game.awayTeamId)) {
          return { name: game.awayTeam, logo: game.awayTeamLogo, abbr: awayAbbr, isHome: false };
      }
      return null;
  };

  if (!mounted) return null;

  return (
    <div className="animate-fade-in space-y-6">
      
      {/* View Toggle */}
      <div className="flex justify-center mb-2">
          <div className="flex w-full max-w-sm bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                  onClick={() => setActiveTab('ACTION')}
                  className={`flex-1 flex items-center justify-center px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all gap-2
                      ${activeTab === 'ACTION' 
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
              >
                  <Activity size={14} className={activeTab === 'ACTION' && isLive ? "animate-pulse text-emerald-500" : ""} />
                  Live Action
              </button>
              <button
                  onClick={() => setActiveTab('PREDICTION')}
                  className={`flex-1 flex items-center justify-center px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all gap-2
                      ${activeTab === 'PREDICTION' 
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
              >
                  <Brain size={14} className={activeTab === 'PREDICTION' ? "text-indigo-500" : ""} />
                  Forecast & Analysis
              </button>
          </div>
      </div>

      {activeTab === 'ACTION' ? (
          <div className="space-y-6 animate-fade-in">
              {/* 1. Field Visualization */}
              {isFootball && (
                  <FootballField 
                      situation={displaySituation} 
                      homeTeam={homeAbbr} 
                      awayTeam={awayAbbr} 
                      game={game} 
                      isDarkMode={isDarkMode}
                      gameDetails={gameDetails}
                      onTeamClick={onTeamClick}
                  />
              )}
              
              {isBaseball && (
                  <BaseballDiamond 
                      situation={displaySituation} 
                      homeTeam={homeAbbr} 
                      awayTeam={awayAbbr} 
                      game={game} 
                      isDarkMode={isDarkMode} 
                  />
              )}

              {/* 2. Live Grid (Scoring + Lineup) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {/* A. Linescore / Summary */}
                 <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col min-h-[220px]">
                     <h4 className="text-xs font-bold text-slate-600 dark:text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                         <Layout size={14} /> {isLive ? 'Live Scoring' : 'Final Score'}
                     </h4>
                     <div className="flex-1 flex flex-col justify-center">
                        {shouldShowScoreboard ? (
                            <ScoreboardTable game={game} gameDetails={gameDetails} onTeamClick={onTeamClick} />
                        ) : (
                            <div className="space-y-4">
                                {renderProjectedScoreRow('away')}
                                <div className="h-px bg-slate-100 dark:bg-slate-800"></div>
                                {renderProjectedScoreRow('home')}
                            </div>
                        )}
                     </div>
                 </div>

                 {/* B. Active Lineup */}
                 <div>
                     <ActiveLineupList 
                        situation={displaySituation} 
                        homeTeam={homeAbbr} 
                        awayTeam={awayAbbr} 
                        game={game} 
                        gameDetails={gameDetails}
                        isDarkMode={isDarkMode} 
                        type={isBasketball ? 'BASKETBALL' : isHockey ? 'HOCKEY' : 'SOCCER'}
                        onPlayerClick={(pid) => setSelectedPlayerId(pid)}
                        onTeamClick={onTeamClick}
                     />
                 </div>
              </div>

              {/* 3. Current Box Score */}
              {gameDetails?.boxscore && gameDetails.boxscore.length > 0 && (
                  <CurrentBoxScore
                      game={game}
                      gameDetails={gameDetails}
                      onPlayerClick={(pid) => setSelectedPlayerId(pid)}
                      onTeamClick={onTeamClick}
                  />
              )}

              {/* 4. Live Stats Grid */}
              {Object.keys(categorizedStats).length > 0 && (
                  <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                      <div 
                          className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center cursor-pointer bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
                          onClick={() => setShowLiveStats(!showLiveStats)}
                      >
                          <h4 className="text-xs font-bold text-slate-600 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                              <BarChart2 size={14} /> Live Team Stats
                          </h4>
                          {showLiveStats ? <ChevronUp size={16} className="text-slate-500 dark:text-slate-300" /> : <ChevronDown size={16} className="text-slate-500 dark:text-slate-300" />}
                      </div>
                      
                      {showLiveStats && (
                          <div className="p-5 space-y-6 animate-fade-in">
                              <div className="grid grid-cols-[minmax(72px,auto)_1fr_minmax(72px,auto)] items-center gap-3 pb-2 border-b border-slate-100 dark:border-slate-800/70">
                                  <div className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                                      {awayAbbr}
                                  </div>
                                  <div className="text-center text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                                      Stat
                                  </div>
                                  <div className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                                      {homeAbbr}
                                  </div>
                              </div>
                              {Object.entries(categorizedStats).map(([category, items]) => (
                                  <div key={category}>
                                      <h5 className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 pl-2 border-l-2 border-slate-300 dark:border-slate-600">{category}</h5>
                                      <div className="space-y-3">
                                          {items.map((stat, idx) => {
                                              const hVal = parseStatValue(stat.homeValue);
                                              const aVal = parseStatValue(stat.awayValue);
                                              const hBold = hVal > aVal;
                                              const aBold = aVal > hVal;
                                              
                                              return (
                                                  <div key={idx} className="grid grid-cols-[minmax(72px,auto)_1fr_minmax(72px,auto)] items-center gap-3 rounded-lg border border-slate-200/80 dark:border-slate-800/70 bg-white/85 dark:bg-slate-900/60 px-3 py-2">
                                                      <span className={`text-right text-base font-mono leading-none ${aBold ? 'font-bold text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>{stat.awayValue}</span>
                                                      <span className="text-center text-xs font-semibold text-slate-700 dark:text-slate-200 px-2 truncate">{stat.label}</span>
                                                      <span className={`text-left text-base font-mono leading-none ${hBold ? 'font-bold text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>{stat.homeValue}</span>
                                                  </div>
                                              );
                                          })}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              )}

              {/* 5. Play by Play */}
              <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                  <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                      <h4 className="text-xs font-bold text-slate-600 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                          <List size={14} /> Play-by-Play
                      </h4>
                      <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5">
                          <button 
                              onClick={() => setShowAllPlays(false)}
                              className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all ${!showAllPlays ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                          >
                              Scoring
                          </button>
                          <button 
                              onClick={() => setShowAllPlays(true)}
                              className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all ${showAllPlays ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                          >
                              All Plays
                          </button>
                      </div>
                  </div>
                  
                  <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                      {sortedPlays.length === 0 ? (
                          <div className="p-8 text-center text-slate-600 dark:text-slate-300 text-xs italic">No plays available yet.</div>
                      ) : (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                              {sortedPlays.map((play) => {
                                  const teamInfo = getPlayTeamInfo(play.teamId);
                                  const pointsStr = getScoringPlayPoints(play, game.league);
                                  return (
                                      <div key={play.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors flex gap-4 items-start">
                                          <div className="flex flex-col items-center min-w-[40px] pt-1">
                                              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-300 font-mono">{play.clock}</span>
                                              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400">Q{play.period}</span>
                                          </div>
                                          
                                          {/* Team Logo Column */}
                                          <div className="flex-shrink-0 w-8 flex justify-center pt-0.5">
                                              {teamInfo?.logo ? (
                                                  <img
                                                      src={teamInfo.logo}
                                                      alt={teamInfo.abbr}
                                                      className={`w-6 h-6 object-contain ${onTeamClick && play.teamId ? 'cursor-pointer hover:opacity-80' : ''}`}
                                                      onClick={(e) => {
                                                          if (!onTeamClick || !play.teamId) return;
                                                          e.stopPropagation();
                                                          onTeamClick(play.teamId, game.league as Sport);
                                                      }}
                                                  />
                                              ) : (
                                                  <div className="w-6" /> // spacer
                                              )}
                                          </div>

                                          <div className="flex-1">
                                              {teamInfo && (
                                                  <div
                                                      className={`text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-0.5 ${onTeamClick && play.teamId ? 'cursor-pointer hover:underline' : ''}`}
                                                      onClick={(e) => {
                                                          if (!onTeamClick || !play.teamId) return;
                                                          e.stopPropagation();
                                                          onTeamClick(play.teamId, game.league as Sport);
                                                      }}
                                                  >
                                                      {teamInfo.name}
                                                  </div>
                                              )}
                                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">{play.text}</p>
                                              {((('scoringPlay' in play) && play.scoringPlay) || ('isHome' in play) || play.type?.toLowerCase().includes('score') || play.type?.toLowerCase().includes('goal') || pointsStr) && (
                                                  <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                                                      <Target size={10} />
                                                      {play.type || 'Score'}
                                                      {pointsStr && <span className="ml-1 text-emerald-800 dark:text-emerald-300">{pointsStr}</span>}
                                                  </div>
                                              )}
                                          </div>
                                          <div className="text-right min-w-[50px] pt-1">
                                              <div className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                                                  {play.awayScore}-{play.homeScore}
                                              </div>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      ) : (
          <div className="space-y-6 animate-fade-in">
              
              {/* Odds Card (Moved to Top of Forecast) */}
              <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                 <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-6 flex items-center gap-2">
                     <DollarSign size={14} className="text-emerald-500" />
                     Market Consensus
                 </h4>
                 {displayOdds ? (
                     <div className="grid grid-cols-3 gap-4 text-center divide-x divide-slate-100 dark:divide-slate-800">
                         <div>
                             <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Spread</div>
                             <div className="text-lg font-mono font-bold text-slate-700 dark:text-slate-300">{displayOdds.spread || '-'}</div>
                         </div>
                         <div>
                             <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Total</div>
                             <div className="text-lg font-mono font-bold text-slate-700 dark:text-slate-300">{displayOdds.overUnder || '-'}</div>
                         </div>
                         <div>
                             <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Moneyline</div>
                             <div className="text-xs font-mono font-bold text-slate-600 dark:text-slate-400 flex flex-col justify-center h-full">
                                 <span
                                    className={onTeamClick && game.awayTeamId ? 'cursor-pointer hover:underline' : ''}
                                    onClick={onTeamClick && game.awayTeamId ? (e) => handleTeamNavigate(e, 'away') : undefined}
                                 >
                                    {awayAbbr} {displayOdds.moneyLineAway || '-'}
                                 </span>
                                 <span
                                    className={onTeamClick && game.homeTeamId ? 'cursor-pointer hover:underline' : ''}
                                    onClick={onTeamClick && game.homeTeamId ? (e) => handleTeamNavigate(e, 'home') : undefined}
                                 >
                                    {homeAbbr} {displayOdds.moneyLineHome || '-'}
                                 </span>
                             </div>
                         </div>
                     </div>
                 ) : (
                     <div className="flex-1 flex items-center justify-center text-center py-4">
                         <p className="text-xs text-slate-400 italic">No betting data available</p>
                     </div>
                 )}
              </div>

              {/* Prediction Component */}
              {prediction && !isFinished && (
                  <PredictionView 
                      game={game} 
                      prediction={prediction} 
                      isDarkMode={isDarkMode} 
                      onGenerateAnalysis={onGenerateAnalysis}
                      gameDetails={gameDetails}
                      hideAnalysis={true} 
                      hideLeaders={true}
                      onTeamClick={onTeamClick}
                  />
              )}

              {/* AI Analysis Section */}
              {( (prediction?.analysis && prediction.analysis.length > 0) || (onGenerateAnalysis) ) && (
                  <div className="bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl p-5 border border-indigo-100 dark:border-indigo-900/30 transition-all duration-500 ease-in-out">
                      <div 
                          className="flex justify-between items-center cursor-pointer mb-2"
                          onClick={() => prediction?.analysis?.length ? setIsAnalysisOpen(!isAnalysisOpen) : null}
                      >
                          <h4 className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-2">
                              <Sparkles size={14} /> AI Match Analysis
                          </h4>
                          {prediction?.analysis && prediction.analysis.length > 0 && (
                              isAnalysisOpen ? <ChevronUp size={16} className="text-indigo-400" /> : <ChevronDown size={16} className="text-indigo-400" />
                          )}
                      </div>
                      
                      <div className="mt-2 min-h-[60px] flex flex-col justify-center">
                          {prediction?.analysis && prediction.analysis.length > 0 ? (
                              isAnalysisOpen && (
                                  <ul className="space-y-3 animate-fade-in">
                                      {(prediction?.analysis || []).map((point: string, idx: number) => (
                                          <li key={idx} className="flex items-start gap-3">
                                              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                                              <span className="text-sm leading-relaxed text-indigo-900 dark:text-indigo-200/80 font-medium">{point}</span>
                                          </li>
                                      ))}
                                  </ul>
                              )
                          ) : (
                              <button 
                                  onClick={() => { 
                                      setIsGenerating(true); 
                                      if(onGenerateAnalysis) onGenerateAnalysis();
                                      setTimeout(() => { setIsGenerating(false); }, 10000); 
                                  }}
                                  disabled={isGenerating}
                                  className="w-full py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm flex items-center justify-center gap-2 hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                              >
                                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} className="text-yellow-400" fill="currentColor" />}
                                  {isGenerating ? 'Analyzing Live Data...' : 'Generate Live Analysis'}
                              </button>
                          )}
                      </div>
                  </div>
              )}

              {/* Grounding Sources */}
              {prediction?.groundingChunks && prediction.groundingChunks.length > 0 && isAnalysisOpen && (
                <div className="bg-white dark:bg-slate-900/40 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <GroundingSources chunks={prediction.groundingChunks} />
                </div>
              )}
          </div>
      )}

      {/* Player Modal */}
      {selectedPlayerId && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative max-h-[90vh] flex flex-col">
                    <button onClick={() => setSelectedPlayerId(null)} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors z-10"><X size={18} /></button>
                    {/* Simplified Header */}
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-6 flex flex-col items-center text-center border-b border-slate-200 dark:border-slate-800">
                        <div className="w-24 h-24 rounded-full bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-800 shadow-md mb-4 overflow-hidden flex items-center justify-center">
                             {displayPlayerInfo.headshot ? <img src={displayPlayerInfo.headshot} alt="" className="w-full h-full object-cover"/> : <UserIcon size={40} className="text-slate-300"/>}
                        </div>
                        <h2 className="text-xl font-bold font-display text-slate-900 dark:text-white">{displayPlayerInfo.displayName}</h2>
                        <p className="text-sm text-slate-500">{displayPlayerInfo.position} {displayPlayerInfo.jersey ? `#${displayPlayerInfo.jersey}` : ''}</p>
                    </div>
                    {/* Game Stats */}
                    <div className="p-6">
                        {activePlayerGameData ? (
                            <div className="grid grid-cols-3 gap-3">
                                {activePlayerGameData.labels.map((lbl, i) => (
                                    <div key={i} className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-100 dark:border-slate-800 text-center">
                                        <div className="text-[10px] text-slate-400 uppercase font-bold">{lbl}</div>
                                        <div className="font-mono font-bold text-slate-800 dark:text-slate-200">{activePlayerGameData.stats[i]}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center text-sm text-slate-400">No stats for this game.</div>
                        )}
                    </div>
                </div>
            </div>,
            document.body
      )}
    </div>
  );
};
