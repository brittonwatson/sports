import React, { useMemo } from "react";
import { RacingCompetitorResult, RacingEventBundle, RacingSessionResult } from "../types";
import { Flag, Timer, Trophy, Sparkles } from "lucide-react";

interface RacingEventPanelProps {
  event: RacingEventBundle | null;
  isLoading?: boolean;
  selectedDriverId?: string | null;
  onDriverClick?: (sport: RacingEventBundle["sport"], driverId: string, driverName: string) => void;
}

type SessionColumn =
  | { kind: "stat"; key: string; normalizedKey: string; label: string }
  | { kind: "derived"; key: "lapsSincePit"; label: string }
  | { kind: "status"; key: "statusText"; label: string };

const FRIENDLY_LABELS: Record<string, string> = {
  totaltime: "Total Time",
  behindtime: "Gap",
  gaptoleader: "Gap",
  behindlaps: "Laps Down",
  lapscompleted: "Laps",
  lapslead: "Laps Led",
  pitstaken: "Pit Stops",
  lastpitlap: "Last Pit",
  fastestlap: "Fastest Lap",
  fastestlapnum: "Fast Lap #",
  championshippts: "Pts",
  points: "Pts",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  qual1timems: "Q1",
  qual2timems: "Q2",
  qual3timems: "Q3",
  tire: "Tire",
  tirestatus: "Tire",
  tirecompound: "Tire",
};

const RACE_PRIORITY_COLUMNS: Array<{ label: string; aliases: string[] }> = [
  { label: "Gap", aliases: ["behindTime", "gapToLeader", "gap", "interval", "timeBehind"] },
  { label: "Laps Down", aliases: ["behindLaps", "lapsDown", "lapDown"] },
  { label: "Laps", aliases: ["lapsCompleted", "laps"] },
  { label: "Laps Led", aliases: ["lapsLead", "lapsLed"] },
  { label: "Pit Stops", aliases: ["pitsTaken", "pitStops", "stops"] },
  { label: "Last Pit", aliases: ["lastPitLap", "lastPit"] },
  { label: "Tire", aliases: ["tireStatus", "tire", "tireCompound", "compound"] },
  { label: "Fastest Lap", aliases: ["fastestLap", "bestLap", "lapTime"] },
  { label: "Fast Lap #", aliases: ["fastestLapNum", "fastestLapNumber"] },
  { label: "Pts", aliases: ["championshipPts", "points"] },
  { label: "Q1", aliases: ["qual1TimeMS", "q1"] },
  { label: "Q2", aliases: ["qual2TimeMS", "q2"] },
  { label: "Q3", aliases: ["qual3TimeMS", "q3"] },
  { label: "Total Time", aliases: ["totalTime"] },
];

const QUALIFYING_PRIORITY_COLUMNS: Array<{ label: string; aliases: string[] }> = [
  { label: "Q3", aliases: ["qual3TimeMS", "q3"] },
  { label: "Q2", aliases: ["qual2TimeMS", "q2"] },
  { label: "Q1", aliases: ["qual1TimeMS", "q1"] },
  { label: "Gap", aliases: ["behindTime", "gapToLeader", "gap", "interval", "timeBehind"] },
  { label: "Fastest Lap", aliases: ["fastestLap", "bestLap", "lapTime"] },
  { label: "Total Time", aliases: ["totalTime"] },
];

const PRACTICE_PRIORITY_COLUMNS: Array<{ label: string; aliases: string[] }> = [
  { label: "Fastest Lap", aliases: ["fastestLap", "bestLap", "lapTime"] },
  { label: "Gap", aliases: ["behindTime", "gapToLeader", "gap", "interval", "timeBehind"] },
  { label: "Laps", aliases: ["lapsCompleted", "laps"] },
  { label: "Laps Led", aliases: ["lapsLead", "lapsLed"] },
  { label: "Total Time", aliases: ["totalTime"] },
  { label: "Tire", aliases: ["tireStatus", "tire", "tireCompound", "compound"] },
];

