import React from "react";
import { RacingStandingsPayload, RacingStandingsTable } from "../types";
import { AlertCircle } from "lucide-react";

interface RacingStandingsViewProps {
  standings: RacingStandingsPayload | null;
  isLoading?: boolean;
}

const PRIORITY_KEYS = [
  "championshipPts",
  "points",
  "wins",
  "starts",
  "top5",
  "top10",
  "behind",
  "poles",
  "avgFinish",
];

const chooseColumns = (table: RacingStandingsTable): Array<{ key: string; label: string }> => {
  const present = new Map<string, string>();
  table.entries.forEach((entry) => {
    entry.stats.forEach((stat) => {
      const key = String(stat.key || "").trim();
      const value = String(stat.value || "").trim();
      if (!key || !value || value === "-" || value === "--") return;
      if (!present.has(key)) {
        present.set(key, stat.abbreviation || stat.label || key);
      }
    });
  });

  const ordered: Array<{ key: string; label: string }> = [];
  PRIORITY_KEYS.forEach((key) => {
    const label = present.get(key);
    if (label) ordered.push({ key, label });
  });

  present.forEach((label, key) => {
    if (ordered.some((column) => column.key === key)) return;
    ordered.push({ key, label });
  });

  return ordered.slice(0, 5);
};

export const RacingStandingsView: React.FC<RacingStandingsViewProps> = ({ standings, isLoading = false }) => {
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
        return (
          <section
            key={table.id}
            className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{table.name}</h3>
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
                  {table.entries.map((entry) => (
                    <tr key={`${table.id}-${entry.competitorId}`} className="border-t border-slate-100 dark:border-slate-800/70">
                      <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">{entry.rank}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-[220px]">
                          {entry.logo ? (
                            <img src={entry.logo} alt="" className="w-6 h-6 rounded-full object-cover bg-slate-200 dark:bg-slate-700" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />
                          )}
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white">{entry.name}</div>
                            {(entry.teamName || entry.manufacturer) && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">{entry.teamName || entry.manufacturer}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      {columns.map((column) => (
                        <td key={`${table.id}-${entry.competitorId}-${column.key}`} className="px-3 py-2 text-slate-700 dark:text-slate-300">
                          {entry.stats.find((stat) => stat.key === column.key)?.value || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
};

