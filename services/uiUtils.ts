
import { ScoringPlay, Play, Sport, SOCCER_LEAGUES } from '../types';

export const getTeamColor = (primary: string | undefined, alternate: string | undefined, isDarkMode: boolean): string => {
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

export const getRankColor = (rank: number | undefined) => {
    if (!rank) return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
    if (rank <= 5) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
    if (rank <= 15) return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-100 dark:border-blue-800';
    if (rank >= 25) return 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-rose-100 dark:border-rose-800';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
};

export const getScoringPlayPoints = (play: ScoringPlay | Play, league: string): string | null => {
    const type = (play.type || '').toLowerCase();
    const text = (play.text || '').toLowerCase();

    if (league === 'NFL' || league === 'NCAAF') {
        if (type.includes('touchdown')) return '+6';
        if (type.includes('field goal') && !type.includes('miss') && !type.includes('blocked')) return '+3';
        if (type.includes('safety')) return '+2';
        if (type.includes('extra point') && (text.includes('good') || text.includes('made'))) return '+1';
        if (type.includes('conversion') && text.includes('good')) return '+2';
    } else if (['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(league)) {
        if (text.includes('three point') || text.includes('3-pointer')) return '+3';
        if (text.includes('free throw')) return '+1';
        return '+2'; 
    } else if (league === 'MLB') {
        if (type.includes('homerun') || type.includes('home run')) {
            if (text.includes('grand slam')) return '+4';
            if (text.includes('3-run')) return '+3';
            if (text.includes('2-run')) return '+2';
            return '+1';
        }
        return '+1';
    } else if (SOCCER_LEAGUES.includes(league as Sport) || league === 'NHL') {
        return '+1';
    }
    return null;
};
