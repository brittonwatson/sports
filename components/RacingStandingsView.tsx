import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, TrendingUp } from "lucide-react";
import { RacingEventBundle, RacingStandingsEntry, RacingStandingsPayload, RacingStandingsTable, Sport } from "../types";
import { ensureInternalSportLoaded, getInternalRacingEventsMap } from "../services/internalDbService";

interface RacingStandingsViewProps {
  sport: Sport;
  standings: RacingStandingsPayload | null;
  isLoading?: boolean;
  selectedDriverId?: string | null;
  onDriverClick?: (sport: Sport, driverId: string, driverName: string) => void;
  mode?: "standings" | "driver-stats";
}

interface RacingDriverRow {
  rank: number;
  competitorId: string;
  name: string;
  shortName?: string;
  abbreviation?: string;
  logo?: string;
  vehicleNumber?: string;
  teamName?: string;
  manufacturer?: string;
  points?: string;
  gap?: string;
  wins?: string;
  poles?: string;
  podiums?: string;
  top5?: string;
  top10?: string;
  starts?: string;
  avgStart?: string;
  avgQualifying?: string;
  avgFinish?: string;
  qualifyingDelta?: string;
  lastFinish?: string;
  championshipProbability?: string;
}

const STAT_LABELS: Record<string, string> = {
  points: "Pts",
  gap: "Gap",
  wins: "Wins",
  poles: "Poles",
  podiums: "Podiums",
  top5: "Top 5",
  top10: "Top 10",
  starts: "Starts",
  avgStart: "Avg Start",
  avgQualifying: "Avg Qual",
  avgFinish: "Avg Finish",
  qualifyingDelta: "Qual +/-",
  lastFinish: "Last",
  championshipProbability: "Title %",
};

const normalizeKey = (value: string): string => String(value || "").trim().toLowerCase();

const getStatValue = (entry: RacingStandingsEntry | undefined, key: string): string | undefined => {
  if (!entry) return undefined;
  return entry.stats.find((stat) => normalizeKey(stat.key) === normalizeKey(key))?.value;
};

const hasMeaningfulValue = (value: string | undefined): boolean => {
  const normalized = String(value || "").trim();
  return Boolean(normalized) && normalized !== "-" && normalized !== "--";
};

const parseNumeric = (value: string | undefined): number | null => {
  if (!hasMeaningfulValue(value)) return null;
  const normalized = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, "").trim());
  return Number.isFinite(normalized) ? normalized : null;
};

const isQualifyingSession = (name: string): boolean => {
  const normalized = normalizeKey(name);
  if (!normalized) return false;
  if (normalized === "ss" || normalized.includes("shootout")) return false;
  return normalized.includes("qual");
};

const isPracticeSession = (name: string): boolean => {
  const normalized = normalizeKey(name);
  return normalized.includes("practice") || normalized.startsWith("fp") || normalized.includes("warmup");
};

const isSprintSession = (name: string): boolean => {
  const normalized = normalizeKey(name);
  return normalized === "sr" || normalized.includes("sprint");
};

const isPrimaryRaceSession = (session: RacingEventBundle["sessions"][number], sessionCount: number): boolean => {
  const normalized = normalizeKey(session.name);
  if (!normalized) return false;
  if (normalized.includes("race")) return true;
  if (isQualifyingSession(session.name) || isPracticeSession(session.name) || isSprintSession(session.name)) return false;
  return sessionCount === 1;
};

interface DerivedDriverMetricAggregate {
  poles: number;
  qualifyingSum: number;
  qualifyingCount: number;
  startSum: number;
  startCount: number;
  qualifyingDeltaSum: number;
  qualifyingDeltaCount: number;
}

interface DerivedDriverMetrics {
  poles?: string;
  avgStart?: string;
  avgQualifying?: string;
  qualifyingDelta?: string;
}

const getOrCreateAggregate = (
  target: Map<string, DerivedDriverMetricAggregate>,
  competitorId: string,
): DerivedDriverMetricAggregate => {
  const existing = target.get(competitorId);
  if (existing) return existing;

  const created: DerivedDriverMetricAggregate = {
    poles: 0,
    qualifyingSum: 0,
    qualifyingCount: 0,
    startSum: 0,
    startCount: 0,
    qualifyingDeltaSum: 0,
    qualifyingDeltaCount: 0,
  };
  target.set(competitorId, created);
  return created;
};

const formatAverage = (value: number): string => {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(1);
};

