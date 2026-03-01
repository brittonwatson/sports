import React from "react";
import { RacingStandingsPayload, RacingStandingsTable, Sport } from "../types";
import { AlertCircle } from "lucide-react";

interface RacingStandingsViewProps {
  sport: Sport;
  standings: RacingStandingsPayload | null;
  isLoading?: boolean;
  selectedDriverId?: string | null;
  onDriverClick?: (sport: Sport, driverId: string, driverName: string) => void;
}

const PRIORITY_KEYS = [
  "rank",
  "championshipPts",
  "points",
  "championshipProbability",
  "wins",
  "podiums",
  "starts",
  "top5",
  "top10",
  "behind",
  "poles",
  "avgFinish",
  "lastFinish",
];

const chooseColumns = (table: RacingStandingsTable): Array<{ key: string; label: string }> => {
  const present = new Map<string, string>();
  table.entries.forEach((entry) => {
    entry.stats.forEach((stat) => {
      const key = String(stat.key || "").trim();
      const normalized = key.toLowerCase();
      const value = String(stat.value || "").trim();
      if (!key || !value || value === "-" || value === "--") return;
      if (!present.has(normalized)) {
        present.set(normalized, stat.abbreviation || stat.label || key);
      }
    });
  });

  const ordered: Array<{ key: string; label: string }> = [];
  PRIORITY_KEYS.forEach((key) => {
    const label = present.get(key.toLowerCase());
    if (label) ordered.push({ key: key.toLowerCase(), label });
  });

  present.forEach((label, key) => {
    if (ordered.some((column) => column.key === key)) return;
    ordered.push({ key, label });
  });

  return ordered.slice(0, 7);
};

const getStatValue = (entry: RacingStandingsTable["entries"][number], key: string): string => {
  return entry.stats.find((stat) => String(stat.key || "").toLowerCase() === key.toLowerCase())?.value || "-";
};

export const RacingStandingsView: React.FC<RacingStandingsViewProps> = ({
  sport,
  standings,
  isLoading = false,
  selectedDriverId,
  onDriverClick,
}) => {
  if (isLoading) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500 dark:text-slate-400">
        Loading racing standings...
      </div>
    );
  }

  if (!standings || standings.tables.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500 dark:text-slate-400">
        Standings are not available yet for this series.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {standings.note && (
        <div className="rounded-2xl border border-amber-300/60 dark:border-amber-600/40 bg-amber-50/80 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{standings.note}</span>
        </div>
      )}

      {standings.tables.map((table) => {
        const columns = chooseColumns(table);
        const isDriverTable = table.category === "driver";

        return (
          <section
            key={table.id}
            className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{table.name}</h3>
              {table.id === "model-series-points" && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                  Model Scoring
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/70 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-3 py-2 text-left">Rank</th>
                    <th className="px-3 py-2 text-left">Competitor</th>
                    {columns.map((column) => (
                      <th key={`${table.id}-${column.key}`} className="px-3 py-2 text-left">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.entries.map((entry) => {
                    const isSelectedDriver = Boolean(selectedDriverId && String(entry.competitorId) === String(selectedDriverId));
                    const clickableDriver = isDriverTable && Boolean(onDriverClick);
                    return (
                      <tr
                        key={`${table.id}-${entry.competitorId}`}
                        className={`border-t border-slate-100 dark:border-slate-800/70 ${isSelectedDriver ? "bg-cyan-50/80 dark:bg-cyan-950/20" : ""}`}
                      >
                        <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">{entry.rank}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-[220px]">
                            {entry.logo ? (
                              <img src={entry.logo} alt="" className="w-6 h-6 rounded-full object-cover bg-slate-200 dark:bg-slate-700" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />
                            )}
                            <div>
                              {clickableDriver ? (
                                <button
                                  type="button"
                                  onClick={() => onDriverClick?.(sport, String(entry.competitorId), entry.name)}
                                  className="font-semibold text-left text-cyan-700 dark:text-cyan-300 hover:underline inline-flex items-center gap-1.5"
                                >
                                  <span>{entry.name}</span>
                                  {entry.vehicleNumber && <span className="text-xs font-bold text-slate-600 dark:text-slate-300">#{entry.vehicleNumber}</span>}
                                </button>
                              ) : (
                                <div className="font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                                  <span>{entry.name}</span>
                                  {entry.vehicleNumber && <span className="text-xs font-bold text-slate-600 dark:text-slate-300">#{entry.vehicleNumber}</span>}
                                </div>
                              )}
                              {(entry.teamName || entry.manufacturer) && (
                                <div className="text-xs text-slate-500 dark:text-slate-400">{entry.teamName || entry.manufacturer}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        {columns.map((column) => (
                          <td key={`${table.id}-${entry.competitorId}-${column.key}`} className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {getStatValue(entry, column.key)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
};
