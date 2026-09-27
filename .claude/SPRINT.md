# Sprint protocol — autonomous issue-fixing run

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
   The one exception: a regression *caused by this sprint's own change*, which the owning developer
   fixes as part of that issue.
3. **Three round trips per issue, then park it.** If an issue has gone developer → tester → developer
   three times without passing, park it: comment on the GitHub issue explaining exactly where it
   stalled, mark it `parked` in state, move to the next. Never a fourth attempt.
4. **Nothing merges to `main`.** Everything lands on `sprint/auto-fixes`. The human opens the PR from
   there to `main` after review. No agent is permitted to merge to `main` under any circumstance.
5. **A red gate is a stop, not a suggestion.** `npm run typecheck` and `npm test -- --maxWorkers=2` must both exit 0
   before anything merges to the integration branch. No exceptions, no "it was already failing".
   The worker cap is part of the gate, not a speed tweak: the sql.js WASM suites crash under default
   jest parallelism on Linux (#377), and CI runs with the same cap. Drop it only when #377 is fixed.
6. **Never edit an existing migration.** Append-only, integer-versioned. This rule has no exceptions
   and breaking it corrupts live databases.
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
| Implement | `developer` | typecheck + test green, regression test written, commits are small and atomic |
| Verify | `tester` | Regression test genuinely fails on the pre-fix commit and passes after. Acceptance criteria met. |
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
- **Device test.** A human runs every issue's **Device check** from its work order on the phone,
  from the integration branch, **before the PR is opened**. Jest and CI cannot see a native crash.
  The SDK 57 expo-notifications crash was invisible to both.

The orchestrator does neither. It lists both as outstanding in the report.

---

## 3. Lanes — this is how conflicts are prevented, not resolved

Most of the scope touches `src/db/database.ts`. Running those issues as parallel worktrees
guarantees conflicts on every merge. So issues are grouped into lanes by file ownership, lanes run in
parallel, and **issues within a lane run serially on one branch**.

This table is sprint 2's scope. `/sprint` freezes exactly the issues in the Issues column that are
still open. Sprint 1 (#300–#336) is done. Its lanes are in git history.

| Lane | Branch | Owns | Issues, in order |
|---|---|---|---|
| A — db core | `sprint/lane-a-db` | `src/db/**` except `src/db/testHelpers/**`, `src/services/backup.ts` | #314, #316, #315, #363, #378, #380, #368, #370, #371, #381, #379, #382, #383, #372, #373, #367, #362 |
| B — notifications | `sprint/lane-b-notify` | `src/services/notifications.ts` | #311, #361 |
| C — analytics screen | `sprint/lane-c-analytics` | `src/screens/AnalyticsDashboardScreen.tsx`, `src/screens/analyticsHelpers.ts` | #328 |
| D — other screens | `sprint/lane-d-screens` | `src/screens/{Settings,MealPrep,Dashboard,Onboarding}Screen.tsx` | #375, #366, #365, #364 |
| E — network | `sprint/lane-e-api` | `src/api/**` | #318 |
| F — repo hygiene | `sprint/lane-f-repo` | root config, docs | #374 |
| G — tests | `sprint/lane-g-tests` | `src/db/testHelpers/**`, `jest.config.js`, `.github/workflows/test.yml` | #377 |

`backup.ts` moved from lane B to lane A for this sprint, because #315's fix spans
`restoreFromPayload` (`database.ts`) and `validatePayload` (`backup.ts`).

**Partials.** Sprint 1 landed part of #311, #314, #315 and #318. The analyst reads the issue's latest
comments and the code on `main`, and scopes the work order to what is still open. It does not redo
what already landed.

**Ordering constraints inside lanes** — these are real dependencies, not preferences:

- Lane A: #314 first. Migrations must be atomic before this sprint appends any new ones, and #316 and
  #380 may need one each.
- Lane A: #315 before #363 and #378. Restore validation is where a garbled `app_start_date` gets in,
  and #363 points there for the sturdier fix. Take #363 and #378 back to back. If #363's fix also
  closes #378, the tester says so and #378 is closed as done by #363's commit, not re-implemented.
- Lane G: #377 last overall. It changes the sql.js adapter every db suite runs on. After it lands, the
  whole suite must pass at default parallelism and at `--maxWorkers=3`.

**Cross-lane dependencies** are the orchestrator's problem. Lane G waits for everything. If #377
removes the worker cap, update the gate in §1 rule 5 in the same lane.

**Decisions a human should make before the run**, or the analyst parks the issue:

- #316: when a recipe still has inventory and cook-log rows, is deleting it blocked, confirmed or
  cascaded?
- #363: what `app_start_date` falls back to when the stored value is invalid.

### Excluded from this sprint

- **#360** — PR #394, landed by hand.
- **#334 (`.gitattributes`)** — PR #393, landed by hand. Before it's merged, no agent touches line
  endings.
- **#392 and every other feature request.** Features run one at a time, outside the sprint.

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
2. **Merged** — table: issue, title, branch, commits, what the regression test asserts.
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
