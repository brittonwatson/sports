
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Game, PredictionResult, SOCCER_LEAGUES, Sport, GameDetails, TeamStat, CalculationDetailItem, PlayerProfile, Player } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Brain, TrendingUp, ShieldCheck, List, Sparkles, Activity, Scale, DollarSign, Target, Wind, Hammer, Timer, Gauge, Footprints, BarChart2, TrendingDown, X, Zap, Star, User, Calculator, Loader2 } from 'lucide-react';
import { GroundingSources } from './GroundingSources';
import { fetchPlayerProfile } from '../services/playerService';
import { getTeamColor } from '../services/uiUtils';
import { getGameTeamAbbreviation } from '../services/teamAbbreviation';

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

const getFactorIcon = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('air') || l.includes('pass')) return <Wind size={14} className="text-sky-500" />;
    if (l.includes('ground') || l.includes('rush')) return <Footprints size={14} className="text-amber-600" />;
    if (l.includes('trench') || l.includes('sack')) return <Hammer size={14} className="text-slate-600 dark:text-slate-400" />;
    if (l.includes('pace') || l.includes('tempo') || l.includes('possession') || l.includes('time')) return <Timer size={14} className="text-indigo-500" />;
    if (l.includes('red zone') || l.includes('leverage')) return <Target size={14} className="text-rose-500" />;
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
  const drawProbability = Math.max(0, Math.min(100, stats.drawProbability ?? 0));
  const hasDrawOutcome = isSoccer || drawProbability > 0.01;

  const homeColor = getTeamColor(game.homeTeamColor, game.homeTeamAlternateColor, isDarkMode);
  const awayColor = getTeamColor(game.awayTeamColor, game.awayTeamAlternateColor, isDarkMode);
  const probabilityRows: Array<{ id: 'home' | 'away' | 'draw'; name: string; value: number; color: string }> = (
      isSoccer
          ? [
                { id: 'home', name: game.homeTeam, value: stats.winProbabilityHome, color: homeColor },
                { id: 'away', name: game.awayTeam, value: stats.winProbabilityAway, color: awayColor },
            ]
          : [
                { id: 'away', name: game.awayTeam, value: stats.winProbabilityAway, color: awayColor },
                { id: 'home', name: game.homeTeam, value: stats.winProbabilityHome, color: homeColor },
            ]
  );
  if (hasDrawOutcome) {
      probabilityRows.splice(1, 0, {
          id: 'draw',
          name: 'Draw',
          value: drawProbability,
          color: isDarkMode ? '#94a3b8' : '#64748b',
      });
  }
  const winData = probabilityRows.map((row) => ({ name: row.name, value: row.value, color: row.color }));

  const handleAnalysisClick = () => {
      if (onGenerateAnalysis) {
          setIsGenerating(true);
          onGenerateAnalysis();
          setTimeout(() => setIsGenerating(false), 8000); 
      }
  };

  const homeAbbr = getGameTeamAbbreviation(game, 'home');
  const awayAbbr = getGameTeamAbbreviation(game, 'away');

  const getImpactMeta = (impact: CalculationDetailItem['impact']) => {
      if (impact === 'positive') {
          return {
              favoredTeam: game.homeTeam,
              favoredAbbr: homeAbbr,
              disadvantagedTeam: game.awayTeam,
              disadvantagedAbbr: awayAbbr,
              favoredColor: homeColor,
          };
      }
      if (impact === 'negative') {
          return {
              favoredTeam: game.awayTeam,
              favoredAbbr: awayAbbr,
              disadvantagedTeam: game.homeTeam,
              disadvantagedAbbr: homeAbbr,
              favoredColor: awayColor,
          };
      }
      return {
          favoredTeam: '',
          favoredAbbr: '',
          disadvantagedTeam: '',
          disadvantagedAbbr: '',
          favoredColor: '',
      };
  };

  const getMatchupExplainerText = (item: CalculationDetailItem): string => {
      const meta = getImpactMeta(item.impact);
      if (item.impact === 'neutral') {
          return `${item.label} is balanced for ${game.homeTeam} and ${game.awayTeam} (${item.value}). ${item.description}`;
      }
      return `${item.label} favors ${meta.favoredTeam} over ${meta.disadvantagedTeam} (${item.value}). ${item.description}`;
  };

  const matchupEdgeReport = useMemo(() => {
      const homeEdges = (stats.calculationBreakdown || [])
          .filter((item) => item.impact === 'positive')
          .slice(0, 5);
      const awayEdges = (stats.calculationBreakdown || [])
          .filter((item) => item.impact === 'negative')
          .slice(0, 5);
      const neutralEdges = (stats.calculationBreakdown || [])
          .filter((item) => item.impact === 'neutral')
          .slice(0, 3);
      return { homeEdges, awayEdges, neutralEdges };
  }, [stats.calculationBreakdown]);

  const displayStats = useMemo(() => {
      if (gameDetails?.seasonStats && gameDetails.seasonStats.length > 0) {
          return gameDetails.seasonStats;
      }
      if (game.status === 'scheduled') {
          return gameDetails?.stats || [];
      }
      return []; 
  }, [gameDetails, game.status]);

  const categorizedStats = useMemo(() => {
      if (!displayStats || displayStats.length === 0) return {} as Record<string, TeamStat[]>;
      
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
          'Shooting': [], 
          'Rebounding': [], 
          'Ball Control': [], 
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

      if (isBasketball) {
          const ordered: Record<string, TeamStat[]> = {};
          if (categories['Offense']) ordered['Offense'] = categories['Offense'];
          if (categories['Shooting']) ordered['Shooting'] = categories['Shooting'];
          if (categories['Defense']) ordered['Defense'] = categories['Defense'];
          if (categories['Rebounding']) ordered['Rebounding'] = categories['Rebounding'];
          if (categories['Ball Control']) ordered['Ball Control'] = categories['Ball Control'];
          Object.keys(categories).forEach(k => {
              if (!ordered[k]) ordered[k] = categories[k];
          });
          return ordered;
      }

      return categories;
  }, [displayStats, isBasketball]);

  const leaderComparisons = useMemo(() => {
      if (hideLeaders || !gameDetails?.leaders || gameDetails.leaders.length < 2) return [];
      
      const homeLeaders = gameDetails.leaders.find(l => l.team.id === game.homeTeamId || l.team.id === String(game.homeTeamId));
      const awayLeaders = gameDetails.leaders.find(l => l.team.id === game.awayTeamId || l.team.id === String(game.awayTeamId));
      
      if (!homeLeaders || !awayLeaders) return [];

      const comparisons = [];
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

  const getDetailedOutlook = () => {
    const outcomeRows: Array<{ id: 'home' | 'away' | 'draw'; label: string; probability: number }> = [
        { id: 'home', label: game.homeTeam, probability: stats.winProbabilityHome },
        { id: 'away', label: game.awayTeam, probability: stats.winProbabilityAway },
    ];
    if (hasDrawOutcome) {
        outcomeRows.push({ id: 'draw', label: 'draw', probability: drawProbability });
    }
    const topOutcome = [...outcomeRows].sort((a, b) => b.probability - a.probability)[0];
    const prob = topOutcome.probability.toFixed(1);
    const isHomeFav = topOutcome.id === 'home';
    
    const meaningfulFactors = stats.calculationBreakdown
        .filter(f => f.impact !== 'neutral' && !f.label.includes('Power Rating') && !f.label.includes('Home Court'))
        .sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
        .slice(0, 3);
    
    let efficiencyText = "";
    if (stats.factorBreakdown.length > 0) {
        const biggestMismatch = [...stats.factorBreakdown].sort((a, b) => {
            const diffA = Math.abs(a.homeValue - a.awayValue);
            const diffB = Math.abs(b.homeValue - b.awayValue);
            return diffB - diffA;
        })[0];

        if (biggestMismatch) {
            const homeBetter = biggestMismatch.homeValue > biggestMismatch.awayValue;
            const invert = biggestMismatch.label.includes('Turnover') || biggestMismatch.label.includes('Allowed');
            const advTeam = (homeBetter && !invert) || (!homeBetter && invert) ? game.homeTeam : game.awayTeam;
            efficiencyText = `Crucially, ${advTeam} holds a significant statistical advantage in ${biggestMismatch.label} (${biggestMismatch.displayHome} vs ${biggestMismatch.displayAway}), creating a structural mismatch.`;
        }
    }

    const factorText = meaningfulFactors.length > 0 
        ? `Key variables driving this forecast include ${meaningfulFactors.map(f => {
            const meta = getImpactMeta(f.impact);
            if (f.impact === 'neutral') return `${f.label} (balanced)`;
            return `${f.label} favoring ${meta.favoredTeam}`;
        }).join(', ')}.` 
        : topOutcome.id === 'draw'
            ? 'The current matchup profile is balanced enough that the draw channel remains highly competitive.'
            : `This prediction relies heavily on ${isHomeFav ? 'historical home field advantage' : 'roster power ratings'} and recent form.`;

    const liveContext = game.status === 'in_progress' 
        ? `As this match is live, our model is actively blending the pre-game prior with real-time efficiency data. The current pace is ${stats.calculationBreakdown.some(f=>f.label.toLowerCase().includes('tempo') || f.label.toLowerCase().includes('pace')) ? 'accelerating' : 'stabilizing'}, shifting the projected total.${hasDrawOutcome ? ' Draw probability is calculated from the current scoreline plus remaining-goal distributions for each side.' : ''}` 
        : `The projected score of ${stats.predictedScoreAway}-${stats.predictedScoreHome} is produced from weighted offense-vs-defense matchup modeling, team context, and opponent-adjusted team history.`;

    const matchupExplainers = meaningfulFactors.map(getMatchupExplainerText);

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {topOutcome.id === 'draw' ? (
                    <>Our predictive engine calculates a <strong>{prob}% probability</strong> of a <strong>draw</strong>. {factorText}</>
                ) : (
                    <>Our predictive engine calculates a <strong>{prob}% probability</strong> of victory for the <strong>{topOutcome.label}</strong>. {factorText}</>
                )}
            </p>
            {matchupExplainers.length > 0 && (
                <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Matchup Explainers</p>
                    {matchupExplainers.map((text, idx) => (
                        <p key={idx} className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {text}
                        </p>
                    ))}
                </div>
            )}
            {efficiencyText && (
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {efficiencyText}
                </p>
            )}
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-3 mt-3">
                {liveContext}
            </p>
        </div>
    );
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="bg-white dark:bg-slate-900/40 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
        
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
                        Model v1.6 &rarr;
                    </span>
                </div>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div 
                onClick={() => setShowOutlookHelp(true)}
                className="flex flex-col p-5 rounded-2xl bg-slate-50/50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-md transition-all duration-300 group/card relative overflow-hidden"
            >
                <div className="absolute inset-0 bg-indigo-50/0 group-hover/card:bg-indigo-50/30 dark:group-hover/card:bg-indigo-900/10 transition-colors" />
                
                <div className="relative z-10 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-4">
                        <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                            <Brain size={14} /> Win Probability
                        </h4>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-md text-[10px] font-semibold transition-colors">
                            <ShieldCheck size={12} className={stats.confidence > 70 ? "text-emerald-500" : stats.confidence < 55 ? "text-amber-500" : "text-slate-500"} />
                            <span className="text-slate-700 dark:text-slate-100">{stats.confidence.toFixed(0)}% Conf</span>
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
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                                </Pie>
                            </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-200">WIN%</span>
                            </div>
                        </div>
                        
                        <div className="flex-1 space-y-3">
                            {probabilityRows.map((row) => (
                                <div key={row.id}>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="font-semibold truncate max-w-[120px] text-slate-700 dark:text-slate-100">{row.name}</span>
                                        <span className="font-bold font-mono" style={{ color: row.color }}>{row.value.toFixed(1)}%</span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                        <div className="h-full transition-all duration-1000" style={{ width: `${Math.max(0, Math.min(100, row.value))}%`, backgroundColor: row.color }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div 
                onClick={() => setShowOutlookHelp(true)}
                className="flex flex-col p-5 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all duration-300 group/card relative overflow-hidden"
            >
                <div className="absolute inset-0 bg-indigo-50/0 group-hover/card:bg-indigo-50/30 dark:group-hover/card:bg-indigo-900/10 transition-colors" />
                <div className="relative z-10 flex flex-col h-full">
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
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-mono text-slate-500 transition-colors">
                            Implied Total: {Math.round(stats.predictedScoreHome + stats.predictedScoreAway)}
                        </span>
                    </div>
                </div>
            </div>
        </div>

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
                             <span>{awayAbbr} {displayOdds.moneyLineAway || '-'}</span>
                             <span>{homeAbbr} {displayOdds.moneyLineHome || '-'}</span>
                         </div>
                     </div>
                     <div className="flex flex-col items-center justify-center">
                         <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total</span>
                         <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{displayOdds.overUnder || '-'}</span>
                     </div>
                 </div>
            </div>
        )}

        {/* STATISTICAL DRIVERS with Visual Impact Bar */}
        {stats.calculationBreakdown && stats.calculationBreakdown.length > 0 && (
             <div className="mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                 <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2 font-display">
                    <Activity size={14} /> Statistical Drivers (Top 5)
                 </h4>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {stats.calculationBreakdown.slice(0, 5).map((item, idx) => {
                        const meta = getImpactMeta(item.impact);
                        return (
                            <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors">
                                <div className="flex-1 pr-3">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        {getFactorIcon(item.label)}
                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{item.label}</span>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                            item.impact === 'neutral'
                                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                                : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                        }`}>
                                            {item.impact === 'neutral' ? 'Balanced' : `Favors ${meta.favoredAbbr}`}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                        {item.description}
                                    </div>
                                    {item.impact !== 'neutral' && (
                                        <div className="mt-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                            Matchup edge: {meta.favoredTeam} over {meta.disadvantagedTeam}
                                        </div>
                                    )}
                                </div>
                                <div className="text-right pl-3 border-l border-slate-200 dark:border-slate-800 w-24">
                                    <div
                                        className="text-sm font-mono font-bold mb-1 text-slate-600 dark:text-slate-300"
                                        style={item.impact === 'neutral' ? undefined : { color: meta.favoredColor }}
                                    >
                                        {item.value}
                                    </div>
                                    <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
                                        <div
                                            className="h-full w-full animate-[pulse_3s_ease-in-out_infinite]"
                                            style={{ backgroundColor: item.impact === 'neutral' ? '#94a3b8' : meta.favoredColor }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                 </div>
             </div>
        )}

        {stats.calculationBreakdown && stats.calculationBreakdown.length > 0 && (
            <div className="mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2 font-display">
                    <Scale size={14} /> Matchup Edge Report
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-3">
                            {game.homeTeam} Positive Factors
                        </div>
                        {matchupEdgeReport.homeEdges.length > 0 ? (
                            <div className="space-y-2">
                                {matchupEdgeReport.homeEdges.map((item, idx) => (
                                    <div key={idx} className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
                                        <span className="font-bold">{item.label}</span>: {item.description}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80">No strong positive edge currently identified.</div>
                        )}
                    </div>
                    <div className="rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 mb-3">
                            {game.awayTeam} Positive Factors
                        </div>
                        {matchupEdgeReport.awayEdges.length > 0 ? (
                            <div className="space-y-2">
                                {matchupEdgeReport.awayEdges.map((item, idx) => (
                                    <div key={idx} className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
                                        <span className="font-bold">{item.label}</span>: {item.description}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-blue-700/80 dark:text-blue-300/80">No strong positive edge currently identified.</div>
                        )}
                    </div>
                </div>
                {matchupEdgeReport.neutralEdges.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Balanced Factors</div>
                        <div className="space-y-1">
                            {matchupEdgeReport.neutralEdges.map((item, idx) => (
                                <div key={idx} className="text-xs text-slate-600 dark:text-slate-300">
                                    <span className="font-semibold">{item.label}</span>: {item.description}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* Season Leaders */}
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
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

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
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                            <div className="space-y-4">
                                <div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <Brain size={14} className="text-indigo-500" /> Methodology Overview
                                    </h4>
                                    {getDetailedOutlook()}
                                </div>
                            </div>
                        </div>

                        {stats.calculationBreakdown && stats.calculationBreakdown.length > 0 ? (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                <div className="px-5 py-3 bg-slate-50/50 dark:bg-slate-900/30 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    Active Weighting Factors
                                </div>
                                {stats.calculationBreakdown.map((item, idx) => {
                                    const meta = getImpactMeta(item.impact);
                                    return (
                                        <div key={idx} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                                            <div className="flex justify-between items-start gap-4">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.label}</span>
                                                        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                                                            item.impact === 'neutral'
                                                                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                                                : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                                        }`}>
                                                            {item.impact === 'neutral' ? 'Balanced' : `Favors ${meta.favoredAbbr}`}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                                        {item.description}
                                                    </p>
                                                    {item.impact !== 'neutral' && (
                                                        <p className="text-[11px] mt-1 font-semibold text-slate-600 dark:text-slate-300">
                                                            Matchup read: {meta.favoredTeam} has the edge against {meta.disadvantagedTeam}.
                                                        </p>
                                                    )}
                                                </div>
                                                <div
                                                    className="font-mono font-bold text-sm whitespace-nowrap text-slate-500 dark:text-slate-400"
                                                    style={item.impact === 'neutral' ? undefined : { color: meta.favoredColor }}
                                                >
                                                    {item.value}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
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
