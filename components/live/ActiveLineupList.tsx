
import React, { useState } from 'react';
import { GameSituation, Game, GameDetails, Player } from '../../types';
import { User as UserIcon, BarChart2 } from 'lucide-react';

interface ActiveLineupListProps {
    situation: GameSituation; 
    homeTeam: string; 
    awayTeam: string; 
    game: Game;
    gameDetails?: GameDetails | null;
    type: 'BASKETBALL' | 'HOCKEY' | 'SOCCER';
    onPlayerClick?: (playerId: string) => void;
    isDarkMode: boolean;
}

export const ActiveLineupList: React.FC<ActiveLineupListProps> = ({ situation, homeTeam, awayTeam, game, gameDetails, type, onPlayerClick }) => {
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
        <div className="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col transition-all duration-300 w-full h-full min-h-[220px]">
             <div className="flex flex-col gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                 <div className="flex items-center gap-2"><UserIcon size={14} className="text-slate-400" /><span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Active Lineup</span></div>
                 <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5 w-full">
                     <button onClick={() => setViewTeam('away')} className={`flex-1 px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all truncate min-w-0 ${viewTeam === 'away' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>{awayTeam}</button>
                     <button onClick={() => setViewTeam('home')} className={`flex-1 px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all truncate min-w-0 ${viewTeam === 'home' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>{homeTeam}</button>
                 </div>
             </div>
             {sortedPlayers.length === 0 ? (
                 <div className="p-8 text-center flex-1 flex items-center justify-center"><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Lineup Not Available</p></div>
             ) : (
                 <div className="divide-y divide-slate-100 dark:divide-slate-800/50 overflow-y-auto custom-scrollbar">
                     {sortedPlayers.map(player => (
                         <div key={player.id} onClick={() => onPlayerClick && onPlayerClick(player.id)} className="flex items-center justify-between px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group">
                             <div className="flex items-center gap-4">
                                 {player.headshot ? (
                                     <img src={player.headshot} alt="" className="w-8 h-8 rounded-full object-cover bg-slate-100 dark:bg-slate-800" />
                                 ) : (
                                     <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400">{player.jersey || '#'}</div>
                                 )}
                                 <div className="flex flex-col">
                                     <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-slate-300 transition-colors">{player.displayName}</span>
                                     <span className="text-[9px] text-slate-400 dark:text-slate-500">{player.position} {player.jersey ? `• #${player.jersey}` : ''}</span>
                                 </div>
                             </div>
                             <div className="p-1.5 rounded-full text-slate-300 dark:text-slate-600 group-hover:bg-slate-100 dark:group-hover:bg-slate-800 group-hover:text-slate-500 dark:group-hover:text-slate-300 transition-all">
                                 <BarChart2 size={14} />
                             </div>
                         </div>
                     ))}
                 </div>
             )}
        </div>
    );
};
