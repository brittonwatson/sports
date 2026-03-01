
import React, { useMemo } from 'react';
import { StandingsGroup, Sport, StandingsType, SOCCER_LEAGUES } from '../types';
import { Info, AlertCircle, Trophy, List, GitMerge } from 'lucide-react';
import { getInternalHistoricalGamesBySport, getInternalTeamStats } from '../services/internalDbService';
import { canonicalizeStatLabel, isInverseMetricLabel } from '../services/statDictionary';

interface StandingsViewProps {
    groups: StandingsGroup[];
    sport: Sport;
    type?: 'STANDINGS' | 'RANKINGS';
    activeType?: StandingsType;
    onTypeChange?: (type: StandingsType) => void;
    onTeamClick?: (teamId: string, league: Sport) => void;
    isLoading?: boolean;
    useApiRankForNCAA?: boolean;
}

// Config to determine where the cutoff line goes
const CUTOFF_CONFIG: Partial<Record<Sport, { rank: number; label: string; secondaryRank?: number; secondaryLabel?: string }>> = {
    'NBA': { rank: 6, label: 'Playoffs', secondaryRank: 10, secondaryLabel: 'Play-In' },
    'NFL': { rank: 7, label: 'Playoffs' },
    'MLB': { rank: 6, label: 'Postseason' },
    'NHL': { rank: 8, label: 'Playoffs' }, 
    'EPL': { rank: 4, label: 'Champions League', secondaryRank: 5, secondaryLabel: 'Europa' },
    'Bundesliga': { rank: 4, label: 'Champions League' },
    'La Liga': { rank: 4, label: 'Champions League' },
    'Serie A': { rank: 4, label: 'Champions League' },
    'Ligue 1': { rank: 3, label: 'Champions League' },
    'MLS': { rank: 9, label: 'Playoffs' },
    'WNBA': { rank: 8, label: 'Playoffs' }
};

// Sports where conference record is a key display metric
const SHOW_CONF_RECORD_LEAGUES: Sport[] = ['NCAAF', 'NCAAM', 'NCAAW', 'WNBA', 'NHL', 'MLB'];

// Sports eligible for the toggle
const TOGGLE_ELIGIBLE_SPORTS: Sport[] = ['NFL', 'NBA', 'NHL', 'MLB', 'WNBA'];

interface ProjectionRow {
    teamId: string;
    teamName: string;
    teamAbbreviation: string;
    logo?: string;
    groupName: string;
    rank: number;
    playoffProbability: number; // 0..1
    championshipProbability: number; // 0..1
    eliminated: boolean;
    clinched: boolean;
}

interface GroupPlayoffMeta {
    cutoff: number;
    cutoffWinPct: number;
    cutoffWins: number;
    seasonTarget: number;
}

const SEASON_GAME_TARGET: Partial<Record<Sport, number>> = {
    NBA: 82,
    WNBA: 44,
    NFL: 17,
    NCAAF: 12,
    MLB: 162,
    NHL: 82,
    MLS: 34,
    EPL: 38,
    Bundesliga: 34,
    'La Liga': 38,
    'Serie A': 38,
    'Ligue 1': 34,
    UCL: 8,
    NCAAM: 31,
    NCAAW: 31,
};

const CHAMPIONSHIP_ROUNDS: Partial<Record<Sport, number>> = {
    NFL: 4,
    NBA: 4,
    NHL: 4,
    MLB: 4,
    WNBA: 3,
    MLS: 4,
    NCAAF: 3,
    NCAAM: 6,
    NCAAW: 6,
    UCL: 4,
    EPL: 1,
    Bundesliga: 1,
    'La Liga': 1,
    'Serie A': 1,
    'Ligue 1': 1,
};

