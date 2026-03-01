
import React from 'react';
import { Game, GameDetails, GameSituation, Sport } from '../../types';
import { getTeamColor } from '../../services/uiUtils';
import { Clock } from 'lucide-react';

interface FieldProps {
    situation: GameSituation; 
    homeTeam: string; 
    awayTeam: string; 
    game: Game;
    isDarkMode: boolean;
    gameDetails?: GameDetails | null;
    compact?: boolean;
    onTeamClick?: (teamId: string, league: Sport) => void;
}

export const FootballField: React.FC<FieldProps> = ({ situation, homeTeam, awayTeam, game, isDarkMode, compact, gameDetails, onTeamClick }) => {
    const { yardLine, possession, homeTimeouts, awayTimeouts, downDistanceText, possessionText } = situation;
    const normPossession = possession ? String(possession) : null;
    const normHomeId = game.homeTeamId ? String(game.homeTeamId) : 'home';
    const normAwayId = game.awayTeamId ? String(game.awayTeamId) : 'away';
    const currentPeriod = gameDetails?.period || game.period || 1;
    const isOddQuarter = currentPeriod % 2 !== 0;
    const leftTeamSide: 'home' | 'away' = isOddQuarter ? 'away' : 'home';
    const rightTeamSide: 'home' | 'away' = isOddQuarter ? 'home' : 'away';
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
    const handleTeamNavigate = (e: React.MouseEvent, side: 'home' | 'away') => {
        if (!onTeamClick) return;
        const teamId = side === 'home' ? game.homeTeamId : game.awayTeamId;
        if (!teamId) return;
        e.stopPropagation();
        onTeamClick(teamId, game.league as Sport);
    };
    return (
        <div className={compact ? "bg-slate-50/30 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800" : "bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm mb-6"}>
            <div className="flex justify-between items-center px-5 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800/50">
                <div className="flex flex-col items-start gap-1.5">
                    <div className="flex items-center gap-2">
                        <span
                            className={`text-sm font-bold font-display text-slate-900 dark:text-white leading-none ${onTeamClick && game.awayTeamId ? 'cursor-pointer hover:underline' : ''}`}
                            onClick={onTeamClick && game.awayTeamId ? (e) => handleTeamNavigate(e, 'away') : undefined}
                        >
                            {awayTeam}
                        </span>
                        {isAwayPossession && <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>}
                    </div>
                    {renderTimeouts(awayTimeouts)}
                </div>
                <div className="hidden sm:flex flex-col items-center justify-center">
                    <div className="flex items-baseline gap-2 mb-1.5"><span className="text-2xl font-mono font-black text-slate-900 dark:text-white tracking-tight leading-none">{displayClock}</span><span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Q{currentPeriod}</span></div>
                    <div className="flex items-center gap-2"><div className="text-xs font-bold font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-2.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 shadow-sm">{downDistanceText || '1st & 10'}</div>{possessionText && (<div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">{possessionText}</div>)}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-2">
                        {isHomePossession && <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>}
                        <span
                            className={`text-sm font-bold font-display text-slate-900 dark:text-white leading-none ${onTeamClick && game.homeTeamId ? 'cursor-pointer hover:underline' : ''}`}
                            onClick={onTeamClick && game.homeTeamId ? (e) => handleTeamNavigate(e, 'home') : undefined}
                        >
                            {homeTeam}
                        </span>
                    </div>
                    {renderTimeouts(homeTimeouts)}
                </div>
            </div>
            <div className="sm:hidden flex items-center justify-between px-5 py-2.5 bg-slate-50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-800/50">
                 <div className="flex items-center gap-2"><Clock size={12} className="text-slate-400" /><span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{displayClock}</span><span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 border-l border-slate-200 dark:border-slate-700 pl-2">Q{currentPeriod}</span></div>
                 <div className="flex items-center gap-3"><span className="text-xs font-bold text-slate-700 dark:text-slate-300">{downDistanceText || '1st & 10'}</span>{possessionText && <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">{possessionText}</span>}</div>
            </div>
            <div className="relative w-full h-32 sm:h-48 md:h-64 bg-gradient-to-b from-emerald-800 to-emerald-900 border-t border-b border-emerald-950/20 shadow-inner select-none overflow-hidden transition-all duration-300">
                <svg width="100%" height="100%" className="absolute inset-0" preserveAspectRatio="none"><defs><pattern id="grass" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#065f46" fillOpacity="0.1" /></pattern></defs><rect width="100%" height="100%" fill="url(#grass)" /><rect x="0%" y="0" width="8.33%" height="100%" fill={leftTeamColor} /><rect x="91.67%" y="0" width="8.33%" height="100%" fill={rightTeamColor} />{yardLines.map(y => { const isMajor = y % 10 === 0; const isMidfield = y === 50; const xPos = 8.33 + (y * 0.8333); return <line key={y} x1={`${xPos}%`} y1="0" x2={`${xPos}%`} y2="100%" stroke="white" strokeOpacity={isMidfield ? "0.8" : (isMajor ? "0.5" : "0.2")} strokeWidth={isMidfield ? "2" : (isMajor ? "1.5" : "1")} />; })}</svg>
                <div className="absolute top-0 bottom-0 left-0 w-[8.33%] flex items-center justify-center overflow-hidden">
                    <span
                        className={`text-white/90 font-display font-black uppercase tracking-widest text-[10px] sm:text-xs whitespace-nowrap ${onTeamClick && (leftTeamSide === 'home' ? game.homeTeamId : game.awayTeamId) ? 'cursor-pointer hover:text-white' : ''}`}
                        onClick={onTeamClick && (leftTeamSide === 'home' ? game.homeTeamId : game.awayTeamId) ? (e) => handleTeamNavigate(e, leftTeamSide) : undefined}
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                    >
                        {leftTeamName}
                    </span>
                </div>
                <div className="absolute top-0 bottom-0 right-0 w-[8.33%] flex items-center justify-center overflow-hidden">
                    <span
                        className={`text-white/90 font-display font-black uppercase tracking-widest text-[10px] sm:text-xs whitespace-nowrap ${onTeamClick && (rightTeamSide === 'home' ? game.homeTeamId : game.awayTeamId) ? 'cursor-pointer hover:text-white' : ''}`}
                        onClick={onTeamClick && (rightTeamSide === 'home' ? game.homeTeamId : game.awayTeamId) ? (e) => handleTeamNavigate(e, rightTeamSide) : undefined}
                        style={{ writingMode: 'vertical-rl', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                    >
                        {rightTeamName}
                    </span>
                </div>
                {game.homeTeamLogo && (<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-12 h-12 sm:w-20 sm:h-20 opacity-40 pointer-events-none mix-blend-overlay"><img src={game.homeTeamLogo} alt="" className="w-full h-full object-contain" /></div>)}
                <div className="absolute inset-0 hidden sm:block pointer-events-none">{[10, 20, 30, 40, 50, 60, 70, 80, 90].map(y => { const xPos = 8.33 + (y * 0.8333); const displayNum = y > 50 ? 100 - y : y; return (<React.Fragment key={y}><div className="absolute top-[20%] text-[10px] font-bold text-white/70 font-mono -translate-x-1/2" style={{ left: `${xPos}%` }}>{displayNum}</div><div className="absolute bottom-[20%] text-[10px] font-bold text-white/70 font-mono -translate-x-1/2" style={{ left: `${xPos}%` }}>{displayNum}</div></React.Fragment>); })}</div>
                <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-10 shadow-[0_0_8px_rgba(96,165,250,0.8)] transition-all duration-700 ease-out" style={{ left: `${8.33 + (ballPos * 0.8333)}%` }}></div>
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-3 -ml-2 z-20 transition-all duration-700 ease-out flex items-center justify-center" style={{ left: `${8.33 + (ballPos * 0.8333)}%` }}><div className="w-full h-full bg-amber-700 rounded-[50%] border border-white/90 shadow-sm relative overflow-hidden"><div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-white/50 -translate-x-1/2"></div></div></div>
            </div>
        </div>
    );
};
