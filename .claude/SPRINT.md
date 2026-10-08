# Sprint protocol — autonomous sprint run

This is the orchestrator's rulebook. The **main Claude Code session is the orchestrator** — subagents
cannot spawn subagents, so the orchestrator is never itself a subagent.

Start a run with `/sprint`. Everything below is binding.

---

## 1. Non-negotiable rules

Read these before anything else. They exist to stop the run going sideways while you are asleep.

1. **Scope is frozen at start.** The issue list is written to `.claude/sprint-state.json` in the first
   minute and never grows. Not for a good idea, not for an obvious adjacent fix, not for anything.
2. **New findings become issues, not work.** If any agent finds a bug that is not in the frozen list,
   file a GitHub issue labelled `found-during-sprint` and move on. Do not fix it. Do not schedule it.
   Two exceptions:
   - A regression *caused by this sprint's own change*, which the owning developer fixes as part of
     that issue.
   - The same bug in a sibling spot: same root cause as the issue being fixed, in a file the lane
     owns. The analyst lists these siblings in the work order, and they are fixed and tested as part
     of that issue. A sibling in another lane's files is filed as usual.

   A finding gets its own issue only if a user can run into it in normal use, or if it can lose or
   corrupt data. Everything else, including findings that need hand-edited or corrupted data, a clock
   change or a crash at one exact moment, and anything about comments, wording or log text, goes into
   one collected issue per sprint, titled `Sprint <n>: small findings`, one checkbox per finding.
3. **Three round trips per issue, then park it.** If an issue has gone developer → tester → developer
   three times without passing, park it: comment on the GitHub issue explaining exactly where it
   stalled, mark it `parked` in state, move to the next. Never a fourth attempt.
4. **Nothing merges to `main`.** Everything lands on `sprint/auto-fixes`. The human opens the PR from
   there to `main` after review. No agent is permitted to merge to `main` under any circumstance.
