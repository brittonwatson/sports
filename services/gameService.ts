
import { Game, GameDetails, Sport, LineScore, TeamStat, ScoringPlay, Play, GameSituation, TeamBoxScore, TeamGameLeaders, TeamStatItem } from "../types";
import { ESPN_ENDPOINTS, SPORT_PARAMS, DAILY_CALENDAR_SPORTS } from "./constants";
import { fetchWithRetry, getUpcomingDateRange, formatTeamName, normalizeStat } from "./utils";
import { mapEventToGame } from "./mappers";
import { fetchTeamSeasonStats } from "./teamService";

export const fetchUpcomingGames = async (sport: Sport, fullHistory = false): Promise<{ games: Game[], groundingChunks: any[], isSeasonActive: boolean }> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const params = new URLSearchParams(SPORT_PARAMS[sport] || '');
    if (sport === 'NCAAF' && !params.has('groups')) params.set('groups', '80');
    if ((sport === 'NCAAM' || sport === 'NCAAW') && !params.has('groups')) params.set('groups', '50');
    if (DAILY_CALENDAR_SPORTS.includes(sport) || sport === 'NFL' || sport === 'NCAAF') params.set('dates', getUpcomingDateRange(sport, fullHistory));
    if (!params.has('limit')) params.set('limit', fullHistory ? '1000' : '200');

    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href;
        const events = data.events || [];
        const games = events.map((event: any) => mapEventToGame(event, sport, leagueLogo));
        let isSeasonActive = false;
        if (data.leagues?.[0]?.season?.startDate && data.leagues?.[0]?.season?.endDate) {
            const now = new Date();
            const start = new Date(data.leagues[0].season.startDate);
            const end = new Date(new Date(data.leagues[0].season.endDate).getTime() + 86400000);
            isSeasonActive = now >= start && now <= end;
        }
        if (games.length > 0) isSeasonActive = true;
        return { games, groundingChunks: [], isSeasonActive };
    } catch (e) {
        return { games: [], groundingChunks: [], isSeasonActive: false };
    }
};

export const fetchGamesForDate = async (sport: Sport, date: Date): Promise<Game[]> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const start = new Date(date); start.setDate(start.getDate() - 1);
    const end = new Date(date); end.setDate(end.getDate() + 1);
    const formatDate = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const params = new URLSearchParams(SPORT_PARAMS[sport] || '');
    if (sport === 'NCAAF') params.set('groups', '80');
    if (sport === 'NCAAM' || sport === 'NCAAW') params.set('groups', '50');
    params.set('dates', `${formatDate(start)}-${formatDate(end)}`);
    params.set('limit', '1000');
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href;
        let games = (data.events || []).map((e: any) => mapEventToGame(e, sport, leagueLogo));
        games = games.filter((g: Game) => {
            const gd = new Date(g.dateTime);
            return gd.getFullYear() === date.getFullYear() && gd.getMonth() === date.getMonth() && gd.getDate() === date.getDate();
        });
        return games;
    } catch { return []; }
};

export const fetchGameDatesForMonth = async (sport: Sport, year: number, month: number): Promise<Set<number>> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dateRange = `${year}${String(month + 1).padStart(2, '0')}01-${year}${String(month + 1).padStart(2, '0')}${lastDay}`;
    const params = new URLSearchParams(SPORT_PARAMS[sport] || '');
    if (sport === 'NCAAF') params.set('groups', '80');
    if (sport === 'NCAAM' || sport === 'NCAAW') params.set('groups', '50');
    params.set('dates', dateRange); params.set('limit', '1000');
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) return new Set();
        const data = await response.json();
        const days = new Set<number>();
        (data.events || []).forEach((evt: any) => {
            const d = new Date(evt.date);
            if (d.getFullYear() === year && d.getMonth() === month) days.add(d.getDate());
        });
        return days;
    } catch { return new Set(); }
};

export const fetchBracketGames = async (sport: Sport): Promise<Game[]> => {
    if (sport === 'NFL') {
        const endpoint = ESPN_ENDPOINTS[sport];
        const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
        const weeks = [1, 2, 3, 4, 5];
        const promises = weeks.map(w => 
            fetchWithRetry(`${baseUrl}?seasontype=3&week=${w}`).then(async r => {
                if (!r.ok) return [];
                const data = await r.json();
                const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href;
                return (data.events || []).map((e: any) => ({ ...e, _leagueLogo: leagueLogo }));
            }).catch(() => [])
        );
        const results = await Promise.all(promises);
        const allEvents = results.flat();
        const uniqueEvents = new Map();
        allEvents.forEach((e: any) => uniqueEvents.set(e.id, e));
        const games = Array.from(uniqueEvents.values()).map((e: any) => mapEventToGame(e, sport, e._leagueLogo));
        return games.filter(g => {
            const ctx = (g.context || '').toLowerCase();
            return !ctx.includes('pro bowl');
        }).sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
    }
    return [];
};