const formatSignedAverage = (value: number): string => {
  if (!Number.isFinite(value)) return "-";
  const rounded = value.toFixed(1);
  return value > 0 ? `+${rounded}` : rounded;
};

const getSessionWinnerId = (session: RacingEventBundle["sessions"][number]): string | null => {
  const byWinner = session.competitors.find((competitor) => competitor.winner && competitor.competitorId);
  if (byWinner?.competitorId) return String(byWinner.competitorId);

  const byFinish = session.competitors.find((competitor) => competitor.finishPosition === 1 && competitor.competitorId);
  if (byFinish?.competitorId) return String(byFinish.competitorId);

  return session.competitors[0]?.competitorId ? String(session.competitors[0].competitorId) : null;
};

const buildDerivedDriverMetricMap = (eventMap: Record<string, RacingEventBundle> | null): Map<string, DerivedDriverMetrics> => {
  const aggregates = new Map<string, DerivedDriverMetricAggregate>();
  if (!eventMap) return new Map();

  Object.values(eventMap).forEach((event) => {
    const sessionCount = event.sessions.length;
    const qualifyingSession = event.sessions.find((session) =>
      session.status === "finished" && isQualifyingSession(session.name),
    );
    const raceSession = event.sessions.find((session) =>
      session.status === "finished" && isPrimaryRaceSession(session, sessionCount),
    );

    const qualifyingPositions = new Map<string, number>();

    if (qualifyingSession) {
      qualifyingSession.competitors.forEach((competitor) => {
        if (!competitor.competitorId || competitor.finishPosition === undefined) return;
        const competitorId = String(competitor.competitorId);
        qualifyingPositions.set(competitorId, competitor.finishPosition);
        const aggregate = getOrCreateAggregate(aggregates, competitorId);
        aggregate.qualifyingSum += competitor.finishPosition;
        aggregate.qualifyingCount += 1;
      });

      const winnerId = getSessionWinnerId(qualifyingSession);
      if (winnerId) {
        const aggregate = getOrCreateAggregate(aggregates, winnerId);
        aggregate.poles += 1;
      }
    }

    if (!raceSession) return;

    raceSession.competitors.forEach((competitor) => {
      if (!competitor.competitorId) return;
      const competitorId = String(competitor.competitorId);
      const aggregate = getOrCreateAggregate(aggregates, competitorId);
      const qualifyingPosition = qualifyingPositions.get(competitorId);
      const explicitStart = competitor.startPosition;
      const startPosition = explicitStart ?? qualifyingPosition;

      if (startPosition !== undefined) {
        aggregate.startSum += startPosition;
        aggregate.startCount += 1;
      }

      if (qualifyingPosition !== undefined && competitor.finishPosition !== undefined) {
        aggregate.qualifyingDeltaSum += (qualifyingPosition - competitor.finishPosition);
        aggregate.qualifyingDeltaCount += 1;
      }
    });
  });

  const out = new Map<string, DerivedDriverMetrics>();
  aggregates.forEach((aggregate, competitorId) => {
    out.set(competitorId, {
      poles: aggregate.poles > 0 ? String(aggregate.poles) : undefined,
      avgStart: aggregate.startCount > 0 ? formatAverage(aggregate.startSum / aggregate.startCount) : undefined,
      avgQualifying: aggregate.qualifyingCount > 0 ? formatAverage(aggregate.qualifyingSum / aggregate.qualifyingCount) : undefined,
      qualifyingDelta: aggregate.qualifyingDeltaCount > 0
        ? formatSignedAverage(aggregate.qualifyingDeltaSum / aggregate.qualifyingDeltaCount)
        : undefined,
    });
  });

  return out;
};

const getPrimaryDriverTable = (standings: RacingStandingsPayload): RacingStandingsTable | null => {
  return standings.tables.find((table) => table.id === "model-series-points" && table.category === "driver")
    || standings.tables.find((table) => table.category === "driver")
    || standings.tables.find((table) => table.entries.some((entry) => hasMeaningfulValue(getStatValue(entry, "points"))))
    || null;
};

