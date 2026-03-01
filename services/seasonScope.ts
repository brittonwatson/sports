import { Game, Sport } from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SPLIT_SEASON_SPORTS = new Set<Sport>([
    "NFL",
    "NCAAF",
    "NBA",
    "NHL",
    "NCAAM",
    "NCAAW",
    "EPL",
    "Bundesliga",
    "La Liga",
    "Ligue 1",
    "Serie A",
    "UCL",
]);

const getSeasonGapDays = (sport?: Sport): number => {
    if (!sport) return 50;
    if (sport === "EPL" || sport === "MLS" || sport === "Bundesliga" || sport === "La Liga" || sport === "Ligue 1" || sport === "Serie A" || sport === "UCL") {
        return 50;
    }
    if (sport === "NBA" || sport === "WNBA" || sport === "NCAAM" || sport === "NCAAW" || sport === "NHL") {
        return 45;
    }
    if (sport === "MLB") return 55;
    if (sport === "NFL" || sport === "NCAAF") return 60;
    return 50;
};

type Cluster = { start: number; end: number };

const inferSeasonYearFromDate = (dateTime: string, sport?: Sport): number | undefined => {
    const date = new Date(dateTime);
    if (!Number.isFinite(date.getTime())) return undefined;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    if (!SPLIT_SEASON_SPORTS.has(sport as Sport)) return year;
    // Seasons that span two calendar years are keyed to their starting year.
    return month >= 7 ? year : year - 1;
};

export const getSeasonYearForGame = (game: Game, sport?: Sport): number | undefined => {
    const explicit = Number(game.seasonYear);
    if (Number.isFinite(explicit) && explicit > 1900) {
        return Math.trunc(explicit);
    }
    return inferSeasonYearFromDate(game.dateTime, sport);
};

export const getSeasonKeyForGame = (game: Game, sport?: Sport): string => {
    const seasonYear = getSeasonYearForGame(game, sport);
    return Number.isFinite(seasonYear) ? String(seasonYear) : "unknown";
};

export const formatSeasonLabel = (sport: Sport | undefined, seasonYear: number): string => {
    if (!Number.isFinite(seasonYear)) return "Unknown Season";
    const year = Math.trunc(seasonYear);
    if (sport && SPLIT_SEASON_SPORTS.has(sport)) {
        const trailing = String((year + 1) % 100).padStart(2, "0");
        return `${year}-${trailing}`;
    }
    return String(year);
};

export interface SeasonOption {
    key: string;
    seasonYear: number;
    label: string;
    gameCount: number;
}

export const listSeasonOptionsFromGames = (games: Game[], sport?: Sport): SeasonOption[] => {
    const counts = new Map<number, number>();

    games.forEach((game) => {
        const seasonYear = getSeasonYearForGame(game, sport);
        if (!Number.isFinite(seasonYear)) return;
        const year = Math.trunc(seasonYear as number);
        counts.set(year, (counts.get(year) || 0) + 1);
    });

    return Array.from(counts.entries())
        .sort((a, b) => {
            if (a[0] !== b[0]) return b[0] - a[0];
            return b[1] - a[1];
        })
        .map(([seasonYear, gameCount]) => ({
            key: String(seasonYear),
            seasonYear,
            label: formatSeasonLabel(sport, seasonYear),
            gameCount,
        }));
};

export const scopeGamesToMostRecentSeason = (games: Game[], sport?: Sport): Game[] => {
    if (!Array.isArray(games) || games.length <= 1) return games;

    const dated = games
        .map((game) => ({ game, ts: new Date(game.dateTime).getTime() }))
        .filter((entry) => Number.isFinite(entry.ts))
        .sort((a, b) => a.ts - b.ts);

    if (dated.length <= 1) return games;

    const maxGapMs = getSeasonGapDays(sport) * MS_PER_DAY;
    const clusters: Cluster[] = [{ start: dated[0].ts, end: dated[0].ts }];

    for (let i = 1; i < dated.length; i += 1) {
        const prev = dated[i - 1];
        const curr = dated[i];
        const gap = curr.ts - prev.ts;
        if (gap > maxGapMs) {
            clusters.push({ start: curr.ts, end: curr.ts });
        } else {
            clusters[clusters.length - 1].end = curr.ts;
        }
    }

    if (clusters.length === 1) return games;

    const activeTimes = games
        .filter((game) => game.status !== "finished")
        .map((game) => new Date(game.dateTime).getTime())
        .filter((ts) => Number.isFinite(ts))
        .sort((a, b) => a - b);

    let targetCluster = clusters[clusters.length - 1];
    if (activeTimes.length > 0) {
        const activeTs = activeTimes[activeTimes.length - 1];
        const activeCluster = clusters.find((cluster) => activeTs >= cluster.start && activeTs <= cluster.end);
        if (activeCluster) targetCluster = activeCluster;
    }

    return games.filter((game) => {
        const ts = new Date(game.dateTime).getTime();
        if (!Number.isFinite(ts)) return true;
        return ts >= targetCluster.start && ts <= targetCluster.end;
    });
};
