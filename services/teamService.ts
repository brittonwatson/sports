
import { Sport, StandingsGroup, StandingsType, SOCCER_LEAGUES, TeamProfile, Game, TeamStatistics, TeamStatItem, LeagueStatRow, SPORTS } from "../types";
import { ESPN_ENDPOINTS } from "./constants";
import {
    fetchWithRetry,
    formatTeamName,
    extractNumber,
    normalizeStat,
    normalizeLocation,
    shouldHideUndeterminedPlayoffGame,
} from "./utils";
import { mapEventToGame } from "./mappers";
import { calculateDerivedRank } from "./probabilities/rankings";
import { saveStatsBatch, getStatsBySport, getTeamStats } from "./statsDb";
import {
    canonicalizeStatLabel,
    inferCanonicalCategory,
    isRateLikeStatLabel,
    normalizeStatToken,
} from "./statDictionary";
import { SEEDED_STATS } from "../data/seededStats";
import { LOCAL_TEAMS } from "../data/leagues/index";
import {
    ensureInternalSportLoaded,
    getInternalDatabaseGeneratedAt,
    getInternalStandings,
    getInternalTeamPlayerStats,
    getInternalTeamSchedule,
    getInternalTeamStatsBySport,
    getInternalTeamStats,
} from "./internalDbService";
import { scopeGamesToMostRecentSeason } from "./seasonScope";

// Concurrency lock to prevent multiple syncs for the same sport at once
const ACTIVE_SYNCS = new Set<string>();
const SYNC_COOLDOWN = 60 * 60 * 1000; // 1 Hour
const ACTIVE_HISTORICAL_SEASON_SYNCS = new Set<string>();
const NCAA_RANKED_SPORTS = new Set<Sport>(['NCAAF', 'NCAAM', 'NCAAW']);
const RACING_SPORTS = new Set<Sport>(['NASCAR', 'INDYCAR', 'F1']);
const NCAA_RANK_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const NCAA_RANK_CACHE = new Map<Sport, { fetchedAt: number; rankByTeamId: Map<string, number> }>();

