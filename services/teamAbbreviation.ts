import { LOCAL_TEAMS } from "../data/teams";
import { Game, Sport } from "../types";

interface TeamAbbreviationInput {
    league?: Sport | string;
    teamId?: string;
    teamName?: string;
    providedAbbreviation?: string;
}

const byLeagueAndId = new Map<string, string>();
const byLeagueAndName = new Map<string, string>();

const normalizeKey = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

const cleanAbbreviation = (value: string | undefined): string =>
    String(value || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .trim();

const setNameAlias = (league: string, alias: string | undefined, abbreviation: string): void => {
    if (!alias || !abbreviation) return;
    const key = `${league}:${normalizeKey(alias)}`;
    if (!byLeagueAndName.has(key)) byLeagueAndName.set(key, abbreviation);
};

Object.entries(LOCAL_TEAMS).forEach(([league, teams]) => {
    teams.forEach((team) => {
        const abbreviation = cleanAbbreviation(team.abbreviation);
        if (!abbreviation) return;

        if (team.id) byLeagueAndId.set(`${league}:${team.id}`, abbreviation);
        setNameAlias(league, team.name, abbreviation);

        const words = team.name.split(/\s+/).filter(Boolean);
        if (words.length >= 1) setNameAlias(league, words[words.length - 1], abbreviation);
        if (words.length >= 2) setNameAlias(league, words.slice(-2).join(" "), abbreviation);
    });
});

const acronymFallback = (teamName: string): string => {
    const words = teamName.replace(/[^A-Za-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    if (words.length === 0) return "TEAM";
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    if (words.length === 2) {
        const [first, second] = words;
        if (first.length >= 3) return first.slice(0, 3).toUpperCase();
        return `${first[0] || ""}${second[0] || ""}${second[1] || ""}`.toUpperCase();
    }
    return words.slice(0, 3).map((word) => word[0] || "").join("").toUpperCase();
};

export const getTeamAbbreviation = (input: TeamAbbreviationInput): string => {
    const provided = cleanAbbreviation(input.providedAbbreviation);
    if (provided) return provided;

    const league = String(input.league || "").trim();
    const teamId = String(input.teamId || "").trim();
    const teamName = String(input.teamName || "").trim();

    if (league && teamId) {
        const byId = byLeagueAndId.get(`${league}:${teamId}`);
        if (byId) return byId;
    }

    if (league && teamName) {
        const byName = byLeagueAndName.get(`${league}:${normalizeKey(teamName)}`);
        if (byName) return byName;
    }

    if (teamName) {
        const maybeAbbreviation = cleanAbbreviation(teamName);
        if (
            maybeAbbreviation.length >= 2 &&
            maybeAbbreviation.length <= 4 &&
            teamName === teamName.toUpperCase()
        ) {
            return maybeAbbreviation;
        }
        return acronymFallback(teamName);
    }

    return "TEAM";
};

export const getGameTeamAbbreviation = (game: Game, side: "home" | "away"): string => {
    if (side === "home") {
        return getTeamAbbreviation({
            league: game.league,
            teamId: game.homeTeamId,
            teamName: game.homeTeam,
            providedAbbreviation: game.homeTeamAbbreviation,
        });
    }
    return getTeamAbbreviation({
        league: game.league,
        teamId: game.awayTeamId,
        teamName: game.awayTeam,
        providedAbbreviation: game.awayTeamAbbreviation,
    });
};

