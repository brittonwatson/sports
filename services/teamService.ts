
import { Sport, StandingsGroup, StandingsType, SOCCER_LEAGUES, TeamProfile, Game, TeamStatistics, TeamStatItem, LeagueStatRow, SPORTS } from "../types";
import { ESPN_ENDPOINTS } from "./constants";
import { fetchWithRetry, formatTeamName, extractNumber, normalizeStat, normalizeLocation } from "./utils";
import { mapEventToGame } from "./mappers";
import { calculateDerivedRank } from "./probabilities/rankings";
import { saveStatsBatch, getStatsBySport, getTeamStats } from "./statsDb";
import { SEEDED_STATS } from "../data/seededStats";
import { LOCAL_TEAMS } from "../data/leagues/index";

// Concurrency lock to prevent multiple syncs for the same sport at once
const ACTIVE_SYNCS = new Set<string>();
const SYNC_COOLDOWN = 60 * 60 * 1000; // 1 Hour

const convertStandingsToStats = (data: any, sport: Sport): TeamStatItem[] => {
    const items: TeamStatItem[] = [];
    const str = (v: any) => (v === undefined || v === null) ? '0' : String(v);

    if (data.wins !== undefined) items.push({ label: 'Wins', value: str(data.wins), category: 'General' });
    if (data.losses !== undefined) items.push({ label: 'Losses', value: str(data.losses), category: 'General' });
    
    if (data.pointsFor !== undefined) {
        items.push({ label: 'Points', value: str(data.pointsFor), category: 'Team' });
    } else if (data.points !== undefined && !['EPL','MLS','NHL','Bundesliga','La Liga','Serie A','Ligue 1','UCL'].includes(sport)) {
        items.push({ label: 'Points', value: str(data.points), category: 'Team' });
    }

    if (data.pointsAgainst !== undefined) items.push({ label: 'Opponent Points', value: str(data.pointsAgainst), category: 'Opponent' });
    
    if (data.pointDifferential !== undefined) {
        items.push({ label: 'Points Differential', value: str(data.pointDifferential), category: 'Differential' });
    } else if (data.pointsFor !== undefined && data.pointsAgainst !== undefined) {
        const diff = parseFloat(data.pointsFor) - parseFloat(data.pointsAgainst);
        items.push({ label: 'Points Differential', value: diff > 0 ? `+${diff}` : String(diff), category: 'Differential' });
    }

    return items;
};