const convertStandingsToStats = (data: any, sport: Sport): TeamStatItem[] => {
    const items: TeamStatItem[] = [];
    const str = (v: any) => (v === undefined || v === null) ? '0' : String(v);
    const num = (v: any): number => {
        const parsed = parseFloat(String(v ?? '0').replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const wins = num(data.wins);
    const losses = num(data.losses);
    const ties = num(data.ties ?? data.otLosses);
    const gp = wins + losses + ties;

    const toPerGame = (value: any, signed = false): string => {
        const raw = num(value);
        if (gp <= 0) {
            if (signed && raw > 0) return `+${raw.toFixed(1)}`;
            return raw.toFixed(1);
        }
        const avg = raw / gp;
        if (signed && avg > 0) return `+${avg.toFixed(1)}`;
        return avg.toFixed(1);
    };

    if (data.wins !== undefined) items.push({ label: 'Wins', value: str(data.wins), category: 'General' });
    if (data.losses !== undefined) items.push({ label: 'Losses', value: str(data.losses), category: 'General' });
    
    if (data.pointsFor !== undefined) {
        items.push({ label: 'Points', value: toPerGame(data.pointsFor), category: 'Team' });
    } else if (data.points !== undefined && !['EPL','MLS','NHL','Bundesliga','La Liga','Serie A','Ligue 1','UCL'].includes(sport)) {
        items.push({ label: 'Points', value: toPerGame(data.points), category: 'Team' });
    }

    if (data.pointsAgainst !== undefined) items.push({ label: 'Opponent Points', value: toPerGame(data.pointsAgainst), category: 'Opponent' });
    
    if (data.pointDifferential !== undefined) {
        items.push({ label: 'Points Differential', value: toPerGame(data.pointDifferential, true), category: 'Differential' });
    } else if (data.pointsFor !== undefined && data.pointsAgainst !== undefined) {
        const diff = num(data.pointsFor) - num(data.pointsAgainst);
        items.push({
            label: 'Points Differential',
            value: toPerGame(diff, true),
            category: 'Differential'
        });
    }

    return items;
};

export const fetchStandings = async (sport: Sport, type: StandingsType): Promise<StandingsGroup[]> => {
    await ensureInternalSportLoaded(sport);

    if (type === 'DIVISION') {
        const internal = getInternalStandings(sport);
        if (internal.length > 0) return internal;
    }

    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/v2/sports/${endpoint}/standings`;
    const params = new URLSearchParams();
    if (!SOCCER_LEAGUES.includes(sport)) params.set('seasontype', '2');
    
    if (['NFL', 'NBA', 'NHL', 'MLB'].includes(sport) && type === 'PLAYOFF') {
        params.set('level', '2');
    }
    
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) throw new Error("Failed");
        const data = await response.json();
        const groups: StandingsGroup[] = [];
        const process = (g: any) => {
            if (g.standings?.entries) {
                groups.push({
                    name: g.name || g.header || 'Standings',
                    standings: g.standings.entries.map((e: any) => {
                        const entryEntity = e.team || e.athlete;
                        const entityId = String(entryEntity?.id || '');
                        const entityName = e.team
                            ? formatTeamName(e.team, sport)
                            : String(entryEntity?.displayName || entryEntity?.name || 'Unknown');
                        const entityAbbreviation = String(
                            entryEntity?.abbreviation ||
                            entryEntity?.shortName ||
                            '',
                        );
                        const entityLogo = e.team?.logos?.[0]?.href ||
                            entryEntity?.flag?.href ||
                            entryEntity?.headshot?.href;

                        let racingStarts = 0;
                        let racingWins = 0;
                        const stats = (e.stats || []).reduce((acc: any, curr: any) => {
                            const val = extractNumber(curr.value);
                            const name = curr.name || '';
                            
                            if (name === 'wins') acc.wins = val;
                            if (name === 'losses') acc.losses = val;
                            if (name === 'ties') acc.ties = val;
                            if (name === 'otLosses') acc.ties = val;
                            
                            if (name === 'winPercent') acc.pct = (val * 100).toFixed(1) + '%';
                            if (name === 'points') acc.points = val; 
                            if (name === 'pointsFor') acc.pointsFor = val;
                            if (name === 'pointsAgainst') acc.pointsAgainst = val;
                            if (name === 'gamesBehind') acc.gamesBehind = normalizeStat(curr);
                            if (name === 'streak') acc.streak = normalizeStat(curr);
                            if (name === 'pointDifferential') acc.pointDifferential = val;
                            
                            if (name === 'vsConf') {
                                acc.confRecord = normalizeStat(curr);
                            } else if (!acc.confRecord && (name.toLowerCase().includes('conf') || curr.shortDisplayName?.toLowerCase().includes('conf'))) {
                                 const sVal = normalizeStat(curr);
                                 if (sVal && sVal.includes('-')) {
                                     acc.confRecord = sVal;
                                 }
                            }
                            
                            if (name === 'overall') acc.overallRecord = normalizeStat(curr);

                            if (RACING_SPORTS.has(sport) && curr?.played) {
                                racingStarts += 1;
                                if (String(curr?.displayValue || '').trim() === '1' || val === 1) {
                                    racingWins += 1;
                                }
                            }
                            
                            return acc;
                        }, {});

                        if (RACING_SPORTS.has(sport)) {
                            const championshipPoints = e.stats?.find((s: any) => s.name === 'championshipPts');
                            if (championshipPoints && stats.points === undefined) {
                                stats.points = extractNumber(championshipPoints.value);
                            }
                            if (!stats.overallRecord && racingStarts > 0) {
                                stats.overallRecord = `${racingWins}-${Math.max(0, racingStarts - racingWins)}`;
                            }
                            if (stats.wins === undefined && racingWins > 0) stats.wins = racingWins;
                            if (stats.losses === undefined && racingStarts > 0) stats.losses = Math.max(0, racingStarts - racingWins);
                        }

                        return {
                            team: {
                                id: entityId || `entry-${(entityName || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`,
                                name: entityName,
                                abbreviation: entityAbbreviation,
                                logo: entityLogo,
                            },
                            stats,
                            rank: extractNumber(e.stats?.find((s: any) => s.name === 'playoffSeed')?.value) || extractNumber(e.stats?.find((s: any) => s.name === 'rank')?.value) || 0,
                            clincher: e.stats?.find((s: any) => s.name === 'clincher')?.displayValue,
                            note: e.note?.description
                        };
                    })
                });
            }
            if (g.children) g.children.forEach(process);
        };
        if (data.children) data.children.forEach(process);
        else if (data.standings) process(data);

        if (sport === 'WNBA' && type === 'PLAYOFF') {
            const allTeams = groups.flatMap(g => g.standings);
            allTeams.sort((a, b) => {
                const pctA = parseFloat(a.stats.pct || '0');
                const pctB = parseFloat(b.stats.pct || '0');
                if (pctA !== pctB) return pctB - pctA;
                return (b.stats.pointDifferential || 0) - (a.stats.pointDifferential || 0);
            });
            allTeams.forEach((t, i) => t.rank = i + 1);
            return [{ name: 'WNBA League Standings', standings: allTeams }];
        }

        return groups;
    } catch { return []; }
};

export const fetchRankings = async (sport: Sport): Promise<StandingsGroup[]> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/rankings`;
    try {
        const response = await fetchWithRetry(baseUrl);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.rankings || []).map((r: any) => ({
            name: r.name,
            standings: r.ranks.map((entry: any) => ({
                team: { id: entry.team.id, name: formatTeamName(entry.team, sport), abbreviation: entry.team.abbreviation, logo: entry.team.logo },
                rank: entry.current,
                stats: { wins: entry.recordSummary?.split('-')[0] || 0, losses: entry.recordSummary?.split('-')[1] || 0, overallRecord: entry.recordSummary },
                note: entry.trend
            }))
        }));
    } catch { return []; }
};

const fetchNCAATeamRank = async (sport: Sport, teamId: string): Promise<number | undefined> => {
    if (!NCAA_RANKED_SPORTS.has(sport)) return undefined;

    const now = Date.now();
    const cached = NCAA_RANK_CACHE.get(sport);
    if (cached && (now - cached.fetchedAt) < NCAA_RANK_CACHE_TTL) {
        return cached.rankByTeamId.get(String(teamId));
    }

    try {
        const rankingGroups = await fetchRankings(sport);
        const preferredGroup =
            rankingGroups.find(g => /ap top 25/i.test(g.name)) ||
            rankingGroups.find(g => /top 25/i.test(g.name)) ||
            rankingGroups[0];

        const rankByTeamId = new Map<string, number>();
        (preferredGroup?.standings || []).forEach((entry) => {
            const id = String(entry.team?.id || '').trim();
            const rank = Number(entry.rank);
            if (!id || !Number.isFinite(rank) || rank <= 0) return;
            rankByTeamId.set(id, rank);
        });

        NCAA_RANK_CACHE.set(sport, { fetchedAt: now, rankByTeamId });
        return rankByTeamId.get(String(teamId));
    } catch {
        NCAA_RANK_CACHE.set(sport, { fetchedAt: now, rankByTeamId: new Map() });
        return undefined;
    }
};

const normalizeLabel = (label: string, catName: string, sport: Sport): string | null => {
    const l = normalizeStatToken(label);
    const cat = normalizeStatToken(catName);

    const BLOCKLIST = [
        'rank', 'conf', 'division', 'streak', 'home', 'away', 'neutral',
        'ot win', 'ot loss', 'shootout', 's/o', 'postponed', 'clinched'
    ];
    
    if (l === 'wins' || l === 'losses' || l === 'ties' || l === 'w' || l === 'l' || l === 't') return null;
    if (BLOCKLIST.some(term => l.includes(term))) return null;

    const isDefensiveCategory = cat.includes('defens') || cat.includes('opponent') || cat.includes('allowed') || cat.includes('against');
    const hasDefensiveHintInLabel =
        l.includes('opponent') ||
        l.includes('opp ') ||
        l.includes('allowed') ||
        l.includes('against') ||
        l.includes('defensive');
    const hasOffensiveHintInLabel = l.includes('offense') || l.includes('offensive');
    const shouldTreatAsDefensiveMetric =
        hasDefensiveHintInLabel ||
        (isDefensiveCategory && !hasOffensiveHintInLabel && !cat.includes('efficiency'));

    let canonical = canonicalizeStatLabel(sport, label, catName);

    if (canonical === 'Points' && shouldTreatAsDefensiveMetric) canonical = 'Opponent Points';
    if (canonical === 'Rebounds' && shouldTreatAsDefensiveMetric && !l.includes('def')) canonical = 'Opponent Rebounds';
    if (canonical === 'Field Goal %' && shouldTreatAsDefensiveMetric) canonical = 'Opponent Field Goal %';

    if (canonical === 'Passing Yards' && shouldTreatAsDefensiveMetric) canonical = 'Passing Yards Allowed';
    if (canonical === 'Rushing Yards' && shouldTreatAsDefensiveMetric) canonical = 'Rushing Yards Allowed';
    if (canonical === 'Total Yards' && shouldTreatAsDefensiveMetric) canonical = 'Total Yards Allowed';

    if (cat.includes('pass') && (l === 'yds' || l === 'yards')) canonical = shouldTreatAsDefensiveMetric ? 'Passing Yards Allowed' : 'Passing Yards';
    if (cat.includes('rush') && (l === 'yds' || l === 'yards')) canonical = shouldTreatAsDefensiveMetric ? 'Rushing Yards Allowed' : 'Rushing Yards';
    if (cat.includes('pass') && l === 'td') canonical = shouldTreatAsDefensiveMetric ? 'Passing TDs Allowed' : 'Passing TDs';
    if (cat.includes('rush') && l === 'td') canonical = shouldTreatAsDefensiveMetric ? 'Rushing TDs Allowed' : 'Rushing TDs';

    // NCAAF feed can misclassify rushing offense labels into allowed variants.
    // Force canonical offense wording for team cards and league alignment.
    if (sport === 'NCAAF' && canonical === 'Rushing Yards Allowed') {
        canonical = 'Rushing Yards';
    }

    return canonical || label;
};

const shouldDropDetailedLabel = (label: string): boolean => {
    const l = label.toLowerCase().trim();
    if (!l) return true;
    const META_ONLY = [
        'rank',
        'seed',
        'conference',
        'division',
        'streak',
        'clinch',
        'postponed'
    ];
    return META_ONLY.some(term => l.includes(term));
};

const cleanCategory = (catName: string, sport: Sport): string => {
    return inferCanonicalCategory(sport, '', catName);
};

const normalizeDetailedDisplayLabel = (rawLabel: string): string => {
    const raw = String(rawLabel || '').trim();
    if (!raw) return '';

    const lower = raw.toLowerCase();
    if (lower === 'leadchange' || lower === 'lead change') return 'Lead Changes';
    if (
        lower === 'fieldgoalsmade-fieldgoalsattempted' ||
        lower === 'field goals made-field goals attempted'
    ) return 'FG';
    if (
        lower === 'threepointfieldgoalsmade-threepointfieldgoalsattempted' ||
        lower === 'three point field goals made-three point field goals attempted'
    ) return '3PT';
    if (
        lower === 'freethrowsmade-freethrowsattempted' ||
        lower === 'free throws made-free throws attempted'
    ) return 'FT';

    let label = raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (/^[a-z0-9][a-z0-9 -]*$/.test(label) && label === label.toLowerCase()) {
        label = label
            .split(' ')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    return label;
};

const normalizeDetailedStatsForDisplay = (stats: TeamStatItem[], sport: Sport): TeamStatItem[] => {
    const deduped = new Map<string, TeamStatItem>();

    stats.forEach((item) => {
        if (!item?.label) return;
        const displayLabel = normalizeDetailedDisplayLabel(item.label);
        if (!displayLabel) return;

        const canonicalLabel = canonicalizeStatLabel(sport, displayLabel, item.category || '');
        const finalLabel = canonicalLabel || displayLabel;
        const finalCategory = inferCanonicalCategory(sport, finalLabel, item.category || 'General');
        const key = `${finalCategory}|${finalLabel.toLowerCase()}`;
        if (!deduped.has(key)) {
            deduped.set(key, { ...item, label: finalLabel, category: finalCategory });
        }
    });

    return Array.from(deduped.values());
};

// Helper to get GP from record string "W-L-T"
const getGPFromRecord = (recordSummary?: string): number => {
    if (!recordSummary) return 0;
    // Replace typical separators
    const cleanRec = recordSummary.replace(/[^\d-]/g, '');
    const parts = cleanRec.split('-').map(p => parseInt(p));
    // Sum W + L + T
    return parts.reduce((acc, val) => acc + (isNaN(val) ? 0 : val), 0);
};

const PLAYOFF_MERGE_SPORTS = new Set<Sport>([
    'NFL', 'NCAAF', 'NBA', 'NHL', 'MLB', 'WNBA', 'NCAAM', 'NCAAW'
]);

const getDefaultSeasonGames = (sport: Sport): number => {
    if (sport === 'NFL') return 17;
    if (sport === 'NCAAF') return 12;
    if (sport === 'NBA' || sport === 'NHL') return 82;
    if (sport === 'MLB') return 162;
    if (sport === 'WNBA') return 40;
    if (sport === 'NCAAM' || sport === 'NCAAW') return 31;
    return 1;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const annotateStatsProvenance = (
    sport: Sport,
    stats: TeamStatItem[],
    source: TeamStatItem['source'],
    seasonYear?: number,
): TeamStatItem[] => {
    if (!Array.isArray(stats) || stats.length === 0) return [];
    const gamesPlayed = getGamesPlayedFromStats(stats, 0);
    const expectedGames = Math.max(1, getDefaultSeasonGames(sport));
    const coverage = gamesPlayed > 0 ? clamp01(gamesPlayed / expectedGames) : undefined;

    return stats.map((item) => ({
        ...item,
        source,
        sampleSize: gamesPlayed > 0 ? Math.round(gamesPlayed) : item.sampleSize,
        coverage: coverage ?? item.coverage,
        seasonYear: seasonYear ?? item.seasonYear,
    }));
};

const parseStatNumber = (value: string): number => {
    const n = parseFloat(value.replace(/,/g, '').replace('%', ''));
    return isNaN(n) ? 0 : n;
};

const getPerGameThreshold = (label: string): number => {
    const l = label.toLowerCase();
    if (l.includes('yard')) return 600;
    if (l.includes('point') || l.includes('pts')) return 160;
    if (l.includes('attempt') || l.includes('fga')) return 120;
    if (l.includes('made') || l.includes('fgm')) return 60;
    if (l.includes('rebound')) return 70;
    if (l.includes('assist')) return 45;
    if (l.includes('first down')) return 80;
    if (l.includes('shot')) return 70;
    if (l.includes('steal') || l.includes('block') || l.includes('sack') || l.includes('interception') || l.includes('touchdown') || l.includes('goal') || l.includes('save') || l.includes('run') || l.includes('hit') || l.includes('error')) {
        return 20;
    }
    return 100000;
};

const isRateLikeLabel = (label: string): boolean => {
    return isRateLikeStatLabel(label);
};

const isSourceAverageLabel = (rawLabel: string): boolean => {
    const l = rawLabel.toLowerCase();
    return (
        l.includes('%') ||
        l.includes('pct') ||
        l.includes('avg') ||
        l.includes('rate') ||
        l.includes('ratio') ||
        l.includes('rating') ||
        l.includes('/g') ||
        l.includes(' per ') ||
        l.includes('ppg') ||
        l.includes('rpg') ||
        l.includes('apg') ||
        l.includes('spg') ||
        l.includes('bpg') ||
        l.includes('topg') ||
        l.includes('yds/g')
    );
};

const getGamesPlayedFromStats = (stats: TeamStatItem[], fallback = 0): number => {
    const gpStat = stats.find(s => {
        const label = s.label.toLowerCase();
        return label === 'games played' || label === 'games' || label === 'gp';
    });

    const gpVal = gpStat ? parseStatNumber(gpStat.value) : 0;
    if (gpVal > 0) return gpVal;

    const wins = stats.find(s => s.label.toLowerCase() === 'wins');
    const losses = stats.find(s => s.label.toLowerCase() === 'losses');
    const ties = stats.find(s => s.label.toLowerCase() === 'ties');
    const wlTotal = parseStatNumber(wins?.value || '0') + parseStatNumber(losses?.value || '0') + parseStatNumber(ties?.value || '0');
    if (wlTotal > 0) return wlTotal;

    return fallback;
};

const normalizeStatsToPerGame = (stats: TeamStatItem[], fallbackGp = 0): TeamStatItem[] => {
    if (stats.length === 0) return stats;

    const gp = getGamesPlayedFromStats(stats, fallbackGp);
    if (gp <= 1) return stats;

    return stats.map((item) => {
        const lower = item.label.toLowerCase();
        const raw = parseStatNumber(item.value);
        const isNumeric = Number.isFinite(raw);
        if (!isNumeric) return item;
        if (shouldSumAcrossSeasons(lower)) return item;
        if (isRateLikeLabel(lower)) return item;

        const threshold = getPerGameThreshold(lower);
        if (Math.abs(raw) <= threshold) return item;

        const perGame = raw / gp;
        const signed = lower.includes('differential');
        const value = signed && perGame > 0 ? `+${perGame.toFixed(1)}` : perGame.toFixed(1);
        return { ...item, value };
    });
};

const normalizeStatsToPerGameStrict = (stats: TeamStatItem[], fallbackGp = 0): TeamStatItem[] => {
    if (stats.length === 0) return stats;

    const gp = getGamesPlayedFromStats(stats, fallbackGp);
    if (gp <= 1) return stats;

    return stats.map((item) => {
        const lower = item.label.toLowerCase();
        const raw = parseStatNumber(item.value);
        if (!Number.isFinite(raw)) return item;
        if (shouldSumAcrossSeasons(lower)) return item;
        if (isRateLikeLabel(lower) || item.value.includes('%')) return item;

        const perGame = raw / gp;
        const signed = lower.includes('differential') || lower.includes('margin');
        const value = signed && perGame > 0 ? `+${perGame.toFixed(1)}` : perGame.toFixed(1);
        return { ...item, value };
    });
};

const dedupeStatsByCategoryLabel = (stats: TeamStatItem[]): TeamStatItem[] => {
    const deduped = new Map<string, TeamStatItem>();
    stats.forEach((item) => {
        const key = `${item.category || 'General'}|${item.label.toLowerCase()}`;
        if (!deduped.has(key)) deduped.set(key, item);
    });
    return Array.from(deduped.values());
};

const inferStatCategory = (stat: TeamStatItem): string => {
    if (stat.category && stat.category.trim()) return stat.category;
    const label = stat.label.toLowerCase();
    if (label.includes('opponent') || label.includes('allowed') || label.includes('against')) return 'Opponent';
    if (label.includes('differential') || label.includes('margin')) return 'Differential';
    if (label.includes('field goal') || label.includes('rebound') || label.includes('assist') || label.includes('turnover') || label.includes('yards') || label.includes('point')) return 'Team';
    return 'General';
};

const toCanonicalSeasonStats = (stats: TeamStatItem[], fallbackGp = 0, sport?: Sport): TeamStatItem[] => {
    const normalized = normalizeStatsToPerGame(stats, fallbackGp);
    const deduped = new Map<string, TeamStatItem>();

    normalized.forEach((stat) => {
        const rawCategory = (stat.category || 'General').trim() || 'General';
        const canonicalLabel = sport
            ? (normalizeLabel(stat.label, rawCategory, sport) || stat.label)
            : stat.label;

        const categoryHint = sport ? cleanCategory(rawCategory, sport) : rawCategory;
        const canonicalStat: TeamStatItem = { ...stat, label: canonicalLabel, category: categoryHint };
        let category = inferStatCategory(canonicalStat);
        const labelLower = canonicalLabel.toLowerCase();

        if (labelLower.includes('opponent') || labelLower.includes('allowed') || labelLower.includes('against')) {
            category = 'Opponent';
        } else if (labelLower.includes('differential') || labelLower.includes('margin')) {
            category = 'Differential';
        } else if (categoryHint && categoryHint !== 'General') {
            category = categoryHint;
        }

        const key = `${category}|${canonicalLabel.toLowerCase()}`;
        if (!deduped.has(key)) {
            deduped.set(key, { ...stat, label: canonicalLabel, category });
        }
    });

    return Array.from(deduped.values());
};

const hasCoreInternalStats = (sport: Sport, stats: TeamStatItem[]): boolean => {
    if (stats.length < 6) return false;
    const labels = new Set(stats.map(s => s.label.toLowerCase()));
    const has = (label: string) => labels.has(label.toLowerCase());

    if (['NBA', 'WNBA', 'NCAAM', 'NCAAW'].includes(sport)) {
        return has('points') && has('rebounds') && has('field goal %');
    }
    if (['NFL', 'NCAAF'].includes(sport)) {
        return has('points') && has('opponent points') && (has('total yards') || has('passing yards'));
    }
    if (sport === 'MLB') {
        return has('runs') || has('era');
    }
    if (sport === 'NHL') {
        return has('goals') && has('goals against');
    }
    return stats.length >= 8;
};

const shouldSumAcrossSeasons = (label: string): boolean => {
    const l = label.toLowerCase();
    return (
        l.includes('win') ||
        l.includes('loss') ||
        l.includes('tie') ||
        l === 'games' ||
        l === 'games played'
    );
};

const hasMeaningfulPostseasonStats = (post: TeamStatItem[], reg: TeamStatItem[]): boolean => {
    if (post.length === 0) return false;
    const postGames = (() => {
        const gp = post.find(s => s.label.toLowerCase() === 'games played' || s.label.toLowerCase() === 'games');
        return gp ? parseStatNumber(gp.value) : 0;
    })();
    if (postGames > 0) return true;

    const regMap = new Map(reg.map(s => [s.label.toLowerCase(), s.value]));
    return post.some(s => {
        const label = s.label.toLowerCase();
        const postVal = parseStatNumber(s.value);
        const regVal = parseStatNumber(regMap.get(label) || '0');
        return Math.abs(postVal - regVal) > 0.001 && postVal !== 0;
    });
};

type SeasonStatDetailLevel = 'canonical' | 'full';

const getMinDetailedCoverage = (sport: Sport): number => {
    if (['NFL', 'NCAAF', 'NBA', 'WNBA', 'NCAAM', 'NCAAW'].includes(sport)) return 14;
    if (['NHL', 'MLB'].includes(sport)) return 10;
    return 8;
};

const applyDerivedRanks = (sport: Sport, stats: TeamStatItem[]): TeamStatItem[] => {
    if (!Array.isArray(stats) || stats.length === 0) return [];
    return stats.map((item) => {
        if (!item || !item.label) return item;
        if (typeof item.rank === 'number' && item.rank > 0) return item;
        const derived = calculateDerivedRank(sport, item.label, String(item.value ?? ''));
        return derived > 0 ? { ...item, rank: derived } : item;
    });
};

const parseComparableStatValue = (
    value: string | number | undefined | null,
    label?: string,
): number | null => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/[a-zA-Z]/.test(raw) && !raw.toLowerCase().includes('e')) return null;

    const timeMatch = raw.match(/^\s*(\d+):(\d{2})(?::(\d{2}))?\s*$/);
    if (timeMatch) {
        if (timeMatch[3] !== undefined) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
            return (hours * 60) + minutes + (seconds / 60);
        }
        const minutes = parseInt(timeMatch[1], 10);
        const seconds = parseInt(timeMatch[2], 10);
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
        return minutes + (seconds / 60);
    }

    const pairedMatch = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*[-/]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (pairedMatch) {
        const made = parseFloat(pairedMatch[1]);
        const attempts = parseFloat(pairedMatch[2]);
        if (!Number.isFinite(made) || !Number.isFinite(attempts)) return null;
        if (attempts === 0) return 0;

        const labelLower = String(label || '').toLowerCase();
        const looksLikeRatePair =
            labelLower.includes('%') ||
            labelLower.includes('pct') ||
            labelLower.includes('percent') ||
            labelLower.includes('rate') ||
            labelLower.includes('ratio') ||
            labelLower.includes('completion') ||
            labelLower.includes('conversions') ||
            labelLower.includes('on target') ||
            labelLower.includes('field goal') ||
            labelLower.includes('free throw') ||
            labelLower.includes('three point') ||
            labelLower.includes('3-point') ||
            labelLower.includes('3pt') ||
            labelLower.includes('power play') ||
            labelLower.includes('penalty kill');

        if (!looksLikeRatePair) return null;
        return (made / attempts) * 100;
    }

    const n = parseFloat(raw.replace(/,/g, '').replace('%', '').replace('+', ''));
    if (!Number.isFinite(n)) return null;
    if (raw.includes('%') && Math.abs(n) <= 1) return n * 100;
    return n;
};

const isInverseRankLabel = (label: string): boolean => {
    const l = String(label || '').toLowerCase();
    if (!l) return false;
    if (l.includes('differential') || l.includes('margin')) return false;
    if (l.includes('turnover differential') || l.includes('turnover margin')) return false;
    if (l.includes('assist') && l.includes('turnover') && (l.includes('ratio') || l.includes('/'))) return false;
    if (l.includes('allowed') || l.includes('against') || l.includes('opponent')) return true;
    if (l.includes('turnover') || l.includes('interception')) return true;
    if (l.includes('foul') || l.includes('penalt') || l.includes('card')) return true;
    if (l.includes('giveaway') || l.includes('error') || l.includes('sack yards lost')) return true;
    if (l === 'era') return true;
    if (l.includes('loss')) return true;
    return false;
};

const buildLeagueRankMaps = (leagueStatsByTeam: Record<string, TeamStatItem[]>) => {
    const byFullKey = new Map<string, Map<string, number>>();
    const byLabelOnly = new Map<string, Map<string, number>>();
    const samplesByFullKey = new Map<string, { teamId: string; value: number; label: string }[]>();
    const samplesByLabelOnly = new Map<string, { teamId: string; value: number; label: string }[]>();

    Object.entries(leagueStatsByTeam).forEach(([teamId, stats]) => {
        if (!Array.isArray(stats)) return;
        stats.forEach((stat) => {
            if (!stat?.label) return;
            const parsed = parseComparableStatValue(stat.value, stat.label);
            if (parsed === null) return;
            const label = stat.label.trim();
            const category = (stat.category || 'General').trim();
            const fullKey = `${category.toLowerCase()}|${label.toLowerCase()}`;
            if (!samplesByFullKey.has(fullKey)) samplesByFullKey.set(fullKey, []);
            samplesByFullKey.get(fullKey)!.push({ teamId, value: parsed, label });

            const labelOnlyKey = label.toLowerCase();
            if (!samplesByLabelOnly.has(labelOnlyKey)) samplesByLabelOnly.set(labelOnlyKey, []);
            samplesByLabelOnly.get(labelOnlyKey)!.push({ teamId, value: parsed, label });
        });
    });

    const rankSamples = (samples: { teamId: string; value: number; label: string }[], inverse: boolean): Map<string, number> => {
        const sorted = [...samples].sort((a, b) => {
            if (inverse) return a.value - b.value;
            return b.value - a.value;
        });
        const ranks = new Map<string, number>();
        let prevVal: number | null = null;
        let prevRank = 0;
        sorted.forEach((entry, idx) => {
            const rank = (prevVal !== null && Math.abs(entry.value - prevVal) < 1e-9) ? prevRank : (idx + 1);
            prevVal = entry.value;
            prevRank = rank;
            if (!ranks.has(entry.teamId)) ranks.set(entry.teamId, rank);
        });
        return ranks;
    };

    samplesByFullKey.forEach((samples, fullKey) => {
        if (samples.length < 2) return;
        const inverse = isInverseRankLabel(samples[0].label);
        byFullKey.set(fullKey, rankSamples(samples, inverse));
    });

    samplesByLabelOnly.forEach((samples, labelOnlyKey) => {
        if (samples.length < 2) return;
        const inverse = isInverseRankLabel(samples[0].label);
        byLabelOnly.set(labelOnlyKey, rankSamples(samples, inverse));
    });

    return { byFullKey, byLabelOnly };
};

const applyInternalLeagueRanks = (
    sport: Sport,
    teamId: string,
    stats: TeamStatItem[],
): TeamStatItem[] => {
    if (!Array.isArray(stats) || stats.length === 0) return [];
    const rawLeagueStatsByTeam = getInternalTeamStatsBySport(sport);
    if (!rawLeagueStatsByTeam || Object.keys(rawLeagueStatsByTeam).length < 2) return stats;

    const leagueStatsByTeam: Record<string, TeamStatItem[]> = {};
    Object.entries(rawLeagueStatsByTeam).forEach(([id, teamStats]) => {
        const prepared = dedupeStatsByCategoryLabel(
            (Array.isArray(teamStats) ? teamStats : [])
                .filter((item) => item && item.label)
                .map((item) => {
                    const rawCategory = (item.category || '').trim();
                    const category = rawCategory || inferStatCategory(item);
                    return { ...item, category };
                }),
        );
        leagueStatsByTeam[id] = normalizeDetailedStatsForDisplay(prepared, sport);
    });

    const { byFullKey, byLabelOnly } = buildLeagueRankMaps(leagueStatsByTeam);
    return stats.map((item) => {
        if (!item?.label) return item;
        const fullKey = `${(item.category || 'General').toLowerCase()}|${item.label.toLowerCase()}`;
        const labelOnlyKey = item.label.toLowerCase();
        const rankFromFull = byFullKey.get(fullKey)?.get(teamId);
        const rankFromLabel = byLabelOnly.get(labelOnlyKey)?.get(teamId);
        const empiricalRank = rankFromFull ?? rankFromLabel;
        if (empiricalRank && empiricalRank > 0) {
            return { ...item, rank: empiricalRank };
        }
        return item;
    });
};

export const fetchTeamSeasonStats = async (
    sport: Sport,
    teamId: string,
    seasonType: number = 2,
    year?: number,
    ignoreCache: boolean = false,
    fallbackData?: any,
    detailLevel: SeasonStatDetailLevel = 'canonical',
): Promise<TeamStatItem[]> => {
    await ensureInternalSportLoaded(sport);

    const seedKey = `${sport}-${teamId}`;
    const endpoint = ESPN_ENDPOINTS[sport];
    const internalStats = (!year && seasonType === 2) ? getInternalTeamStats(sport, teamId) : [];
    const isFullDetail = detailLevel === 'full';
    const minDetailedCoverage = getMinDetailedCoverage(sport);

    // Use internal snapshot first when coverage is sufficient (and cache is allowed).
    if (!ignoreCache && internalStats.length > 0) {
        if (isFullDetail) {
            // Internal DB team stats are already stored as per-game season averages.
            const normalizedInternalDetailed = normalizeDetailedStatsForDisplay(
                dedupeStatsByCategoryLabel(internalStats),
                sport,
            );
            const hasSufficientInternalDetail =
                normalizedInternalDetailed.length >= minDetailedCoverage ||
                hasCoreInternalStats(sport, normalizedInternalDetailed);
            if (hasSufficientInternalDetail) {
                const ranked = applyInternalLeagueRanks(sport, teamId, applyDerivedRanks(sport, normalizedInternalDetailed));
                return annotateStatsProvenance(sport, ranked, 'internal_db', year);
            }
        } else if (hasCoreInternalStats(sport, internalStats)) {
            const ranked = applyInternalLeagueRanks(sport, teamId, applyDerivedRanks(sport, toCanonicalSeasonStats(internalStats, 0, sport)));
            return annotateStatsProvenance(sport, ranked, 'internal_db', year);
        }
    }
    
    if (!isFullDetail && !ignoreCache && !year && seasonType === 2) {
        try {
            const cached = await getTeamStats(sport, teamId);
            const hasData = cached && cached.stats && cached.stats.length > 0 && cached.stats.some(s => s.label === 'Points' || s.label === 'Wins');
            if (hasData) {
                const normalizedCached = toCanonicalSeasonStats(cached.stats, 0, sport);
                const hasSufficientCoverage = normalizedCached.length >= minDetailedCoverage || hasCoreInternalStats(sport, normalizedCached);
                if (hasSufficientCoverage) {
                    const ranked = applyInternalLeagueRanks(sport, teamId, applyDerivedRanks(sport, normalizedCached));
                    return annotateStatsProvenance(sport, ranked, 'cached', year);
                }
            }
        } catch (e) {}
    }

    let stats: TeamStatItem[] = [];
    let statsSource: TeamStatItem['source'] = 'espn_api';
    let derivedGP = 0;

    // 1. Fetch Summary for regular season GP fallback.
    if (seasonType === 2) {
        try {
            const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}`;
            const sumRes = await fetchWithRetry(summaryUrl, 1);
            if (sumRes.ok) {
                const sumData = await sumRes.json();
                const recordStr = sumData.team?.record?.items?.[0]?.summary; 
                derivedGP = getGPFromRecord(recordStr);
            }
        } catch (e) {
            console.warn("Could not derive GP from summary", e);
        }
    }
    
    try {
        const v3Url = `https://site.web.api.espn.com/apis/common/v3/sports/${endpoint}/teams/${teamId}/statistics`;
        const v3Params = new URLSearchParams({ 
            region: 'us', lang: 'en', contentorigin: 'espn', isqualified: 'false', 
            page: '1', limit: '50', seasontype: String(seasonType) 
        });
        if (year) v3Params.append('season', String(year));

        const v3Res = await fetchWithRetry(`${v3Url}?${v3Params.toString()}`, 1);
        if (v3Res.ok) {
            const v3Data = await v3Res.json();
            if (v3Data.categories) {
                
                // If we didn't find GP from record, try to find it in the stats response
                if (derivedGP === 0) {
                    for (const cat of v3Data.categories) {
                        if (cat.labels && cat.totals) {
                            const gpIdx = cat.labels.findIndex((l: string) => l.toLowerCase() === 'gp' || l.toLowerCase() === 'games' || l.toLowerCase() === 'games played');
                            if (gpIdx !== -1) {
                                derivedGP = parseFloat(normalizeStat(cat.totals[gpIdx]));
                                if (derivedGP > 0) break;
                            }
                        }
                    }
                }
                
                const finalGP = derivedGP || 1; // Default to 1 to prevent div by zero

                v3Data.categories.forEach((cat: any) => {
                    if (cat.totals && cat.labels && cat.totals.length === cat.labels.length) {
                        const rawCatName = cat.displayName || cat.name || 'General';
                        const uiCategory = isFullDetail ? rawCatName : cleanCategory(rawCatName, sport);
                        
                        cat.labels.forEach((label: string, idx: number) => {
                            const rawLabel = String(label || '').trim();
                            if (!rawLabel) return;

                            let finalLabel = normalizeLabel(rawLabel, rawCatName, sport);
                            if (!finalLabel) {
                                if (!isFullDetail || shouldDropDetailedLabel(rawLabel)) return;
                                finalLabel = rawLabel;
                            }

                            const valStr = normalizeStat(cat.totals[idx]);
                            let valNum = parseFloat(valStr.replace(/,/g, '').replace('%', ''));
                            if (isNaN(valNum)) valNum = 0;

                            const normalizedLabelLooksRate = isRateLikeLabel(finalLabel);
                            const sourceLabelLooksRate = isSourceAverageLabel(rawLabel);
                            const valueLooksPercent = valStr.includes('%') || finalLabel.includes('%');
                            const threshold = getPerGameThreshold(finalLabel);

                            const shouldAveragePerGame =
                                !normalizedLabelLooksRate &&
                                !sourceLabelLooksRate &&
                                !valueLooksPercent &&
                                finalGP > 1 &&
                                Math.abs(valNum) > threshold;
                            const normalizedValue = shouldAveragePerGame ? (valNum / finalGP) : valNum;
                            const rankVal = normalizedValue;

                            let displayValue = valStr;
                            if (Number.isFinite(normalizedValue)) {
                                if (valueLooksPercent || normalizedLabelLooksRate || sourceLabelLooksRate) {
                                    displayValue = valueLooksPercent ? `${normalizedValue.toFixed(1)}%` : normalizedValue.toFixed(1);
                                } else {
                                    // Team cards should display season stats as per-game averages for counting stats.
                                    displayValue = normalizedValue.toFixed(1);
                                }
                            }

                            const apiRank = calculateDerivedRank(sport, finalLabel, String(rankVal));

                            const exists = stats.some(s => {
                                const sameLabel = s.label.toLowerCase() === finalLabel!.toLowerCase();
                                if (!sameLabel) return false;
                                if (!isFullDetail) return true;
                                return (s.category || 'General').toLowerCase() === (uiCategory || 'General').toLowerCase();
                            });

                            if (!exists) {
                                stats.push({
                                    label: finalLabel,
                                    value: displayValue,
                                    rank: apiRank > 0 ? apiRank : undefined,
                                    category: uiCategory 
                                });
                            }
                        });
                    }
                });
            }
        }
    } catch (e) {
        if (SEEDED_STATS[seedKey] && stats.length === 0) {
            stats = SEEDED_STATS[seedKey];
            statsSource = 'fallback_standings';
        }
    }
    
    if (stats.length < 3) {
        let summaryStats: TeamStatItem[] = [];
        
        if (internalStats.length > 0) {
            summaryStats = internalStats;
            statsSource = 'internal_db';
        } else if (fallbackData) {
            summaryStats = convertStandingsToStats(fallbackData, sport);
            statsSource = 'fallback_standings';
        } else if (!year && seasonType === 2) {
            try {
                const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}`;
                const sumRes = await fetchWithRetry(summaryUrl, 1);
                if (sumRes.ok) {
                    const sumData = await sumRes.json();
                    const record = sumData.team?.record?.items?.[0];
                    if (record) {
                        const statsObj = record.stats?.reduce((acc: any, s: any) => {
                            acc[s.name] = s.value;
                            return acc;
                        }, {});
                        
                        if (statsObj) {
                            summaryStats = convertStandingsToStats({
                                ...statsObj,
                                wins: statsObj.wins,
                                losses: statsObj.losses
                            }, sport);
                            statsSource = 'fallback_standings';
                        }
                    }
                }
            } catch(e) {}
        }

        summaryStats.forEach(sumStat => {
            const exists = stats.some(s => {
                const sameLabel = s.label.toLowerCase() === sumStat.label.toLowerCase();
                if (!sameLabel) return false;
                if (!isFullDetail) return true;
                return (s.category || 'General').toLowerCase() === (sumStat.category || 'General').toLowerCase();
            });
            if (!exists) {
                stats.push(sumStat);
            }
        });
    }

    if (['NBA', 'WNBA', 'NCAAM', 'NCAAW', 'NFL', 'NCAAF'].includes(sport)) {
        const getVal = (lbl: string) => {
            const item = stats.find(s => s.label === lbl) || stats.find(s => s.label.toLowerCase() === lbl.toLowerCase());
            return item ? parseFloat(item.value.replace(/,/g, '').replace('%', '')) : null;
        };

        const pairs = [
            { main: 'Points', opp: 'Opponent Points', diff: 'Points Differential', isPct: false },
            { main: 'Rebounds', opp: 'Opponent Rebounds', diff: 'Rebounds Differential', isPct: false },
            { main: 'Field Goal %', opp: 'Opponent Field Goal %', diff: 'Field Goal % Differential', isPct: true }
        ];

        pairs.forEach(pair => {
            const m = getVal(pair.main);
            const o = getVal(pair.opp) ?? getVal('Points Allowed') ?? getVal('Scoring Defense');
            
            if (m !== null && o !== null) {
                const diff = m - o;
                const formatted = pair.isPct ? `${diff.toFixed(1)}%` : (diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1));
                const diffLabel = pair.diff;
                
                if (!stats.some(s => s.label === diffLabel)) {
                    const apiRank = calculateDerivedRank(sport, diffLabel, String(diff));
                    stats.push({
                        label: diffLabel,
                        value: formatted,
                        rank: apiRank > 0 ? apiRank : undefined,
                        category: 'Differential'
                    });
                }
            }
        });
    }

    if (!isFullDetail) {
        stats.forEach(item => {
            if (['Points', 'Rebounds', 'Field Goal %', 'Assists', 'Blocks', 'Steals', 'Turnovers', 'Total Yards', 'Passing Yards', 'Rushing Yards', 'First Downs', '3-Point %'].includes(item.label)) {
                item.category = 'Team';
            }
            else if (item.label.startsWith('Opponent') || item.label.includes('Allowed')) {
                item.category = 'Opponent';
            }
            else if (item.label.includes('Differential')) {
                item.category = 'Differential';
            }
            else if (item.label.includes('Punt') || item.label.includes('Kick')) {
                item.category = 'Special Teams';
            }
        });
    }

    const normalizedStats = isFullDetail
        ? (() => {
            // Full-detail values are already normalized during extraction (or come from internal DB).
            return normalizeDetailedStatsForDisplay(dedupeStatsByCategoryLabel(stats), sport);
        })()
        : toCanonicalSeasonStats(stats, derivedGP, sport);
    const rankedNormalizedStats = applyInternalLeagueRanks(sport, teamId, applyDerivedRanks(sport, normalizedStats));
    const rankedWithProvenance = annotateStatsProvenance(sport, rankedNormalizedStats, statsSource, year);

    if (!isFullDetail && !year && seasonType === 2 && rankedWithProvenance.length > 0) {
        saveStatsBatch([{
            id: seedKey,
            sport,
            teamId,
            stats: rankedWithProvenance,
            timestamp: Date.now()
        }]).catch(() => {});
    }

    return rankedWithProvenance;
};

export const fetchTeamCurrentSeasonStats = async (
    sport: Sport,
    teamId: string,
    fallbackData?: any,
    forceRefresh = false,
): Promise<TeamStatItem[]> => {
    const regular = toCanonicalSeasonStats(
        await fetchTeamSeasonStats(sport, teamId, 2, undefined, forceRefresh, fallbackData),
        0,
        sport,
    );
    if (!PLAYOFF_MERGE_SPORTS.has(sport)) return regular;

    try {
        const postseason = await fetchTeamSeasonStats(sport, teamId, 3, undefined, true);
        if (!hasMeaningfulPostseasonStats(postseason, regular)) return regular;
        const merged = toCanonicalSeasonStats(
            mergeSeasonStats(regular, postseason, getDefaultSeasonGames(sport)),
            0,
            sport,
        );

        if (merged.length > 0) {
            saveStatsBatch([{
                id: `${sport}-${teamId}`,
                sport,
                teamId,
                stats: merged,
                timestamp: Date.now(),
            }]).catch(() => {});
        }

        return merged;
    } catch {
        return regular;
    }
};

const mergeSeasonStatsByCategory = (reg: TeamStatItem[], post: TeamStatItem[], defaultRegGP: number = 1): TeamStatItem[] => {
    let gpReg = getGamesPlayedFromStats(reg, defaultRegGP);
    if (gpReg === 0 && reg.length > 0) gpReg = defaultRegGP;

    let gpPost = getGamesPlayedFromStats(post, 0);
    if (gpPost === 0 && post.length > 0) gpPost = 1;

    if (gpPost === 0) return reg;

    const keyOf = (item: TeamStatItem): string => `${(item.category || 'General').toLowerCase()}|${item.label.toLowerCase()}`;
    const regMap = new Map(reg.map(item => [keyOf(item), item]));
    const postMap = new Map(post.map(item => [keyOf(item), item]));
    const keys = new Set<string>([...regMap.keys(), ...postMap.keys()]);
    const totalGP = gpReg + gpPost;
    const merged: TeamStatItem[] = [];

    keys.forEach((key) => {
        const rItem = regMap.get(key);
        const pItem = postMap.get(key) || (rItem ? post.find(p => p.label.toLowerCase() === rItem.label.toLowerCase()) : undefined);
        const base = rItem || pItem;
        if (!base) return;

        if (!rItem || !pItem) {
            merged.push(base);
            return;
        }

        const labelLower = base.label.toLowerCase();
        const vReg = parseStatNumber(rItem.value);
        const vPost = parseStatNumber(pItem.value);
        if (!Number.isFinite(vReg) || !Number.isFinite(vPost)) {
            merged.push(base);
            return;
        }

        const mergedValue = shouldSumAcrossSeasons(labelLower)
            ? (vReg + vPost)
            : (totalGP > 0 ? ((vReg * gpReg) + (vPost * gpPost)) / totalGP : vReg);

        const isPct = base.value.includes('%') || labelLower.includes('pct') || labelLower.includes('%') || labelLower.includes('rate');
        const formatted = isPct
            ? `${mergedValue.toFixed(1)}%`
            : shouldSumAcrossSeasons(labelLower)
                ? Math.round(mergedValue).toString()
                : mergedValue.toFixed(1);

        merged.push({
            ...base,
            value: formatted,
            rank: rItem.rank,
        });
    });

    return merged.sort((a, b) => {
        const catCmp = (a.category || 'General').localeCompare(b.category || 'General');
        if (catCmp !== 0) return catCmp;
        return a.label.localeCompare(b.label);
    });
};

export const fetchTeamCurrentSeasonStatsDetailed = async (
    sport: Sport,
    teamId: string,
    fallbackData?: any,
    forceRefresh = false,
): Promise<TeamStatItem[]> => {
    const regular = await fetchTeamSeasonStats(
        sport,
        teamId,
        2,
        undefined,
        forceRefresh,
        fallbackData,
        'full',
    );
    if (!PLAYOFF_MERGE_SPORTS.has(sport)) return regular;

    try {
        const postseason = await fetchTeamSeasonStats(
            sport,
            teamId,
            3,
            undefined,
            true,
            undefined,
            'full',
        );

        if (!hasMeaningfulPostseasonStats(postseason, regular)) return regular;
        return mergeSeasonStatsByCategory(regular, postseason, getDefaultSeasonGames(sport));
    } catch {
        return regular;
    }
};

// ... (autoSyncLeagueStats, syncFullDatabase, getStoredLeagueStats, fetchTeamProfile, fetchTeamSchedule, fetchTeamStatistics exports remain unchanged)
export const autoSyncLeagueStats = async (
    sport: Sport, 
    teamIds: string[], 
    force = false, 
    onProgress?: (completed: number, total: number) => void,
    standingsMap?: Map<string, any>
): Promise<void> => {
    const lastSyncKey = `stats_sync_${sport}`;
    const lastSyncTime = parseInt(localStorage.getItem(lastSyncKey) || '0');
    
    if (!force && Date.now() - lastSyncTime < SYNC_COOLDOWN) return;

    if (ACTIVE_SYNCS.has(sport)) return;
    ACTIVE_SYNCS.add(sport);

    const CHUNK_SIZE = 4;
    const total = teamIds.length;
    let processed = 0;

    try {
        for (let i = 0; i < teamIds.length; i += CHUNK_SIZE) {
            const chunk = teamIds.slice(i, i + CHUNK_SIZE);
            const promises = chunk.map(id => {
                const fallback = standingsMap?.get(id);
                return fetchTeamCurrentSeasonStats(sport, id, fallback, force);
            });
            
            try {
                await Promise.all(promises);
            } catch (e) {
                console.warn("[AutoSync] Chunk failure", e);
            }
            
            processed += chunk.length;
            if (onProgress) onProgress(processed, total);

            // Respect API limits
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        localStorage.setItem(lastSyncKey, Date.now().toString());

    } finally {
        ACTIVE_SYNCS.delete(sport);
    }
};

export const syncFullDatabase = async (onProgress?: (percent: number) => void) => {
    const totalSports = SPORTS.length;
    
    for (let i = 0; i < totalSports; i++) {
        const sport = SPORTS[i];
        let teamIds: string[] = [];
        let standingsMap = new Map<string, any>();

        try {
            const groups = await fetchStandings(sport, 'DIVISION');
            groups.forEach(g => {
                g.standings.forEach(s => {
                    teamIds.push(s.team.id);
                    standingsMap.set(s.team.id, s.stats);
                });
            });
        } catch (e) {
            teamIds = LOCAL_TEAMS[sport]?.map(t => t.id) || [];
        }

        if (teamIds.length > 0) {
            await autoSyncLeagueStats(sport, teamIds, true, (completed, totalTeams) => {
                if (onProgress) {
                    const base = (i / totalSports) * 100;
                    const increment = (completed / totalTeams) * (100 / totalSports);
                    onProgress(Math.min(99, Math.round(base + increment)));
                }
            }, standingsMap);
        } else {
             if (onProgress) {
                 const percent = Math.round(((i + 1) / totalSports) * 100);
                 onProgress(percent);
             }
        }
    }
    
    if (onProgress) onProgress(100);
};

const toDetailedLeagueStats = (stats: TeamStatItem[], sport: Sport): TeamStatItem[] => {
    if (!Array.isArray(stats) || stats.length === 0) return [];
    const prepared = dedupeStatsByCategoryLabel(
        stats
            .filter((item) => item && item.label)
            .map((item) => {
                const rawCategory = (item.category || '').trim();
                const category = rawCategory || inferStatCategory(item);
                return { ...item, category };
            }),
    );
    return normalizeDetailedStatsForDisplay(prepared, sport);
};

const normalizeSeasonYearInput = (seasonYear?: number): number | undefined => {
    const parsed = Number(seasonYear);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.trunc(parsed);
};

const loadHistoricalSeasonTeamStats = async (
    sport: Sport,
    teamId: string,
    seasonYear: number,
): Promise<TeamStatItem[]> => {
    const regular = await fetchTeamSeasonStats(
        sport,
        teamId,
        2,
        seasonYear,
        true,
        undefined,
        'full',
    );

    if (!PLAYOFF_MERGE_SPORTS.has(sport)) return regular;

    try {
        const postseason = await fetchTeamSeasonStats(
            sport,
            teamId,
            3,
            seasonYear,
            true,
            undefined,
            'full',
        );
        if (!hasMeaningfulPostseasonStats(postseason, regular)) return regular;
        return mergeSeasonStatsByCategory(regular, postseason, getDefaultSeasonGames(sport));
    } catch {
        return regular;
    }
};

export const getStoredLeagueStats = async (
    sport: Sport, 
    teams: { id: string, name: string, logo?: string }[],
    fallbackMap?: Map<string, any>,
    seasonYear?: number,
): Promise<{ rows: LeagueStatRow[], lastUpdated: number | null, isHydrating: boolean }> => {
    await ensureInternalSportLoaded(sport);

    const targetSeasonYear = normalizeSeasonYearInput(seasonYear);
    const storedRecords = await getStatsBySport(sport);
    const storedMap = new Map<string, (typeof storedRecords)[number]>();
    storedRecords.forEach((record) => {
        const recordSeason = normalizeSeasonYearInput((record as any).seasonYear);
        const matchesTarget =
            targetSeasonYear === undefined
                ? recordSeason === undefined
                : recordSeason === targetSeasonYear;
        if (!matchesTarget) return;

        const existing = storedMap.get(record.teamId);
        if (!existing || (record.timestamp || 0) > (existing.timestamp || 0)) {
            storedMap.set(record.teamId, record);
        }
    });
    const internalGeneratedAtMs = Date.parse(getInternalDatabaseGeneratedAt()) || 0;

    if (targetSeasonYear === undefined) {
        teams.forEach((team) => {
            const internalStats = getInternalTeamStats(sport, team.id);
            if (internalStats.length > 0) {
                const detailedInternalStats = toDetailedLeagueStats(internalStats, sport);
                const existing = storedMap.get(team.id);
                const existingCount = existing?.stats?.length || 0;
                const shouldReplace =
                    !existing ||
                    detailedInternalStats.length > existingCount ||
                    ((internalGeneratedAtMs || 0) > (existing?.timestamp || 0));

                if (shouldReplace) {
                    storedMap.set(team.id, {
                        id: `${sport}-${team.id}`,
                        sport,
                        teamId: team.id,
                        stats: detailedInternalStats,
                        timestamp: internalGeneratedAtMs || Date.now(),
                    });
                }
            }
        });
    }

    const missingIds: string[] = [];
    const rows: LeagueStatRow[] = [];
    let newestTimestamp = 0;

    teams.forEach(team => {
        let record = storedMap.get(team.id);
        let needsHydration = false;
        const minDetailedStats = ['NFL', 'NCAAF', 'NBA', 'WNBA', 'NCAAM', 'NCAAW'].includes(sport) ? 8 : 5;

        if (record?.stats) {
            record.stats = toDetailedLeagueStats(record.stats, sport);
        }
        
        const hasRealStats = !!(
            record &&
            record.stats &&
            (
                record.stats.length >= minDetailedStats ||
                hasCoreInternalStats(sport, record.stats)
            )
        );
        
        if (!hasRealStats) {
            needsHydration = true;
            if (targetSeasonYear === undefined) {
                if (fallbackMap && fallbackMap.has(team.id)) {
                    const fallbackStats = toDetailedLeagueStats(convertStandingsToStats(fallbackMap.get(team.id), sport), sport);
                    
                    if (!record) {
                        record = { id: `${sport}-${team.id}`, sport, teamId: team.id, stats: fallbackStats, timestamp: Date.now() };
                    } else {
                        fallbackStats.forEach(fb => {
                            if (!record!.stats.some(s =>
                                s.label.toLowerCase() === fb.label.toLowerCase() &&
                                (s.category || 'General').toLowerCase() === (fb.category || 'General').toLowerCase()
                            )) {
                                record!.stats.push(fb);
                            }
                        });
                    }
                } else if (SEEDED_STATS[`${sport}-${team.id}`]) {
                    record = {
                        id: `${sport}-${team.id}`,
                        sport,
                        teamId: team.id,
                        stats: toDetailedLeagueStats(SEEDED_STATS[`${sport}-${team.id}`], sport),
                        timestamp: Date.now()
                    };
                }
            }
        }

        if (needsHydration && !missingIds.includes(team.id)) {
            missingIds.push(team.id);
        }

        if (record) {
            if (record.timestamp > newestTimestamp) newestTimestamp = record.timestamp;
            const statsMap: Record<string, string> = {};
            toDetailedLeagueStats(record.stats, sport).forEach(s => {
                statsMap[`${s.category || 'General'}|${s.label}`] = s.value;
            });
            rows.push({ team: { id: team.id, name: team.name, logo: team.logo }, stats: statsMap, ranks: {} });
        }
    });

    let isHydrating = false;
    if (missingIds.length > 0 && targetSeasonYear !== undefined) {
        isHydrating = true;
        const syncKey = `${sport}-${targetSeasonYear}`;
        if (!ACTIVE_HISTORICAL_SEASON_SYNCS.has(syncKey)) {
            ACTIVE_HISTORICAL_SEASON_SYNCS.add(syncKey);
            const idsToHydrate = [...missingIds];
            (async () => {
                const CHUNK_SIZE = 4;

                try {
                    for (let i = 0; i < idsToHydrate.length; i += CHUNK_SIZE) {
                        const chunk = idsToHydrate.slice(i, i + CHUNK_SIZE);
                        const chunkResults = await Promise.all(
                            chunk.map(async (teamId) => {
                                try {
                                    const stats = await loadHistoricalSeasonTeamStats(sport, teamId, targetSeasonYear);
                                    const detailed = toDetailedLeagueStats(stats, sport);
                                    if (detailed.length === 0) return null;
                                    return {
                                        id: `${sport}-${targetSeasonYear}-${teamId}`,
                                        sport,
                                        teamId,
                                        seasonYear: targetSeasonYear,
                                        stats: detailed,
                                        timestamp: Date.now(),
                                    };
                                } catch {
                                    return null;
                                }
                            }),
                        );

                        chunkResults.forEach((record) => {
                            if (!record) return;
                        });

                        if (chunkResults.some((record) => Boolean(record))) {
                            await saveStatsBatch(chunkResults.filter((record): record is NonNullable<typeof record> => Boolean(record)) as any);
                        }
                    }
                } finally {
                    ACTIVE_HISTORICAL_SEASON_SYNCS.delete(syncKey);
                }
            })();
        }
    } else if (missingIds.length > 0) {
        autoSyncLeagueStats(sport, missingIds);
    }

    return { rows, lastUpdated: newestTimestamp, isHydrating };
};

export const getStoredTeamSeasonStats = async (
    sport: Sport,
    team: { id: string; name: string; logo?: string },
    fallbackStats?: any,
): Promise<TeamStatItem[]> => {
    const fallbackMap = fallbackStats ? new Map<string, any>([[team.id, fallbackStats]]) : undefined;
    const { rows } = await getStoredLeagueStats(sport, [team], fallbackMap);
    const row = rows.find((r) => r.team.id === team.id);
    if (!row) return [];

    const output = Object.entries(row.stats || {}).map(([fullKey, value]) => {
        const separatorIndex = fullKey.indexOf('|');
        let category = separatorIndex >= 0 ? fullKey.slice(0, separatorIndex) : 'General';
        let label = separatorIndex >= 0 ? fullKey.slice(separatorIndex + 1) : fullKey;
        const rank = row.ranks?.[fullKey];

        if (sport === 'NCAAF' && label.toLowerCase() === 'rushing yards allowed') {
            label = 'Rushing Yards';
            category = 'Offense';
        }

        return {
            label,
            value,
            category: category || 'General',
            rank: typeof rank === 'number' && rank > 0 ? rank : undefined,
            source: 'internal_db' as const,
        };
    });

    const ranked = applyInternalLeagueRanks(sport, team.id, output);
    return ranked.sort((a, b) => {
        const categoryCompare = String(a.category || 'General').localeCompare(String(b.category || 'General'));
        if (categoryCompare !== 0) return categoryCompare;
        return a.label.localeCompare(b.label);
    });
};

export const fetchTeamProfile = async (sport: Sport, teamId: string): Promise<TeamProfile | null> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}`;
    const params = new URLSearchParams({ enable: 'roster,venue,record' });
    const isUSSport = ['NBA', 'NFL', 'NHL', 'MLB', 'WNBA'].includes(sport);

    try {
        const [response, standingsGroups, nationalRank] = await Promise.all([
            fetchWithRetry(`${baseUrl}?${params.toString()}`),
            fetchStandings(sport, 'DIVISION'),
            fetchNCAATeamRank(sport, teamId),
        ]);

        if (!response.ok) return null;
        const data = await response.json();
        const t = data.team;
        
        let conferenceRank: string | undefined;
        let conferenceName: string | undefined;
        let fallbackStats: any = undefined;

        if (standingsGroups.length > 0) {
            for (const group of standingsGroups) {
                const entry = group.standings.find(s => s.team.id === teamId);
                if (entry) {
                    conferenceName = group.name;
                    const n = entry.rank;
                    const s = ["th", "st", "nd", "rd"];
                    const v = n % 100;
                    const ord = n + (s[(v - 20) % 10] || s[v] || s[0]);
                    conferenceRank = ord;
                    fallbackStats = entry.stats; 
                    break;
                }
            }
        }

        const seasonStats = await fetchTeamCurrentSeasonStats(sport, teamId, fallbackStats);

        return {
            id: t.id, 
            location: normalizeLocation(t, sport), 
            name: t.displayName || formatTeamName(t, sport),
            rank: nationalRank,
            abbreviation: t.abbreviation, 
            displayName: t.displayName, 
            color: t.color ? `#${t.color}` : undefined, 
            alternateColor: t.alternateColor ? `#${t.alternateColor}` : undefined, 
            logo: t.logos?.[0]?.href, 
            standingSummary: t.standingSummary, 
            record: t.record?.items?.[0]?.summary,
            roster: (t.athletes || []).map((a: any) => ({ id: a.id, displayName: a.displayName, jersey: a.jersey, position: a.position?.abbreviation, headshot: a.headshot?.href, height: a.displayHeight, weight: a.displayWeight, age: a.age })),
            seasonStats: seasonStats, 
            conferenceRank,
            conferenceName
        };
    } catch { return null; }
};

export const fetchTeamSchedule = async (
    sport: Sport,
    teamId: string,
    options?: { scope?: 'recent' | 'all'; forceLiveRefresh?: boolean },
): Promise<Game[]> => {
    const scope = options?.scope || 'recent';
    const forceLiveRefresh = options?.forceLiveRefresh === true;
    await ensureInternalSportLoaded(sport);

    const shouldRefreshNearLiveWindow = (games: Game[]): boolean => {
        const nowMs = Date.now();
        const refreshWindowMs = 36 * 60 * 60 * 1000;
        return games.some((game) => {
            if (game.status === 'in_progress') return true;
            const gameMs = new Date(game.dateTime).getTime();
            if (!Number.isFinite(gameMs)) return false;
            return Math.abs(nowMs - gameMs) <= refreshWindowMs;
        });
    };

    const mergeGamesByIdPreferFresh = (baseGames: Game[], freshGames: Game[]): Game[] => {
        if (freshGames.length === 0) return baseGames;
        const merged = new Map<string, Game>();
        baseGames.forEach((game) => merged.set(game.id, game));
        freshGames.forEach((game) => {
            const existing = merged.get(game.id);
            if (!existing) {
                merged.set(game.id, game);
                return;
            }
            merged.set(game.id, {
                ...existing,
                ...game,
                context: game.context ?? existing.context,
                gameStatus: game.gameStatus ?? existing.gameStatus,
                leagueLogo: game.leagueLogo || existing.leagueLogo,
            });
        });
        return Array.from(merged.values()).sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
    };

    const fetchTeamScheduleFromApi = async (bypassCache = false): Promise<Game[]> => {
        const endpoint = ESPN_ENDPOINTS[sport];
        const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}/schedule`;
        const url = bypassCache ? `${baseUrl}?_ts=${Date.now()}` : baseUrl;
        const response = await fetchWithRetry(url);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.events || [])
            .map((e: any) => mapEventToGame(e, sport))
            .filter((game: Game) => !shouldHideUndeterminedPlayoffGame(game));
    };

    const internal = getInternalTeamSchedule(sport, teamId);
    if (internal.length > 0) {
        let filtered = internal.filter((game) => !shouldHideUndeterminedPlayoffGame(game));
        if (forceLiveRefresh && shouldRefreshNearLiveWindow(filtered)) {
            try {
                const fresh = await fetchTeamScheduleFromApi(true);
                if (fresh.length > 0) {
                    filtered = mergeGamesByIdPreferFresh(filtered, fresh);
                }
            } catch {
            }
        }
        return scope === 'all' ? filtered : scopeGamesToMostRecentSeason(filtered, sport);
    }

    try {
        const mapped = await fetchTeamScheduleFromApi(forceLiveRefresh);
        return scope === 'all' ? mapped : scopeGamesToMostRecentSeason(mapped, sport);
    } catch { return []; }
};

export const fetchTeamStatistics = async (sport: Sport, teamId: string): Promise<TeamStatistics | null> => {
    await ensureInternalSportLoaded(sport);
    const internalPlayerStats = getInternalTeamPlayerStats(sport, teamId);
    if (internalPlayerStats.length > 0) {
        return { categories: internalPlayerStats };
    }

    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${endpoint}/teams/${teamId}/statistics`;
    try {
        const response = await fetchWithRetry(baseUrl);
        if (!response.ok) throw new Error("V3 Failed");
        const data = await response.json();
        if (!data.categories) throw new Error("No Categories");
        const categories = data.categories.map((cat: any) => ({
            name: cat.name,
            displayName: cat.displayName,
            shortDisplayName: cat.shortDisplayName,
            labels: cat.labels,
            athletes: (cat.athletes || []).map((ath: any) => ({
                player: {
                    id: ath.athlete.id,
                    displayName: ath.athlete.displayName,
                    shortName: ath.athlete.shortName,
                    jersey: ath.athlete.jersey,
                    position: ath.athlete.position?.abbreviation,
                    headshot: ath.athlete.headshot?.href
                },
                stats: (ath.stats || []).map(normalizeStat)
            }))
        }));
        return { categories };
    } catch { return null; }
};

// Merge regular + postseason stat feeds into one current-season per-game set.
const mergeSeasonStats = (reg: TeamStatItem[], post: TeamStatItem[], defaultRegGP: number = 1): TeamStatItem[] => {
    const getVal = (items: TeamStatItem[], label: string) => {
        const item = items.find(i => i.label.toLowerCase() === label.toLowerCase());
        return item ? parseFloat(item.value.replace(/,/g, '').replace('%', '')) : 0;
    };

    // 1. Calculate Grand Total GP
    let gpReg = getVal(reg, 'games played') || getVal(reg, 'games') || defaultRegGP;
    if (gpReg === 0 && reg.length > 0) gpReg = defaultRegGP;

    let gpPost = getVal(post, 'games played') || getVal(post, 'games');
    if (gpPost === 0 && post.length > 0) gpPost = 1;

    const totalGP = gpReg + gpPost;

    if (gpPost === 0) return reg;

    const merged: TeamStatItem[] = [];

    reg.forEach(rItem => {
        const pItem = post.find(p => p.label === rItem.label);
        const labelLower = rItem.label.toLowerCase();

        const vReg = parseFloat(rItem.value.replace(/,/g, '').replace('%', ''));
        if (isNaN(vReg)) {
            merged.push(rItem);
            return;
        }

        let newVal = vReg;

        if (!pItem) {
            newVal = vReg;
        } else {
            const vPost = parseFloat(pItem.value.replace(/,/g, '').replace('%', ''));
            if (isNaN(vReg) || isNaN(vPost)) {
                merged.push(rItem);
                return;
            }

            if (labelLower.includes('rank')) {
                newVal = vReg;
            } else if (shouldSumAcrossSeasons(labelLower)) {
                newVal = vReg + vPost;
            } else {
                // Keep everything else as a GP-weighted season average.
                newVal = totalGP > 0 ? ((vReg * gpReg) + (vPost * gpPost)) / totalGP : vReg;
            }
        }

        const isPct = rItem.value.includes('%') || labelLower.includes('pct') || labelLower.includes('%');
        let valStr = '';

        if (isPct) {
            valStr = newVal.toFixed(1) + '%';
        } else if (shouldSumAcrossSeasons(labelLower)) {
            valStr = Math.round(newVal).toString();
        } else {
            valStr = newVal.toFixed(1);
        }

        merged.push({
            label: rItem.label,
            value: valStr,
            rank: rItem.rank
        });
    });

    return merged;
};
