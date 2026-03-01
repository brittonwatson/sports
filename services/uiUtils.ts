
import { Game, ScoringPlay, Play, Sport, SOCCER_LEAGUES, RACING_LEAGUES } from '../types';

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
    const combined = `${type} ${text}`;
    const explicitScoringFlag = (('scoringPlay' in play) && Boolean(play.scoringPlay)) || (('isHome' in play) && Boolean(play.isHome !== undefined));

    const hasAny = (...patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(combined));
    const hasNoScoreContext = hasAny(
        /\btimeout\b/,
        /\bout of bounds\b/,
        /\brebound\b/,
        /\bturnover\b/,
        /\bst(e|ea)al\b/,
        /\bblock\b/,
        /\bfoul\b/,
        /\bjump ball\b/,
        /\bviolation\b/,
        /\bend of\b/,
        /\bstart of\b/,
        /\bmiss(?:es|ed)?\b/,
        /\bno goal\b/,
    );
    if (!explicitScoringFlag && hasNoScoreContext) return null;

    if (league === 'NFL' || league === 'NCAAF') {
        if (hasAny(/\btouchdown\b/)) return '+6';
        if (hasAny(/\bfield goal\b/) && !hasAny(/\bmiss(?:es|ed)?\b/, /\bblocked\b/, /\bno good\b/)) return '+3';
        if (hasAny(/\bsafety\b/)) return '+2';
        if (hasAny(/\bextra point\b/) && hasAny(/\bgood\b/, /\bmade\b/)) return '+1';
        if (hasAny(/\btwo[-\s]?point conversion\b/, /\b2[-\s]?pt conversion\b/) && hasAny(/\bgood\b/, /\bsuccess(?:ful)?\b/)) return '+2';
    } else if (['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(league)) {
        const madeThree = hasAny(
            /\bmake(?:s|d)?\b.*\b(three|3[-\s]?pt|3[-\s]?pointer|three[-\s]?pointer)\b/,
            /\bhit(?:s)?\b.*\b(three|3[-\s]?pt|3[-\s]?pointer|three[-\s]?pointer)\b/,
        );
        if (madeThree) return '+3';

        const madeFreeThrow = hasAny(/\bfree throw\b/) && hasAny(/\bmake(?:s|d)?\b/, /\bgood\b/, /\bhit(?:s)?\b/);
        if (madeFreeThrow) return '+1';

        const madeTwo = hasAny(
            /\bmake(?:s|d)?\b.*\b(layup|dunk|jumper|jump shot|hook shot|bank shot|shot)\b/,
            /\bhit(?:s)?\b.*\b(layup|dunk|jumper|jump shot|hook shot|bank shot|shot)\b/,
        ) && !madeThree;
        if (madeTwo) return '+2';
        return null;
    } else if (league === 'MLB') {
        if (hasAny(/\bhome run\b/, /\bhomerun\b/)) {
            if (hasAny(/\bgrand slam\b/)) return '+4';
            if (hasAny(/\b3[-\s]?run\b/)) return '+3';
            if (hasAny(/\b2[-\s]?run\b/)) return '+2';
            return '+1';
        }
        if (hasAny(/\bscores\b/, /\bwalk[-\s]?off\b/, /\bsacrifice fly\b/, /\brbi\b/)) return '+1';
        return null;
    } else if (SOCCER_LEAGUES.includes(league as Sport) || league === 'NHL') {
        if (!explicitScoringFlag && !hasAny(/\bgoal\b/, /\bown goal\b/, /\bpenalty scored\b/)) return null;
        if (hasAny(/\bno goal\b/, /\boffside\b/, /\bsaved\b/)) return null;
        return '+1';
    }
    return null;
};

interface ParsedClock {
    seconds: number;
    format: 'mm:ss' | 'hh:mm:ss';
}

export interface LiveStatusSeed {
    baseClock?: string;
    baseStatus?: string;
}

