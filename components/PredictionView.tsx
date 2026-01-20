
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Game, PredictionResult, SOCCER_LEAGUES, Sport, GameDetails, TeamStat, CalculationDetailItem, PlayerProfile, Player } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Brain, TrendingUp, ShieldCheck, List, Sparkles, Activity, Scale, DollarSign, Target, Wind, Hammer, Timer, Gauge, Footprints, BarChart2, TrendingDown, X, Zap, Star, User, Calculator, Loader2 } from 'lucide-react';
import { GroundingSources } from './GroundingSources';
import { fetchPlayerProfile } from '../services/playerService';

interface PredictionViewProps {
  game: Game;
  prediction: PredictionResult;
  isDarkMode: boolean;
  onGenerateAnalysis?: () => void;
  gameDetails?: GameDetails | null;
  hideAnalysis?: boolean;
  hideLeaders?: boolean;
}

interface ActivePlayerGameData {
    player: Player;
    stats: string[];
    labels: string[];
    groupName: string;
}

const getTeamColor = (primary: string | undefined, alternate: string | undefined, isDarkMode: boolean): string => {
    const defaultColor = isDarkMode ? '#e5e5e5' : '#171717';
    if (!primary) return defaultColor;
    const p = primary.toLowerCase().replace('#', '');
    const a = alternate ? alternate.toLowerCase().replace('#', '') : null;
    const isBlack = p === '000000';
    const isWhite = p === 'ffffff';
    if (isDarkMode && isBlack) return a && a !== '000000' ? `#${a}` : '#ffffff';
    if (!isDarkMode && isWhite) return a && a !== 'ffffff' ? `#${a}` : '#000000';
    return primary;
};

const getFactorIcon = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('air') || l.includes('pass')) return <Wind size={14} className="text-sky-500" />;
    if (l.includes('ground') || l.includes('rush')) return <Footprints size={14} className="text-amber-600" />;
    if (l.includes('trench') || l.includes('sack')) return <Hammer size={14} className="text-slate-600 dark:text-slate-400" />;
    if (l.includes('pace') || l.includes('tempo') || l.includes('possession') || l.includes('time')) return <Timer size={14} className="text-indigo-500" />;
    if (l.includes('red zone')) return <Target size={14} className="text-rose-500" />;
    if (l.includes('eff')) return <Gauge size={14} className="text-emerald-500" />;
    if (l.includes('turnover') || l.includes('penalty')) return <TrendingDown size={14} className="text-amber-500" />;
    return <Activity size={14} className="text-slate-400" />;
};

const parseStatValue = (val: string): number => {
    if (!val) return 0;
    const clean = val.replace(/,/g, '').replace('%', '');
    if (clean.includes(':')) {
        const parts = clean.split(':');
        return parseInt(parts[0]) + (parseInt(parts[1]) / 60);
    }
    return parseFloat(clean) || 0;
};