5. **A red gate is a stop, not a suggestion.** `npm run typecheck` and `npm test -- --maxWorkers=2` must both exit 0
   before anything merges to the integration branch. No exceptions, no "it was already failing".
   The worker cap is part of the gate, not a speed tweak: jest workers crash under default parallelism
   on Linux, and CI runs with the same cap. The cap is permanent (#377).
6. **Never edit an existing migration.** Append-only, integer-versioned. This rule has no exceptions
   and breaking it corrupts live databases. The `//` comments above a migration aren't part of it and
   may be corrected.
7. **Stay in your lane.** Each lane owns its files exclusively (see §3). A developer who needs to
   touch a file outside its lane stops and reports to the orchestrator instead of editing it.

---

## 2. The pipeline

Per issue:

```
orchestrator → analyst → developer → tester → security → orchestrator → merge to integration
                             ↑___________|________|
                              (max 3 round trips total)
```

| Stage | Agent | Gate to pass |
|---|---|---|
| Understand | `analyst` | Acceptance criteria are concrete and testable. Ambiguity resolved or issue parked. |
| Implement | `developer` | typecheck + test green, regression or feature tests written, commits are small and atomic |
| Verify | `tester` | The new tests genuinely fail on the commit before the change and pass after. Acceptance criteria met. |
| Review | `security` | No new injection surface, no unvalidated external input reaching SQL or the filesystem, no swallowed errors on a data-writing path |
| Land | orchestrator | Merge branch into `sprint/auto-fixes`, resolve conflicts via `conflict` agent if needed |

`security` runs on every issue that touches `src/db/`, `src/services/backup.ts`, `src/api/`, or any
path that reads external input. For pure UI issues it can be skipped — the orchestrator decides and
records the decision in state.

The `cleanup` agent runs **once at the end of each lane**, not per issue.

**After the run, two stages gate the PR to `main`.** Both are formal stages, and neither can be skipped:

- **Cold review.** A fresh Claude Code session, with none of the sprint's context, reviews the whole
  `main...sprint/auto-fixes` diff (`/code-review` on the branch). The orchestrator and its agents
  have seen every rationale. A cold reader only has the code, and that is the point.
- **Device test.** A human runs every issue's **Device check** from its work order on the phone, in
  Expo Go via the QR code, from the integration branch, **before the PR is opened**. A device check
  never needs edited code, a preview build or a notification. What only those could show is covered
  by tests, and the report names it. Jest and CI cannot see a native crash. The SDK 57
  expo-notifications crash was invisible to both.

The orchestrator does neither. It lists both as outstanding in the report.

---

## 3. Lanes — this is how conflicts are prevented, not resolved

Most of the scope touches `src/db/database.ts` or one of the big screens. Running those issues as
parallel worktrees guarantees conflicts on every merge. So issues are grouped into lanes by file
ownership, lanes run in parallel, and **issues within a lane run serially on one branch**.

This table is sprint 5's scope. `/sprint` freezes exactly the issues in the Issues column that are
still open. Sprints 1 to 4 were bug sprints and are done. Their lanes are in git history.

| Lane | Branch | Owns | Issues, in order |
|---|---|---|---|
| A — training | `sprint/lane-a-training` | `src/db/schema.ts`, `src/screens/DashboardScreen.tsx`, `src/screens/AnalyticsDashboardScreen.tsx`, `src/screens/analyticsHelpers.ts`, and in `database.ts` the `workout_set_log` functions | #344, #337, #342 |
| B — meals | `sprint/lane-b-meals` | `src/screens/{MealPrep,ShoppingList}Screen.tsx`, a new aisle lookup under `src/data/`, and in `database.ts` the shopping-list, meal-plan, inventory and `cook_log` functions | #444, #347, #348 |
| C — data | `sprint/lane-c-data` | `src/services/backup.ts`, a new `src/services/csvExport.ts`, `src/screens/SettingsScreen.tsx`, `App.tsx`, and new read functions in `database.ts` for the CSV export | #338, #339 |
| D — recipes | `sprint/lane-d-recipes` | `src/api/**`, `src/nutrition/**`, `src/screens/{Recipes,RecipeEditor,RecipeDetail,Discover,DiscoverDetail}Screen.tsx`, the route params in `src/navigation/AppNavigator.tsx`, and in `database.ts` the recipe and `off_cache` functions | #442, #443, #352 |

Each lane also owns the tests for what it changes and any new file it creates.

**Features.** Sprint 5 is the first feature sprint. #444, #442 and #443 are bugs in files these lanes
own anyway.

- For a feature, the pipeline's regression test means the feature's tests. They must fail on the lane
  commit before the feature code, because the behaviour is missing and not just an import, and pass
  after.
- The decision comment is the whole scope. What the issue leaves for later is not built. If something
  beyond the decision looks necessary, the analyst says so in the work order and the orchestrator
  files it.
- UI wording and small layout choices the decision doesn't make are the analyst's picks. The work
  order lists them, and the report repeats them in §6.
- New UI uses the Verdure tokens and the existing components in `src/components/`.

**Ordering constraints** — these are real dependencies, not preferences:

- Lanes A, B and D start right away. Lane C starts after lane A has merged into the integration
  branch, because #339 exports #344's set type.
- Lane A: #344 first, because #337's "last time" line leaves warm-ups out. #342 last.
- Lane B: #444 first.
- Lane D: #442 and #443 before #352.
- Only lane A adds a migration: v39 for #344. No other lane touches `schema.ts`.
- In `database.ts`, a lane puts new functions next to the functions it owns, never at the end of the
  file.
- Lane B may use `src/nutrition/units.ts` but not change it.
- No lane changes `package.json`, `package-lock.json` or `app.json`. A developer who thinks it needs
  a new package stops and reports.

**Cross-lane dependencies** are the orchestrator's problem. A developer who finds that its issue needs
a file another lane owns stops and reports, as rule 7 says.

**Decisions.** Every issue in the table has a decision comment, and the latest one is binding. #348 is
adapted to this app's Lunch and Dinner slots, and its quick add moved to #447.

### Excluded from this sprint

- **Sprint 6:** #349 (barcode scanning) and #392 (muscle map) add native packages. #346 (weekly
  review) and #351 (adaptive TDEE) build on #342, and #447 (quick add) changes the daily totals they
  read.
- **Sprint 7:** #350 (dark mode), on its own, because it touches every screen.
- **#353 and #355** need a development build, and the phone checks run in Expo Go.
- **#396, #441 and #445** are not part of the feature sprints.

---

## 4. State file

`.claude/sprint-state.json` is the orchestrator's memory. **Write to it after every state change.**
An 8-hour run will outlive any single context window — this file is what lets a fresh session pick
up exactly where the last one stopped.

