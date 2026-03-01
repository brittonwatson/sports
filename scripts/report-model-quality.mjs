#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const internalDbDir = path.join(repoRoot, "public", "internal-db");

const parseArgs = (argv) => {
  const out = { sports: null };
  argv.forEach((arg) => {
    if (arg.startsWith("--sports=")) {
      out.sports = arg
        .slice("--sports=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  });
  return out;
};

const formatNumber = (value, digits = 3) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits);
};

const readSnapshot = async (sport) => {
  const fileName = `${sport.replace(/\s+/g, "_")}.json`;
  const fullPath = path.join(internalDbDir, fileName);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(internalDbDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const allSports = Object.keys(manifest.sports || {});
  const sports = args.sports && args.sports.length > 0
    ? allSports.filter((sport) => args.sports.includes(sport))
    : allSports;

  if (sports.length === 0) {
    console.log("[report-model-quality] No sports selected.");
    return;
  }

  console.log("[report-model-quality] Model quality and integrity summary");
  console.log("sport | season | evalGames | brier | logLoss | calErr | maeTotal | warnings | critical");
  console.log("----- | ------ | --------- | ----- | ------- | ------ | -------- | -------- | --------");

  for (const sport of sports) {
    try {
      const snapshot = await readSnapshot(sport);
      const quality = snapshot.qualityMetrics || {};
      const integrity = snapshot.integritySummary || {};
      const seasonYear = snapshot.statsSeasonYear || quality.seasonYear || integrity.seasonYear || "-";
      const warnings = integrity?.severityCounts?.warning ?? 0;
      const critical = integrity?.severityCounts?.critical ?? 0;

      console.log(
        `${sport} | ${seasonYear} | ${quality.evaluatedGames ?? 0} | ${formatNumber(quality.brier, 5)} | ${formatNumber(quality.logLoss, 5)} | ${formatNumber(quality.calibrationError, 5)} | ${formatNumber(quality.maeTotal, 3)} | ${warnings} | ${critical}`,
      );
    } catch (err) {
      console.log(`${sport} | - | - | - | - | - | - | - | -`);
      console.warn(`[report-model-quality] Failed to read ${sport}:`, err?.message || err);
    }
  }
};

main().catch((err) => {
  console.error("[report-model-quality] fatal:", err);
  process.exit(1);
});

