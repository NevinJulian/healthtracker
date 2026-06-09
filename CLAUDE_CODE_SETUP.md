# Claude Code setup — healthtracker redesign

A start-to-finish guide (Windows) to run the Verdure UI overhaul in Claude Code with the GitHub MCP doing the issues / branches / commits / PRs / merges as **you** (NevinJulian).

> Why Claude Code and not Cowork: Cowork's GitHub connector is OAuth-only and grants read access; it can't be given a write token. Claude Code lets you attach the same official GitHub MCP server with a write-scoped Personal Access Token — exactly like Antigravity. Everything we've built so far lives in this repo (`design/verdure/`, the updated `src/theme/tokens.ts`), so nothing is lost.

---

## 1. Install Claude Code

Open **PowerShell** (not as Administrator) and run the native installer:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Then open a **new** PowerShell window and confirm:

```powershell
claude --version
```

If `claude` isn't recognized, add `%USERPROFILE%\.local\bin` to your PATH (Windows Settings → Environment Variables) and reopen the terminal.

*Alternative (if you prefer npm, needs Node 18+):* `npm install -g @anthropic-ai/claude-code`

---

## 2. First run & login

From inside your repo folder:

```powershell
cd C:\git\healthtracker
claude
```

On first launch it asks how to authenticate:

- **Claude Pro / Max subscription** → choose "Claude account", sign in via the browser. (Recommended — no API key, no per-token billing.)
- **Anthropic API key** → choose "Anthropic Console" if you'd rather pay per use.

Check status anytime with `/status`; re-auth with `/login`.

---

## 3. Create a *write* token

The token you made earlier was read-only — that's why pushes were denied. Make a new one with write:

1. https://github.com/settings/personal-access-tokens/new
2. **Name:** `claude-code-healthtracker` · **Expiration:** 30–90 days
3. **Resource owner:** NevinJulian · **Repository access:** Only select repositories → **healthtracker**
4. **Repository permissions:**
   - Contents → **Read and write**
   - Issues → **Read and write**
   - Pull requests → **Read and write**
   - Metadata → Read-only (auto)
5. Generate and copy it.

---

## 4. Add the GitHub MCP

In PowerShell, inside the repo, paste your token into `$pat` and add the server:

```powershell
$pat = "github_pat_YOUR_NEW_WRITE_TOKEN"
claude mcp add github --transport http "https://api.githubcopilot.com/mcp/" -H "Authorization: Bearer $pat"
```

Notes:
- This uses the **default `local` scope**, which stores the config (and token) in your private per-project Claude config — **not** in the repo. Do **not** use `--scope project`; that writes a committed `.mcp.json` and would leak the token into git.
- Verify inside Claude Code with `/mcp` (should show `github` connected) or in the shell with `claude mcp list`.
- Avoid the old `@modelcontextprotocol/server-github` npm package — it's deprecated.

If you ever rotate the token: `claude mcp remove github` then re-run the add command.

---

## 5. One-time project setup

Inside `claude`:

1. **`/init`** — scans the repo and writes a `CLAUDE.md` (tech stack, `npm start` / `npm run typecheck` / `npm test`, structure, conventions). Run this first; review and commit it.
2. **Permissions** — by default Claude asks before each `git`/`npm` command. To let it run unattended, either:
   - press **Shift+Tab** to cycle into **Auto-Accept** mode for a session, or
   - run **`/permissions`** and allow the commands you trust (e.g. `npm run typecheck`, `npm test`, `git` operations).
   Start cautious, loosen as you trust it.

---

## 6. Set up your two agents

You wanted a coding agent and a testing agent. Create them interactively:

```
/agents
```

Choose "Create new agent" → project scope, and make two:

- **coding** — *"Implements one redesign unit: reads design/verdure/DESIGN.md, creates a GitHub issue and a `redesign/<unit>` branch via the GitHub MCP, edits the React Native screens/theme, commits in small steps, opens a PR that closes the issue. Does not merge."* Model: Sonnet (or Opus for tricky screens). Tools: Read, Edit, Write, Bash, plus the GitHub MCP.
- **testing** — *"Verifies a branch: runs `npm run typecheck` and `npm test`, reports pass/fail on the PR, and merges via the GitHub MCP only if both pass."* Model: Haiku (fast/cheap). Tools: Read, Bash, plus the GitHub MCP.

Claude writes these to `.claude/agents/coding.md` and `.claude/agents/testing.md`. You can then say things like *"use the coding agent for the Today screen, then the testing agent to verify and merge."*

---

## 7. The slash commands worth knowing

| Command | What it does |
|---|---|
| `/init` | Generate `CLAUDE.md` for the repo (run once, first) |
| `/mcp` | Check / re-auth MCP servers — confirm GitHub is connected |
| `/agents` | Create & manage your coding / testing subagents |
| `/model` | Switch model — Sonnet by default, Opus for hard reasoning, Haiku for cheap tasks |
| `/review` | Code-review the current changes / PR |
| `/permissions` | Control which tools run without asking |
| `/clear` | Reset context between unrelated tasks (keeps it fast & cheap) |
| `/compact` | Compress a long conversation while keeping key context |
| `/context` | See how full the context window is |
| `/resume` | Resume an earlier session |
| `/help` | List everything |

Handy keys: **Shift+Tab** cycles Edit → Auto-Accept → **Plan mode** (Plan mode = it proposes a plan before changing anything — great for each screen). **Esc Esc** opens rewind/checkpoints to undo to an earlier state.

---

## 8. Plugins / skills to install

Open the marketplace browser:

```
/plugin
```

From the Anthropic marketplace, install (user scope, so they work everywhere):

- **code-review** — structured review of your React Native changes before merge.
- **security-review** — flags injection / unsafe patterns; adds `/security-review`.

Skills come bundled inside plugins — install the plugin, then the skill (e.g. `/security-review`) is available. `/review` is built in and doesn't need a plugin.

---

## 9. Continue the Verdure overhaul

Everything is queued up for Claude Code. Once the MCP shows connected, paste this:

```
Read design/verdure/DESIGN.md and design/verdure/OVERHAUL_PLAN.md, then execute the
overhaul one unit at a time. For each unit: create a GitHub issue, branch off main as
redesign/<unit>, implement the changes, commit in small logical steps, run
`npm run typecheck` and `npm test`, open a PR that says "Closes #<issue>", and merge it
once both checks pass. Use the GitHub MCP for all GitHub actions.

Start with Unit 1 (Verdure design tokens): src/theme/tokens.ts is already updated and
passes typecheck + tests — just commit it with the design/verdure board, open the PR,
and pause for my review before continuing.
```

`OVERHAUL_PLAN.md` (in `design/verdure/`) has the full unit list, branch names, commit conventions, and the verification gate.

---

## 10. Quick checklist

```
[ ] irm https://claude.ai/install.ps1 | iex        (new terminal after)
[ ] cd C:\git\healthtracker ; claude ; /login
[ ] create write PAT (Contents/Issues/PRs = R/W, healthtracker only)
[ ] claude mcp add github --transport http "https://api.githubcopilot.com/mcp/" -H "Authorization: Bearer $pat"
[ ] /mcp                      (confirm github connected)
[ ] /init                     (generate CLAUDE.md)
[ ] /agents                   (create coding + testing agents)
[ ] /plugin                   (install code-review, security-review)
[ ] paste the Section 9 prompt to run the overhaul
```

---

### Sources
- Install / setup: https://code.claude.com/docs/en/setup
- MCP (add servers): https://code.claude.com/docs/en/mcp
- GitHub MCP install guide: https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md
- Slash commands: https://code.claude.com/docs/en/slash-commands
- Subagents: https://code.claude.com/docs/en/sub-agents
- Plugins: https://code.claude.com/docs/en/discover-plugins
- Permissions: https://code.claude.com/docs/en/permissions