const HIDDEN_COLUMN_KEYS = new Set([
  "place",
  "position",
  "order",
  "startorder",
  "startposition",
  "wins",
  "top5",
  "top10",
]);

const normalizeKey = (value: string): string => String(value || "").trim().toLowerCase();

const inferSessionType = (sessionName: string): "race" | "qualifying" | "practice" | "other" => {
  const normalized = normalizeKey(sessionName);
  if (normalized.includes("race")) return "race";
  if (normalized.includes("qualifying") || normalized.includes("shootout")) return "qualifying";
  if (normalized.includes("practice") || normalized.startsWith("fp") || normalized.includes("warmup")) return "practice";
  return "other";
};

const getSessionStatusOrder = (status: RacingSessionResult["status"]): number => {
  if (status === "in_progress") return 0;
  if (status === "scheduled") return 1;
  return 2;
};

const getSessionTypeOrder = (name: string): number => {
  const type = inferSessionType(name);
  if (type === "practice") return 0;
  if (type === "qualifying") return 1;
  if (type === "race") return 2;
  return 3;
};

const sortSessionsForDisplay = (sessions: RacingSessionResult[]): RacingSessionResult[] => {
  return [...sessions].sort((a, b) => {
    const statusDiff = getSessionStatusOrder(a.status) - getSessionStatusOrder(b.status);
    if (statusDiff !== 0) return statusDiff;
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    if (a.status === "finished") {
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    } else if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    const typeDiff = getSessionTypeOrder(a.name) - getSessionTypeOrder(b.name);
    if (typeDiff !== 0) return typeDiff;
    return a.name.localeCompare(b.name);
  });
};

const hasMeaningfulValue = (value: string): boolean => {
  const normalized = String(value || "").trim();
  return !!normalized && normalized !== "-" && normalized !== "--";
};

