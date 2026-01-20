
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Game, GameDetails, PredictionResult, SOCCER_LEAGUES, Sport, GameSituation, PlayerProfile, Player, ScoringPlay, Play, TeamStat } from '../types';
import { Radio, Target, Activity, ChevronDown, ChevronUp, Brain, CheckCircle2, Clock, Play as PlayIcon, Sparkles, Table, X, Loader2, User as UserIcon, CircleDot, Disc, Zap, Hash, BarChart2, Calendar, TrendingUp, HelpCircle, BookOpen, Calculator, List, Scale, MapPin, CloudSun, Tv } from 'lucide-react';
import { fetchPlayerProfile } from '../services/playerService';
import { PredictionView } from './PredictionView';

interface LiveGameViewProps {
  game: Game;
  gameDetails: GameDetails | null;
  prediction: PredictionResult | null;
  isDarkMode: boolean;
  onGenerateAnalysis?: () => void;
  onTeamClick?: (teamId: string, league: Sport) => void;
}

interface FieldProps {
    situation: GameSituation; 
    homeTeam: string; 
    awayTeam: string; 
    game: Game;
    isDarkMode: boolean;
    gameDetails?: GameDetails | null;
    onPlayerClick?: (playerId: string) => void;
    compact?: boolean;
}

const getTeamColor = (primary: string | undefined, alternate: string | undefined, isDarkMode: boolean): string => {
    const defaultColor = isDarkMode ? '#e5e5e5' : '#171717'; 
    
    if (!primary) return defaultColor;

    const p = primary.toLowerCase().replace('#', '');
    const a = alternate ? alternate.toLowerCase().replace('#', '') : null;

    const isBlack = p === '000000';
    const isWhite = p === 'ffffff';

    if (isDarkMode && isBlack) {
        return a && a !== '000000' ? `#${a}` : '#ffffff';
    }
    
    if (!isDarkMode && isWhite) {
        return a && a !== 'ffffff' ? `#${a}` : '#000000';
    }

    return primary;
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

const FootballField: React.FC<FieldProps> = ({ situation, homeTeam, awayTeam, game, isDarkMode, compact, gameDetails }) => {
    const { yardLine, possession, homeTimeouts, awayTimeouts, downDistanceText, possessionText } = situation;
    const normPossession = possession ? String(possession) : null;
    const normHomeId = game.homeTeamId ? String(game.homeTeamId) : 'home';
    const normAwayId = game.awayTeamId ? String(game.awayTeamId) : 'away';
    const currentPeriod = gameDetails?.period || game.period || 1;
    const isOddQuarter = currentPeriod % 2 !== 0;
    const leftTeamId = isOddQuarter ? normAwayId : normHomeId;
    const rightTeamId = isOddQuarter ? normHomeId : normAwayId;
    const leftTeamName = isOddQuarter ? awayTeam : homeTeam;
    const leftTeamColor = isOddQuarter 
        ? getTeamColor(game.awayTeamColor, game.awayTeamAlternateColor, isDarkMode)
        : getTeamColor(game.homeTeamColor, game.homeTeamAlternateColor, isDarkMode);
    const rightTeamName = isOddQuarter ? homeTeam : awayTeam;
    const rightTeamColor = isOddQuarter
        ? getTeamColor(game.homeTeamColor, game.homeTeamAlternateColor, isDarkMode)
        : getTeamColor(game.awayTeamColor, game.awayTeamAlternateColor, isDarkMode);
    const isHomePossession = normPossession === normHomeId;
    const isAwayPossession = normPossession === normAwayId;
    let ballPos = 50;
    if (yardLine !== undefined) {
         if (normPossession === leftTeamId) ballPos = yardLine;
         else if (normPossession === rightTeamId) ballPos = 100 - yardLine;
         else ballPos = yardLine; 
    }
    ballPos = Math.max(0, Math.min(100, ballPos));
    const renderTimeouts = (count: number | undefined) => (
        <div className="flex gap-1.5">
            {[...Array(3)].map((_, i) => (
                <div key={i} className={`h-2.5 w-8 rounded-sm transition-all duration-300 ${i < (count || 0) ? 'bg-slate-900 dark:bg-white shadow-sm' : 'bg-slate-200 dark:bg-slate-800'}`} />
            ))}
        </div>
    );
    const yardLines = Array.from({ length: 19 }, (_, i) => (i + 1) * 5);
    const displayClock = gameDetails?.clock || game.clock || '00:00';
    return (
        <div className={compact ? "bg-slate-50/30 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800" : "bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm mb-6"}>
            <div className="flex justify-between items-center px-5 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800/50">
                <div className="flex flex-col items-start gap-1.5">
                    <div className="flex items-center gap-2"><span className="text-sm font-bold font-display text-slate-900 dark:text-white leading-none">{awayTeam}</span>{isAwayPossession && <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>}</div>
                    {renderTimeouts(awayTimeouts)}
                </div>
                <div className="hidden sm:flex flex-col items-center justify-center">
                    <div className="flex items-baseline gap-2 mb-1.5"><span className="text-2xl font-mono font-black text-slate-900 dark:text-white tracking-tight leading-none">{displayClock}</span><span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Q{currentPeriod}</span></div>
                    <div className="flex items-center gap-2"><div className="text-xs font-bold font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-2.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 shadow-sm">{downDistanceText || '1st & 10'}</div>{possessionText && (<div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">{possessionText}</div>)}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-2">{isHomePossession && <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>}<span className="text-sm font-bold font-display text-slate-900 dark:text-white leading-none">{homeTeam}</span></div>
                    {renderTimeouts(homeTimeouts)}
                </div>
            </div>
            <div className="sm:hidden flex items-center justify-between px-5 py-2.5 bg-slate-50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-800/50">
                 <div className="flex items-center gap-2"><Clock size={12} className="text-slate-400" /><span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{displayClock}</span><span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 border-l border-slate-200 dark:border-slate-700 pl-2">Q{currentPeriod}</span></div>
                 <div className="flex items-center gap-3"><span className="text-xs font-bold text-slate-700 dark:text-slate-300">{downDistanceText || '1st & 10'}</span>{possessionText && <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">{possessionText}</span>}</div>
            </div>
            <div className="relative w-full h-32 sm:h-48 md:h-64 bg-gradient-to-b from-emerald-800 to-emerald-900 border-t border-b border-emerald-950/20 shadow-inner select-none overflow-hidden transition-all duration-300">
                <svg width="100%" height="100%" className="absolute inset-0" preserveAspectRatio="none"><defs><pattern id="grass" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#065f46" fillOpacity="0.1" /></pattern></defs><rect width="100%" height="100%" fill="url(#grass)" /><rect x="0%" y="0" width="8.33%" height="100%" fill={leftTeamColor} /><rect x="91.67%" y="0" width="8.33%" height="100%" fill={rightTeamColor} />{yardLines.map(y => { const isMajor = y % 10 === 0; const isMidfield = y === 50; const xPos = 8.33 + (y * 0.8333); return <line key={y} x1={`${xPos}%`} y1="0" x2={`${xPos}%`} y2="100%" stroke="white" strokeOpacity={isMidfield ? "0.8" : (isMajor ? "0.5" : "0.2")} strokeWidth={isMidfield ? "2" : (isMajor ? "1.5" : "1")} />; })}</svg>
                <div className="absolute top-0 bottom-0 left-0 w-[8.33%] flex items-center justify-center pointer-events-none overflow-hidden"><span className="text-white/90 font-display font-black uppercase tracking-widest text-[10px] sm:text-xs whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>{leftTeamName}</span></div>
                <div className="absolute top-0 bottom-0 right-0 w-[8.33%] flex items-center justify-center pointer-events-none overflow-hidden"><span className="text-white/90 font-display font-black uppercase tracking-widest text-[10px] sm:text-xs whitespace-nowrap" style={{ writingMode: 'vertical-rl', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>{rightTeamName}</span></div>
                {game.homeTeamLogo && (<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-12 h-12 sm:w-20 sm:h-20 opacity-40 pointer-events-none mix-blend-overlay"><img src={game.homeTeamLogo} alt="" className="w-full h-full object-contain" /></div>)}
                <div className="absolute inset-0 hidden sm:block pointer-events-none">{[10, 20, 30, 40, 50, 60, 70, 80, 90].map(y => { const xPos = 8.33 + (y * 0.8333); const displayNum = y > 50 ? 100 - y : y; return (<React.Fragment key={y}><div className="absolute top-[20%] text-[10px] font-bold text-white/70 font-mono -translate-x-1/2" style={{ left: `${xPos}%` }}>{displayNum}</div><div className="absolute bottom-[20%] text-[10px] font-bold text-white/70 font-mono -translate-x-1/2" style={{ left: `${xPos}%` }}>{displayNum}</div></React.Fragment>); })}</div>
                <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-10 shadow-[0_0_8px_rgba(96,165,250,0.8)] transition-all duration-700 ease-out" style={{ left: `${8.33 + (ballPos * 0.8333)}%` }}></div>
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-3 -ml-2 z-20 transition-all duration-700 ease-out flex items-center justify-center" style={{ left: `${8.33 + (ballPos * 0.8333)}%` }}><div className="w-full h-full bg-amber-700 rounded-[50%] border border-white/90 shadow-sm relative overflow-hidden"><div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-white/50 -translate-x-1/2"></div></div></div>
            </div>
        </div>
    );
};

const BaseballDiamond: React.FC<FieldProps> = ({ situation }) => {
    const { balls, strikes, outs, onFirst, onSecond, onThird, batter, pitcher } = situation;
    const baseOn = "bg-amber-400 border-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.8)]";
    const baseOff = "bg-slate-700/50 border-slate-600";
    return (
        <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm mb-6 flex">
            <div className="relative w-1/2 sm:w-2/5 aspect-square bg-emerald-900 border-r border-emerald-950/20 flex items-center justify-center">
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_70%,_var(--tw-gradient-stops))] from-emerald-800 via-emerald-900 to-emerald-950"></div>
                 <div className="relative w-32 h-32 transform rotate-45">
                     <div className="absolute inset-0 border-2 border-white/10"></div>
                     <div className={`absolute top-0 right-0 w-5 h-5 -mt-2.5 -mr-2.5 rotate-[-45deg] rounded-sm border-2 transition-all duration-300 ${onFirst ? baseOn : baseOff}`}></div>
                     <div className={`absolute top-0 left-0 w-5 h-5 -mt-2.5 -ml-2.5 rotate-[-45deg] rounded-sm border-2 transition-all duration-300 ${onSecond ? baseOn : baseOff}`}></div>
                     <div className={`absolute bottom-0 left-0 w-5 h-5 -mb-2.5 -ml-2.5 rotate-[-45deg] rounded-sm border-2 transition-all duration-300 ${onThird ? baseOn : baseOff}`}></div>
                     <div className="absolute bottom-0 right-0 w-5 h-5 -mb-2.5 -mr-2.5 rotate-[-45deg] bg-white border-2 border-slate-300"></div>
                     <div className="absolute top-1/2 left-1/2 w-4 h-4 -mt-2 -ml-2 rounded-full bg-amber-800 border border-amber-900/50"></div>
                 </div>
            </div>
            <div className="flex-1 p-5 flex flex-col justify-center gap-6 bg-slate-50 dark:bg-slate-900/50">
                 <div className="flex justify-between items-start">
                     <div className="space-y-1"><div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Pitching</div><div className="text-sm font-bold text-slate-800 dark:text-white">{pitcher || 'Pitcher'}</div></div>
                     <div className="text-right space-y-1"><div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">At Bat</div><div className="text-sm font-bold text-slate-800 dark:text-white">{batter || 'Batter'}</div></div>
                 </div>
                 <div className="flex items-center justify-center gap-6">
                     <div className="flex flex-col items-center gap-1"><span className="text-2xl font-mono font-bold text-slate-900 dark:text-white">{balls || 0}-{strikes || 0}</span><span className="text-xs font-bold text-slate-400 uppercase">Count</span></div>
                     <div className="w-px h-10 bg-slate-200 dark:bg-slate-800"></div>
                     <div className="flex flex-col items-center gap-1"><div className="flex gap-1">{[...Array(3)].map((_, i) => (<div key={i} className={`w-3 h-3 rounded-full ${i < (outs || 0) ? 'bg-rose-500' : 'bg-slate-200 dark:bg-slate-700'}`}></div>))}</div><span className="text-xs font-bold text-slate-400 uppercase mt-1">Outs</span></div>
                 </div>
            </div>
        </div>
    );
};

const ActiveLineupList: React.FC<FieldProps & { type: 'BASKETBALL' | 'HOCKEY' | 'SOCCER' }> = ({ situation, homeTeam, awayTeam, game, gameDetails, type, onPlayerClick }) => {
    const [viewTeam, setViewTeam] = useState<'home' | 'away'>('away');
    const isBasketball = type === 'BASKETBALL';
    const isHockey = type === 'HOCKEY';
    const getStarters = (teamId: string | undefined): Player[] => {
        if (!gameDetails?.boxscore || !teamId) return [];
        const teamBox = gameDetails.boxscore.find(t => t.teamId === teamId);
        if (!teamBox) return [];
        const allPlayers = teamBox.groups.flatMap(g => g.players.map(p => p.player)) as Player[];
        let starters = allPlayers.filter(p => p.isStarter);
        if (starters.length === 0) {
            const limit = isBasketball ? 5 : (isHockey ? 6 : 11);
            starters = allPlayers.slice(0, limit);
        }
        return Array.from(new Map(starters.map((p): [string, Player] => [p.id, p])).values());
    };
    const activeTeamId = viewTeam === 'home' ? game.homeTeamId : game.awayTeamId;
    const activePlayers = getStarters(activeTeamId);
    const sortOrder: Record<string, number> = { 'GK': 0, 'G': 1, 'D': 2, 'M': 3, 'F': 4, 'C': 5 };
    const sortedPlayers = [...activePlayers].sort((a: Player, b: Player) => {
        const getPosChar = (p: Player) => p.position ? p.position.charAt(0) : 'F';
        return (sortOrder[getPosChar(a)] ?? 9) - (sortOrder[getPosChar(b)] ?? 9);
    });
    return (
        <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col transition-all duration-300 w-full mb-6">
             <div className="flex flex-col gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                 <div className="flex items-center gap-2"><UserIcon size={14} className="text-slate-400" /><span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Active Lineup</span></div>
                 <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5 w-full">
                     <button onClick={() => setViewTeam('away')} className={`flex-1 px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all truncate min-w-0 ${viewTeam === 'away' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>{awayTeam}</button>
                     <button onClick={() => setViewTeam('home')} className={`flex-1 px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all truncate min-w-0 ${viewTeam === 'home' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>{homeTeam}</button>
                 </div>
             </div>
             {sortedPlayers.length === 0 ? (
                 <div className="p-8 text-center"><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Lineup Not Available</p></div>
             ) : (
                 <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                     {sortedPlayers.map(player => (
                         <div key={player.id} onClick={() => onPlayerClick && onPlayerClick(player.id)} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group">
                             <div className="flex items-center gap-4">
                                 {player.headshot ? (
                                     <img src={player.headshot} alt="" className="w-8 h-8 rounded-full object-cover bg-slate-100 dark:bg-slate-800" />
                                 ) : (
                                     <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400">{player.jersey || '#'}</div>
                                 )}
                                 <div className="flex flex-col">
                                     <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-slate-300 transition-colors">{player.displayName}</span>
                                     <span className="text-[10px] text-slate-400 dark:text-slate-500">{player.position} {player.jersey ? `• #${player.jersey}` : ''}</span>
                                 </div>
                             </div>
                             <div className="p-1.5 rounded-full text-slate-300 dark:text-slate-600 group-hover:bg-slate-100 dark:group-hover:bg-slate-800 group-hover:text-slate-500 dark:group-hover:text-slate-300 transition-all">
                                 <BarChart2 size={16} />
                             </div>
                         </div>
                     ))}
                 </div>
             )}
        </div>
    );
};

const BasketballLinescoreTable: React.FC<{ game: Game, gameDetails: GameDetails | null }> = ({ game, gameDetails }) => {
    if (!gameDetails) return null;
    const isNCAAM = game.league === 'NCAAM';
    const minPeriods = isNCAAM ? 2 : 4;
    const maxDataPeriod = gameDetails.linescores.length > 0 ? Math.max(...gameDetails.linescores.map(ls => ls.period)) : 0;
    const totalPeriods = Math.max(minPeriods, maxDataPeriod);
    return (<div className="overflow-x-auto"><table className="w-full text-center text-xs"><thead><tr className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700"><th className="px-2 py-1.5 text-left">Team</th>{Array.from({ length: totalPeriods }).map((_, i) => { const p = i + 1; let label = String(p); if (isNCAAM) { if (p === 1) label = '1st'; else if (p === 2) label = '2nd'; else label = `OT${p-2 > 1 ? p-2 : ''}`; } else { if (p <= 4) label = `Q${p}`; else label = `OT${p-4 > 1 ? p-4 : ''}`; } return <th key={p} className="px-1.5 py-1.5 min-w-[24px]">{label}</th>; })}<th className="px-2 py-1.5 text-slate-800 dark:text-white font-bold">T</th></tr></thead><tbody className="font-mono">{[{ name: game.awayTeam, logo: game.awayTeamLogo, score: game.awayScore, isHome: false }, { name: game.homeTeam, logo: game.homeTeamLogo, score: game.homeScore, isHome: true }].map((teamObj) => (<tr key={teamObj.name} className="border-b border-slate-100 dark:border-slate-800/50 last:border-none"><td className="px-2 py-2 text-left font-sans font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">{teamObj.logo ? <img src={teamObj.logo} alt="" className="w-3.5 h-3.5 object-contain" /> : <div className="w-3.5 h-3.5 bg-slate-200 rounded-full" />}<span className="truncate max-w-[100px]">{teamObj.name}</span></td>{Array.from({ length: totalPeriods }).map((_, i) => { const p = i + 1; const ls = gameDetails.linescores.find(l => l.period === p); const score = teamObj.isHome ? ls?.homeScore : ls?.awayScore; return (<td key={p} className="px-1.5 py-2 text-slate-600 dark:text-slate-400">{score || '-'}</td>); })}<td className="px-2 py-2 font-bold text-slate-900 dark:text-white">{teamObj.score}</td></tr>))}</tbody></table></div>);
};

export const LiveGameView: React.FC<LiveGameViewProps> = ({ game, gameDetails, prediction, isDarkMode, onGenerateAnalysis, onTeamClick }) => {
  const [showLiveStats, setShowLiveStats] = useState(false);
  const [showBoxScore, setShowBoxScore] = useState(false);
  const [showPregameOutlook, setShowPregameOutlook] = useState(false);
  const [activeBoxScoreTeam, setActiveBoxScoreTeam] = useState<string | null>(null);
  const [showAllPlays, setShowAllPlays] = useState(false); 
  const [mounted, setMounted] = useState(false);
  
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState<PlayerProfile | null>(null);
  const [isPlayerLoading, setIsPlayerLoading] = useState(false);
  const [playerStatsMode, setPlayerStatsMode] = useState<'GAME' | 'SEASON'>('GAME');
  
  const [showBettingHelp, setShowBettingHelp] = useState(false);
  const [showProbHelp, setShowProbHelp] = useState(false);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const isSoccer = SOCCER_LEAGUES.includes(game.league as Sport);
  const isFootball = game.league === 'NFL' || game.league === 'NCAAF';
  const isBaseball = game.league === 'MLB';
  const isHockey = game.league === 'NHL';
  const isBasketball = ['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(game.league);
  
  const isFinished = game.status === 'finished';
  const isLive = game.status === 'in_progress';
  
  const homeColor = getTeamColor(game.homeTeamColor, game.homeTeamAlternateColor, isDarkMode);
  const awayColor = getTeamColor(game.awayTeamColor, game.awayTeamAlternateColor, isDarkMode);
  
  const stats = prediction?.stats;
  const analysis: string[] = prediction?.analysis || [];
  
  const homeAbbr = game.homeTeam.substring(0, 3).toUpperCase();
  const awayAbbr = game.awayTeam.substring(0, 3).toUpperCase();

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

  const drawProb = stats?.drawProbability || 0;
  const hPct = stats?.winProbabilityHome || 50;
  const aPct = stats?.winProbabilityAway || 50;
  const dPct = drawProb;
  const topTeam = isSoccer ? 'home' : 'away';
  const bottomTeam = isSoccer ? 'away' : 'home';
  const leftPct = isSoccer ? hPct : aPct;
  const rightPct = isSoccer ? aPct : hPct;
  const rightColor = isSoccer ? awayColor : homeColor;
  const leftColor = isSoccer ? homeColor : awayColor;
  const leftProbVal = isSoccer ? stats?.winProbabilityHome : stats?.winProbabilityAway;
  const rightProbVal = isSoccer ? stats?.winProbabilityAway : stats?.winProbabilityHome;
  const displayOdds = stats?.marketOdds || game.odds;

  const renderProjectedScoreRow = (type: 'home' | 'away') => {
      const isHome = type === 'home';
      const logo = isHome ? game.homeTeamLogo : game.awayTeamLogo;
      const name = isHome ? game.homeTeam : game.awayTeam;
      const score = isFinished ? (isHome ? game.homeScore : game.awayScore) : (isHome ? stats?.predictedScoreHome : stats?.predictedScoreAway);
      const teamId = isHome ? game.homeTeamId : game.awayTeamId;
      return (
        <div className="flex items-center justify-between">
            <div className={`flex items-center gap-3 ${onTeamClick && teamId ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={(e) => { if (onTeamClick && teamId) { e.stopPropagation(); onTeamClick(teamId, game.league as Sport); } }}>{logo ? (<img src={logo} alt={name} className="w-6 h-6 object-contain" />) : (<div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700"></div>)}<span className="font-bold text-slate-700 dark:text-slate-200 text-sm font-display">{name}</span></div>
            <span className="text-lg font-bold text-slate-900 dark:text-white font-mono">{score}</span>
        </div>
      );
  };

  const activeBoxScoreData = gameDetails?.boxscore?.find(t => t.teamId === activeBoxScoreTeam);
  const activePlayerGameData = selectedPlayerId && gameDetails?.boxscore ? (() => { for (const team of gameDetails.boxscore) { for (const group of team.groups) { const pEntry = group.players.find(p => p.player.id === selectedPlayerId); if (pEntry) return { player: pEntry.player, stats: pEntry.stats, labels: group.labels, groupName: group.label }; } } return null; })() : null;
  const displayPlayerInfo = activePlayerGameData?.player || { id: selectedPlayerId || '', displayName: selectedPlayerProfile?.name || 'Unknown Player', headshot: selectedPlayerProfile?.headshot, position: selectedPlayerProfile?.position, jersey: selectedPlayerProfile?.jersey };
  
  const allPlays = gameDetails?.plays || [];
  const scoredPlays = gameDetails?.scoringPlays || [];
  let playsToShow: (ScoringPlay | Play)[] = showAllPlays ? allPlays : (scoredPlays.length > 0 ? scoredPlays : allPlays.filter(p => ('scoringPlay' in p ? p.scoringPlay : false) || p.type?.toLowerCase().includes('score') || p.text?.toLowerCase().match(/\b(goal|touchdown|td|fg|field goal|home run|hr|run|safety|points)\b/)));
  if (isHockey && !showAllPlays && playsToShow.length === allPlays.length) playsToShow = playsToShow.filter(p => p.type.toLowerCase().includes('goal') || p.text.toLowerCase().includes('goal'));
  const sortedPlays = [...playsToShow].reverse();
  let displaySituation = gameDetails?.situation || game.situation || {};
  if (isFootball && sortedPlays.length > 0 && (isLive || isFinished)) { const allPlaysSorted = [...(gameDetails?.plays || [])].reverse(); const lastPlay = allPlaysSorted[0]; if (lastPlay && lastPlay.down !== undefined && lastPlay.distance !== undefined) { displaySituation = { ...displaySituation, down: lastPlay.down, distance: lastPlay.distance, yardLine: lastPlay.yardLine, downDistanceText: lastPlay.downDistanceText } } }

  const handlePlayerClick = async (playerId: string) => { setSelectedPlayerId(playerId); setIsPlayerLoading(true); setPlayerStatsMode('GAME'); setSelectedPlayerProfile(null); try { const profile = await fetchPlayerProfile(game.league as Sport, playerId); if (profile) setSelectedPlayerProfile(profile); } catch (e) { console.error("Failed to load player", e); } finally { setIsPlayerLoading(false); } };
  const handleAnalysisClick = () => { if (onGenerateAnalysis) { setIsGenerating(true); onGenerateAnalysis(); setTimeout(() => setIsGenerating(false), 8000); } };

  return (
    <div className="animate-fade-in space-y-6">
        <div className="bg-white dark:bg-slate-900/40 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden transition-colors">
             {isFinished ? (
                 <>
                    <div className="flex items-center gap-2 mb-6"><div className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 border border-slate-200 dark:border-slate-700"><CheckCircle2 size={12} /> Final</div><h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 font-display">OFFICIAL RESULTS</h3></div>
                     <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4 border border-slate-100 dark:border-slate-800/80"><div className="flex items-center gap-2 mb-3"><Target size={14} className="text-slate-400" /><span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider Final Score">Final Score</span></div>{isBasketball && gameDetails ? (<BasketballLinescoreTable game={game} gameDetails={gameDetails} />) : (<div className="space-y-3">{renderProjectedScoreRow(topTeam)}<div className="w-full h-px bg-slate-200/50 dark:bg-slate-800/50"></div>{renderProjectedScoreRow(bottomTeam)}</div>)}</div>
                 </>
             ) : (
                 <>
                     <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-[80px] rounded-full"></div>
                     <div className="absolute top-2 right-2 text-slate-400 hover:text-emerald-500 cursor-pointer transition-colors p-2" onClick={(e) => { e.stopPropagation(); setShowProbHelp(true); }} title="Probability Logic"><HelpCircle size={16} /></div>
                     <div className="flex items-center gap-2 mb-6"><div className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse border border-emerald-500/20"><Radio size={12} /> Live</div><h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 font-display">REAL-TIME PROBABILITY</h3></div>
                     {stats && (<div className="mb-6 cursor-pointer group/prob" onClick={() => setShowProbHelp(true)}><div className="flex justify-between items-end mb-2"><div className="flex items-center gap-3">{isSoccer ? (game.homeTeamLogo && <img src={game.homeTeamLogo} className="w-8 h-8 object-contain drop-shadow-sm" alt={game.homeTeam} />) : (game.awayTeamLogo && <img src={game.awayTeamLogo} className="w-8 h-8 object-contain drop-shadow-sm" alt={game.awayTeam} />)}<span className="text-2xl font-bold font-mono leading-none" style={{ color: leftColor }}>{Math.round(leftProbVal || 0)}%</span></div>{drawProb > 0 && <span className="font-bold text-slate-400 dark:text-slate-500 text-xs mb-1">Draw {Math.round(drawProb)}%</span>}<div className="flex items-center gap-3"><span className="text-2xl font-bold font-mono leading-none" style={{ color: rightColor }}>{Math.round(rightProbVal || 0)}%</span>{isSoccer ? (game.awayTeamLogo && <img src={game.awayTeamLogo} className="w-8 h-8 object-contain drop-shadow-sm" alt={game.awayTeam} />) : (game.homeTeamLogo && <img src={game.homeTeamLogo} className="w-8 h-8 object-contain drop-shadow-sm" alt={game.homeTeam} />)}</div></div><div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner"><div style={{ width: `${leftPct}%`, backgroundColor: leftColor }} className="h-full transition-all duration-1000 shadow-[0_0_10px_rgba(0,0,0,0.1)] relative group"></div>{dPct > 0 && (<div style={{ width: `${dPct}%` }} className="h-full bg-slate-300 dark:bg-slate-600 transition-all duration-1000 border-x border-white/20 dark:border-black/20"></div>)}<div style={{ width: `${rightPct}%`, backgroundColor: rightColor }} className="h-full transition-all duration-1000 relative group"></div></div></div>)}
                     {stats && (<div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4 border border-slate-100 dark:border-slate-800/80"><div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Target size={14} className="text-slate-400" /><span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Projected Final</span></div><span className="text-[9px] text-slate-400 bg-slate-200/50 dark:bg-slate-800/50 px-1.5 py-0.5 rounded">Uses Live WPA Data</span></div><div className="space-y-3">{renderProjectedScoreRow(topTeam)}<div className="w-full h-px bg-slate-200/50 dark:bg-slate-800/50"></div>{renderProjectedScoreRow(bottomTeam)}</div></div>)}
                     {displayOdds && (<div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4 cursor-pointer group/betting" onClick={(e) => { e.stopPropagation(); setShowBettingHelp(true); }}><div className="flex items-center justify-between mb-3"><h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-2">Live Market Odds<HelpCircle size={12} className="text-slate-300 dark:text-slate-600" /></h4><span className="text-[10px] text-slate-400 font-medium group-hover/betting:text-indigo-500 transition-colors">Explain Lines &rarr;</span></div><div className="grid grid-cols-3 gap-2 text-center"><div className="flex flex-col"><span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Spread</span><span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{displayOdds.spread || '-'}</span></div><div className="flex flex-col border-x border-slate-100 dark:border-slate-800/50"><span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Moneyline</span><div className="flex flex-col items-center text-xs font-mono font-medium text-slate-600 dark:text-slate-400 leading-tight"><span>{game.awayTeam.substring(0,3).toUpperCase()} {displayOdds.moneyLineAway || '-'}</span><span>{game.homeTeam.substring(0,3).toUpperCase()} {displayOdds.moneyLineHome || '-'}</span></div></div><div className="flex flex-col"><span className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-0.5">Total</span><span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{displayOdds.overUnder || '-'}</span></div></div></div>)}
                     {isLive && !isFinished && (
                        <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4">
                            <button onClick={() => setIsAnalysisOpen(!isAnalysisOpen)} className="w-full flex items-center justify-between group">
                                <div className="flex items-center gap-2">
                                    <Sparkles size={16} className={`text-indigo-500 transition-all ${isAnalysisOpen ? 'scale-110' : ''}`} />
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors font-display">Live Insights</h4>
                                </div>
                                <div className={`text-slate-400 transition-transform duration-300 ${isAnalysisOpen ? 'rotate-180' : ''}`}><ChevronDown size={16} /></div>
                            </button>
                            {isAnalysisOpen && (
                                <div className="mt-4 animate-fade-in">
                                    {analysis && analysis.length > 0 ? (
                                        <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4 border border-slate-100 dark:border-slate-800/60">
                                            <ul className="space-y-3">
                                                {(analysis as any[]).map((point, idx) => (
                                                    <li key={idx} className="flex items-start gap-3">
                                                        <div className="mt-1.5 w-1 h-1 rounded-full bg-indigo-500 shrink-0" />
                                                        <span className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 font-medium">{point}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : (
                                        <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-6 text-center border border-dashed border-slate-200 dark:border-slate-800">
                                            <button onClick={handleAnalysisClick} disabled={isGenerating} className="group relative inline-flex items-center justify-center gap-2 px-5 py-2.5 font-bold text-white transition-all duration-200 bg-slate-900 dark:bg-white dark:text-slate-900 rounded-lg hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden text-xs uppercase tracking-wide">
                                                {isGenerating ? (
                                                    <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white dark:border-slate-900"></div><span>Processing...</span></>
                                                ) : (
                                                    <><Brain size={14} /><span>Run Gemini Simulation</span></>
                                                )}
                                                {!isGenerating && <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent z-10" />}
                                            </button>
                                            <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500 font-medium">Generates a 5-point situational breakdown using Gemini 3 Flash.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                     )}
                 </>
             )}
        </div>
        
        {gameDetails && (
             <div className="bg-white dark:bg-slate-900/40 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm w-full max-w-full">
                 {isLive && isFootball && displaySituation && (<FootballField situation={displaySituation} homeTeam={game.homeTeam} awayTeam={game.awayTeam} game={game} isDarkMode={isDarkMode} compact={true} gameDetails={gameDetails} />)}
                 <div className="bg-slate-50/80 dark:bg-slate-900/80 px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                     <div className="flex items-center gap-3 justify-between w-full">
                         <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Game Feed</h4>
                         <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-1">
                             <button onClick={() => setShowAllPlays(false)} className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all flex-1 ${!showAllPlays ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>Scores</button>
                             <button onClick={() => setShowAllPlays(true)} className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all flex-1 ${showAllPlays ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>Play-by-Play</button>
                         </div>
                     </div>
                 </div>
                 <div className="relative">
                     {!showAllPlays && (
                        <div className="overflow-x-auto border-b border-slate-100 dark:border-slate-800/50">
                            {isBasketball ? (
                                <BasketballLinescoreTable game={game} gameDetails={gameDetails} />
                            ) : (
                                <table className="w-full text-center text-sm">
                                    <thead>
                                        <tr className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
                                            <th className="px-4 py-3 text-left">Team</th>
                                            {(() => {
                                                const maxDataPeriod = gameDetails?.linescores?.length ? Math.max(...gameDetails.linescores.map(ls => ls.period)) : 0;
                                                const defaultPeriods = isBaseball ? 9 : isHockey ? 3 : isSoccer ? 2 : 4; 
                                                const totalPeriods = Math.max(defaultPeriods, maxDataPeriod);
                                                
                                                return Array.from({ length: totalPeriods }).map((_, i) => {
                                                    const p = i + 1;
                                                    let label = String(p);
                                                    if (isBaseball) label = String(p);
                                                    else if (p > defaultPeriods) label = 'OT';
                                                    return <th key={p} className="px-2 py-3 min-w-[32px]">{label}</th>;
                                                });
                                            })()}
                                            <th className="px-4 py-3 text-slate-800 dark:text-white">T</th>
                                        </tr>
                                    </thead>
                                    <tbody className="font-mono">
                                        {[
                                            { name: game.awayTeam, logo: game.awayTeamLogo, score: game.awayScore, isHome: false },
                                            { name: game.homeTeam, logo: game.homeTeamLogo, score: game.homeScore, isHome: true }
                                        ].map((teamObj) => (
                                            <tr key={teamObj.name} className="border-b border-slate-100 dark:border-slate-800/50 last:border-none">
                                                <td className="px-4 py-3 text-left font-sans font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                                    {teamObj.logo ? <img src={teamObj.logo} alt="" className="w-4 h-4 object-contain" /> : <div className="w-4 h-4 bg-slate-200 rounded-full" />}
                                                    <span className="truncate max-w-[120px]">{teamObj.name}</span>
                                                </td>
                                                {(() => {
                                                    const maxDataPeriod = gameDetails?.linescores?.length ? Math.max(...gameDetails.linescores.map(ls => ls.period)) : 0;
                                                    const defaultPeriods = isBaseball ? 9 : isHockey ? 3 : isSoccer ? 2 : 4;
                                                    const totalPeriods = Math.max(defaultPeriods, maxDataPeriod);
                                                    return Array.from({ length: totalPeriods }).map((_, i) => {
                                                        const p = i + 1;
                                                        const ls = gameDetails?.linescores?.find(l => l.period === p);
                                                        const score = teamObj.isHome ? ls?.homeScore : ls?.awayScore;
                                                        return <td key={p} className="px-2 py-3 text-slate-600 dark:text-slate-400">{score || '-'}</td>;
                                                    });
                                                })()}
                                                <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{teamObj.score}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                     )}
                     
                     {showAllPlays && (
                         <div className="max-h-[400px] overflow-y-auto p-0 divide-y divide-slate-100 dark:divide-slate-800/50 custom-scrollbar">
                             {sortedPlays.length === 0 ? (
                                 <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-xs uppercase font-bold tracking-wider">No plays available</div>
                             ) : (
                                 sortedPlays.map((play) => {
                                     const isScoring = 'scoringPlay' in play ? play.scoringPlay : true;
                                     return (
                                     <div key={play.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors flex gap-4">
                                         <div className="min-w-[50px] text-xs font-mono font-bold text-slate-400 dark:text-slate-500 pt-0.5 text-right">
                                             {play.clock || play.period}
                                         </div>
                                         <div className="flex-1">
                                             <div className="flex items-center gap-2 mb-1">
                                                 {isScoring && <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-emerald-200 dark:border-emerald-800/50">Score</span>}
                                                 <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{play.type}</span>
                                             </div>
                                             <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{play.text}</p>
                                         </div>
                                         {(play.homeScore > 0 || play.awayScore > 0) && (
                                             <div className="text-xs font-mono font-bold text-slate-900 dark:text-white pt-0.5">
                                                 {play.awayScore}-{play.homeScore}
                                             </div>
                                         )}
                                     </div>
                                 )})
                             )}
                         </div>
                     )}
                 </div>
             </div>
        )}

        {isLive && (isBasketball || isHockey || isSoccer) && (<ActiveLineupList situation={game.situation || {}} homeTeam={game.homeTeam} awayTeam={game.awayTeam} game={game} gameDetails={gameDetails} type={isBasketball ? 'BASKETBALL' : isHockey ? 'HOCKEY' : 'SOCCER'} onPlayerClick={handlePlayerClick} isDarkMode={isDarkMode} compact={false} />)}

        {/* Live Stats Dropdown */}
        {gameDetails?.stats && gameDetails.stats.length > 0 && (
             <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden w-full">
                 <button 
                     onClick={() => setShowLiveStats(!showLiveStats)}
                     className="w-full px-4 py-3 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center group transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                 >
                     <div className="flex items-center gap-2">
                         <BarChart2 size={14} className="text-slate-400" />
                         <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">
                             Live Stats
                         </span>
                     </div>
                     <div className={`text-slate-400 transition-transform duration-300 ${showLiveStats ? 'rotate-180' : ''}`}>
                         <ChevronDown size={16} />
                     </div>
                 </button>
                 
                 {showLiveStats && (
                     <div className="p-4 sm:p-6 animate-fade-in space-y-8">
                        {Object.entries(categorizedStats).map(([category, items]) => (
                            <div key={category}>
                                <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-3">
                                    <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">{category}</span>
                                    <div className="h-px bg-slate-100 dark:bg-slate-800 flex-1"></div>
                                </h3>
                                <div className="space-y-4">
                                    <div className="flex justify-between text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-2 px-2">
                                        <span>{awayAbbr}</span>
                                        <span>{homeAbbr}</span>
                                    </div>
                                    {items.map((stat, idx) => {
                                        const hVal = parseStatValue(stat.homeValue);
                                        const aVal = parseStatValue(stat.awayValue);
                                        const max = Math.max(hVal, aVal);
                                        const hBar = max > 0 ? (hVal / max) * 100 : 0;
                                        const aBar = max > 0 ? (aVal / max) * 100 : 0;
                                        
                                        // Determine winner highlight
                                        let hWins = hVal > aVal;
                                        let aWins = aVal > hVal;
                                        
                                        // Logic for defensive/negative stats (lower is better)
                                        if (category === 'Defense' || stat.label.includes('Turnover') || stat.label.includes('Interception')) {
                                            hWins = hVal < aVal;
                                            aWins = aVal < hVal;
                                        }
                                        
                                        // Visual Label Overrides for Clarity
                                        let displayLabel = stat.label;
                                        if (stat.label === 'Points') displayLabel = 'Points (Total)';
                                        if (stat.label === 'Points Against' || stat.label === 'Opponent Points') displayLabel = 'Points Against';
                                        
                                        return (
                                            <div key={idx} className="relative group">
                                                <div className="flex items-center justify-between text-sm font-mono font-bold text-slate-700 dark:text-slate-300 relative z-10 px-2 py-1">
                                                    <span className={`flex items-center gap-1.5 ${aWins ? 'text-slate-900 dark:text-white scale-105 origin-left transition-transform' : 'opacity-80'}`}>
                                                        {stat.awayValue}
                                                        {stat.awayRank && <span className="text-[9px] bg-slate-200 dark:bg-slate-700 px-1 rounded text-slate-500 dark:text-slate-400">#{stat.awayRank}</span>}
                                                    </span>
                                                    
                                                    <span className="text-xs font-sans text-slate-500 dark:text-slate-400 font-medium text-center absolute left-1/2 -translate-x-1/2 w-full max-w-[50%] truncate">{displayLabel}</span>
                                                    
                                                    <span className={`flex items-center gap-1.5 ${hWins ? 'text-slate-900 dark:text-white scale-105 origin-right transition-transform' : 'opacity-80'}`}>
                                                        {stat.homeRank && <span className="text-[9px] bg-slate-200 dark:bg-slate-700 px-1 rounded text-slate-500 dark:text-slate-400">#{stat.homeRank}</span>}
                                                        {stat.homeValue}
                                                    </span>
                                                </div>
                                                
                                                <div className="flex h-1.5 w-full bg-slate-50 dark:bg-slate-900 rounded-full overflow-hidden mt-1">
                                                    <div className="flex-1 flex justify-end bg-slate-100 dark:bg-slate-800/50">
                                                        <div 
                                                            style={{ width: `${aBar}%`, backgroundColor: awayColor }} 
                                                            className="h-full rounded-l-full opacity-60 group-hover:opacity-100 transition-opacity"
                                                        ></div>
                                                    </div>
                                                    <div className="w-0.5 bg-white dark:bg-slate-950 z-10"></div>
                                                    <div className="flex-1 flex justify-start bg-slate-100 dark:bg-slate-800/50">
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
                        
                        {Object.keys(categorizedStats).length === 0 && (
                            <div className="text-center py-8 text-xs text-slate-400 italic">
                                No detailed metrics available for this matchup.
                            </div>
                        )}
                     </div>
                 )}
             </div>
        )}

        {/* Box Score Section - Same as before */}
        {gameDetails?.boxscore && gameDetails.boxscore.length > 0 && (
           <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden w-full max-w-full">
               <button onClick={() => setShowBoxScore(!showBoxScore)} className="w-full px-4 py-3 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center group transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"><div className="flex items-center gap-2"><Table size={14} className="text-slate-400" /><span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">Box Score</span></div><div className={`text-slate-400 transition-transform duration-300 ${showBoxScore ? 'rotate-180' : ''}`}><ChevronDown size={16} /></div></button>
               {showBoxScore && (<div className="p-0 animate-fade-in"><div className="flex border-b border-slate-100 dark:border-slate-800">{gameDetails.boxscore.map((teamBox) => { const isActive = activeBoxScoreTeam === teamBox.teamId; const isHome = teamBox.teamId === game.homeTeamId; const activeColor = isHome ? homeColor : awayColor; return (<button key={teamBox.teamId} onClick={() => setActiveBoxScoreTeam(teamBox.teamId)} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 flex items-center justify-center gap-2 ${isActive ? 'bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'}`} style={isActive ? { borderColor: activeColor } : {}}>{teamBox.teamLogo && <img src={teamBox.teamLogo} alt="" className="w-4 h-4 object-contain" />}{teamBox.teamName}</button>); })}</div><div className="overflow-x-auto">{activeBoxScoreData ? (<div className="divide-y divide-slate-100 dark:divide-slate-800/50">{activeBoxScoreData.groups.map((group, gIdx) => (<div key={gIdx}><div className="bg-slate-50/50 dark:bg-slate-900/30 px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800/50 sticky left-0">{group.label}</div><table className="w-full text-right text-xs"><thead><tr className="border-b border-slate-100 dark:border-slate-800/50 text-[10px] text-slate-400 font-bold uppercase"><th className="px-4 py-2 text-left sticky left-0 bg-white dark:bg-slate-900 z-10 w-32 md:w-48">Player</th>{(group.labels || []).map((l, i) => (<th key={i} className="px-2 py-2 min-w-[32px] whitespace-nowrap">{l}</th>))}</tr></thead><tbody className="divide-y divide-slate-5 dark:divide-slate-800/30">{group.players.map((pEntry, pIdx) => (<tr key={pIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer" onClick={() => handlePlayerClick(pEntry.player.id)}><td className="px-4 py-2.5 text-left font-medium text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/30 border-r border-transparent hover:border-slate-100 dark:hover:border-slate-800 transition-colors flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">{pEntry.player.headshot ? (<img src={pEntry.player.headshot} alt="" className="w-full h-full object-cover" />) : (<div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-slate-400">{pEntry.player.position || '#'}</div>)}</div><div className="min-w-0"><div className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[120px]">{pEntry.player.displayName}</div><div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">#{pEntry.player.jersey || '00'} • {pEntry.player.position || 'P'}</div></div></td>{(pEntry.stats as string[] || []).map((s, sIdx) => (<td key={sIdx} className="px-2 py-2.5 font-mono text-slate-600 dark:text-slate-400">{s}</td>))}</tr>))}</tbody></table></div>))}</div>) : (<div className="p-8 text-center text-slate-400 text-sm italic">Select a team to view stats.</div>)}</div></div>)}
           </div>
        )}

        {/* NEW: Pregame Outlook Dropdown */}
        {prediction && (
            <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden w-full">
                <button 
                    onClick={() => setShowPregameOutlook(!showPregameOutlook)}
                    className="w-full px-4 py-3 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center group transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                    <div className="flex items-center gap-2">
                        <TrendingUp size={14} className="text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">
                            Pregame Outlook
                        </span>
                    </div>
                    <div className={`text-slate-400 transition-transform duration-300 ${showPregameOutlook ? 'rotate-180' : ''}`}>
                        <ChevronDown size={16} />
                    </div>
                </button>
                
                {showPregameOutlook && (
                    <div className="p-4 sm:p-6 animate-fade-in bg-slate-50/30 dark:bg-slate-950/30">
                        <PredictionView 
                            game={game} 
                            prediction={prediction} 
                            isDarkMode={isDarkMode} 
                            onGenerateAnalysis={onGenerateAnalysis}
                            gameDetails={gameDetails}
                            hideAnalysis={true}
                            hideLeaders={true}
                        />
                    </div>
                )}
            </div>
        )}

      {selectedPlayerId && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative max-h-[90vh] flex flex-col">
                    <button onClick={() => setSelectedPlayerId(null)} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors z-10"><X size={18} /></button>
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-6 flex flex-col items-center text-center border-b border-slate-200 dark:border-slate-800">
                        <div className="w-24 h-24 rounded-full bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-800 shadow-md mb-4 overflow-hidden">
                            {displayPlayerInfo.headshot ? (<img src={displayPlayerInfo.headshot} alt={displayPlayerInfo.displayName} className="w-full h-full object-cover" />) : (<div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600"><UserIcon size={48} /></div>)}
                        </div>
                        <h2 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-1">{displayPlayerInfo.displayName}</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">#{displayPlayerInfo.jersey || '00'} • {displayPlayerInfo.position || ''}</p>
                        {selectedPlayerProfile && (<div className="mt-3 flex gap-2 justify-center text-xs text-slate-400 dark:text-slate-500">{selectedPlayerProfile.height && <span>{selectedPlayerProfile.height}</span>}{selectedPlayerProfile.weight && <span>• {selectedPlayerProfile.weight} lbs</span>}{selectedPlayerProfile.age && <span>• {selectedPlayerProfile.age} yrs</span>}</div>)}
                    </div>
                    <div className="flex border-b border-slate-200 dark:border-slate-800">
                        <button onClick={() => setPlayerStatsMode('GAME')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${playerStatsMode === 'GAME' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'bg-slate-50 dark:bg-slate-900/50 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>This Game</button>
                        <button onClick={() => setPlayerStatsMode('SEASON')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${playerStatsMode === 'SEASON' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'bg-slate-50 dark:bg-slate-900/50 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Season Stats</button>
                    </div>
                    <div className="overflow-y-auto p-6 max-h-[400px]">
                        {playerStatsMode === 'GAME' ? (activePlayerGameData ? (<div className="grid grid-cols-2 gap-3">{activePlayerGameData.labels.map((label, i) => (<div key={i} className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800"><div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">{label}</div><div className="text-lg font-mono font-bold text-slate-900 dark:text-white">{activePlayerGameData.stats[i]}</div></div>))}</div>) : (<div className="text-center text-sm text-slate-400 italic">No stats available for this game yet.</div>)) : (isPlayerLoading ? (<div className="flex flex-col items-center justify-center py-8"><Loader2 size={24} className="text-slate-500 animate-spin mb-3" /><p className="text-xs text-slate-500">Retrieving season stats...</p></div>) : selectedPlayerProfile?.stats && selectedPlayerProfile.stats.length > 0 ? (<div className="space-y-6">{selectedPlayerProfile.stats.map((group, idx) => (<div key={idx}><h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">{group.title}</h4><div className="grid grid-cols-2 gap-3">{group.data.map((item, i) => (<div key={i} className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800"><div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">{item.label}</div><div className="text-lg font-mono font-bold text-slate-900 dark:text-white">{item.value}</div></div>))}</div></div>))}</div>) : (<div className="text-center text-sm text-slate-400 italic py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">No detailed season statistics available.</div>))}
                    </div>
                </div>
            </div>,
            document.body
        )}

      {showProbHelp && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
                    <button onClick={() => setShowProbHelp(false)} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors z-10"><X size={18} /></button>
                    <div className="p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
                                <Calculator size={20} />
                            </div>
                            <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white">Live Probability Engine</h2>
                        </div>
                        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            <p>
                                The <strong>Real-Time Probability</strong> is calculated using a dynamic Bayesian inference model.
                            </p>
                            <ul className="space-y-2 list-disc list-inside">
                                <li>
                                    <strong>Pre-Game Prior:</strong> We start with a baseline probability derived from team power ratings and season-long efficiency metrics.
                                </li>
                                <li>
                                    <strong>In-Game Decay:</strong> As the game progresses, the influence of the pre-game prior decays, and the current score differential takes precedence.
                                </li>
                                <li>
                                    <strong>Situation Awareness:</strong> For Football, we factor in Expected Points (EP) based on field position, down, and distance. For Basketball, we track possession momentum.
                                </li>
                            </ul>
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xs italic">
                                "As time remaining approaches zero, the probability converges to 100% for the leading team."
                            </div>
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        )}

      {showBettingHelp && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
                    <button onClick={() => setShowBettingHelp(false)} className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors z-10"><X size={18} /></button>
                    <div className="p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl text-emerald-600 dark:text-emerald-400">
                                <TrendingUp size={20} />
                            </div>
                            <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white">Understanding Odds</h2>
                        </div>
                        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Spread</h4>
                                <p>The point difference handicap. If a team is -3.5, they must win by 4 or more points.</p>
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Moneyline</h4>
                                <p>The odds for a straight-up win. Negative (e.g. -150) means you bet that amount to win $100. Positive (+130) means you win that amount on a $100 bet.</p>
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Total (Over/Under)</h4>
                                <p>The predicted combined score of both teams. You bet on whether the actual score will be over or under this number.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        )}
    </div>
  );
};