const CLOCK_PATTERN = /^\s*(\d{1,3}):(\d{2})(?::(\d{2}))?\s*$/;
const SOCCER_MINUTE_PATTERN = /^\s*(\d{1,3})(?:\+(\d{1,2}))?\s*['’]?\s*$/;

const parseClockText = (value: string | undefined): ParsedClock | null => {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(CLOCK_PATTERN);
    if (!match) return null;
    const first = parseInt(match[1], 10);
    const second = parseInt(match[2], 10);
    const third = match[3] !== undefined ? parseInt(match[3], 10) : null;
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    if (third !== null && !Number.isFinite(third)) return null;

    if (third !== null) {
        return {
            seconds: (first * 3600) + (second * 60) + third,
            format: 'hh:mm:ss',
        };
    }
    return {
        seconds: (first * 60) + second,
        format: 'mm:ss',
    };
};

const formatClockText = (seconds: number, format: ParsedClock['format']): string => {
    const safe = Math.max(0, Math.floor(seconds));
    if (format === 'hh:mm:ss') {
        const h = Math.floor(safe / 3600);
        const m = Math.floor((safe % 3600) / 60);
        const s = safe % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const parseSoccerMinute = (value: string | undefined): number | null => {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(SOCCER_MINUTE_PATTERN);
    if (!match) return null;
    const minute = parseInt(match[1], 10);
    const extra = match[2] ? parseInt(match[2], 10) : 0;
    if (!Number.isFinite(minute) || !Number.isFinite(extra)) return null;
    return Math.max(0, minute + extra);
};

const formatSoccerMinute = (minutesElapsed: number): string =>
    `${Math.max(0, Math.floor(minutesElapsed))}'`;

const isLikelySoccerClock = (value: string | undefined): boolean =>
    /['’]/.test(String(value || '')) || SOCCER_MINUTE_PATTERN.test(String(value || '').trim());

const normalizeStatusSuffix = (baseStatus: string, baseClock: string): string => {
    const detail = String(baseStatus || '').trim();
    const clock = String(baseClock || '').trim();
    if (!detail) return '';

    const split = detail.match(/^(.+?)\s*[-•]\s*(.+)$/);
    if (split && split[2]) {
        const left = split[1].trim();
        if (left === clock || parseClockText(left) || parseSoccerMinute(left) !== null || /lap/i.test(left)) {
            return split[2].trim();
        }
    }

    if (clock && detail.toLowerCase().startsWith(clock.toLowerCase())) {
        return detail
            .slice(clock.length)
            .replace(/^\s*[-•]\s*/, '')
            .trim();
    }

    return detail === clock ? '' : detail;
};

const getLapTickSeconds = (league: string): number => {
    if (league === 'NASCAR') return 55;
    if (league === 'INDYCAR') return 75;
    if (league === 'F1') return 95;
    return 70;
};

const applyRacingRealtimeStatus = (
    league: string,
    baseStatus: string,
    baseClock: string,
    elapsedSeconds: number,
): string | null => {
    const detail = String(baseStatus || '').trim();
    const lapMatch = detail.match(/(lap(?:s)?\s*)(\d+)(?:\s*(?:\/|of)\s*(\d+))?/i);
    if (lapMatch) {
        const startLap = parseInt(lapMatch[2], 10);
        const totalLaps = lapMatch[3] ? parseInt(lapMatch[3], 10) : undefined;
        if (Number.isFinite(startLap) && startLap > 0) {
            const step = Math.floor(Math.max(0, elapsedSeconds) / getLapTickSeconds(league));
            const nextLap = totalLaps && totalLaps > 0
                ? Math.min(totalLaps, startLap + step)
                : startLap + step;
            return detail.replace(
                /(lap(?:s)?\s*)(\d+)(?:\s*(?:\/|of)\s*(\d+))?/i,
                (_, prefix: string) => `${prefix}${nextLap}${totalLaps && totalLaps > 0 ? `/${totalLaps}` : ''}`,
            );
        }
    }

    const remainingMatch = detail.match(/(\d{1,3}:\d{2}(?::\d{2})?)\s*(remaining|left)/i);
    if (remainingMatch) {
        const parsed = parseClockText(remainingMatch[1]);
        if (parsed) {
            const next = formatClockText(parsed.seconds - elapsedSeconds, parsed.format);
            return detail.replace(remainingMatch[1], next);
        }
    }

    const combinedContext = `${detail} ${String(baseClock || '')}`.toLowerCase();
    const isTimedSession = combinedContext.includes('practice') || combinedContext.includes('qualifying') || combinedContext.includes('shootout');
    if (isTimedSession) {
        const parsed = parseClockText(baseClock);
        if (parsed) {
            return `${formatClockText(parsed.seconds - elapsedSeconds, parsed.format)} remaining`;
        }
    }

    return null;
};

export const getRealtimeLiveStatus = (
    game: Game,
    seed: LiveStatusSeed,
    elapsedSeconds: number,
): string => {
    const baseClock = String(seed.baseClock ?? game.clock ?? '').trim();
    const baseStatus = String(seed.baseStatus ?? game.gameStatus ?? '').trim();
    const elapsed = Math.max(0, Math.floor(elapsedSeconds));

    if (RACING_LEAGUES.includes(game.league as Sport)) {
        const racingStatus = applyRacingRealtimeStatus(game.league, baseStatus, baseClock, elapsed);
        if (racingStatus) return racingStatus;
    }

    const isSoccer = SOCCER_LEAGUES.includes(game.league as Sport);
    const clockText = baseClock || (baseStatus.match(/(\d{1,3}:\d{2}(?::\d{2})?|\d{1,3}(?:\+\d{1,2})?\s*['’]?)/)?.[1] || '');

    if (clockText) {
        const parsedClock = parseClockText(clockText);
        const parsedSoccerMinute = parseSoccerMinute(clockText);
        let dynamicClock = clockText;

        if (parsedSoccerMinute !== null && (isSoccer || isLikelySoccerClock(clockText))) {
            dynamicClock = formatSoccerMinute(parsedSoccerMinute + (elapsed / 60));
        } else if (parsedClock) {
            const nextSeconds = isSoccer ? (parsedClock.seconds + elapsed) : (parsedClock.seconds - elapsed);
            dynamicClock = formatClockText(nextSeconds, parsedClock.format);
        }

        const suffix = normalizeStatusSuffix(baseStatus, clockText);
        if (suffix) return `${dynamicClock} - ${suffix}`;
        return dynamicClock;
    }

    return baseStatus || 'Live';
};
