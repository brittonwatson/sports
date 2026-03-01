
import { ScoringPlay, Play, Sport, SOCCER_LEAGUES } from '../types';

export const getTeamColor = (primary: string | undefined, alternate: string | undefined, isDarkMode: boolean): string => {
    const defaultColor = isDarkMode ? '#e5e7eb' : '#171717';

    const normalizeHex = (value?: string): string | null => {
        if (!value) return null;
        const trimmed = value.trim().replace('#', '');
        if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
            return trimmed.split('').map((c) => `${c}${c}`).join('').toLowerCase();
        }
        if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
        return null;
    };

    const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
    });

    const rgbToHex = (rgb: { r: number; g: number; b: number }): string =>
        `#${[rgb.r, rgb.g, rgb.b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;

    const srgbToLinear = (channel: number): number => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };

    const luminance = (hex: string): number => {
        const { r, g, b } = hexToRgb(hex);
        const rl = srgbToLinear(r);
        const gl = srgbToLinear(g);
        const bl = srgbToLinear(b);
        return (0.2126 * rl) + (0.7152 * gl) + (0.0722 * bl);
    };

    const mixTowardWhite = (hex: string, amount: number): string => {
        const clamped = Math.max(0, Math.min(1, amount));
        const { r, g, b } = hexToRgb(hex);
        return rgbToHex({
            r: r + ((255 - r) * clamped),
            g: g + ((255 - g) * clamped),
            b: b + ((255 - b) * clamped),
        });
    };

    const primaryHex = normalizeHex(primary);
    const alternateHex = normalizeHex(alternate);
    if (!primaryHex) return defaultColor;

    const isBlack = primaryHex === '000000';
    const isWhite = primaryHex === 'ffffff';

    if (!isDarkMode) {
        if (isWhite) return alternateHex ? `#${alternateHex}` : '#000000';
        return `#${primaryHex}`;
    }

    let candidate = primaryHex;
    if (isBlack) {
        candidate = alternateHex && alternateHex !== '000000' ? alternateHex : 'ffffff';
    }

    const candidateLum = luminance(candidate);
    const alternateLum = alternateHex ? luminance(alternateHex) : 0;

    if (alternateHex && alternateHex !== candidate && alternateLum > candidateLum + 0.06) {
        candidate = alternateHex;
    }

    // Ensure accent colors remain visible on dark surfaces.
    let finalColor = `#${candidate}`;
    let finalLum = luminance(candidate);
    if (finalLum < 0.20) {
        finalColor = mixTowardWhite(candidate, 0.28);
        finalLum = luminance(normalizeHex(finalColor) || candidate);
    }
    if (finalLum < 0.28) {
        finalColor = mixTowardWhite(normalizeHex(finalColor) || candidate, 0.42);
    }

    return finalColor;
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