const buildDriverRows = (table: RacingStandingsTable | null, derivedMetrics: Map<string, DerivedDriverMetrics>): RacingDriverRow[] => {
  if (!table) return [];

  const leaderPoints = parseNumeric(getStatValue(table.entries[0], "points"));

  return table.entries.map((entry, index) => {
    const points = getStatValue(entry, "points");
    const entryPoints = parseNumeric(points);
    const competitorId = String(entry.competitorId || "");
    const metrics = derivedMetrics.get(competitorId);
    const gap = (() => {
      if (index === 0) return "Leader";
      if (leaderPoints === null || entryPoints === null) return undefined;
      const delta = leaderPoints - entryPoints;
      if (!Number.isFinite(delta)) return undefined;
      return delta === 0 ? "Leader" : `-${delta}`;
    })();

    return {
      rank: entry.rank,
      competitorId,
      name: entry.name,
      shortName: entry.shortName,
      abbreviation: entry.abbreviation,
      logo: entry.logo,
      vehicleNumber: entry.vehicleNumber,
      teamName: entry.teamName,
      manufacturer: entry.manufacturer,
      points,
      gap,
      wins: getStatValue(entry, "wins"),
      poles: metrics?.poles,
      podiums: getStatValue(entry, "podiums"),
      top5: getStatValue(entry, "top5"),
      top10: getStatValue(entry, "top10"),
      starts: getStatValue(entry, "starts"),
      avgStart: metrics?.avgStart,
      avgQualifying: metrics?.avgQualifying,
      avgFinish: getStatValue(entry, "avgFinish"),
      qualifyingDelta: metrics?.qualifyingDelta,
      lastFinish: getStatValue(entry, "lastFinish"),
      championshipProbability: getStatValue(entry, "championshipProbability"),
    };
  });
};

const hasVisibleStat = (rows: RacingDriverRow[], key: keyof RacingDriverRow): boolean => {
  if (key === "poles") {
    return rows.some((row) => (parseNumeric(row.poles) || 0) > 0);
  }
  return rows.some((row) => hasMeaningfulValue(String(row[key] || "")));
};

const chooseDriverColumns = (
  sport: Sport,
  rows: RacingDriverRow[],
  mode: "standings" | "driver-stats",
  showProbability: boolean,
): Array<{ key: keyof RacingDriverRow; label: string }> => {
  const preferred = mode === "standings"
    ? ["points", "gap", "wins", "poles", sport === "F1" ? "podiums" : "top5", "top10", "avgFinish", "lastFinish", "championshipProbability"] as Array<keyof RacingDriverRow>
    : ["starts", "points", "wins", "poles", "podiums", "top5", "top10", "avgStart", "avgQualifying", "avgFinish", "qualifyingDelta", "lastFinish"] as Array<keyof RacingDriverRow>;

  return preferred
    .filter((key) => key !== "championshipProbability" || showProbability)
    .filter((key) => {
      if (key === "points") return true;
      if (key === "gap") return mode === "standings";
      if (key === "starts") return mode === "driver-stats";
      if (key === "podiums" && sport !== "F1" && !hasVisibleStat(rows, "podiums")) return false;
      if (key === "top5" && sport === "F1" && mode === "standings") return false;
      return hasVisibleStat(rows, key);
    })
    .map((key) => ({ key, label: STAT_LABELS[String(key)] || String(key) }));
};

const getConstructorTables = (standings: RacingStandingsPayload): RacingStandingsTable[] => {
  return standings.tables.filter((table) =>
    (table.category === "constructor" || table.category === "team")
    && table.entries.length > 0,
  );
};

