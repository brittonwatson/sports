
import React from 'react';
import { GameSituation, Game } from '../../types';

interface FieldProps {
    situation: GameSituation; 
    homeTeam: string; 
    awayTeam: string; 
    game: Game;
    isDarkMode: boolean;
}

export const BaseballDiamond: React.FC<FieldProps> = ({ situation }) => {
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