export const fetchGameDetails = async (gameId: string, sport: Sport): Promise<GameDetails | null> => {
    const endpoint = ESPN_ENDPOINTS[sport];
    const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary`;
    const params = new URLSearchParams({ event: gameId });
    try {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
        if (!response.ok) return null;
        const data = await response.json();
        
        const playerSource = data.boxscore?.players || data.rosters || [];
        let teamBoxSource = data.boxscore?.teams;
        
        if ((!teamBoxSource || teamBoxSource.length === 0) && data.statistics) {
            teamBoxSource = data.statistics;
        }
        
        const boxscore: TeamBoxScore[] = (playerSource || []).map((t: any) => ({
            teamId: t.team.id,
            teamName: formatTeamName(t.team, sport),
            teamLogo: t.team.logo,
            groups: (t.statistics || []).map((g: any) => ({
                label: g.name === 'defensive' ? 'Defense' : g.name === 'offensive' ? 'Offense' : g.name || 'Stats',
                labels: g.labels || (g.names || []),
                players: (g.athletes || []).map((a: any) => ({
                    player: { 
                        id: a.athlete.id, 
                        displayName: a.athlete.displayName, 
                        shortName: a.athlete.shortName, 
                        jersey: a.athlete.jersey, 
                        position: a.athlete.position?.abbreviation, 
                        headshot: a.athlete.headshot?.href, 
                        isStarter: a.starter 
                    },
                    stats: (a.stats || []).map(normalizeStat)
                }))
            }))
        }));

        const leaders: TeamGameLeaders[] = (data.leaders || []).map((t: any) => ({
            team: {
                id: t.team.id,
                abbreviation: t.team.abbreviation,
                logo: t.team.logo
            },
            leaders: (t.leaders || []).map((l: any) => ({
                name: l.name,
                displayName: l.displayName,
                shortDisplayName: l.shortDisplayName,
                leaders: (l.leaders || []).map((a: any) => ({
                    id: a.athlete.id,
                    displayName: a.athlete.displayName,
                    headshot: a.athlete.headshot?.href,
                    displayValue: a.displayValue,
                    position: a.athlete.position?.abbreviation,
                    jersey: a.athlete.jersey
                }))
            }))
        }));

        const competitors = data.header?.competitions?.[0]?.competitors || [];
        const homeComp = competitors.find((c: any) => c.homeAway === 'home');
        const awayComp = competitors.find((c: any) => c.homeAway === 'away');
        
        let parsedLinescores: LineScore[] = [];
        if (homeComp?.linescores && awayComp?.linescores) {
            parsedLinescores = homeComp.linescores.map((hLs: any) => {
                const period = hLs.period;
                const aLs = awayComp.linescores.find((a: any) => a.period === period);
                return { 
                    period: period, 
                    displayValue: hLs.displayValue, 
                    homeScore: normalizeStat(hLs), 
                    awayScore: normalizeStat(aLs) 
                };
            }).sort((a: any, b: any) => a.period - b.period);
        }

        let teamStats: TeamStat[] = [];
        if (teamBoxSource && teamBoxSource.length === 2) {
            const homeTeamId = homeComp?.team?.id;
            const homeData = teamBoxSource.find((t: any) => t.team?.id === homeTeamId);
            const awayData = teamBoxSource.find((t: any) => t.team?.id !== homeTeamId);
            
            if (homeData && awayData) {
                const getStatsList = (d: any) => {
                    if (d.statistics && Array.isArray(d.statistics)) return d.statistics;
                    return [];
                };

                const homeStatsList = getStatsList(homeData);
                const awayStatsList = getStatsList(awayData);

                if (homeStatsList.length > 0) {
                     teamStats = homeStatsList.map((hStat: any): TeamStat | null => {
                        const aStat = awayStatsList.find((aS: any) => (aS.name === hStat.name) || (aS.label === hStat.label));
                        if (!aStat) return null;
                        return { 
                            label: hStat.label || hStat.name, 
                            homeValue: normalizeStat(hStat), 
                            awayValue: normalizeStat(aStat),
                            homeRank: hStat.rank ? parseInt(hStat.rank) : undefined,
                            awayRank: aStat.rank ? parseInt(aStat.rank) : undefined
                        };
                    }).filter((s): s is TeamStat => s !== null);
                } else {
                    const flattenStats = (teamData: any) => teamData.statistics?.flatMap((group: any) => 
                        (group.stats || [group]).map((s: any) => ({
                            ...s,
                            label: (group.name && group.name !== 'general' && !s.label?.toLowerCase().includes(group.name.toLowerCase()) && !group.name.includes('general')) 
                                ? `${group.label || group.name} ${s.label}` 
                                : s.label
                        }))
                    ) || [];

                    const hList = flattenStats(homeData);
                    const aList = flattenStats(awayData);
                    
                    teamStats = hList.map((hStat: any): TeamStat | null => {
                        const aStat = aList.find((aS: any) => 
                            aS.name === hStat.name || 
                            aS.label === hStat.label ||
                            (aS.label && hStat.label && aS.label.replace(groupRegex(aS), '') === hStat.label.replace(groupRegex(hStat), ''))
                        );
                        if (!aStat) return null;
                        return { 
                            label: hStat.label || hStat.name, 
                            homeValue: normalizeStat(hStat), 
                            awayValue: normalizeStat(aStat),
                            homeRank: hStat.rank ? parseInt(hStat.rank) : undefined,
                            awayRank: aStat.rank ? parseInt(aStat.rank) : undefined
                        };
                    }).filter((s): s is TeamStat => s !== null);
                }
            }
        }

        let seasonStats: TeamStat[] | undefined;
        
        const seasonType = data.header?.competitions?.[0]?.season?.type;
        const seasonYear = data.header?.competitions?.[0]?.season?.year;
        const isPostseason = seasonType === 3;
        
        if (isPostseason && (sport === 'NFL' || sport === 'NCAAF' || sport === 'NBA' || sport === 'NHL' || sport === 'WNBA' || sport === 'MLB')) {
             const homeId = homeComp?.team?.id;
             const awayId = awayComp?.team?.id;
             
             if (homeId && awayId) {
                 try {
                     const [hReg, hPost, aReg, aPost] = await Promise.all([
                         fetchTeamSeasonStats(sport, homeId, 2, seasonYear),
                         fetchTeamSeasonStats(sport, homeId, 3, seasonYear),
                         fetchTeamSeasonStats(sport, awayId, 2, seasonYear),
                         fetchTeamSeasonStats(sport, awayId, 3, seasonYear)
                     ]);

                     let defaultGP = 1;
                     if (sport === 'NFL') defaultGP = 17;
                     else if (sport === 'NBA' || sport === 'NHL') defaultGP = 82;
                     else if (sport === 'MLB') defaultGP = 162;
                     else if (sport === 'WNBA') defaultGP = 40;
                     else if (sport.startsWith('NCAA')) defaultGP = 12;

                     const hMerged = mergeSeasonStats(hReg, hPost, defaultGP);
                     const aMerged = mergeSeasonStats(aReg, aPost, defaultGP);

                     if (hMerged.length > 0 && aMerged.length > 0) {
                         seasonStats = hMerged.map(hStat => {
                             const aStat = aMerged.find(a => a.label === hStat.label);
                             if (!aStat) return { label: hStat.label, homeValue: hStat.value, awayValue: '0', homeRank: hStat.rank };
                             return {
                                 label: hStat.label,
                                 homeValue: hStat.value,
                                 awayValue: aStat.value,
                                 homeRank: hStat.rank,
                                 awayRank: aStat.rank
                             };
                         });
                     }
                 } catch (e) {
                     console.warn("Failed to fetch season stats for prediction baseline", e);
                 }
             }
        }

        const scoringPlays: ScoringPlay[] = (data.scoringPlays || []).map((p: any) => ({
            id: p.id, period: p.period.number, clock: p.clock.displayValue, type: p.type?.text || 'Score', text: p.text, isHome: p.team?.id === homeComp?.team?.id, homeScore: p.homeScore, awayScore: p.awayScore, teamId: p.team?.id
        }));
        
        let rawPlays = data.plays || [];
        if (rawPlays.length === 0 && data.drives) {
             const drives = [...(data.drives.previous || [])];
             if (data.drives.current) drives.push(data.drives.current);
             rawPlays = drives.flatMap((d: any) => d.plays || []);
        }

        const plays: Play[] = rawPlays.map((p: any) => ({
            id: p.id, period: p.period.number, clock: p.clock.displayValue, type: p.type?.text || 'Play', text: p.text, scoringPlay: p.scoringPlay, homeScore: p.homeScore, awayScore: p.awayScore, teamId: p.team?.id, wallclock: p.wallclock, down: p.start?.down, distance: p.start?.distance, yardLine: p.start?.yardLine, downDistanceText: p.start?.downDistanceText
        }));

        let situation: GameSituation | undefined;
        if (data.situation) {
            if (sport === 'NFL' || sport === 'NCAAF') {
                situation = { down: data.situation.down, distance: data.situation.distance, yardLine: data.situation.yardLine, possession: data.situation.possession ? String(data.situation.possession) : undefined, isRedZone: data.situation.isRedZone, possessionText: data.situation.possessionText, downDistanceText: data.situation.downDistanceText, homeTimeouts: homeComp?.timeoutsLeft, awayTimeouts: awayComp?.timeoutsLeft };
            } else if (sport === 'MLB') {
                 situation = { balls: data.situation.balls, strikes: data.situation.strikes, outs: data.situation.outs, onFirst: !!data.situation.onFirst, onSecond: !!data.situation.onSecond, onThird: !!data.situation.onThird, batter: data.situation.batter?.athlete?.displayName, pitcher: data.situation.pitcher?.athlete?.displayName };
            }
        }

        return {
            gameId, linescores: parsedLinescores, stats: teamStats, seasonStats, scoringPlays, plays, leaders,
            gameInfo: { weather: data.gameInfo?.weather?.displayValue, venue: data.gameInfo?.venue?.fullName, attendance: data.gameInfo?.attendance },
            injuries: (data.injuries || []).flatMap((t: any) => (t.injuries || []).map((i: any) => ({ athlete: { id: i.athlete.id, displayName: i.athlete.displayName, position: i.athlete.position?.abbreviation }, status: i.status, teamId: t.team.id }))),
            boxscore, situation, clock: data.header?.competitions?.[0]?.status?.displayClock, period: data.header?.competitions?.[0]?.status?.period, homeScore: homeComp?.score, awayScore: awayComp?.score,
            odds: data.pickcenter?.[0] ? { spread: data.pickcenter[0].details, overUnder: data.pickcenter[0].overUnder ? `O/U ${data.pickcenter[0].overUnder}` : undefined, moneyLineAway: data.pickcenter[0].awayTeamOdds?.moneyLine !== undefined ? String(data.pickcenter[0].awayTeamOdds.moneyLine) : undefined, moneyLineHome: data.pickcenter[0].homeTeamOdds?.moneyLine !== undefined ? String(data.pickcenter[0].homeTeamOdds.moneyLine) : undefined, provider: data.pickcenter[0].provider?.name } : undefined
        };
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
    const AVG_KEYS = ['points', 'points against', 'yards', 'passing yards', 'rushing yards', 'passing avg', 'rushing avg', 'total yards', 'points for'];
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
            if (AVG_LABELS.has(labelLower) && Math.abs(vReg) > 80) { // Simple heuristic: >80 likely total points/yards
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
            
            // Logic A: Volume Stats (Points, Yards) -> Always convert to Average
            if (AVG_LABELS.has(labelLower)) {
                let regTotal = vReg;
                let postTotal = vPost;

                // Detect if source is Average or Total
                // Most APIs return totals for "Points", "Yards". 
                // But if value is small (< 60 for points, < 15 for yards?), it might be an average already.
                // NFL Points: > 100 is Total. < 50 is Avg.
                // NFL Yards: > 1000 is Total. < 500 is Avg.
                
                const isRegAvg = Math.abs(vReg) < (labelLower.includes('yards') ? 600 : 70);
                const isPostAvg = Math.abs(vPost) < (labelLower.includes('yards') ? 600 : 70);

                if (isRegAvg) regTotal = vReg * gpReg;
                if (isPostAvg) postTotal = vPost * gpPost;

                const grandTotal = regTotal + postTotal;
                newVal = totalGP > 0 ? grandTotal / totalGP : 0;

            } else if (isExplicitAvg || isPct) {
                // Logic B: Already Averages/Rates -> Weighted Average
                newVal = ((vReg * gpReg) + (vPost * gpPost)) / totalGP;
            } else {
                // Logic C: Count Stats (Sacks, Interceptions, Wins) -> Sum
                // Unless it's explicitly 'Rank', then keep Reg or weight it? Let's just keep Reg for rank.
                if (labelLower.includes('rank')) newVal = vReg;
                else newVal = vReg + vPost;
            }
        }

        const isPct = rItem.value.includes('%') || labelLower.includes('pct') || labelLower.includes('%');
        let valStr = '';
        
        if (isPct) {
            valStr = newVal.toFixed(1) + '%';
        } else {
            // formatting: if small decimal, keep decimal. if large integer, round.
            // But since we are converting Volume to Average, we WANT decimals (e.g. 24.5 PPG)
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
