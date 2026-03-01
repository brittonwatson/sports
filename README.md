<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a4301978-3cd9-4564-a634-3c5217792b29

## Run Locally

**Prerequisites:** Node.js 20+ and npm

1. Use the pinned Node version:
   `nvm use` (or install Node 20 manually if you do not use nvm)
2. Install dependencies:
   `npm install`
3. Create your local env file:
   `cp .env.example .env.local`
4. Edit `.env.local` and set:
   - `VITE_GEMINI_API_KEY=...` (required for AI analysis)
   - `VITE_GOOGLE_CLIENT_ID=...` (optional, for Google Sign-In)
   - `VITE_ENABLE_RUNTIME_SYNC=false` (recommended; keeps API sync off by default)
5. Start the dev server:
   `npm run dev`
6. Open:
   `http://localhost:3000`

## Pre-Push Local Check

Run this before pushing:

`npm run check`

That runs:
- TypeScript type-check (`tsc --noEmit`)
- Production build (`vite build`)

## Internal Database (App-Owned Snapshot)

This app now supports an internal, versioned data snapshot (not per-user cache):

- Files: `public/internal-db/*.json` (one file per league) + `public/internal-db/manifest.json`
- Used first for:
  - Team stats
  - Team schedules
  - League scoreboards (including recent/past scores in snapshot window)
- API is used only as fallback when snapshot data is missing.
- Browser-side nightly sync is disabled by default unless `VITE_ENABLE_RUNTIME_SYNC=true`.
- Historical game data is retained in `gamesHistoryBySport` so ended seasons are preserved.
- Team season stats are built from finished-game boxscores (season totals averaged per game), with standings stats as fallback. Sport-specific normalization now expands composite live stats like `FG`, `Comp/Att`, `3rd down efficiency`, `Penalties`, and possession/time formats before aggregation.
- Sync now also writes:
  - `integritySummary` (coverage/mismatch warnings)
  - `qualityMetrics` (pregame backtest MAE, Brier, log-loss, calibration error)

Refresh the snapshot from ESPN and write it into the app:

`npm run sync:internal-db`

Default sync behavior:
- Pulls monthly ranges around the current month
- Includes historical seasons by default (`fromYear = currentYear - 12`)
- Includes future schedule through next year (`toYear = currentYear + 1`)
- Uses smaller 7-day chunks for high-volume leagues (`NCAAM`, `NCAAW`) to avoid 1000-result caps

Useful options:
- `npm run sync:internal-db -- --sports="NBA,NFL,MLB,NHL,EPL,Bundesliga,La Liga,Ligue 1,Serie A,MLS,UCL,NCAAF,NCAAM,NCAAW,WNBA,F1,INDYCAR,NASCAR,UFC"`
- `npm run sync:internal-db -- --sports=NCAAW,WNBA,UFC,F1,INDYCAR,NASCAR` (resume/continue only specific leagues)
- `npm run sync:internal-db -- --sports=NBA,NFL`
- `npm run sync:internal-db -- --fromYear=2016 --toYear=2027`
- `npm run sync:internal-db -- --daysBack=120 --daysForward=60` (overrides year window)
- `npm run sync:internal-db -- --no-schedules`
- `npm run sync:internal-db -- --no-game-stats` (skip boxscore stat aggregation; faster but less detailed)

Model-quality report from current snapshots:

`npm run report:quality`

Optional filter:

`npm run report:quality -- --sports=NBA,NFL,NCAAF`

After syncing, commit `public/internal-db/` so everyone gets the same internal dataset.