const parseLooseNumber = (value: string | number | undefined, label?: string): number | null => {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim();
    if (!raw || raw === '-' || raw === '--' || raw.toLowerCase() === 'n/a') return null;

    const timeMatch = raw.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
        const a = parseInt(timeMatch[1], 10);
        const b = parseInt(timeMatch[2], 10);
        const c = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
        if (timeMatch[3]) return (a * 60) + b + (c / 60);
        return a + (b / 60);
    }

    const pairMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*[-/]\s*(-?\d+(?:\.\d+)?)$/);
    if (pairMatch) {
        const made = parseFloat(pairMatch[1]);
        const attempts = parseFloat(pairMatch[2]);
        if (!Number.isFinite(made) || !Number.isFinite(attempts) || attempts === 0) return null;
        const lowerLabel = String(label || '').toLowerCase();
        const looksRate =
            lowerLabel.includes('%') ||
            lowerLabel.includes('pct') ||
            lowerLabel.includes('rate') ||
            lowerLabel.includes('ratio') ||
            lowerLabel.includes('efficiency') ||
            lowerLabel.includes('completion') ||
            lowerLabel.includes('field goal') ||
            lowerLabel.includes('free throw') ||
            lowerLabel.includes('three point');
        if (!looksRate) return null;
        return (made / attempts) * 100;
    }

    const numeric = parseFloat(raw.replace(/,/g, '').replace('%', '').replace('+', ''));
    if (!Number.isFinite(numeric)) return null;
    if (raw.includes('%') && Math.abs(numeric) <= 1) return numeric * 100;
    return numeric;
};

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

const clamp = (value: number, min: number, max: number): number => {
    if (Number.isNaN(value)) return min;
    return Math.min(max, Math.max(min, value));
};

const formatProbability = (probability: number): string => {
    const pct = clamp(probability * 100, 0, 100);
    if (pct <= 0.05 || pct >= 99.95) return `${Math.round(pct)}%`;
    return `${pct.toFixed(1)}%`;
};

const toWinPct = (wins: number, losses: number, ties: number): number => {
    const games = wins + losses + ties;
    if (games <= 0) return 0;
    return (wins + (ties * 0.5)) / games;
};

const parseStreakScore = (streak?: string): number => {
    if (!streak) return 0;
    const normalized = streak.trim().toUpperCase();
    const match = normalized.match(/^([WLTD])\s*([0-9]+)/);
    if (!match) return 0;
    const count = parseInt(match[2], 10);
    if (!Number.isFinite(count)) return 0;
    if (match[1] === 'W') return count;
    if (match[1] === 'L') return -count;
    return 0;
};