const renderCompetitorCell = (
  row: Pick<RacingDriverRow, "logo" | "name" | "vehicleNumber" | "teamName" | "manufacturer" | "competitorId">,
  sport: Sport,
  clickable: boolean,
  onDriverClick?: (sport: Sport, driverId: string, driverName: string) => void,
) => (
  <div className="flex items-center gap-2 min-w-[220px]">
    {row.logo ? (
      <img src={row.logo} alt="" className="w-6 h-6 rounded-full object-cover bg-slate-200 dark:bg-slate-700" />
    ) : (
      <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />
    )}
    <div>
      {clickable ? (
        <button
          type="button"
          onClick={() => onDriverClick?.(sport, row.competitorId, row.name)}
          className="font-semibold text-left text-cyan-700 dark:text-cyan-300 hover:underline inline-flex items-center gap-1.5"
        >
          <span>{row.name}</span>
          {row.vehicleNumber && <span className="text-xs font-bold text-slate-600 dark:text-slate-300">#{row.vehicleNumber}</span>}
        </button>
      ) : (
        <div className="font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
          <span>{row.name}</span>
          {row.vehicleNumber && <span className="text-xs font-bold text-slate-600 dark:text-slate-300">#{row.vehicleNumber}</span>}
        </div>
      )}
      {(row.teamName || row.manufacturer) && (
        <div className="text-xs text-slate-500 dark:text-slate-400">{row.teamName || row.manufacturer}</div>
      )}
    </div>
  </div>
);

export const RacingStandingsView: React.FC<RacingStandingsViewProps> = ({
  sport,
  standings,
  isLoading = false,
  selectedDriverId,
  onDriverClick,
  mode,
}) => {
  const currentMode = (mode ?? "standings") as "standings" | "driver-stats";
  const [showProbability, setShowProbability] = useState(false);
  const [eventMap, setEventMap] = useState<Record<string, RacingEventBundle> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadRacingContext = async () => {
      await ensureInternalSportLoaded(sport);
      if (cancelled) return;
      setEventMap(getInternalRacingEventsMap(sport));
    };

    loadRacingContext();
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const derivedMetrics = useMemo(() => buildDerivedDriverMetricMap(eventMap), [eventMap]);
  const driverTable = useMemo(() => (standings ? getPrimaryDriverTable(standings) : null), [standings]);
  const driverRows = useMemo(() => buildDriverRows(driverTable, derivedMetrics), [driverTable, derivedMetrics]);
  const constructorTables = useMemo(() => (standings ? getConstructorTables(standings) : []), [standings]);
  const hasProbability = useMemo(
    () => driverRows.some((row) => hasMeaningfulValue(row.championshipProbability)),
    [driverRows],
  );
  const driverColumns = useMemo(
    () => chooseDriverColumns(sport, driverRows, currentMode, showProbability),
    [sport, driverRows, currentMode, showProbability],
  );

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500 dark:text-slate-400">
        Loading racing standings...
      </div>
    );
  }

  if (!standings || standings.tables.length === 0 || (currentMode === "driver-stats" && driverRows.length === 0)) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500 dark:text-slate-400">
        {currentMode === "driver-stats" ? "Driver stats are not available yet for this series." : "Standings are not available yet for this series."}
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

      {currentMode === "standings" && hasProbability && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowProbability((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border transition-all ${
              showProbability
                ? "border-purple-400/60 bg-purple-500/15 text-purple-700 dark:text-purple-300"
                : "border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <TrendingUp size={12} />
            Title %
          </button>
        </div>
      )}

      {driverRows.length > 0 && (
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                {currentMode === "driver-stats" ? "Driver Stats" : "Driver Championship"}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {currentMode === "driver-stats"
                  ? "Season-long driver metrics only. Avg Start, Avg Qual, and Qual +/- show when qualifying/grid data exists in the feed."
                  : "Championship order with racing-specific stats such as wins, poles, top 10s, and average finish."}
              </p>
            </div>
            {driverTable?.id === "model-series-points" && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                Racing Metrics
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/70 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Rank</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  {driverColumns.map((column) => (
                    <th key={`driver-${String(column.key)}`} className="px-3 py-2 text-left">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {driverRows.map((row) => {
                  const isSelectedDriver = Boolean(selectedDriverId && row.competitorId === String(selectedDriverId));
                  return (
                    <tr
                      key={`driver-${row.competitorId}`}
                      className={`border-t border-slate-100 dark:border-slate-800/70 ${isSelectedDriver ? "bg-cyan-50/80 dark:bg-cyan-950/20" : ""}`}
                    >
                      <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">{row.rank}</td>
                      <td className="px-3 py-2">
                        {renderCompetitorCell(row, sport, Boolean(onDriverClick), onDriverClick)}
                      </td>
                      {driverColumns.map((column) => (
                        <td key={`driver-${row.competitorId}-${String(column.key)}`} className="px-3 py-2 text-slate-700 dark:text-slate-300">
                          {String(row[column.key] ?? "-")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {currentMode === "standings" && constructorTables.map((table) => (
        <section
          key={table.id}
          className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              {table.name.toLowerCase().includes("constructor") ? table.name : "Constructor Championship"}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/70 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Rank</th>
                  <th className="px-3 py-2 text-left">Constructor</th>
                  <th className="px-3 py-2 text-left">Pts</th>
                </tr>
              </thead>
              <tbody>
                {table.entries.map((entry) => (
                  <tr key={`${table.id}-${entry.competitorId}`} className="border-t border-slate-100 dark:border-slate-800/70">
                    <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">{entry.rank}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900 dark:text-white">{entry.name}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{getStatValue(entry, "points") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};
