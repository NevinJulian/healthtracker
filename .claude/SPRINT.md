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
5. **A red gate is a stop, not a suggestion.** `npm run typecheck` and `npm test` must both exit 0
   before anything merges to the integration branch. No exceptions, no "it was already failing".
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

---

## 3. Lanes — this is how conflicts are prevented, not resolved

Most of #300–#336 touch `src/db/database.ts`. Running them as parallel worktrees guarantees
conflicts on every merge. So issues are grouped into lanes by file ownership, lanes run in parallel,
and **issues within a lane run serially on one branch**.

| Lane | Branch | Owns | Issues |
|---|---|---|---|
| A — db core | `sprint/lane-a-db` | `src/db/**` | #300, #301, #305, #302, #303, #319, #320, #321, #314, #315, #316, #306, #307, #331 |
| B — notifications | `sprint/lane-b-notify` | `src/services/notifications.ts`, `src/services/backup.ts` | #309, #310, #311 |
| C — analytics screen | `sprint/lane-c-analytics` | `src/screens/AnalyticsDashboardScreen.tsx`, `src/screens/analyticsHelpers.ts` | #308, #312, #327, #328 |
| D — other screens | `sprint/lane-d-screens` | `src/screens/{Settings,MealPrep,Dashboard}Screen.tsx` | #313, #322, #323, #324, #325, #326, #329, #330, #304, #317 |
| E — network | `sprint/lane-e-api` | `src/api/**` | #318 |
| F — repo hygiene | `sprint/lane-f-repo` | root config, docs | #332, #333, #335 |
| G — tests | `sprint/lane-g-tests` | `src/**/__tests__/**`, `jest.config.js` | #336 |

**Ordering constraints inside lanes** — these are real dependencies, not preferences:

- Lane A: #300 and #301 first. Everything else in the lane assumes history survives.
- Lane A: #305 before #302/#303. Upserts must work before inventory maths is trusted.
- Lane B: #309 first. It unblocks #310 and #311 and makes both far smaller.
- Lane D: #304 last. It depends on lane A's writers being correct, so it merges after lane A lands.
- Lane G: #336 last overall. It writes regression tests for the other lanes' work.

**Cross-lane dependencies** are the orchestrator's problem. Lane D waits for lane A to merge into
`sprint/auto-fixes` before starting #304 and #317. Lane G waits for everything.

### Excluded from this sprint

- **#334 (`.gitattributes`)** — renormalises 52k lines. Merged alongside anything else it makes every
  diff unreviewable and conflicts with every open branch. It lands alone, by hand, when nothing is in
  flight. Do not touch it.
- **#327 memoisation** — only the measurable parts. Do not speculatively memoise. If the agent cannot
  demonstrate an improvement, it reports that and the issue is parked rather than churned.
- Everything #337 and above. Features are out of scope.

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
      "commits": ["a1b2c3d"], "notes": "tester rejected: credit path still asymmetric for exhausted batch"
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
