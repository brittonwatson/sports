
import React from 'react';
import { Game, GameDetails, SOCCER_LEAGUES, Sport } from '../../types';

interface ScoreboardTableProps { 
    game: Game;
    gameDetails: GameDetails | null;
}

export const ScoreboardTable: React.FC<ScoreboardTableProps> = ({ game, gameDetails }) => {
    if (!gameDetails) return null;
    
    const { league } = game;
    const isMLB = league === 'MLB';
    const isNHL = league === 'NHL';
    const isSoccer = SOCCER_LEAGUES.includes(league as Sport);
    const isNCAAM = league === 'NCAAM';
    const isNCAAW = league === 'NCAAW';
    
    let minPeriods = 4;
    if (isMLB) minPeriods = 9;
    if (isNHL) minPeriods = 3;
    if (isSoccer || isNCAAM) minPeriods = 2; // NCAAM (Men's) is 2 halves. NCAAW (Women's) is 4 quarters.

    // Robustly handle linescores to prevent NaN or undefined from collapsing the table
    const validLinescores = gameDetails.linescores?.filter(ls => typeof ls.period === 'number') || [];
    const maxDataPeriod = validLinescores.length > 0 ? Math.max(...validLinescores.map(ls => ls.period)) : 0;
    const safeMax = isNaN(maxDataPeriod) ? 0 : maxDataPeriod;
    const totalPeriods = Math.max(minPeriods, safeMax);

    const getPeriodLabel = (p: number) => {
        if (isMLB) return String(p); // 1, 2, 3...
        if (isSoccer) {
            if (p === 1) return '1';
            if (p === 2) return '2';
            if (p === 3) return 'ET';
            if (p === 4) return 'P';
            return String(p);
        }
        if (isNCAAM) {
            if (p === 1) return '1';
            if (p === 2) return '2';
            return `OT${p-2 > 1 ? p-2 : ''}`;
        }
        if (isNHL) {
            if (p <= 3) return String(p);
            return 'OT'; // Usually just OT or SO
        }
        // Default (NBA, NFL, NCAAW, WNBA)
        if (p <= 4) return String(p); 
        return `OT${p-4 > 1 ? p-4 : ''}`;
    };

    return (
        <div className="overflow-x-auto pb-2">
            <table className="w-full text-center text-xs border-collapse">
                <thead>
                    <tr className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase border-b border-slate-200 dark:border-slate-700">
                        <th className="px-2 py-2 text-left w-24 sticky left-0 bg-white dark:bg-slate-900 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.2)]">Team</th>
                        {Array.from({ length: totalPeriods }).map((_, i) => (
                            <th key={i} className="px-1.5 py-2 min-w-[28px] font-mono">
                                {getPeriodLabel(i + 1)}
                            </th>
                        ))}
                        <th className="px-3 py-2 text-slate-900 dark:text-white font-black bg-slate-50 dark:bg-slate-900/50 sticky right-0 shadow-[-2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[-2px_0_5px_rgba(0,0,0,0.2)]">T</th>
                    </tr>
                </thead>
                <tbody>
                    {[
                        { name: game.awayTeam, logo: game.awayTeamLogo, score: game.awayScore, isHome: false }, 
                        { name: game.homeTeam, logo: game.homeTeamLogo, score: game.homeScore, isHome: true }
                    ].map((teamObj) => (
                        <tr key={teamObj.name} className="border-b border-slate-200/80 dark:border-slate-700/60 last:border-none group">
                            <td className="px-2 py-2.5 text-left font-display font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 sticky left-0 bg-white dark:bg-slate-900 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.2)]">
                                {teamObj.logo ? (
                                    <img src={teamObj.logo} alt="" className="w-4 h-4 object-contain" />
                                ) : (
                                    <div className="w-4 h-4 bg-slate-200 rounded-full" />
                                )}
                                <span className="truncate max-w-[80px] sm:max-w-[120px]">{teamObj.name}</span>
                            </td>
                            {Array.from({ length: totalPeriods }).map((_, i) => {
                                const p = i + 1;
                                const ls = gameDetails.linescores?.find(l => l.period === p);
                                const score = teamObj.isHome ? ls?.homeScore : ls?.awayScore;
                                // Explicitly check for null/undefined/empty string, allowing '0' to pass through as valid
                                const displayScore = (score !== undefined && score !== null && score !== '') ? score : '-';
                                return (
                                    <td key={p} className="px-1.5 py-2.5 font-mono font-semibold text-slate-700 dark:text-slate-200">
                                        {displayScore}
                                    </td>
                                );
                            })}
                            <td className="px-3 py-2.5 font-mono font-bold text-slate-900 dark:text-white text-sm bg-slate-50 dark:bg-slate-900/50 sticky right-0 shadow-[-2px_0_5px_rgba(0,0,0,0.05)] dark:shadow-[-2px_0_5px_rgba(0,0,0,0.2)]">
                                {teamObj.score}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
