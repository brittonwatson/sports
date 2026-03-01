import React from "react";
import { RacingDriverSeasonResults } from "../types";
import { Loader2, X } from "lucide-react";

interface RacingDriverSeasonPanelProps {
  data: RacingDriverSeasonResults | null;
  isLoading?: boolean;
  onClose: () => void;
}

const formatDate = (value: string): string => {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const statusClass = (status: string): string => {
  const normalized = String(status).toLowerCase();
  if (normalized.includes("final") || normalized.includes("finished")) return "text-emerald-300 bg-emerald-500/20 border-emerald-400/40";
  if (normalized.includes("progress") || normalized.includes("green") || normalized.includes("caution") || normalized.includes("red")) return "text-amber-300 bg-amber-500/20 border-amber-400/40";
  return "text-slate-300 bg-slate-700/40 border-slate-600";
};

export const RacingDriverSeasonPanel: React.FC<RacingDriverSeasonPanelProps> = ({
  data,
  isLoading = false,
  onClose,
}) => {
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Driver Season Results</h3>
          {data && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {data.driverName} • {data.sport} {data.seasonYear}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          aria-label="Close driver panel"
        >
          <X size={14} />
        </button>
      </div>

      {isLoading ? (
        <div className="p-10 text-center">
          <Loader2 size={22} className="mx-auto animate-spin text-slate-500 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading driver season results...</p>
        </div>
      ) : !data ? (
        <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Driver season details are unavailable.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Points</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">{data.points}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Starts</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">{data.starts}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Wins</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">{data.wins}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Podiums</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">{data.podiums}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Top 5</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">{data.top5}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Top 10</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">{data.top10}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Avg Finish</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">{data.avgFinish > 0 ? data.avgFinish.toFixed(2) : '-'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Points Src</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 uppercase">{data.pointsSource}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/70 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Event</th>
                  <th className="px-3 py-2 text-left">Start</th>
                  <th className="px-3 py-2 text-left">Finish</th>
                  <th className="px-3 py-2 text-left">Pts</th>
                  <th className="px-3 py-2 text-left">Gain</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((result) => (
                  <tr key={`${result.eventId}-${result.date}`} className="border-t border-slate-100 dark:border-slate-800/70">
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{formatDate(result.date)}</td>
                    <td className="px-3 py-2 min-w-[220px]">
                      <div className="font-semibold text-slate-900 dark:text-white">{result.shortName || result.eventName}</div>
                      {(result.teamName || result.manufacturer) && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{result.teamName || result.manufacturer}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{result.startPosition || '-'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{result.finishPosition || '-'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{result.points ?? '-'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                      {result.positionGain === undefined ? '-' : result.positionGain > 0 ? `+${result.positionGain}` : String(result.positionGain)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] uppercase tracking-wider border px-2 py-0.5 rounded-full ${statusClass(result.statusText)}`}>
                        {result.statusText}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