export const fetchStandings = async (sport: Sport, type: StandingsType): Promise<StandingsGroup[]> => {
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
                    standings: g.standings.entries.map((e: any) => ({
                        team: { id: e.team.id, name: formatTeamName(e.team, sport), abbreviation: e.team.abbreviation, logo: e.team.logos?.[0]?.href },
                        stats: (e.stats || []).reduce((acc: any, curr: any) => {
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
                            
                            return acc;
                        }, {}),
                        rank: extractNumber(e.stats?.find((s: any) => s.name === 'playoffSeed')?.value) || extractNumber(e.stats?.find((s: any) => s.name === 'rank')?.value) || 0,
                        clincher: e.stats?.find((s: any) => s.name === 'clincher')?.displayValue,
                        note: e.note?.description
                    }))
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

const normalizeLabel = (label: string, catName: string, sport: Sport): string | null => {
    const l = label.toLowerCase();
    const cat = catName.toLowerCase();

    const BLOCKLIST = [
        'rank', 'conf', 'division', 'streak', 'home', 'away', 'neutral',
        'ot win', 'ot loss', 'shootout', 's/o', 'postponed', 'clinched',
        'games started', 'minutes', 'avg rating', 'rating', 'prate', 'games played'
    ];
    
    if (l === 'wins' || l === 'losses' || l === 'ties' || l === 'w' || l === 'l' || l === 't') return null;
    if (BLOCKLIST.some(term => l.includes(term))) return null;
    if (l === 'gp' || l === 'gs' || l === 'min') return null; 

    const isDefensiveCategory = cat.includes('defens') || cat.includes('opponent') || cat.includes('allowed');

    if (['NFL', 'NCAAF'].includes(sport)) {
        if (l === '1st downs' || l === 'first downs') return 'First Downs';
        if (l === 'turnover margin' || l === 'turnover diff') return 'Turnover Differential';
        if (cat.includes('kick') || cat.includes('general') || cat.includes('special')) {
             if (l === 'fg%' || (l.includes('field goal') && l.includes('%'))) return 'Field Goal %'; 
             if (l.includes('avg') && l.includes('return') && l.includes('kick')) return 'Kick Return Average';
        }
        if (cat.includes('punt') || cat.includes('general') || cat.includes('special')) {
             if (l.includes('avg') && !l.includes('return')) return 'Punting Average';
             if (l.includes('avg') && l.includes('return')) return 'Punt Return Average';
        }
        if (cat.includes('pass')) {
            if (l === 'yds' || l === 'yards') return isDefensiveCategory ? 'Passing Yards Allowed' : 'Passing Yards';
            if (l === 'td') return isDefensiveCategory ? 'Passing TDs Allowed' : 'Passing TDs';
        }
        if (cat.includes('rush')) {
            if (l === 'yds' || l === 'yards') return isDefensiveCategory ? 'Rushing Yards Allowed' : 'Rushing Yards';
            if (l === 'td') return isDefensiveCategory ? 'Rushing TDs Allowed' : 'Rushing TDs';
        }
        if (cat.includes('defens')) {
            if (l === 'sacks') return 'Sacks';
            if (l === 'int' || l === 'interceptions') return 'Interceptions';
        }
        if (l === 'total yards' || l === 'yds/g') return isDefensiveCategory ? 'Total Yards Allowed' : 'Total Yards';
    }

    if (['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(sport)) {
        if (l === 'fgm') return 'Field Goals Made';
        if (l === 'fga') return 'Field Goals Attempted';
        if (l === '3pm') return '3-Pointers Made';
        if (l === '3pa') return '3-Pointers Attempted';
        if (l === 'ftm') return 'Free Throws Made';
        if (l === 'fta') return 'Free Throws Attempted';
        if (l === 'oreb' || l === 'off reb') return 'Offensive Rebounds';
        if (l === 'dreb' || l === 'def reb') return 'Defensive Rebounds';
        if (l === '3p%' || l === '3-point field goal %' || l === 'three point %') return '3-Point %';
    }

    if (l === 'pts' || l === 'ppg' || l === 'points') {
        if (isDefensiveCategory) return 'Opponent Points';
        return 'Points';
    }
    
    if (l === 'reb' || l === 'rpg' || l === 'rebounds' || l === 'total rebounds') {
        if (isDefensiveCategory && !l.includes('def')) return 'Opponent Rebounds';
        return 'Rebounds';
    }

    if (l === 'ast' || l === 'apg') return 'Assists';
    if (l === 'stl' || l === 'spg') return 'Steals';
    if (l === 'blk' || l === 'bpg') return 'Blocks';
    if (l === 'to' || l === 'topg' || l === 'turnover' || l === 'turnovers') return 'Turnovers';
    
    if (l === 'fg%' || l === 'field goal %' || l === 'field goal percentage' || l === 'fg percentage') {
        if (isDefensiveCategory) return 'Opponent Field Goal %';
        return 'Field Goal %';
    }
    
    if (l === 'opp ppg' || l === 'points allowed' || l === 'opponent points' || l === 'pa') return 'Opponent Points';
    if (l === 'opp reb' || l === 'opponent rebounds' || l === 'rebounds allowed' || l === 'opp rpg') return 'Opponent Rebounds';
    if (l === 'opp fg%' || l === 'opponent field goal %' || l === 'defensive field goal %' || l === 'opp field goal %') return 'Opponent Field Goal %';

    if (l === 'points' || l === 'points for' || l === 'pf' || l === 'pts' || l.includes('gf/gp') || l === 'ppg') return 'Points';
    if (l.includes('ga/gp')) return 'Opponent Points';
    
    return label;
};

const cleanCategory = (catName: string, sport: Sport): string => {
    const c = catName.toLowerCase();
    
    if (['NBA', 'NCAAM', 'NCAAW', 'WNBA'].includes(sport)) {
        if (c.includes('shoot') || c.includes('scoring') || c.includes('field goal')) return 'Shooting';
        if (c.includes('rebound')) return 'Rebounding';
        if (c.includes('defens') || c.includes('opponent')) return 'Defense';
        if (c.includes('assist') || c.includes('turnover')) return 'Ball Control';
        if (c.includes('general') || c.includes('miscellaneous')) return 'General';
    }
    
    if (['NFL', 'NCAAF'].includes(sport)) {
        if (c.includes('kick') || c.includes('punt') || c.includes('special') || c.includes('return')) return 'Special Teams';
        if (c.includes('rush')) return 'Rushing';
        if (c.includes('pass')) return 'Passing';
        if (c.includes('receiv')) return 'Receiving';
        if (c.includes('defens')) return 'Defense';
        if (c.includes('offens')) return 'Offense';
    }

    if (c.includes('offens')) return 'Offense';
    if (c.includes('defens')) return 'Defense';
    return 'General';
};

// Generic threshold Helper to determine if a value looks like a total based on magnitude
const getStatThreshold = (label: string): number => {
    const l = label.toLowerCase();
    
    // Distances
    if (l.includes('yard')) return 600; 
    
    // Scoring
    if (l.includes('point') || l.includes('pts') || l.includes('ppg')) return 160; 
    
    // Attempts vs Makes
    if (l.includes('attempt') || l.includes('fga')) return 120;
    if (l.includes('made') || l.includes('fgm')) return 60;
    
    // Rebounds/Assists
    if (l.includes('rebound')) return 70;
    if (l.includes('assist')) return 45;
    
    // Low volume counts
    if (l.includes('steal') || l.includes('block') || l.includes('sack') || l.includes('interception') || l.includes('touchdown') || l.includes('goal') || l.includes('save') || l.includes('run') || l.includes('hit') || l.includes('error')) {
        return 20; // Lowered from 25 to catch early season totals
    }
    
    // Minutes
    if (l.includes('min')) return 70; 
    
    return 100000; // Default high to avoid dividing undefined things
};

const isTotalValue = (val: number, label: string): boolean => {
    const l = label.toLowerCase();
    // Never divide percentages, ratings, or explicit averages
    if (l.includes('%') || l.includes('pct') || l.includes('rate') || l.includes('avg') || l.includes('rating') || l.includes('ratio')) return false;
    return val > getStatThreshold(label);
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

export const fetchTeamSeasonStats = async (sport: Sport, teamId: string, seasonType: number = 2, year?: number, ignoreCache: boolean = false, fallbackData?: any): Promise<TeamStatItem[]> => {
    const seedKey = `${sport}-${teamId}`;
    const endpoint = ESPN_ENDPOINTS[sport];
    
    if (!ignoreCache && !year && seasonType === 2) {
        try {
            const cached = await getTeamStats(sport, teamId);
            const hasData = cached && cached.stats && cached.stats.length > 0 && cached.stats.some(s => s.label === 'Points' || s.label === 'Wins');
            if (hasData) {
                return cached.stats;
            }
        } catch (e) {}
    }

    let stats: TeamStatItem[] = [];
    let derivedGP = 0;

    // 1. Fetch Summary INDEPENDENTLY to get specific GP
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
                        const uiCategory = cleanCategory(rawCatName, sport);
                        
                        cat.labels.forEach((label: string, idx: number) => {
                            let finalLabel = normalizeLabel(label, rawCatName, sport);
                            if (!finalLabel) return; 

                            const valStr = normalizeStat(cat.totals[idx]);
                            let valNum = parseFloat(valStr.replace(/,/g, '').replace('%', ''));
                            if (isNaN(valNum)) valNum = 0;

                            let rankVal = valNum;
                            
                            // Robust check for Total vs Avg using thresholds and confirmed GP
                            // If it looks like a total AND we have a valid GP > 1, divide it.
                            if (isTotalValue(valNum, finalLabel) && finalGP > 1) {
                                valNum = valNum / finalGP;
                                rankVal = valNum;
                            }

                            // Format display value
                            let displayValue = valStr;
                            const labelLower = finalLabel.toLowerCase();
                            
                            // Re-format if we converted to average OR if it was already an avg
                            if (isTotalValue(parseFloat(valStr.replace(/,/g, '')), finalLabel) || labelLower.includes('opponent') || labelLower.includes('avg')) {
                                displayValue = valNum.toFixed(1);
                            }

                            const apiRank = calculateDerivedRank(sport, finalLabel, String(rankVal));

                            if (!stats.some(s => s.label.toLowerCase() === finalLabel!.toLowerCase())) {
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
        if (SEEDED_STATS[seedKey] && stats.length === 0) stats = SEEDED_STATS[seedKey];
    }
    
    if (stats.length < 3) {
        let summaryStats: TeamStatItem[] = [];
        
        if (fallbackData) {
            summaryStats = convertStandingsToStats(fallbackData, sport);
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
                        }
                    }
                }
            } catch(e) {}
        }

        summaryStats.forEach(sumStat => {
            if (!stats.some(s => s.label === sumStat.label)) {
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
    
    if (!year && seasonType === 2 && stats.length > 0) {
        saveStatsBatch([{
            id: seedKey,
            sport,
            teamId,
            stats,
            timestamp: Date.now()
        }]).catch(() => {});
    }

    return stats;
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
                return fetchTeamSeasonStats(sport, id, 2, undefined, force, fallback);
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

export const getStoredLeagueStats = async (
    sport: Sport, 
    teams: { id: string, name: string, logo?: string }[],
    fallbackMap?: Map<string, any>
): Promise<{ rows: LeagueStatRow[], lastUpdated: number | null }> => {
    let storedRecords = await getStatsBySport(sport);
    const storedMap = new Map(storedRecords.map(r => [r.teamId, r]));
    const missingIds: string[] = [];
    const rows: LeagueStatRow[] = [];
    let newestTimestamp = 0;

    teams.forEach(team => {
        let record = storedMap.get(team.id);
        
        const hasRealStats = record && record.stats && record.stats.length > 2 && record.stats.some(s => s.label === 'Points');
        
        if (!hasRealStats) {
            if (fallbackMap && fallbackMap.has(team.id)) {
                const fallbackStats = convertStandingsToStats(fallbackMap.get(team.id), sport);
                
                if (!record) {
                    record = { id: `${sport}-${team.id}`, sport, teamId: team.id, stats: fallbackStats, timestamp: Date.now() };
                    missingIds.push(team.id);
                } else {
                    fallbackStats.forEach(fb => {
                        if (!record!.stats.some(s => s.label === fb.label)) {
                            record!.stats.push(fb);
                        }
                    });
                }
            } else if (SEEDED_STATS[`${sport}-${team.id}`]) {
                record = { id: `${sport}-${team.id}`, sport, teamId: team.id, stats: SEEDED_STATS[`${sport}-${team.id}`], timestamp: Date.now() };
            }
        }

        if (record) {
            if (record.timestamp > newestTimestamp) newestTimestamp = record.timestamp;
            const statsMap: Record<string, string> = {};
            record.stats.forEach(s => {
                statsMap[`${s.category || 'General'}|${s.label}`] = s.value; 
                statsMap[`${s.label}`] = s.value; 
                statsMap[`General|${s.label}`] = s.value; 
            });
            rows.push({ team: { id: team.id, name: team.name, logo: team.logo }, stats: statsMap, ranks: {} });
        }
    });

    if (missingIds.length > 0) {
        autoSyncLeagueStats(sport, missingIds);
    }

    return { rows, lastUpdated: newestTimestamp };
};

export const fetchTeamProfile = async (sport: Sport, teamId: string): Promise<TeamProfile | null> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}`;
    const params = new URLSearchParams({ enable: 'roster,venue,record' });
    const isUSSport = ['NBA', 'NFL', 'NHL', 'MLB', 'WNBA'].includes(sport);

    try {
        const [response, standingsGroups] = await Promise.all([
            fetchWithRetry(`${baseUrl}?${params.toString()}`),
            fetchStandings(sport, 'DIVISION') 
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

        const seasonStats = await fetchTeamSeasonStats(sport, teamId, 2, undefined, false, fallbackStats);

        return {
            id: t.id, 
            location: normalizeLocation(t, sport), 
            name: t.displayName || formatTeamName(t, sport),
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

export const fetchTeamSchedule = async (sport: Sport, teamId: string): Promise<Game[]> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}/schedule`;
    try {
        const response = await fetchWithRetry(baseUrl);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.events || []).map((e: any) => mapEventToGame(e, sport));
    } catch { return []; }
};

export const fetchTeamStatistics = async (sport: Sport, teamId: string): Promise<TeamStatistics | null> => {
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

const groupRegex = (obj: any) => {
    return new RegExp(''); 
};

// Robust Merger: Always produces Average per Game for Volume Stats
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
    
    // If no postseason data, just return regular season
    if (gpPost === 0) return reg;

    const merged: TeamStatItem[] = [];
    const processedLabels = new Set<string>();

    // 2. Define Stats to Normalize as Averages
    const AVG_KEYS = [
        'points', 'points against', 'points for', 'opp points', 'opponent points',
        'yards', 'passing yards', 'rushing yards', 'receiving yards', 'total yards',
        'rebounds', 'assists', 'steals', 'blocks', 'turnovers',
        'field goals made', 'field goals attempted',
        '3-pointers made', '3-pointers attempted',
        'free throws made', 'free throws attempted',
        'sacks', 'interceptions',
        'goals', 'goals for', 'goals against', 'saves', 'shots',
        'passing avg', 'rushing avg'
    ];
    const AVG_LABELS = new Set(AVG_KEYS);

    reg.forEach(rItem => {
        processedLabels.add(rItem.label);
        const pItem = post.find(p => p.label === rItem.label);
        const labelLower = rItem.label.toLowerCase();
        
        let newVal = 0;
        const vReg = parseFloat(rItem.value.replace(/,/g, '').replace('%', ''));
        
        if (!pItem) {
            // Only have regular season data
            // If it's a volume stat that looks like a total, convert to average for consistency
            if (AVG_LABELS.has(labelLower) && isTotalValue(vReg, labelLower)) { 
                 newVal = vReg / gpReg;
            } else {
                 newVal = vReg;
            }
        } else {
            const vPost = parseFloat(pItem.value.replace(/,/g, '').replace('%', ''));
            
            if (isNaN(vReg) || isNaN(vPost)) {
                merged.push(rItem);
                return;
            }

            const isPct = rItem.value.includes('%') || labelLower.includes('pct') || labelLower.includes('%');
            const isExplicitAvg = labelLower.includes('avg') || labelLower.includes('per') || labelLower.includes('rating');
            
            // Logic A: Volume Stats -> Always convert to Average
            if (AVG_LABELS.has(labelLower)) {
                let regTotal = vReg;
                let postTotal = vPost;

                // Detect if source is Average or Total using generic thresholds
                // We assume if it's NOT a total value (based on our function), it IS an average.
                const isRegAvg = !isTotalValue(vReg, labelLower);
                const isPostAvg = !isTotalValue(vPost, labelLower);

                if (isRegAvg) regTotal = vReg * gpReg;
                if (isPostAvg) postTotal = vPost * gpPost;

                const grandTotal = regTotal + postTotal;
                newVal = totalGP > 0 ? grandTotal / totalGP : 0;

            } else if (isExplicitAvg || isPct) {
                // Logic B: Already Averages/Rates -> Weighted Average
                newVal = ((vReg * gpReg) + (vPost * gpPost)) / totalGP;
            } else {
                // Logic C: Count Stats (e.g. Wins, Losses) -> Sum
                // Unless it's explicitly 'Rank', then keep Reg.
                if (labelLower.includes('rank')) newVal = vReg;
                else newVal = vReg + vPost;
            }
        }

        const isPct = rItem.value.includes('%') || labelLower.includes('pct') || labelLower.includes('%');
        let valStr = '';
        
        if (isPct) {
            valStr = newVal.toFixed(1) + '%';
        } else {
            // Volume Stats converted to average should show decimals
            if (AVG_LABELS.has(labelLower)) {
                valStr = newVal.toFixed(1);
            } else {
                valStr = rItem.value.includes('.') ? newVal.toFixed(1) : Math.round(newVal).toString();
            }
        }

        merged.push({
            label: rItem.label,
            value: valStr,
            rank: rItem.rank
        });
    });

    return merged;
};