const formatDateTime = (value: string): string => {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const sessionLabelClass = (status: RacingSessionResult["status"]): string => {
  if (status === "in_progress") return "text-amber-300 bg-amber-500/20 border-amber-400/40";
  if (status === "finished") return "text-emerald-300 bg-emerald-500/20 border-emerald-400/40";
  return "text-slate-300 bg-slate-700/40 border-slate-600";
};

const buildStatValueMap = (competitor: RacingCompetitorResult): Map<string, string> => {
  const map = new Map<string, string>();
  competitor.stats.forEach((stat) => {
    const normalizedKey = normalizeKey(stat.key);
    if (!normalizedKey) return;
    map.set(normalizedKey, String(stat.value || "").trim());
  });
  return map;
};

const parseNumeric = (value: string | undefined): number | null => {
  if (!value) return null;
  const sanitized = String(value).replace(/[^\d.-]/g, "");
  const num = Number(sanitized);
  if (!Number.isFinite(num)) return null;
  return num;
};

const deriveLapsSincePit = (statMap: Map<string, string>): string => {
  const completed = parseNumeric(statMap.get("lapscompleted"));
  const lastPit = parseNumeric(statMap.get("lastpitlap"));
  if (completed === null || lastPit === null) return "-";
  const delta = completed - lastPit;
  if (!Number.isFinite(delta) || delta < 0) return "-";
  return String(Math.round(delta));
};

const getCoverageThreshold = (sessionType: ReturnType<typeof inferSessionType>): number => {
  if (sessionType === "qualifying") return 0.18;
  if (sessionType === "practice") return 0.22;
  return 0.25;
};

const chooseVisibleColumns = (session: RacingSessionResult): SessionColumn[] => {
  const sessionType = inferSessionType(session.name);
  const priorityColumns = sessionType === "qualifying"
    ? QUALIFYING_PRIORITY_COLUMNS
    : sessionType === "practice"
      ? PRACTICE_PRIORITY_COLUMNS
      : RACE_PRIORITY_COLUMNS;
  const present = new Map<string, { key: string; label: string }>();
  const populatedCounts = new Map<string, number>();
  const driverCount = Math.max(1, session.competitors.length);
  const minCoverage = getCoverageThreshold(sessionType);

  session.competitors.forEach((competitor) => {
    competitor.stats.forEach((stat) => {
      const key = String(stat.key || "").trim();
      const value = String(stat.value || "").trim();
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey || !hasMeaningfulValue(value)) return;
      populatedCounts.set(normalizedKey, (populatedCounts.get(normalizedKey) || 0) + 1);
      if (!present.has(normalizedKey)) {
        present.set(normalizedKey, {
          key,
          label: String(stat.label || stat.abbreviation || key),
        });
      }
    });
  });

  const coverageForKey = (normalizedKey: string): number =>
    (populatedCounts.get(normalizedKey) || 0) / driverCount;

  const ordered: SessionColumn[] = [];
  const usedKeys = new Set<string>();

  priorityColumns.forEach((priorityColumn) => {
    const match = priorityColumn.aliases
      .map((alias) => present.get(normalizeKey(alias)))
      .find((entry): entry is { key: string; label: string } => Boolean(entry));
    if (!match) return;
    const normalizedKey = normalizeKey(match.key);
    if (coverageForKey(normalizedKey) < minCoverage) return;
    if (usedKeys.has(normalizedKey)) return;
    usedKeys.add(normalizedKey);
    ordered.push({
      kind: "stat",
      key: match.key,
      normalizedKey,
      label: priorityColumn.label,
    });
  });

  const hasLapsSincePitData = (
    present.has("lapscompleted") &&
    present.has("lastpitlap") &&
    coverageForKey("lapscompleted") >= minCoverage &&
    coverageForKey("lastpitlap") >= minCoverage
  );
  if (hasLapsSincePitData) {
    ordered.push({ kind: "derived", key: "lapsSincePit", label: "Since Pit" });
  }

  const statusCoverage = session.competitors
    .filter((competitor) => hasMeaningfulValue(competitor.statusText || ""))
    .length / driverCount;
  const hasStatusText = statusCoverage >= Math.min(0.35, minCoverage + 0.08);
  if (hasStatusText) {
    ordered.push({ kind: "status", key: "statusText", label: "Status" });
  }

  present.forEach((entry, normalizedKey) => {
    if (usedKeys.has(normalizedKey) || HIDDEN_COLUMN_KEYS.has(normalizedKey)) return;
    if (coverageForKey(normalizedKey) < minCoverage) return;
    usedKeys.add(normalizedKey);
    ordered.push({
      kind: "stat",
      key: entry.key,
      normalizedKey,
      label: FRIENDLY_LABELS[normalizedKey] || entry.label || entry.key,
    });
  });

  return ordered;
};

const resolveColumnValue = (
  competitor: RacingCompetitorResult,
  statMap: Map<string, string>,
  column: SessionColumn,
): string => {
  if (column.kind === "derived") {
    return deriveLapsSincePit(statMap);
  }
  if (column.kind === "status") {
    return competitor.statusText || "-";
  }
  return statMap.get(column.normalizedKey) || "-";
};

const getSessionDataNote = (session: RacingSessionResult, columns: SessionColumn[]): string | null => {
  if (session.competitors.length === 0) return null;
  const statColumns = columns.filter((column) => column.kind !== "status");
  if (statColumns.length === 0) {
    return "Detailed telemetry is not provided by the ESPN feed for this session yet.";
  }
  if (statColumns.length <= 2) {
    return "This session has limited telemetry from the feed; showing only populated fields.";
  }
  return null;
};

