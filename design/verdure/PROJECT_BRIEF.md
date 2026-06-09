# HealthTracker — Verdure redesign: project & workflow brief

The single "start here" document for executing the UI overhaul in Claude Code. Read this together with `CLAUDE.md` (repo architecture), `design/verdure/DESIGN.md` (design system), `design/verdure/code.html` (visual board of all 7 screens), and `design/verdure/OVERHAUL_PLAN.md` (detailed unit table).

---

## 1. The project
HealthTracker is an **Expo / React Native** app (SDK 54, RN 0.81, React 19, TypeScript strict, New Architecture on). All data is **on-device in SQLite** via `expo-sqlite` — no backend, no remote API. It's a 90-day health program with these main screens: **Today** (dashboard: walking, gym, fasting, meals, weight), **Recipes** + **Recipe detail**, **Meal plan**, **Cooking tasks**, **Shopping list**, and **Analytics**.

Architecture lives in `CLAUDE.md` — the short version: `src/db/database.ts` is the data-access spine (all queries + shared types), schema/migrations are append-only in `src/db/schema.ts`, navigation is a right-side drawer, and **`src/theme/tokens.ts` is the single source of truth for all colours, spacing, type, and radii** — screens must style through those tokens, never raw hex.

Commands: `npm install --legacy-peer-deps`, `npm run typecheck` (`tsc --noEmit` — the only static check), `npm test` (jest).

## 2. The redesign — "Verdure"
A calm-wellness visual overhaul replacing the old dark fitness UI. Warm linen canvas, **sage** as the lead accent, **clay** for the food side, **sky** blue for rest, **gold** for streaks; soft serif (Fraunces) for display, rounded sans (Plus Jakarta Sans) for UI. Full system in `DESIGN.md`; every screen is mocked in `code.html`.

## 3. GitHub workflow
- **One issue per unit**, titled `Redesign · <unit>`.
- **One branch per unit** off `main`, named `redesign/<unit>` (e.g. `redesign/today`).
- **Granular commits**, Conventional Commits style (`feat(theme):`, `style(today):`, `docs(design):`). Never one giant commit.
- **One PR per unit**, base `main`, body ends with `Closes #<issue>`.
- **Merge straight into `main`** once green (auto-merge on green is approved; pause after Unit 1 for review).
- Everything attributed to **NevinJulian** via the GitHub MCP.
- Keep files **LF** (the repo is LF in git; Windows shows CRLF locally — harmless).

## 4. Agent workflow
Two project subagents in `.claude/agents/` drive each unit:
- **coding** (`coding.md`, Sonnet) — creates the issue + `redesign/<unit>` branch, implements via the theme tokens, commits in small steps, opens the PR. **Never merges.**
- **testing** (`testing.md`, Haiku) — runs `npm run typecheck` + `npm test`, comments the result on the PR, and **merges only if both pass**. Reports failures back for the coding agent to fix.

Loop per unit: `coding` → PR → `testing` → merge (or bounce back) → next unit. Units are sequential — branch each from the updated `main` after the previous merges.

## 5. Verification gate (must pass before merge)
`npm run typecheck` exits 0 **and** `npm test` is all-green. Both are green on `main` today, so any failure is introduced by the change. (A full native/EAS build is out of scope for the gate.)

## 6. Current status
- ✅ Design system + visual board locked (`DESIGN.md`, `code.html`).
- ✅ **Unit 1 already implemented locally:** `src/theme/tokens.ts` is rewritten to the Verdure palette/radii/type slots (all existing token keys preserved → screens recolour automatically). Verified locally: `npm run typecheck` ✅, `npm test` ✅. It just needs committing → PR → merge.
- ✅ Redesign docs + agent files are on disk (this folder + `.claude/agents/`), uncommitted.
- ⬜ Units 2–10 pending.

## 7. Unit roadmap
Full scope/files in `OVERHAUL_PLAN.md`. In order:

1. **theme-tokens** — `src/theme/tokens.ts` (done locally) + the `design/verdure/` board & docs.
2. **fonts** — load Fraunces + Plus Jakarta Sans via `expo-font`; wire `Typography.display`/`body`.
3. **ui-kit** — shared components (Card, Row, IconChip, Pill, ProgressBar, Button, ScreenHeader).
4. **today** — `DashboardScreen.tsx`.
5. **recipes** — `RecipesScreen.tsx`.
6. **recipe-detail** — `RecipeDetailScreen.tsx`.
7. **meal-plan** — `MealPrepScreen.tsx`.
8. **cooking-tasks** — `CookingTasksScreen.tsx`.
9. **shopping-list** — `ShoppingListScreen.tsx`.
10. **analytics** — `AnalyticsDashboardScreen.tsx`.

(Also restyle `OverviewScreen`, `TemplateEditorScreen`, `BioForceModal`, and the drawer/tab bar in `AppNavigator` — fold into the nearest unit or add follow-ups.)

## 8. After the UI — code refactor (separate track)
Once the redesign lands, schedule as its own issues/branches: replace the hardcoded `src/data/recipes.ts` with a real recipe API/source, and clean up the other hardcoded/poorly-implemented functions surfaced during the screen work.

## 9. How to run it
Do one unit at a time with the two agents (Section 4). Start at Unit 1 — since the code is already done and green, it's just commit → PR → merge. Review the first merged PR, then continue unit by unit.