const parseGamesBehind = (value?: string): number => {
    if (!value) return 0;
    const normalized = value.trim().toUpperCase();
    if (!normalized || normalized === '-' || normalized === '--' || normalized === 'GB' || normalized === 'E') return 0;
    const parsed = parseFloat(normalized.replace(/[A-Z]/g, '').trim());
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const scoreScaleBySport = (sport: Sport): number => {
    if (sport === 'NBA' || sport === 'WNBA' || sport === 'NCAAM' || sport === 'NCAAW') return 12;
    if (sport === 'NFL' || sport === 'NCAAF') return 9;
    if (sport === 'MLB') return 2;
    if (sport === 'NHL') return 2;
    if (SOCCER_LEAGUES.includes(sport)) return 1.6;
    return 6;
};

const cutoffForGroup = (
    sport: Sport,
    groupSize: number,
    conf?: { rank: number; label: string; secondaryRank?: number; secondaryLabel?: string },
): number => {
    if (conf?.secondaryRank) return Math.min(groupSize, conf.secondaryRank);
    if (conf?.rank) return Math.min(groupSize, conf.rank);
    if (SOCCER_LEAGUES.includes(sport)) return Math.max(1, Math.round(groupSize * 0.25));
    if (sport === 'NCAAF') return Math.min(groupSize, 12);
    if (sport === 'NCAAM' || sport === 'NCAAW') return Math.min(groupSize, Math.max(4, Math.round(groupSize * 0.45)));
    return Math.max(1, Math.round(groupSize * 0.5));
};

export const StandingsView: React.FC<StandingsViewProps> = ({ groups, sport, type = 'STANDINGS', activeType = 'PLAYOFF', onTypeChange, onTeamClick, isLoading = false, useApiRankForNCAA = false }) => {
    const config = CUTOFF_CONFIG[sport];
    const isNCAA = sport.startsWith('NCAA');
    const isRankings = type === 'RANKINGS';
    const isSoccer = SOCCER_LEAGUES.includes(sport);
    
    // Check if ANY team in the current view has valid conference record data. 
    // If not, hide the column to keep it clean, UNLESS it's NCAA where we expect it even if 0-0.
    const hasConfData = useMemo(() => {
        if (isNCAA) return true; // Always show for NCAA
        return groups.some(g => g.standings.some(s => s.stats.confRecord && s.stats.confRecord !== '-' && s.stats.confRecord !== '0-0'));
    }, [groups, isNCAA]);

    const showConf = SHOW_CONF_RECORD_LEAGUES.includes(sport) && !isRankings && hasConfData;
    const showToggle = TOGGLE_ELIGIBLE_SPORTS.includes(sport) && !isRankings && onTypeChange;
    const showPlayoffProjection = !isRankings && groups.length > 0 && (activeType === 'PLAYOFF' || !showToggle);

    const divisionLabel = ['NBA', 'WNBA', 'NFL', 'NCAAF'].includes(sport) ? 'Conference' : 'Division';

    const playoffProjection = useMemo(() => {
        if (!showPlayoffProjection) return null;

        const flatTeams = groups.flatMap((group) =>
            group.standings.map((standing) => ({ groupName: group.name, standing })),
        );
        if (flatTeams.length < 2) return null;

        const teamIds = new Set(flatTeams.map((entry) => String(entry.standing.team.id)));
        const labelValues = new Map<string, number[]>();
        const teamStatValues = new Map<string, Map<string, number>>();

        flatTeams.forEach(({ standing }) => {
            const teamId = String(standing.team.id);
            const stats = getInternalTeamStats(sport, teamId);
            const values = new Map<string, number>();
            stats.forEach((item) => {
                if (!item?.label) return;
                const canonicalLabel = canonicalizeStatLabel(sport, item.label);
                if (!canonicalLabel) return;
                const numeric = parseLooseNumber(item.value, canonicalLabel);
                if (numeric === null || !Number.isFinite(numeric)) return;
                if (!values.has(canonicalLabel)) values.set(canonicalLabel, numeric);
            });
            teamStatValues.set(teamId, values);
            values.forEach((value, label) => {
                const arr = labelValues.get(label) || [];
                arr.push(value);
                labelValues.set(label, arr);
            });
        });

        const minCoverage = Math.max(4, Math.ceil(flatTeams.length * 0.4));
        const distributions = new Map<string, { mean: number; stdev: number; inverse: boolean }>();
        labelValues.forEach((values, label) => {
            if (values.length < minCoverage) return;
            const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
            const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
            const stdev = Math.sqrt(Math.max(0, variance));
            if (!Number.isFinite(stdev) || stdev <= 1e-6) return;
            distributions.set(label, { mean, stdev, inverse: isInverseMetricLabel(label) });
        });

        const groupMeta = new Map<string, GroupPlayoffMeta>();
        groups.forEach((group) => {
            const sorted = [...group.standings].sort((a, b) => a.rank - b.rank);
            if (sorted.length === 0) return;
            const cutoff = cutoffForGroup(sport, sorted.length, config);
            const cutoffTeam = sorted[Math.max(0, Math.min(sorted.length - 1, cutoff - 1))];
            const cutoffWins = Number(cutoffTeam.stats.wins || 0);
            const cutoffLosses = Number(cutoffTeam.stats.losses || 0);
            const cutoffTies = Number(cutoffTeam.stats.ties || 0);
            const cutoffWinPct = toWinPct(cutoffWins, cutoffLosses, cutoffTies);
            const maxGamesPlayed = Math.max(
                ...sorted.map((row) => Number(row.stats.wins || 0) + Number(row.stats.losses || 0) + Number(row.stats.ties || 0)),
            );
            const seasonTarget = Math.max(SEASON_GAME_TARGET[sport] || 0, maxGamesPlayed || 0);
            groupMeta.set(group.name, { cutoff, cutoffWinPct, cutoffWins, seasonTarget });
        });

        const historicalGames = getInternalHistoricalGamesBySport(sport).filter((game) => {
            if (game.status !== 'finished') return false;
            if (!game.homeTeamId || !game.awayTeamId) return false;
            return teamIds.has(String(game.homeTeamId)) && teamIds.has(String(game.awayTeamId));
        });

        const h2hMap = new Map<string, { games: number; wins: number; losses: number; draws: number; margin: number }>();
        const updateH2H = (teamA: string, teamB: string, margin: number, isWin: boolean, isLoss: boolean, isDraw: boolean) => {
            const key = `${teamA}|${teamB}`;
            const existing = h2hMap.get(key) || { games: 0, wins: 0, losses: 0, draws: 0, margin: 0 };
            existing.games += 1;
            if (isWin) existing.wins += 1;
            if (isLoss) existing.losses += 1;
            if (isDraw) existing.draws += 1;
            existing.margin += margin;
            h2hMap.set(key, existing);
        };

        historicalGames.forEach((game) => {
            const homeId = String(game.homeTeamId);
            const awayId = String(game.awayTeamId);
            const homeScore = parseLooseNumber(game.homeScore) ?? 0;
            const awayScore = parseLooseNumber(game.awayScore) ?? 0;
            const margin = homeScore - awayScore;
            const isDraw = Math.abs(margin) < 0.0001;
            updateH2H(homeId, awayId, margin, margin > 0, margin < 0, isDraw);
            updateH2H(awayId, homeId, -margin, margin < 0, margin > 0, isDraw);
        });

        const baseRows = flatTeams.map(({ groupName, standing }) => {
            const teamId = String(standing.team.id);
            const wins = Number(standing.stats.wins || 0);
            const losses = Number(standing.stats.losses || 0);
            const ties = Number(standing.stats.ties || 0);
            const gamesPlayed = wins + losses + ties;
            const group = groupMeta.get(groupName);
            const seasonTarget = Math.max(group?.seasonTarget || 0, gamesPlayed);
            const remaining = Math.max(0, seasonTarget - gamesPlayed);
            const winPct = toWinPct(wins, losses, ties);
            const pointDiffRaw = Number(standing.stats.pointDifferential || 0);
            const pointDiffPerGame = gamesPlayed > 0 ? pointDiffRaw / gamesPlayed : 0;
            const rank = Number(standing.rank || 0);
            const cutoff = group?.cutoff || Math.max(1, Math.round(flatTeams.length * 0.5));
            const cutoffWinPct = group?.cutoffWinPct || 0.5;
            const cutoffWins = group?.cutoffWins || 0;
            const streakScore = parseStreakScore(standing.stats.streak);
            const gamesBehind = parseGamesBehind(standing.stats.gamesBehind);
            const values = teamStatValues.get(teamId) || new Map<string, number>();

            let statPowerSum = 0;
            let statPowerCount = 0;
            distributions.forEach((dist, label) => {
                const value = values.get(label);
                if (value === undefined) return;
                let z = (value - dist.mean) / dist.stdev;
                if (dist.inverse) z = -z;
                statPowerSum += clamp(z, -3, 3);
                statPowerCount += 1;
            });
            const statPower = statPowerCount > 0 ? clamp(statPowerSum / statPowerCount, -2.5, 2.5) : 0;
            const reliability = seasonTarget > 0 ? clamp(gamesPlayed / seasonTarget, 0.1, 1) : 0.5;

            const clincherToken = String(standing.clincher || '').toLowerCase().replace(/[^a-z]/g, '');
            const eliminatedByFlag = clincherToken.includes('e');
            const clinched = standing.isChampion || (!!clincherToken && !eliminatedByFlag);

            const rankEdge = (cutoff - rank) / Math.max(1, cutoff);
            const pctEdge = (winPct - cutoffWinPct) * 6.2;
            const winsEdge = (wins - cutoffWins) / Math.max(1, Math.round(seasonTarget * 0.08));
            const diffEdge = pointDiffPerGame / scoreScaleBySport(sport);
            const gbPenalty = gamesBehind * 0.55;
            const momentumEdge = streakScore * 0.08;
            const strengthEdge = statPower * 0.95;
            const maxPossibleWins = wins + remaining + (ties * 0.5);
            const impossibleByRecord = rank > cutoff && remaining > 0 && maxPossibleWins + 0.001 < cutoffWins;

            let playoffProbability = 0;
            if (eliminatedByFlag || impossibleByRecord) {
                playoffProbability = 0;
            } else if (clinched) {
                playoffProbability = 1;
            } else if (remaining <= 0) {
                playoffProbability = rank <= cutoff ? 1 : 0;
            } else {
                const rawScore = (rankEdge * 1.45) + pctEdge + winsEdge + diffEdge + strengthEdge + momentumEdge - gbPenalty;
                const uncertaintyDamp = 0.7 + ((1 - reliability) * 0.9);
                const base = sigmoid(rawScore / uncertaintyDamp);
                playoffProbability = 0.5 + ((base - 0.5) * reliability);
                if (rank <= cutoff) playoffProbability = Math.max(playoffProbability, 0.52);
                playoffProbability = clamp(playoffProbability, 0, 0.995);
            }

            return {
                teamId,
                teamName: standing.team.name,
                teamAbbreviation: standing.team.abbreviation,
                logo: standing.team.logo,
                groupName,
                rank,
                wins,
                losses,
                ties,
                winPct,
                pointDiffPerGame,
                streakScore,
                statPower,
                playoffProbability,
                cutoff,
            };
        });

        const rowsWithElimination = baseRows.map((row) => ({
            ...row,
            eliminated: row.playoffProbability <= 0.0001,
        }));

        const sportRounds = CHAMPIONSHIP_ROUNDS[sport] || (SOCCER_LEAGUES.includes(sport) ? 1 : 3);
        const scoreScale = scoreScaleBySport(sport);
        const contenderScores = new Map<string, number>();
        rowsWithElimination.forEach((team) => {
            if (team.eliminated) {
                contenderScores.set(team.teamId, 0);
                return;
            }
            let matchupWeighted = 0;
            let matchupWeightTotal = 0;
            rowsWithElimination.forEach((opponent) => {
                if (team.teamId === opponent.teamId || opponent.eliminated) return;
                const powerEdge = (team.statPower - opponent.statPower) * 1.05;
                const winEdge = (team.winPct - opponent.winPct) * 2.4;
                const diffEdge = (team.pointDiffPerGame - opponent.pointDiffPerGame) / scoreScale;
                const h2h = h2hMap.get(`${team.teamId}|${opponent.teamId}`);
                let h2hEdge = 0;
                if (h2h && h2h.games > 0) {
                    const recordEdge = (h2h.wins - h2h.losses) / h2h.games;
                    const marginEdge = (h2h.margin / h2h.games) / scoreScale;
                    h2hEdge = (recordEdge * 0.65) + (marginEdge * 0.5);
                }
                const matchupProb = sigmoid(powerEdge + winEdge + diffEdge + h2hEdge);
                const weight = Math.max(0.02, opponent.playoffProbability);
                matchupWeighted += matchupProb * weight;
                matchupWeightTotal += weight;
            });
            const versusField = matchupWeightTotal > 0 ? (matchupWeighted / matchupWeightTotal) : 0.5;
            const seedEdge = (team.cutoff - team.rank + 1) / Math.max(1, team.cutoff);
            const seedFactor = clamp(0.84 + (seedEdge * 0.24), 0.62, 1.24);
            const momentumFactor = clamp(1 + (team.streakScore * 0.02), 0.8, 1.25);
            const playoffFactor = Math.pow(clamp(team.playoffProbability, 0, 1), 1.12);
            const pathFactor = Math.pow(clamp(versusField, 0.2, 0.95), Math.max(1, sportRounds));
            const statFactor = Math.exp(clamp(team.statPower, -2.5, 2.5) * 0.32);
            const score = playoffFactor * pathFactor * seedFactor * momentumFactor * statFactor;
            contenderScores.set(team.teamId, Number.isFinite(score) ? Math.max(0, score) : 0);
        });

        const scoreSum = Array.from(contenderScores.values()).reduce((sum, value) => sum + value, 0);
        const rows: ProjectionRow[] = rowsWithElimination.map((row) => {
            const championshipProbability = row.eliminated || scoreSum <= 0
                ? 0
                : (contenderScores.get(row.teamId) || 0) / scoreSum;
            const clinched = row.playoffProbability >= 0.999;
            return {
                teamId: row.teamId,
                teamName: row.teamName,
                teamAbbreviation: row.teamAbbreviation,
                logo: row.logo,
                groupName: row.groupName,
                rank: row.rank,
                playoffProbability: row.eliminated ? 0 : clamp(row.playoffProbability, 0, 1),
                championshipProbability: row.eliminated ? 0 : clamp(championshipProbability, 0, 1),
                eliminated: row.eliminated,
                clinched,
            };
        });

        rows.sort((a, b) => b.championshipProbability - a.championshipProbability);

        const qualificationLabel = config?.secondaryLabel
            ? `${config.secondaryLabel} / ${config.label}`
            : (config?.label || (SOCCER_LEAGUES.includes(sport) ? 'Qualification' : 'Postseason'));

        return {
            rows,
            qualificationLabel,
        };
    }, [config, groups, showPlayoffProjection, sport]);

    if (isLoading) {
        return (
            <div className="space-y-6 animate-fade-in">
                {showToggle && (
                    <div className="flex justify-center mb-2">
                        <div className="w-full max-w-sm h-10 bg-slate-100 dark:bg-slate-900/80 rounded-xl animate-pulse"></div>
                    </div>
                )}
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="bg-slate-50/80 dark:bg-slate-900 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse"></div>
                        </div>
                        <div className="p-0">
                            {[...Array(8)].map((__, j) => (
                                <div key={j} className="flex items-center px-6 py-3 border-b border-slate-100 dark:border-slate-800/40">
                                    <div className="w-6 h-4 bg-slate-100 dark:bg-slate-800 rounded mr-6 animate-pulse"></div>
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse"></div>
                                        <div className="h-4 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
                                    </div>
                                    <div className="w-12 h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-4"></div>
                                    <div className="w-12 h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-4"></div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Toggle Control for Eligible Sports */}
            {showToggle && (
                <div className="flex justify-center mb-2">
                    <div className="flex w-full max-w-sm bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                        <button
                            onClick={() => onTypeChange?.('PLAYOFF')}
                            className={`flex-1 flex items-center justify-center px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                                ${activeType === 'PLAYOFF' 
                                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            Playoff Picture
                        </button>
                        <button
                            onClick={() => onTypeChange?.('DIVISION')}
                            className={`flex-1 flex items-center justify-center px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                                ${activeType === 'DIVISION' 
                                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            {divisionLabel} Standings
                        </button>
                    </div>
                </div>
            )}

            {playoffProjection && playoffProjection.rows.length > 0 && (
                <div className="bg-white dark:bg-slate-900/55 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <Trophy size={15} className="text-amber-500" />
                            <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                                Playoff Probability Model
                            </h3>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                            Updates after completed games
                        </span>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                                <GitMerge size={13} className="text-indigo-500" />
                                Championship Probability
                            </div>
                            <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
                                {[...playoffProjection.rows]
                                    .sort((a, b) => b.championshipProbability - a.championshipProbability)
                                    .map((row, index) => (
                                        <button
                                            key={`champ-${row.teamId}`}
                                            type="button"
                                            onClick={() => onTeamClick?.(row.teamId, sport)}
                                            className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                                                row.eliminated
                                                    ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 opacity-50 grayscale'
                                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-700'
                                            }`}
                                            aria-label={`Open ${row.teamName} team page`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="w-5 text-[11px] font-mono text-slate-500 dark:text-slate-400">{index + 1}</span>
                                                {row.logo ? (
                                                    <img src={row.logo} alt="" className="w-6 h-6 object-contain shrink-0" loading="lazy" />
                                                ) : (
                                                    <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{row.teamName}</p>
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                                                        Seed {row.rank} {row.clinched ? '• Clinched' : row.eliminated ? '• Eliminated' : ''}
                                                    </p>
                                                </div>
                                                <span className={`font-mono font-bold text-sm ${row.eliminated ? 'text-slate-400 dark:text-slate-500' : 'text-indigo-600 dark:text-indigo-400'}`}>
                                                    {formatProbability(row.championshipProbability)}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                                <List size={13} className="text-emerald-500" />
                                {playoffProjection.qualificationLabel} Probability
                            </div>
                            <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
                                {[...playoffProjection.rows]
                                    .sort((a, b) => b.playoffProbability - a.playoffProbability)
                                    .map((row, index) => (
                                        <button
                                            key={`playoff-${row.teamId}`}
                                            type="button"
                                            onClick={() => onTeamClick?.(row.teamId, sport)}
                                            className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                                                row.eliminated
                                                    ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 opacity-50 grayscale'
                                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-emerald-300 dark:hover:border-emerald-700'
                                            }`}
                                            aria-label={`Open ${row.teamName} team page`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="w-5 text-[11px] font-mono text-slate-500 dark:text-slate-400">{index + 1}</span>
                                                {row.logo ? (
                                                    <img src={row.logo} alt="" className="w-6 h-6 object-contain shrink-0" loading="lazy" />
                                                ) : (
                                                    <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{row.teamName}</p>
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                                                        Seed {row.rank} {row.clinched ? '• Clinched' : row.eliminated ? '• Eliminated' : ''}
                                                    </p>
                                                </div>
                                                <span className={`font-mono font-bold text-sm ${row.eliminated ? 'text-slate-400 dark:text-slate-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                    {formatProbability(row.playoffProbability)}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </div>

                    <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Uses each team&apos;s current-season record, point differential, full internal stat profile, and direct head-to-head game outcomes to estimate
                        postseason qualification and championship share. Eliminated teams are fixed at 0%.
                    </div>
                </div>
            )}

            {!groups.length ? (
                <div className="p-16 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20">
                    <p>Standings data not available for this view.</p>
                </div>
            ) : (
                groups.map((group, groupIdx) => {
                    // Sorting Logic: Enforce Conference Record Order for NCAA
                    const sortedStandings = [...group.standings].sort((a, b) => {
                        // For Rankings view (e.g. AP Top 25), rely strictly on rank
                        if (isRankings) return a.rank - b.rank;

                        // When the app requests NCAA Top-25 behavior inside standings views,
                        // keep API rank ordering so teams are not reshuffled by conference records.
                        if (isNCAA && useApiRankForNCAA) {
                            return a.rank - b.rank;
                        }

                        // For NCAA Conference Standings
                        if (isNCAA) {
                            // 1. Conference Winning Percentage
                            const getConfPct = (rec?: string) => {
                                if (!rec || rec === '-') return -1;
                                const [w, l] = rec.split('-').map(Number);
                                if (isNaN(w) || isNaN(l)) return -1;
                                const total = w + l;
                                return total === 0 ? 0 : w / total;
                            };
                            
                            const confPctA = getConfPct(a.stats.confRecord);
                            const confPctB = getConfPct(b.stats.confRecord);
                            
                            if (confPctA !== confPctB) return confPctB - confPctA; // Descending Pct

                            // 2. Overall Winning Percentage
                            const getOverPct = (pct?: string) => parseFloat(pct || '0');
                            const overPctA = getOverPct(a.stats.pct);
                            const overPctB = getOverPct(b.stats.pct);
                            if (overPctA !== overPctB) return overPctB - overPctA;

                            // 3. Fallback to Rank provided by API (often handles complex tie-breakers)
                            return a.rank - b.rank;
                        }

                        // Default for other leagues: Trust API Rank
                        return a.rank - b.rank;
                    });

                    return (
                    <div key={groupIdx} className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="bg-slate-50/80 dark:bg-slate-900 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider font-display">{group.name}</h3>
                            {/* Only show cutoff labels in Playoff mode or if it's a sport that doesn't have a toggle */}
                            {config && !isNCAA && !isRankings && (activeType === 'PLAYOFF' || !showToggle) && (
                                <div className="flex items-center gap-4 text-[10px] text-slate-500 dark:text-slate-500 font-semibold">
                                    {/* Playoff Line Legend */}
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-0 border-t-2 border-dashed ${config.secondaryRank ? 'border-blue-400 dark:border-blue-500' : 'border-rose-400 dark:border-rose-500'}`}></div>
                                        <span>{config.label}</span>
                                    </div>
                                    
                                    {/* Play-In Line Legend */}
                                    {config.secondaryRank && (
                                         <div className="flex items-center gap-2">
                                            <div className="w-6 h-0 border-t-2 border-dashed border-rose-400 dark:border-rose-500"></div>
                                            <span>{config.secondaryLabel}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800/80">
                                        <th className="px-6 py-3 w-16 text-center">Rk</th>
                                        <th className="px-6 py-3">Team</th>
                                        {showConf && <th className="px-6 py-3 text-right">Conf</th>}
                                        <th className="px-6 py-3 text-right">{isNCAA ? 'Overall' : `W-D-L`}</th>
                                        {(!isNCAA || isRankings) && (
                                            <th className="px-6 py-3 text-right">{isSoccer || sport === 'NHL' || isRankings ? 'Pts' : 'Pct'}</th>
                                        )}
                                        <th className="px-6 py-3 text-right hidden sm:table-cell">{isRankings ? 'Trend' : 'Diff/GB'}</th>
                                        {!isRankings && <th className="px-6 py-3 text-right hidden sm:table-cell">Strk</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedStandings.map((team, idx) => {
                                        // Calculate display rank dynamically based on sort order if API rank looks unordered or if we re-sorted
                                        const displayRank = isNCAA && !isRankings && !useApiRankForNCAA ? idx + 1 : team.rank;
                                        
                                        // Check if we need a cutoff border
                                        let borderClass = "border-b border-slate-100 dark:border-slate-800/40";
                                        
                                        // Cutoff logic: Only apply in Playoff mode or non-toggle sports
                                        if (config && !isNCAA && !isRankings && (activeType === 'PLAYOFF' || !showToggle)) {
                                            if (team.rank === config.rank) {
                                                const colorClass = config.secondaryRank ? 'border-blue-400 dark:border-blue-500' : 'border-rose-400 dark:border-rose-500';
                                                borderClass = `border-b-2 ${colorClass} border-dashed relative`;
                                            } else if (config.secondaryRank && team.rank === config.secondaryRank) {
                                                 borderClass = "border-b-2 border-rose-400 dark:border-rose-500 border-dashed relative";
                                            }
                                        }
                                        
                                        // Remove border from last item if not a cutoff
                                        if (idx === group.standings.length - 1 && !borderClass.includes('dashed')) {
                                            borderClass = "border-none";
                                        }

                                        return (
                                            <React.Fragment key={team.team.id}>
                                                <tr className={`group hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-sm ${borderClass}`}>
                                                    <td className="px-6 py-3 text-center font-mono text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 relative font-medium">
                                                        {displayRank}
                                                        {team.clincher && !team.isChampion && sport !== 'NFL' && (
                                                            <span className="ml-1 text-[9px] align-top text-slate-900 dark:text-white font-bold" title="Clinched Playoff Spot">{team.clincher}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        <div className="flex flex-col gap-1">
                                                            <div 
                                                                className={`flex items-center gap-3 ${onTeamClick ? 'cursor-pointer' : ''}`}
                                                                onClick={() => onTeamClick?.(team.team.id, sport)}
                                                            >
                                                                {team.team.logo && (
                                                                    <img src={team.team.logo} alt="" className="w-6 h-6 object-contain drop-shadow-sm" loading="lazy" />
                                                                )}
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-semibold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                                                                        {team.team.name}
                                                                    </span>
                                                                    {/* Champion Trophy Icon - Hidden for NFL */}
                                                                    {team.isChampion && sport !== 'NFL' && (
                                                                        <Trophy size={14} className="text-yellow-500 drop-shadow-sm" fill="currentColor" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {/* Tie-breaker Note */}
                                                            {team.note && !isRankings && (
                                                                <div className="flex items-start gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 italic pl-9 opacity-80 group-hover:opacity-100">
                                                                    <Info size={10} className="mt-0.5 shrink-0" />
                                                                    <span>{team.note}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {showConf && (
                                                        <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-400 align-top pt-3.5 font-medium">
                                                            {team.stats.confRecord || '0-0'}
                                                        </td>
                                                    )}

                                                    <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-400 align-top pt-3.5 font-medium">
                                                        {isSoccer 
                                                            ? `${team.stats.wins || 0}-${team.stats.ties || 0}-${team.stats.losses || 0}` 
                                                            : sport === 'NHL' 
                                                                ? `${team.stats.wins || 0}-${team.stats.losses || 0}-${team.stats.ties || 0}`
                                                                : (team.stats.overallRecord || `${team.stats.wins || 0}-${team.stats.losses || 0}${team.stats.ties !== undefined && team.stats.ties > 0 ? `-${team.stats.ties}` : ''}`)
                                                        }
                                                    </td>
                                                    
                                                    {(!isNCAA || isRankings) && (
                                                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200 align-top pt-3.5">
                                                            {isSoccer || sport === 'NHL' || isRankings 
                                                                ? team.stats.points 
                                                                : team.stats.pct}
                                                        </td>
                                                    )}
                                                    
                                                    {isRankings ? (
                                                         <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-500 hidden sm:table-cell text-xs align-top pt-3.5">
                                                            {team.note || '-'}
                                                        </td>
                                                    ) : (
                                                        <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-500 hidden sm:table-cell align-top pt-3.5">
                                                            {team.stats.gamesBehind || (team.stats.pointDifferential && team.stats.pointDifferential > 0 ? `+${team.stats.pointDifferential}` : team.stats.pointDifferential) || '-'}
                                                        </td>
                                                    )}

                                                    {!isRankings && (
                                                        <td className="px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-500 hidden sm:table-cell text-xs align-top pt-3.5">
                                                            {team.stats.streak || '-'}
                                                        </td>
                                                    )}
                                                </tr>
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )})
            )}
            
            {!isRankings && !isLoading && (
                <div className="flex items-start gap-3 p-5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-400">
                    <AlertCircle size={16} className="mt-0.5 shrink-0 text-slate-400" />
                    <p className="leading-relaxed">
                        Playoff picture is projected based on current standings and league rules. 
                        Tie-breaker information is provided where applicable by the league data source.
                    </p>
                </div>
            )}
        </div>
    );
};