export const RacingEventPanel: React.FC<RacingEventPanelProps> = ({
  event,
  isLoading = false,
  selectedDriverId,
  onDriverClick,
}) => {
  const sessions = useMemo(
    () => sortSessionsForDisplay(event?.sessions || []),
    [event],
  );
  const hasForecastableRace = useMemo(() => {
    const raceSession = sessions.find((session) => inferSessionType(session.name) === "race");
    if (raceSession) return raceSession.status !== "finished";
    return sessions.some((session) => session.status !== "finished");
  }, [sessions]);

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500 dark:text-slate-400">
        Loading race sessions and full-field results...
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500 dark:text-slate-400">
        Race event details are unavailable right now.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div>
            <h3 className="text-lg font-display font-bold text-slate-900 dark:text-white">{event.shortName}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {event.venue || "Venue TBD"}{event.location ? `, ${event.location}` : ""}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Session stats show only fields populated by the live feed.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-500">Start</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{formatDateTime(event.date)}</p>
          </div>
        </div>
      </section>

      {hasForecastableRace && event.prediction && event.prediction.entries.length > 0 && (
        <section className="rounded-3xl border border-cyan-300/50 dark:border-cyan-700/50 bg-cyan-50/70 dark:bg-cyan-950/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-cyan-600 dark:text-cyan-300" />
              <h4 className="text-sm font-bold text-cyan-900 dark:text-cyan-200 uppercase tracking-wider">Race Forecast</h4>
            </div>
            <div className="text-xs text-cyan-800 dark:text-cyan-300">
              {(event.prediction.confidence * 100).toFixed(0)}% confidence • {event.prediction.simulations.toLocaleString()} simulations
            </div>
          </div>
          <p className="text-xs text-cyan-900/80 dark:text-cyan-200/80 mb-3">
            {event.prediction.model}. Forecast blends qualifying, practice pace, and season form.
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-cyan-100/80 dark:bg-cyan-900/40 text-cyan-900 dark:text-cyan-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Rank</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-left">Win</th>
                  <th className="px-3 py-2 text-left">Podium</th>
                  <th className="px-3 py-2 text-left">Top 5</th>
                  <th className="px-3 py-2 text-left">Why</th>
                </tr>
              </thead>
              <tbody>
                {event.prediction.entries.slice(0, 12).map((entry) => {
                  const selected = selectedDriverId && String(selectedDriverId) === String(entry.competitorId);
                  return (
                    <tr key={`${event.eventId}-${entry.competitorId}`} className={`border-t border-cyan-200/60 dark:border-cyan-800/50 ${selected ? 'bg-cyan-100/70 dark:bg-cyan-900/35' : ''}`}>
                      <td className="px-3 py-2 font-semibold text-cyan-900 dark:text-cyan-200">{entry.rank}</td>
                      <td className="px-3 py-2 min-w-[180px]">
                              {onDriverClick ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!entry.competitorId) return;
                                    onDriverClick(event.sport, entry.competitorId, entry.name);
                                  }}
                                  className="text-left font-semibold text-cyan-800 dark:text-cyan-200 hover:underline inline-flex items-center gap-1.5"
                                >
                                  <span>{entry.name}</span>
                                  {entry.vehicleNumber && <span className="text-xs font-bold text-cyan-900/80 dark:text-cyan-200/90">#{entry.vehicleNumber}</span>}
                                </button>
                        ) : (
                          <span className="font-semibold text-cyan-900 dark:text-cyan-200 inline-flex items-center gap-1.5">
                            <span>{entry.name}</span>
                            {entry.vehicleNumber && <span className="text-xs font-bold text-cyan-900/80 dark:text-cyan-200/90">#{entry.vehicleNumber}</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-cyan-900 dark:text-cyan-200">{entry.winProbability.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-cyan-900 dark:text-cyan-200">{entry.podiumProbability.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-cyan-900 dark:text-cyan-200">{entry.top5Probability.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-xs text-cyan-900/80 dark:text-cyan-200/80 min-w-[220px]">{entry.explanation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sessions.map((session) => {
        const columns = chooseVisibleColumns(session);
        const sessionDataNote = getSessionDataNote(session, columns);
        return (
          <section
            key={session.id}
            className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag size={14} className="text-cyan-500" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{session.name}</h4>
                <span className={`text-[10px] uppercase tracking-wider border px-2 py-0.5 rounded-full ${sessionLabelClass(session.status)}`}>
                  {session.statusText}
                </span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(session.date)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/70 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-3 py-2 text-left">Pos</th>
                    <th className="px-3 py-2 text-left">Driver</th>
                    <th className="px-3 py-2 text-left">Team</th>
                    <th className="px-3 py-2 text-left">Start</th>
                    {columns.map((column, columnIndex) => (
                      <th key={`${session.id}-${column.key}-${columnIndex}`} className="px-3 py-2 text-left">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {session.competitors.map((competitor) => {
                    const statMap = buildStatValueMap(competitor);
                    const placeStat = parseNumeric(statMap.get("place"));
                    const position =
                      competitor.finishPosition ||
                      (placeStat !== null && placeStat > 0 ? Math.trunc(placeStat) : undefined) ||
                      competitor.startPosition ||
                      "-";
                    const selected = selectedDriverId && String(selectedDriverId) === String(competitor.competitorId);
                    return (
                      <tr key={`${session.id}-${competitor.competitorId}`} className={`border-t border-slate-100 dark:border-slate-800/70 ${selected ? 'bg-cyan-50/80 dark:bg-cyan-950/20' : ''}`}>
                        <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">
                          {competitor.winner ? (
                            <span className="inline-flex items-center gap-1 text-amber-500">
                              <Trophy size={12} />
                              {position}
                            </span>
                          ) : (
                            position
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-[180px]">
                            {competitor.logo ? (
                              <img src={competitor.logo} alt="" className="w-6 h-6 rounded-full object-cover bg-slate-200 dark:bg-slate-700" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />
                            )}
                            <div>
                              {onDriverClick ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!competitor.competitorId) return;
                                    onDriverClick(event.sport, competitor.competitorId, competitor.name);
                                  }}
                                  className="font-semibold text-left text-cyan-700 dark:text-cyan-300 hover:underline leading-tight inline-flex items-center gap-1.5"
                                >
                                  <span>{competitor.name}</span>
                                  {competitor.vehicleNumber && <span className="text-xs font-bold text-slate-600 dark:text-slate-300">#{competitor.vehicleNumber}</span>}
                                </button>
                              ) : (
                                <div className="font-semibold text-slate-900 dark:text-white leading-tight inline-flex items-center gap-1.5">
                                  <span>{competitor.name}</span>
                                  {competitor.vehicleNumber && <span className="text-xs font-bold text-slate-600 dark:text-slate-300">#{competitor.vehicleNumber}</span>}
                                </div>
                              )}
                              {competitor.flag && (
                                <img src={competitor.flag} alt="" className="w-4 h-3 object-cover rounded-sm mt-1" />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300 min-w-[180px]">
                          {competitor.teamName || competitor.manufacturer || "-"}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{competitor.startPosition || "-"}</td>
                        {columns.map((column, columnIndex) => (
                          <td
                            key={`${session.id}-${competitor.competitorId}-${column.key}-${columnIndex}`}
                            className="px-3 py-2 text-slate-700 dark:text-slate-300"
                          >
                            {resolveColumnValue(competitor, statMap, column)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {session.competitors.length === 0 && (
              <div className="p-4 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Timer size={14} />
                Session entries are not posted yet.
              </div>
            )}
            {sessionDataNote && session.competitors.length > 0 && (
              <div className="px-4 py-3 text-xs text-amber-700 dark:text-amber-300 border-t border-amber-200/60 dark:border-amber-700/50 bg-amber-50/70 dark:bg-amber-950/20">
                {sessionDataNote}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};
