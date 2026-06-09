# Verdure UI overhaul — execution plan

Handoff plan for executing the calm-wellness ("Verdure") redesign in Claude Code with the GitHub MCP. Pair this with `DESIGN.md` (the design system) and `code.html` (the visual board) in this folder.

## Goal
Replace the old dark fitness UI with the Verdure calm-wellness system across all main screens, shipped as small, reviewable PRs — one (or more) per screen — each attributed to NevinJulian.

## Workflow conventions
- **One issue per unit**, titled `Redesign · <unit>`.
- **One branch per unit**, off `main`, named `redesign/<unit>` (e.g. `redesign/today`).
- **Granular commits** — small, logical, Conventional Commits style (`feat(theme):`, `style(today):`, `docs(design):`). Never one giant commit.
- **One PR per unit**, base `main`, body ends with `Closes #<issue>`.
- **Verification gate (must pass before merge):** `npm run typecheck` (exit 0) **and** `npm test` (jest, all green). Both are green on `main` today, so any failure is introduced by the change.
- **Merge straight into `main`** once green (auto-merge on green was approved). Pause after Unit 1 for review.
- **Line endings:** the repo is LF in git; keep new/edited files LF. (Windows checkouts show CRLF locally — that's just the working copy, harmless.)

## Suggested two-agent split
- **coding agent** — creates the issue + `redesign/<unit>` branch, implements, commits granularly, opens the PR. Does not merge.
- **testing agent** — runs `npm run typecheck` + `npm test`, comments the result on the PR, merges only if both pass.

## Status
- ✅ Design system locked: `design/verdure/DESIGN.md` + `code.html` (board). Already on disk in this repo.
- ✅ **Unit 1 implemented locally:** `src/theme/tokens.ts` is already rewritten to the Verdure palette/radii/type slots (all existing token keys preserved, so screens recolour automatically). Verified: `npm run typecheck` ✅ and `npm test` ✅. It just needs committing → PR → merge.
- ⬜ Units 2–10 pending (below).

## Units

| # | Unit | Branch | Scope / files |
|---|------|--------|---------------|
| 1 | Design tokens | `redesign/theme-tokens` | `src/theme/tokens.ts` (done locally) + add `design/verdure/` board. Keep all token keys; values → Verdure; soften `Radius`; add `display`/`body` type slots + extended colour tokens. |
| 2 | Fonts | `redesign/fonts` | Load Fraunces (display) + Plus Jakarta Sans (body) via `expo-font`; set `Typography.display`/`body`. Adds deps — keep typecheck/jest green. |
| 3 | Shared UI kit | `redesign/ui-kit` | New reusable components in `src/components` (Card, Row, IconChip, Pill, ProgressBar, Button, ScreenHeader) per `DESIGN.md` §5. |
| 4 | Today (Dashboard) | `redesign/today` | `src/screens/DashboardScreen.tsx` — hero day card + ring, focus task rows, today's meals, weight, bottom tabs. |
| 5 | Recipes | `redesign/recipes` | `src/screens/RecipesScreen.tsx` — search, filter chips, recipe card grid. |
| 6 | Recipe detail | `redesign/recipe-detail` | `src/screens/RecipeDetailScreen.tsx` — hero, stat row, ingredients, method, action buttons. |
| 7 | Meal plan | `redesign/meal-plan` | `src/screens/MealPrepScreen.tsx` — day selector, prep-day banner, meal cards, daily total. |
| 8 | Cooking tasks | `redesign/cooking-tasks` | `src/screens/CookingTasksScreen.tsx` — progress, active timer card, task checklist with time chips. |
| 9 | Shopping list | `redesign/shopping-list` | `src/screens/ShoppingListScreen.tsx` — progress, category groups, items with qty + check states. |
| 10 | Analytics | `redesign/analytics` | `src/screens/AnalyticsDashboardScreen.tsx` — metric cards, weight trend, consistency grid, macros. |

> Also restyle `OverviewScreen`, `TemplateEditorScreen`, `BioForceModal`, and `AppNavigator` (tab bar) to match — fold into the relevant unit or add follow-up units.

## After the UI: the code refactor (separate track)
Originally requested alongside the UI work — schedule as its own issues/branches once the redesign lands:
- Replace the hardcoded `src/data/recipes.ts` with a real recipe API/source.
- General refactor of the "very bad / hardcoded" functions surfaced during the screen work.

## Sequencing
Do units in order; each branch is cut from `main` **after** the previous PR merges, so changes stack cleanly. Units 4–10 depend on 1–3 (tokens, fonts, UI kit).