const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export const PredictionView: React.FC<PredictionViewProps> = ({ 
    game, 
    prediction, 
    isDarkMode, 
    onGenerateAnalysis, 
    gameDetails,
    hideAnalysis = false,
    hideLeaders = false
}) => {
  const { stats, analysis, groundingChunks } = prediction;
  const isSoccer = SOCCER_LEAGUES.includes(game.league as Sport);
  const isBasketball = ['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(game.league);
  const isFootball = ['NFL', 'NCAAF'].includes(game.league);

  const [showOutlookHelp, setShowOutlookHelp] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Player Modal State
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [isPlayerLoading, setIsPlayerLoading] = useState(false);
  const [playerStatsMode, setPlayerStatsMode] = useState<'GAME' | 'SEASON'>('SEASON');

  const displayOdds = stats.marketOdds || game.odds;
  
  const topTeam = isSoccer ? 'home' : 'away';
  const bottomTeam = isSoccer ? 'away' : 'home';

  const homeColor = getTeamColor(game.homeTeamColor, game.homeTeamAlternateColor, isDarkMode);
  const awayColor = getTeamColor(game.awayTeamColor, game.awayTeamAlternateColor, isDarkMode);

  const getTeamData = (type: 'home' | 'away') => ({
      name: type === 'home' ? game.homeTeam : game.awayTeam,
      value: type === 'home' ? stats.winProbabilityHome : stats.winProbabilityAway,
      color: type === 'home' ? homeColor : awayColor,
      score: type === 'home' ? stats.predictedScoreHome : stats.predictedScoreAway,
      logo: type === 'home' ? game.homeTeamLogo : game.awayTeamLogo
  });

  const topData = getTeamData(topTeam);
  const bottomData = getTeamData(bottomTeam);

  const winData = [
    { name: topData.name, value: topData.value },
    { name: bottomData.name, value: bottomData.value },
  ];

  const COLORS = [topData.color, bottomData.color];

  const handleAnalysisClick = () => {
      if (onGenerateAnalysis) {
          setIsGenerating(true);
          onGenerateAnalysis();
          setTimeout(() => setIsGenerating(false), 8000); 
      }
  };

  const homeAbbr = game.homeTeam.substring(0, 3).toUpperCase();
  const awayAbbr = game.awayTeam.substring(0, 3).toUpperCase();

  // STRICT PREGAME DATA LOGIC:
  // If game is live/finished, we MUST use seasonStats to represent the "Pregame Outlook".
  // If seasonStats are missing in a live game, we show nothing rather than showing live stats (which would be confusing in a 'Prediction' view).
  // If game is scheduled, we prefer seasonStats but fallback to stats (which are usually pregame aggregates or empty).
  const displayStats = useMemo(() => {
      if (gameDetails?.seasonStats && gameDetails.seasonStats.length > 0) {
          return gameDetails.seasonStats;
      }
      if (game.status === 'scheduled') {
          return gameDetails?.stats || [];
      }
      return []; // Return empty for live/finished games if season stats failed to load, to avoid showing live boxscore.
  }, [gameDetails, game.status]);

  const categorizedStats = useMemo(() => {
      if (!displayStats || displayStats.length === 0) return {} as Record<string, TeamStat[]>;
      
      // Deduplication helper
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
      const uniqueStats = displayStats.reduce((acc, current) => {
          const norm = getNormLabel(current.label);
          if (!acc.some(s => getNormLabel(s.label) === norm)) {
              acc.push(current);
          }
          return acc;
      }, [] as TeamStat[]);

      const categories: Record<string, TeamStat[]> = {
          'Offense': [],
          'Defense': [],
          'Shooting': [], // Basketball
          'Rebounding': [], // Basketball
          'Ball Control': [], // Basketball
          'Passing': [],
          'Rushing': [],
          'Special Teams': [],
          'Efficiency': [],
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
              // Football / Other
              if (l.includes('kick') || l.includes('punt') || l.includes('return') || l.includes('field goal') || l.includes('fg')) {
                  categories['Special Teams'].push(stat);
              } else if (l.includes('pass') || l.includes('air') || l.includes('completion') || l.includes('qb')) {
                  categories['Passing'].push(stat);
              } else if (l.includes('rush') || l.includes('ground') || l.includes('carry')) {
                  categories['Rushing'].push(stat);
              } else if (l.includes('allowed') || l.includes('opponent') || l.includes('defens') || l.includes('sack') || l.includes('tackle') || l.includes('interception')) {
                  categories['Defense'].push(stat);
              } else if (l.includes('efficiency') || l.includes('pct') || l.includes('down') || l.includes('red zone') || l.includes('possession') || l.includes('penalty') || l.includes('turnover')) {
                  categories['Efficiency'].push(stat);
              } else if (l.includes('yards') || l.includes('score') || l.includes('touchdown') || l.includes('points')) {
                  categories['Offense'].push(stat);
              } else {
                  categories['Other'].push(stat);
              }
          }
      });

      Object.keys(categories).forEach(key => {
          if (categories[key].length === 0) delete categories[key];
      });

      // Custom Order for Basketball to improve readability
      if (isBasketball) {
          const ordered: Record<string, TeamStat[]> = {};
          if (categories['Offense']) ordered['Offense'] = categories['Offense'];
          if (categories['Shooting']) ordered['Shooting'] = categories['Shooting'];
          if (categories['Defense']) ordered['Defense'] = categories['Defense'];
          if (categories['Rebounding']) ordered['Rebounding'] = categories['Rebounding'];
          if (categories['Ball Control']) ordered['Ball Control'] = categories['Ball Control'];
          // Add others
          Object.keys(categories).forEach(k => {
              if (!ordered[k]) ordered[k] = categories[k];
          });
          return ordered;
      }

      return categories;
  }, [displayStats, isBasketball]);

  // Leaders logic
  const leaderComparisons = useMemo(() => {
      if (hideLeaders || !gameDetails?.leaders || gameDetails.leaders.length < 2) return [];
      
      const homeLeaders = gameDetails.leaders.find(l => l.team.id === game.homeTeamId || l.team.id === String(game.homeTeamId));
      const awayLeaders = gameDetails.leaders.find(l => l.team.id === game.awayTeamId || l.team.id === String(game.awayTeamId));
      
      if (!homeLeaders || !awayLeaders) return [];

      const comparisons = [];
      // Use home categories as the base list
      for (const hCat of homeLeaders.leaders) {
          const aCat = awayLeaders.leaders.find(c => c.name === hCat.name);
          if (aCat && hCat.leaders.length > 0 && aCat.leaders.length > 0) {
              comparisons.push({
                  category: hCat.shortDisplayName || hCat.displayName,
                  homePlayer: hCat.leaders[0],
                  awayPlayer: aCat.leaders[0]
              });
          }
      }
      return comparisons;
  }, [gameDetails, game, hideLeaders]);

  const handlePlayerClick = async (playerId: string) => {
      setSelectedPlayerId(playerId);
      setIsPlayerLoading(true);
      setPlayerProfile(null);
      setPlayerStatsMode('SEASON'); 
      try {
          const profile = await fetchPlayerProfile(game.league as Sport, playerId);
          setPlayerProfile(profile);
      } catch (e) {
          console.error("Failed to load player", e);
      } finally {
          setIsPlayerLoading(false);
      }
  };

  const activePlayerGameData: ActivePlayerGameData | null = selectedPlayerId && gameDetails?.boxscore ? (() => { 
        for (const team of gameDetails.boxscore) { 
            for (const group of team.groups) { 
                const pEntry = group.players.find(p => p.player.id === selectedPlayerId); 
                if (pEntry) return { player: pEntry.player, stats: pEntry.stats, labels: group.labels, groupName: group.label }; 
            } 
        } 
        return null; 
  })() : null;

  const clickedLeader = useMemo(() => {
        if (!selectedPlayerId) return null;
        for (const comp of leaderComparisons) {
            if (comp.homePlayer.id === selectedPlayerId) return comp.homePlayer;
            if (comp.awayPlayer.id === selectedPlayerId) return comp.awayPlayer;
        }
        return null;
  }, [selectedPlayerId, leaderComparisons]);

  const displayPlayerInfo = activePlayerGameData?.player || {
        id: selectedPlayerId || '',
        displayName: playerProfile?.name || clickedLeader?.displayName || 'Unknown Player',
        headshot: playerProfile?.headshot || clickedLeader?.headshot,
        position: playerProfile?.position || clickedLeader?.position,
        jersey: playerProfile?.jersey || clickedLeader?.jersey
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="bg-white dark:bg-slate-900/40 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
        
        {/* 1. Header */}
        <div className="flex items-center justify-between mb-8">
            <div 
                className="flex items-center gap-3 cursor-pointer group/outlook"
                onClick={() => setShowOutlookHelp(true)}
            >
                <div className="p-2.5 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 group-hover/outlook:bg-slate-200 dark:group-hover/outlook:bg-slate-800/80 transition-colors">
                    <TrendingUp size={20} className="text-slate-900 dark:text-white" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider font-display group-hover/outlook:text-indigo-600 dark:group-hover/outlook:text-indigo-400 transition-colors">
                        Match Outlook
                    </h3>
                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 group-hover/outlook:text-slate-600 dark:group-hover/outlook:text-slate-300 transition-colors">
                        Model v1.5 &rarr;
                    </span>
                </div>
            </div>
        </div>

        {/* 2. Projected Score & Win Probability (Grid) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div className="flex flex-col p-5 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50">
                <div className="flex justify-between items-start mb-4">
                    <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Brain size={14} /> Win Probability
                    </h4>
                    <div 
                        className="flex items-center gap-1.5 px-2 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-[10px] font-semibold cursor-help transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                        onClick={(e) => { e.stopPropagation(); setShowOutlookHelp(true); }}
                        title="View Confidence Logic"
                    >
                        <ShieldCheck size={12} className={stats.confidence > 70 ? "text-emerald-500" : stats.confidence < 55 ? "text-amber-500" : "text-slate-500"} />
                        <span className="text-slate-600 dark:text-slate-400">{stats.confidence.toFixed(0)}% Conf</span>
                    </div>
                </div>

                <div className="flex items-center gap-6 flex-1">
                    <div className="w-[80px] h-[80px] relative shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                            data={winData}
                            cx="50%"
                            cy="50%"
                            innerRadius={25}
                            outerRadius={40}
                            paddingAngle={4}
                            dataKey="value"
                            stroke="none"
                            startAngle={90}
                            endAngle={-270}
                            >
                            {winData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                            </Pie>
                        </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">WIN%</span>
                        </div>
                    </div>
                    
                    <div className="flex-1 space-y-3">
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="font-semibold truncate max-w-[120px] text-slate-700 dark:text-slate-300">{topData.name}</span>
                                <span className="font-bold font-mono" style={{ color: topData.color }}>{topData.value.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                <div className="h-full transition-all duration-1000" style={{ width: `${topData.value}%`, backgroundColor: topData.color }}></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="font-semibold truncate max-w-[120px] text-slate-700 dark:text-slate-300">{bottomData.name}</span>
                                <span className="font-bold font-mono" style={{ color: bottomData.color }}>{bottomData.value.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                <div className="h-full transition-all duration-1000" style={{ width: `${bottomData.value}%`, backgroundColor: bottomData.color }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col p-5 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50">
                <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Target size={14} /> Projected Score
                </h4>
                <div className="flex items-center justify-between gap-2 px-4 flex-1">
                     <div className="flex flex-col items-center">
                         {game.awayTeamLogo ? (
                             <img src={game.awayTeamLogo} alt={game.awayTeam} className="w-12 h-12 object-contain mb-2 drop-shadow-sm" />
                         ) : <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 mb-2"></div>}
                         <span className="text-3xl sm:text-4xl font-mono font-bold text-slate-900 dark:text-white tracking-tighter">
                             {stats.predictedScoreAway}
                         </span>
                         <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-1 truncate max-w-[100px]">
                             {game.awayTeam}
                         </span>
                     </div>
                     <div className="h-12 w-px bg-slate-200 dark:bg-slate-700"></div>
                     <div className="flex flex-col items-center">
                         {game.homeTeamLogo ? (
                             <img src={game.homeTeamLogo} alt={game.homeTeam} className="w-12 h-12 object-contain mb-2 drop-shadow-sm" />
                         ) : <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 mb-2"></div>}
                         <span className="text-3xl sm:text-4xl font-mono font-bold text-slate-900 dark:text-white tracking-tighter">
                             {stats.predictedScoreHome}
                         </span>
                         <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-1 truncate max-w-[100px]">
                             {game.homeTeam}
                         </span>
                     </div>
                </div>
                <div className="mt-4 text-center">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-mono text-slate-500">
                        Implied Total: {Math.round(stats.predictedScoreHome + stats.predictedScoreAway)}
                    </span>
                </div>
            </div>
        </div>

        {/* 3. Market Odds */}
        {displayOdds && (
            <div className="mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                 <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2 font-display">
                    <DollarSign size={14} className="text-emerald-500" />
                    Market Odds <span className="text-[10px] text-slate-300 dark:text-slate-600 font-medium ml-auto">{displayOdds.provider || 'ESPN BET'}</span>
                 </h4>
                 <div className="grid grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
                     <div className="flex flex-col items-center justify-center">
                         <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Spread</span>
                         <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{displayOdds.spread || '-'}</span>
                     </div>
                     <div className="flex flex-col items-center justify-center border-x border-slate-200 dark:border-slate-700/50">
                         <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Moneyline</span>
                         <div className="flex flex-col items-center text-xs font-mono font-medium text-slate-600 dark:text-slate-400 leading-tight">
                             <span>{game.awayTeam.substring(0,3).toUpperCase()} {displayOdds.moneyLineAway || '-'}</span>
                             <span>{game.homeTeam.substring(0,3).toUpperCase()} {displayOdds.moneyLineHome || '-'}</span>
                         </div>
                     </div>
                     <div className="flex flex-col items-center justify-center">
                         <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total</span>
                         <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{displayOdds.overUnder || '-'}</span>
                     </div>
                 </div>
            </div>
        )}

        {/* 4. Full Matchup Telemetry */}
        {Object.keys(categorizedStats).length > 0 ? (
             <div className="mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                 <div className="flex items-center justify-between mb-6">
                    <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2 font-display">
                        <BarChart2 size={14} /> Full Matchup Telemetry {game.status !== 'scheduled' && <span className="text-[10px] text-slate-400 ml-2">(Regular Season Avg)</span>}
                    </h4>
                 </div>
                 
                 <div className="space-y-8">
                    {Object.entries(categorizedStats).map(([category, items]) => (
                        <div key={category}>
                            <h5 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                                {category}
                            </h5>
                            <div className="space-y-3">
                                <div className="flex justify-between text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase px-1">
                                    <span>{game.awayTeam}</span>
                                    <span>{game.homeTeam}</span>
                                </div>
                                {items.map((stat, idx) => {
                                    const hVal = parseStatValue(stat.homeValue);
                                    const aVal = parseStatValue(stat.awayValue);
                                    const max = Math.max(hVal, aVal);
                                    const hBar = max > 0 ? (hVal / max) * 100 : 0;
                                    const aBar = max > 0 ? (aVal / max) * 100 : 0;
                                    
                                    let hWins = hVal > aVal;
                                    let aWins = aVal > hVal;
                                    
                                    if (category === 'Defense' || stat.label.includes('Turnover') || stat.label.includes('Interception') || stat.label.includes('Penalty')) {
                                        hWins = hVal < aVal;
                                        aWins = aVal < hVal;
                                    }
                                    
                                    // Visual Label Overrides for Clarity
                                    let displayLabel = stat.label;
                                    if (stat.label === 'Points') displayLabel = 'Points (Total)';
                                    if (stat.label === 'Points Against' || stat.label === 'Opponent Points') displayLabel = 'Points Against';
                                    
                                    return (
                                        <div key={idx} className="relative group">
                                            <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-700 dark:text-slate-300 relative z-10 px-1 mb-1">
                                                <span className={`flex items-center gap-1.5 ${aWins ? 'text-slate-900 dark:text-white' : 'opacity-70'}`}>
                                                    {stat.awayValue}
                                                    {stat.awayRank && <span className="text-[9px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-slate-500 font-sans tracking-tight">{getOrdinal(stat.awayRank)}</span>}
                                                </span>
                                                
                                                <span className="text-[10px] font-sans text-slate-500 dark:text-slate-400 font-medium text-center absolute left-1/2 -translate-x-1/2 w-full max-w-[50%] truncate">
                                                    {displayLabel}
                                                </span>
                                                
                                                <span className={`flex items-center gap-1.5 ${hWins ? 'text-slate-900 dark:text-white' : 'opacity-70'}`}>
                                                    {stat.homeRank && <span className="text-[9px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-slate-500 font-sans tracking-tight">{getOrdinal(stat.homeRank)}</span>}
                                                    {stat.homeValue}
                                                </span>
                                            </div>
                                            
                                            <div className="flex h-1.5 w-full bg-slate-50 dark:bg-slate-900/50 rounded-full overflow-hidden">
                                                <div className="flex-1 flex justify-end">
                                                    <div 
                                                        style={{ width: `${aBar}%`, backgroundColor: awayColor }} 
                                                        className="h-full rounded-l-full opacity-60 group-hover:opacity-100 transition-opacity"
                                                    ></div>
                                                </div>
                                                <div className="w-px bg-white dark:bg-slate-950/20 z-10"></div>
                                                <div className="flex-1 flex justify-start">
                                                    <div 
                                                        style={{ width: `${hBar}%`, backgroundColor: homeColor }} 
                                                        className="h-full rounded-r-full opacity-60 group-hover:opacity-100 transition-opacity"
                                                    ></div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                 </div>
             </div>
        ) : (
            stats.factorBreakdown && stats.factorBreakdown.length > 0 && (
                 <div className="mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                     <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2 font-display">
                        <Scale size={14} /> Efficiency Comparison
                     </h4>
                     <div className="space-y-4">
                         {stats.factorBreakdown.map((factor, idx) => {
                             const total = factor.homeValue + factor.awayValue;
                             const hPct = total > 0 ? (factor.homeValue / total) * 100 : 50;
                             return (
                                 <div key={idx}>
                                     <div className="flex justify-between items-end mb-1 text-[10px] uppercase font-bold text-slate-500">
                                         <span>{game.awayTeam}</span>
                                         <span className="text-slate-400">{factor.label}</span>
                                         <span>{game.homeTeam}</span>
                                     </div>
                                     <div className="flex justify-between items-end mb-1 text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                                         <span>{factor.displayAway}</span>
                                         <span>{factor.displayHome}</span>
                                     </div>
                                     <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                                         <div style={{ width: `${100 - hPct}%`, backgroundColor: awayColor }} className="h-full"></div>
                                         <div style={{ width: `${hPct}%`, backgroundColor: homeColor }} className="h-full"></div>
                                     </div>
                                 </div>
                             )
                         })}
                     </div>
                 </div>
            )
        )}

        {/* 5. Statistical Drivers */}
        {stats.calculationBreakdown && stats.calculationBreakdown.length > 0 && (
             <div className="mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                 <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2 font-display">
                    <Activity size={14} /> Statistical Drivers (Top 5)
                 </h4>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {stats.calculationBreakdown.slice(0, 5).map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors">
                            <div className="flex-1 pr-3">
                                <div className="flex items-center gap-2 mb-1.5">
                                    {getFactorIcon(item.label)}
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{item.label}</span>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                        item.impact === 'positive' 
                                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' 
                                            : item.impact === 'negative' 
                                                ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                    }`}>
                                        {item.impact === 'positive' 
                                            ? `${homeAbbr} Adv` 
                                            : item.impact === 'negative' 
                                                ? `${awayAbbr} Adv` 
                                                : 'Neutral'}
                                    </span>
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                    {item.description}
                                </div>
                            </div>
                            <div className="text-right pl-2 border-l border-slate-200 dark:border-slate-800">
                                <div className={`text-sm font-mono font-bold ${
                                    item.impact === 'positive' ? 'text-emerald-600 dark:text-emerald-400' : 
                                    item.impact === 'negative' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'
                                }`}>
                                    {item.value}
                                </div>
                                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Impact</div>
                            </div>
                        </div>
                    ))}
                 </div>
             </div>
        )}

        {/* 6. Season Leaders */}
        {!hideLeaders && leaderComparisons.length > 0 && (
            <div className="mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2 font-display">
                    <Star size={14} className="text-amber-500" /> Season Leaders
                </h4>
                <div className="space-y-3">
                    {leaderComparisons.map((item, idx) => (
                        <div key={idx} className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 sm:p-4 border border-slate-100 dark:border-slate-800">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
                                
                                <div className="sm:hidden flex justify-center -mt-1 mb-2">
                                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-2 py-1 bg-white dark:bg-slate-800 rounded-full border border-slate-100 dark:border-slate-700 whitespace-nowrap shadow-sm">
                                        {item.category}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 sm:flex sm:flex-1 items-center gap-4 w-full">
                                    
                                    <div 
                                        className="flex flex-col sm:flex-row items-center sm:gap-3 flex-1 min-w-0 text-center sm:text-left cursor-pointer hover:bg-white dark:hover:bg-slate-800/60 p-2 rounded-lg -m-2 transition-all group/player"
                                        onClick={() => handlePlayerClick(item.awayPlayer.id)}
                                    >
                                        <div className="w-10 h-10 sm:w-9 sm:h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 mb-2 sm:mb-0 shadow-sm relative group">
                                            {item.awayPlayer.headshot ? (
                                                <img src={item.awayPlayer.headshot} alt={item.awayPlayer.displayName} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                    <User size={16} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-0 w-full">
                                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate px-1 sm:px-0 group-hover/player:text-indigo-600 dark:group-hover/player:text-indigo-400 transition-colors">
                                                {item.awayPlayer.displayName}
                                            </div>
                                            <div className="text-sm sm:text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
                                                {item.awayPlayer.displayValue}
                                            </div>
                                            <div className="text-[9px] text-slate-400 uppercase sm:hidden mt-0.5">{game.awayTeam}</div>
                                        </div>
                                    </div>

                                    <div className="hidden sm:flex justify-center shrink-0">
                                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-2 py-1 bg-white dark:bg-slate-800 rounded border border-slate-100 dark:border-slate-700 whitespace-nowrap">
                                            {item.category}
                                        </div>
                                    </div>

                                    <div 
                                        className="flex flex-col sm:flex-row items-center sm:justify-end sm:gap-3 flex-1 min-w-0 text-center sm:text-right cursor-pointer hover:bg-white dark:hover:bg-slate-800/60 p-2 rounded-lg -m-2 transition-all group/player"
                                        onClick={() => handlePlayerClick(item.homePlayer.id)}
                                    >
                                        <div className="hidden sm:block min-w-0">
                                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover/player:text-indigo-600 dark:group-hover/player:text-indigo-400 transition-colors">
                                                {item.homePlayer.displayName}
                                            </div>
                                            <div className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
                                                {item.homePlayer.displayValue}
                                            </div>
                                        </div>

                                        <div className="w-10 h-10 sm:w-9 sm:h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 mb-2 sm:mb-0 shadow-sm">
                                            {item.homePlayer.headshot ? (
                                                <img src={item.homePlayer.headshot} alt={item.homePlayer.displayName} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                    <User size={16} />
                                                </div>
                                            )}
                                        </div>

                                        <div className="sm:hidden min-w-0 w-full">
                                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate px-1 group-hover/player:text-indigo-600 dark:group-hover/player:text-indigo-400 transition-colors">
                                                {item.homePlayer.displayName}
                                            </div>
                                            <div className="text-sm sm:text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
                                                {item.homePlayer.displayValue}
                                            </div>
                                            <div className="text-[9px] text-slate-400 uppercase sm:hidden mt-0.5">{game.homeTeam}</div>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* 7. AI Analysis */}
        {!hideAnalysis && (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2 font-display">
                    <Brain size={16} />
                    Qualitative Analysis
                </h4>
                
                {analysis && analysis.length > 0 ? (
                    <ul className="space-y-3">
                        {(analysis as any[]).map((point, idx) => (
                            <li key={idx} className="flex items-start gap-4">
                                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-900 dark:bg-white shrink-0" />
                                <span className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 font-medium">{point}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-6 text-center border border-dashed border-slate-200 dark:border-slate-800">
                        <button 
                            onClick={handleAnalysisClick}
                            disabled={isGenerating}
                            className="group relative inline-flex items-center justify-center gap-2 px-6 py-3 font-bold text-white transition-all duration-200 bg-slate-900 dark:bg-white dark:text-slate-900 rounded-xl hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden"
                        >
                            {isGenerating ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white dark:border-slate-900"></div>
                                    <span>Simulating...</span>
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} className="text-yellow-400" fill="currentColor" />
                                    <span>Run Gemini Simulation</span>
                                </>
                            )}
                            {!isGenerating && <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent z-10" />}
                        </button>
                        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                            Generate a 5-point rigorous breakdown using Gemini 3 Flash.
                        </p>
                    </div>
                )}
            </div>
        )}
      </div>

      {(groundingChunks && groundingChunks.length > 0 && !hideAnalysis) && (
        <div className="bg-white dark:bg-slate-900/40 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
            <GroundingSources chunks={groundingChunks} />
        </div>
      )}

      {showOutlookHelp && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col max-h-[85vh]">
                    <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
                                <Calculator size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white">Projection Logic</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Model Inputs & Weights</p>
                            </div>
                        </div>
                        <button onClick={() => setShowOutlookHelp(false)} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-0">
                        {/* New Methodology & Telemetry Explanation Section */}
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                            <div className="space-y-4">
                                <div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <Brain size={14} className="text-indigo-500" /> Methodology Overview
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                        We utilize a hybrid statistical engine. We establish a "Prior" probability based on historical power ratings, season averages, and market consensus. As live game data flows in, we use Bayesian inference to blend this prior with real-time performance to generate the final win probability and score.
                                    </p>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <BarChart2 size={14} className="text-emerald-500" /> Telemetry Decoding
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-2">
                                        The model analyzes key efficiency matchups. For example:
                                    </p>
                                    <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300 mb-1">
                                            <span>Stat A (Home Offense)</span>
                                            <span className="text-slate-400">vs</span>
                                            <span>Stat B (Away Defense)</span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                                            If Home Team averages 6.5 Yards Per Play, but Away Team allows only 4.2 YPP, the projected score is dampened to reflect the defensive mismatch.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {stats.calculationBreakdown && stats.calculationBreakdown.length > 0 ? (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                <div className="px-5 py-3 bg-slate-50/50 dark:bg-slate-900/30 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    Active Weighting Factors
                                </div>
                                {stats.calculationBreakdown.map((item, idx) => (
                                    <div key={idx} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.label}</span>
                                                    {item.impact !== 'neutral' && (
                                                        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                                                            item.impact === 'positive' 
                                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' 
                                                                : 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'
                                                        }`}>
                                                            {item.impact === 'positive' ? 'Advantage' : 'Disadvantage'}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                                    {item.description}
                                                </p>
                                            </div>
                                            <div className={`font-mono font-bold text-sm whitespace-nowrap ${
                                                item.impact === 'positive' ? 'text-emerald-600 dark:text-emerald-400' : 
                                                item.impact === 'negative' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
                                            }`}>
                                                {item.value}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-400 mb-3">
                                    <Activity size={24} />
                                </div>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Detailed calculation breakdown is not available for this game type.</p>
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed text-center">
                        These factors are weighted and summed to adjust the baseline projection. A Monte Carlo simulation (10,000 iterations) then determines the final win probability and score distribution.
                    </div>
                </div>
            </div>,
            document.body
      )}

      {selectedPlayerId && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative max-h-[90vh] flex flex-col">
                    <button onClick={() => setSelectedPlayerId(null)} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors z-10"><X size={18} /></button>
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-6 flex flex-col items-center text-center border-b border-slate-200 dark:border-slate-800">
                        <div className="w-24 h-24 rounded-full bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-800 shadow-md mb-4 overflow-hidden">
                            {displayPlayerInfo.headshot ? (<img src={displayPlayerInfo.headshot} alt={displayPlayerInfo.displayName} className="w-full h-full object-cover" />) : (<div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600"><User size={48} /></div>)}
                        </div>
                        <h2 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-1">{displayPlayerInfo.displayName}</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">#{displayPlayerInfo.jersey || '00'} • {displayPlayerInfo.position || ''}</p>
                        {playerProfile && (<div className="mt-3 flex gap-2 justify-center text-xs text-slate-400 dark:text-slate-500">{playerProfile.height && <span>{playerProfile.height}</span>}{playerProfile.weight && <span>• {playerProfile.weight} lbs</span>}{playerProfile.age && <span>• {playerProfile.age} yrs</span>}</div>)}
                    </div>
                    <div className="flex border-b border-slate-200 dark:border-slate-800">
                        <button onClick={() => setPlayerStatsMode('GAME')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${playerStatsMode === 'GAME' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'bg-slate-50 dark:bg-slate-900/50 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>This Game</button>
                        <button onClick={() => setPlayerStatsMode('SEASON')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${playerStatsMode === 'SEASON' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'bg-slate-50 dark:bg-slate-900/50 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Season Stats</button>
                    </div>
                    <div className="overflow-y-auto p-6 max-h-[400px]">
                        {playerStatsMode === 'GAME' ? (
                            activePlayerGameData ? (
                                <div className="grid grid-cols-2 gap-3">
                                    {activePlayerGameData.labels.map((label, i) => (
                                        <div key={i} className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">{label}</div>
                                            <div className="text-lg font-mono font-bold text-slate-900 dark:text-white">{activePlayerGameData.stats[i]}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-sm text-slate-400 italic">No stats available for this game yet.</div>
                            )
                        ) : (
                            isPlayerLoading ? (
                                <div className="flex flex-col items-center justify-center py-8">
                                    <Loader2 size={24} className="text-slate-500 animate-spin mb-3" />
                                    <p className="text-xs text-slate-500">Retrieving season stats...</p>
                                </div>
                            ) : playerProfile?.stats && playerProfile.stats.length > 0 ? (
                                <div className="space-y-6">
                                    {playerProfile.stats.map((group, idx) => (
                                        <div key={idx}>
                                            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">{group.title}</h4>
                                            <div className="grid grid-cols-2 gap-3">
                                                {group.data.map((item, i) => (
                                                    <div key={i} className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">{item.label}</div>
                                                        <div className="text-lg font-mono font-bold text-slate-900 dark:text-white">{item.value}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-sm text-slate-400 italic py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">No detailed season statistics available.</div>
                            )
                        )}
                    </div>
                </div>
            </div>,
            document.body
        )}
    </div>
  );
};
