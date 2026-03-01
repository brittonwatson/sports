import React, { useMemo } from "react";
import { RacingEventBundle, RacingSessionResult } from "../types";
import { Flag, Timer, Trophy } from "lucide-react";

interface RacingEventPanelProps {
  event: RacingEventBundle | null;
  isLoading?: boolean;
}

const PRIORITY_STAT_KEYS = [
  "totalTime",
  "behindTime",
  "fastestLap",
  "lapsCompleted",
  "lapsLead",
  "championshipPts",
  "qual1TimeMS",
  "qual2TimeMS",
  "qual3TimeMS",
  "place",
];

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

const chooseVisibleStatKeys = (session: RacingSessionResult): Array<{ key: string; label: string }> => {
  const present = new Map<string, string>();
  session.competitors.forEach((competitor) => {
    competitor.stats.forEach((stat) => {
      const key = String(stat.key || "").trim();
      const value = String(stat.value || "").trim();
      if (!key || !value || value === "-" || value === "--") return;
      if (!present.has(key)) present.set(key, stat.abbreviation || stat.label || key);
    });
  });

  const ordered: Array<{ key: string; label: string }> = [];
  PRIORITY_STAT_KEYS.forEach((key) => {
    const label = present.get(key);
    if (label) ordered.push({ key, label });
  });

  present.forEach((label, key) => {
    if (ordered.some((item) => item.key === key)) return;
    ordered.push({ key, label });
  });

  return ordered.slice(0, 3);
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
        const statColumns = chooseVisibleStatKeys(session);
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
                    {statColumns.map((column) => (
                      <th key={`${session.id}-${column.key}`} className="px-3 py-2 text-left">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {session.competitors.map((competitor) => {
                    const position = competitor.finishPosition || competitor.startPosition || "-";
                    const bestStat = (key: string) => (
                      competitor.stats.find((item) => item.key === key)?.value || "-"
                    );
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
                        {statColumns.map((column) => (
                          <td key={`${session.id}-${competitor.competitorId}-${column.key}`} className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {bestStat(column.key)}
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

