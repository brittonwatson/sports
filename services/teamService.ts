
import { Sport, StandingsGroup, StandingsType, SOCCER_LEAGUES, TeamProfile, Game, TeamStatistics, TeamStatItem } from "../types";
import { ESPN_ENDPOINTS } from "./constants";
import { fetchWithRetry, formatTeamName, extractNumber, normalizeStat, normalizeLocation } from "./utils";
import { mapEventToGame } from "./mappers";

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

export const fetchTeamProfile = async (sport: Sport, teamId: string): Promise<TeamProfile | null> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}`;
    const params = new URLSearchParams({ enable: 'roster,venue,statistics,record' });
    
    const isUSSport = ['NBA', 'NFL', 'NHL', 'MLB', 'WNBA'].includes(sport);

    try {
        const [response, standingsGroups] = await Promise.all([
            fetchWithRetry(`${baseUrl}?${params.toString()}`),
            isUSSport ? fetchStandings(sport, 'PLAYOFF') : Promise.resolve([])
        ]);

        if (!response.ok) return null;
        const data = await response.json();
        const t = data.team;
        
        let seasonStats: TeamStatItem[] = [];
        
        if (t.statistics?.stats) {
             seasonStats = t.statistics.stats.map((s: any) => ({
                 label: s.displayName || s.name,
                 value: normalizeStat(s),
                 rank: extractNumber(s.rank)
             }));
        } else if (t.record?.items) {
             const overallRecord = t.record.items.find((i: any) => i.type === 'total' || i.description === 'Overall');
             if (overallRecord && overallRecord.stats) {
                 seasonStats = overallRecord.stats.map((s: any) => ({
                     label: s.displayName || s.name,
                     value: normalizeStat(s),
                     rank: extractNumber(s.rank)
                 }));
             }
        }

        let conferenceRank: string | undefined;
        let conferenceName: string | undefined;

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
                    break;
                }
            }
        }

        return {
            id: t.id, 
            location: normalizeLocation(t, sport), 
            name: formatTeamName(t, sport), 
            abbreviation: t.abbreviation, 
            displayName: t.displayName, 
            color: t.color ? `#${t.color}` : undefined, 
            alternateColor: t.alternateColor ? `#${t.alternateColor}` : undefined, 
            logo: t.logos?.[0]?.href, 
            standingSummary: t.standingSummary, 
            record: t.record?.items?.[0]?.summary,
            roster: (t.athletes || []).map((a: any) => ({ id: a.id, displayName: a.displayName, jersey: a.jersey, position: a.position?.abbreviation, headshot: a.headshot?.href, height: a.displayHeight, weight: a.displayWeight, age: a.age })),
            seasonStats,
            conferenceRank,
            conferenceName
        };
    } catch { return null; }
};

export const fetchTeamSeasonStats = async (sport: Sport, teamId: string, seasonType: number = 2, year?: number): Promise<TeamStatItem[]> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    
    // 1. Attempt V2 API first (Includes Rankings and pre-calculated Averages)
    const v2Url = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams/${teamId}`;
    const v2Params = new URLSearchParams({ 
        enable: 'record,statistics', 
        seasontype: String(seasonType) 
    });
    if (year) v2Params.append('season', String(year));
    
    let stats: TeamStatItem[] = [];

    // Helper to standardize common labels for merging consistency
    const normalizeLabel = (label: string): string => {
        const l = label.toLowerCase();
        if (l === 'points allowed' || l === 'opponent points' || l === 'pa') return 'Points Against';
        if (l === 'points' || l === 'points for' || l === 'pf' || l === 'pts') return 'Points';
        if (l === 'games played' || l === 'games' || l === 'gp' || l === 'g') return 'Games Played';
        return label;
    };

    try {
        const v2Res = await fetchWithRetry(`${v2Url}?${v2Params.toString()}`);
        if (v2Res.ok) {
            const data = await v2Res.json();
            const t = data.team;
            
            // Granular stats
            if (t.statistics?.stats) {
                 t.statistics.stats.forEach((s: any) => {
                     const label = normalizeLabel(s.displayName || s.name);
                     stats.push({
                         label,
                         value: normalizeStat(s),
                         rank: extractNumber(s.rank)
                     });
                 });
            } 
            
            // Record summary stats
            if (t.record?.items) {
                 const overallRecord = t.record.items.find((i: any) => i.type === 'total' || i.description === 'Overall');
                 if (overallRecord && overallRecord.stats) {
                     overallRecord.stats.forEach((s: any) => {
                         const label = normalizeLabel(s.displayName || s.name);
                         // Prioritize statistics object if it exists, otherwise add from record
                         if (!stats.some(existing => existing.label === label)) {
                             stats.push({
                                 label,
                                 value: normalizeStat(s),
                                 rank: extractNumber(s.rank)
                             });
                         }
                     });
                 }
            }
        }
    } catch (e) {
        console.warn("V2 fetch failed", e);
    }

    // 2. If V2 returned insufficient data (common for NFL Reg Season via V2 during playoffs), try V3 Statistics API
    // V3 provides raw totals which we can use
    if (stats.length < 5) {
        try {
            const v3Url = `https://site.web.api.espn.com/apis/common/v3/sports/${endpoint}/teams/${teamId}/statistics`;
            const v3Params = new URLSearchParams({ 
                region: 'us', lang: 'en', contentorigin: 'espn', isqualified: 'false', 
                page: '1', limit: '50', seasontype: String(seasonType) 
            });
            if (year) v3Params.append('season', String(year));

            const v3Res = await fetchWithRetry(`${v3Url}?${v3Params.toString()}`);
            if (v3Res.ok) {
                const v3Data = await v3Res.json();
                if (v3Data.categories) {
                    v3Data.categories.forEach((cat: any) => {
                        if (cat.totals && cat.labels && cat.totals.length === cat.labels.length) {
                            const catName = (cat.name || '').toLowerCase();
                            
                            cat.labels.forEach((label: string, idx: number) => {
                                let finalLabel = label;
                                
                                // Disambiguate generic V3 labels
                                if (label === 'YDS') finalLabel = catName.includes('passing') ? 'Passing Yards' : catName.includes('rushing') ? 'Rushing Yards' : catName.includes('receiving') ? 'Receiving Yards' : label;
                                if (label === 'AVG') finalLabel = catName.includes('passing') ? 'Passing Avg' : catName.includes('rushing') ? 'Rushing Avg' : label;
                                if (label === 'TD') finalLabel = catName.includes('passing') ? 'Passing TD' : catName.includes('rushing') ? 'Rushing TD' : label;
                                if (label === 'PCT') finalLabel = catName.includes('passing') ? 'Completion %' : label;
                                
                                // Mapping for General Stats
                                if (label === 'PTS') finalLabel = 'Points';
                                if (label === 'PA') finalLabel = 'Points Against';
                                if (label === 'GP') finalLabel = 'Games Played';

                                finalLabel = normalizeLabel(finalLabel);
                                
                                if (!stats.some(s => s.label.toLowerCase() === finalLabel.toLowerCase())) {
                                    stats.push({
                                        label: finalLabel,
                                        value: normalizeStat(cat.totals[idx])
                                    });
                                }
                            });
                        }
                    });
                }
            }
        } catch (e) {
            console.warn("V3 fetch failed", e);
        }
    }
        
    return stats;
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
    } catch { 
        return null; 
    }
};