```json
{
  "startedAt": "2026-09-18T22:00:00Z",
  "integrationBranch": "sprint/auto-fixes",
  "baseSha": "b5791a5",
  "frozenScope": [300, 301, 302, "..."],
  "budget": { "maxRoundTripsPerIssue": 3, "maxParkedBeforeAbort": 8 },
  "lanes": {
    "A": { "branch": "sprint/lane-a-db", "status": "in_progress", "current": 302, "done": [300, 301, 305], "parked": [] }
  },
  "issues": {
    "302": {
      "lane": "A", "status": "in_test", "roundTrips": 1, "branch": "sprint/lane-a-db",
      "commits": ["a1b2c3d"], "deviceCheck": "none",
      "notes": "tester rejected: credit path still asymmetric for exhausted batch"
    }
  },
  "foundDuringSprint": [358, 359],
  "log": [{ "at": "...", "event": "merged lane A into integration", "sha": "..." }]
}
```

Statuses: `pending` · `analysing` · `in_dev` · `in_test` · `in_security` · `ready` · `merged` ·
`parked` · `blocked`.

**On resume:** read this file first, reconcile against `git log` and the GitHub issues, and continue.
Never restart a lane that is already `in_progress` — pick up its current issue.

---

## 5. Abort conditions

Stop the whole run, write the report, and wait for a human if any of these hit:

- More than 8 issues parked — something systemic is wrong, not eight unrelated things
- The integration branch fails typecheck or tests after a merge and the `conflict` agent cannot fix it
  in one attempt
- Any agent reports it cannot run `npm test` at all — an environment failure is not something to work
  around at 3am
- A migration file was modified rather than appended
- Any attempt to push to `main`

Aborting is a good outcome. A run that stops with 12 issues done and a clear report beats a run that
pushes 30 half-verified changes.

---

## 6. Final report

Write `SPRINT_REPORT.md` to the repo root when the run ends — completed, aborted, or out of work.

Required sections:

1. **Outcome** — one paragraph. What landed, what did not, whether the integration branch is green.
2. **Merged** — table: issue, title, branch, commits, what the regression or feature tests assert.
3. **Parked** — table: issue, how far it got, exactly why it stalled, what a human needs to decide.
   This is the most useful section. Be specific — "tester rejected twice because the fix changes
   `date_cooked` semantics and the issue does not say whether that is acceptable" is useful, "failed"
   is not.
4. **Found during sprint** — new issues filed, with a one-line note on each and an explicit statement
   that none were worked.
5. **Integration branch state** — SHA, typecheck result, test result, test count before and after,
   and the exact command to open the PR to `main`.
6. **What I would not merge without reading** — the orchestrator's own judgement on which diffs
   deserve close human attention and why. Do not be diplomatic here.
7. **Before the PR** — a checklist of the device checks, one per issue that has one, copied from the
   work orders, plus the cold-review step. Both are unticked. The human ticks them.

---

## 7. Commit and PR conventions

Inherited from `CLAUDE.md`, restated because agents will get this wrong otherwise:

- Conventional Commits: `fix(db): stop pruning daily_log history (#300)`
- **Small, individually revertable commits.** One logical change each. A commit that does three things
  is a defect in itself — it cannot be reverted cleanly when one of the three turns out wrong.
- Every commit references its issue number
- Merge into the integration branch with a **regular merge commit, never squash** — preserving the
  individual commits is the whole point of committing in small steps
- PR bodies end with `Closes #<issue>`
- Comments only where the code can't explain itself. No issue numbers, no history of how the code got
  here, no explanation of why a line exists, that goes in the commit message. In lines you touch
  anyway, trim existing comments to the same standard.
- Use plain `git` for branches, commits, pushes. Use the **GitHub MCP** for issues, PRs, comments.
  Never the `gh` CLI.

---

## 8. Lessons that are now rules

Each of these cost a sprint or a release once.

- **Commit identity is checked in preflight.** `git config user.email` must be an address verified
  on the GitHub account, normally `41645782+NevinJulian@users.noreply.github.com`. Anything else
  lands a night of commits that GitHub does not attribute.
- **After any Expo SDK or native dependency change, open the app in Expo Go before the PR.** The
  expo-notifications crash on SDK 57 was invisible to jest and to CI.
- **A CI fix goes into every workflow with the same step.** `test.yml`, `build-check.yml` and
  `release.yml` share steps. #385–#387 fixed only `release.yml`, and `build-check.yml` failed on the
  same `tools` package the next time it ran. After changing one workflow, grep the others.
- **Run git from Windows against this checkout.** Until #334's `.gitattributes` is on `main`, a
  Linux or WSL shell sees every CRLF working-tree file as modified. That is where the old "52,000
  lines of churn" came from. Never commit a "line ending fix".
- **Run `npx expo install --check` with network.** Offline, it silently skips the version lookups.
  That is how the Jest 30 / SDK 57 mismatch (#390) got through.
