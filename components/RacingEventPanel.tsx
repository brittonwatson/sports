import React, { useMemo } from "react";
import { RacingCompetitorResult, RacingEventBundle, RacingSessionResult } from "../types";
import { Flag, Timer, Trophy } from "lucide-react";

interface RacingEventPanelProps {
  event: RacingEventBundle | null;
  isLoading?: boolean;
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

const PRIORITY_COLUMNS: Array<{ label: string; aliases: string[] }> = [
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

const chooseVisibleColumns = (session: RacingSessionResult): SessionColumn[] => {
  const present = new Map<string, { key: string; label: string }>();

  session.competitors.forEach((competitor) => {
    competitor.stats.forEach((stat) => {
      const key = String(stat.key || "").trim();
      const value = String(stat.value || "").trim();
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey || !hasMeaningfulValue(value)) return;
      if (!present.has(normalizedKey)) {
        present.set(normalizedKey, {
          key,
          label: String(stat.label || stat.abbreviation || key),
        });
      }
    });
  });

  const ordered: SessionColumn[] = [];
  const usedKeys = new Set<string>();

  PRIORITY_COLUMNS.forEach((priorityColumn) => {
    const match = priorityColumn.aliases
      .map((alias) => present.get(normalizeKey(alias)))
      .find((entry): entry is { key: string; label: string } => Boolean(entry));
    if (!match) return;
    const normalizedKey = normalizeKey(match.key);
    if (usedKeys.has(normalizedKey)) return;
    usedKeys.add(normalizedKey);
    ordered.push({
      kind: "stat",
      key: match.key,
      normalizedKey,
      label: priorityColumn.label,
    });
  });

  const hasLapsSincePitData = present.has("lapscompleted") && present.has("lastpitlap");
  if (hasLapsSincePitData) {
    ordered.push({ kind: "derived", key: "lapsSincePit", label: "Since Pit" });
  }

  const hasStatusText = session.competitors.some((competitor) => hasMeaningfulValue(competitor.statusText || ""));
  if (hasStatusText) {
    ordered.push({ kind: "status", key: "statusText", label: "Status" });
  }

  present.forEach((entry, normalizedKey) => {
    if (usedKeys.has(normalizedKey) || HIDDEN_COLUMN_KEYS.has(normalizedKey)) return;
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

export const RacingEventPanel: React.FC<RacingEventPanelProps> = ({ event, isLoading = false }) => {
  const sessions = useMemo(
    () => (event?.sessions || []).slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [event],
  );

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
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-500">Start</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{formatDateTime(event.date)}</p>
          </div>
        </div>
      </section>

      {sessions.map((session) => {
        const columns = chooseVisibleColumns(session);
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
                    <th className="px-3 py-2 text-left">#</th>
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
                    return (
                      <tr key={`${session.id}-${competitor.competitorId}`} className="border-t border-slate-100 dark:border-slate-800/70">
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
                              <div className="font-semibold text-slate-900 dark:text-white leading-tight">{competitor.name}</div>
                              {competitor.flag && (
                                <img src={competitor.flag} alt="" className="w-4 h-3 object-cover rounded-sm mt-1" />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300 min-w-[180px]">
                          {competitor.teamName || competitor.manufacturer || "-"}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{competitor.vehicleNumber || "-"}</td>
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
          </section>
        );
      })}
    </div>
  );
};
