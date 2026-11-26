# batonflow End-to-End Usage & Universal Agent Skill Guide

English | [简体中文](USAGE_GUIDE.zh-CN.md)

This guide walks through real-world usage of **`batonflow`** and its built-in **universal Agent Skill** (`skills/batonflow/SKILL.md`, compatible with **Antigravity, Claude Code, Codex CLI, Gemini CLI, Cursor, and OpenCode**)—from initial setup to automatic multi-CLI failover, 5-hour vs. weekly quota handling, and cross-client checkpoint resume.

---

## 1. Install & Initialize

### Install globally once
```bash
npm install -g batonflow
batonflow --version
```

### Choose how your AI clients load the universal `batonflow` Skill
`skills/batonflow/SKILL.md` follows the open **Agent Skills** standard (progressive disclosure), so normal chats are never slowed down or hijacked:

| AI Client | Project-Level Skill Path (`batonflow init`) | Global Skill Path (`batonflow init --global-skill`) |
| :--- | :--- | :--- |
| **Antigravity** | `.agents/skills/batonflow/SKILL.md` | `~/.gemini/config/skills/batonflow/SKILL.md` |
| **Codex / Gemini CLI / Cursor / OpenCode** | `.agents/skills/batonflow/SKILL.md` | `~/.agents/skills/batonflow/SKILL.md` |
| **Claude Code** | `.claude/skills/batonflow/SKILL.md` | `~/.claude/skills/batonflow/SKILL.md` |

1. **Project-level Skill (Automatic with `batonflow init`)**
   ```bash
   cd /path/to/your-project
   batonflow init
   ```
   This automatically creates:
   - `.agents/skills/batonflow/SKILL.md` (Universal Agent Skill for Antigravity / Codex / Gemini CLI / Cursor / OpenCode) & `.agent/rules/batonflow.md`
   - `.claude/skills/batonflow/SKILL.md` (Claude Code `/batonflow` Skill), `CLAUDE.md` (idempotent marker append), & `.claude/settings.json`
   - `batonflow.config.json`, `.batonflow/WORKFLOW.md`, `PLAN.md`

2. **Global Skill (One-time install for all repos & clients on your machine)**
   ```bash
   # Install for all clients (Antigravity + Claude Code + Codex/Universal):
   batonflow init --global-skill

   # Or install for a single client only:
   batonflow init --global-skill claude-code
   ```
   This installs global `SKILL.md` files without creating any project files in your current directory. Inside each repository you want to orchestrate, you still run `batonflow init` once to create `batonflow.config.json` and `PLAN.md`.

### Customize `batonflow.config.json` & Verify
Keep only the AI CLIs you actually have installed and signed into in `executor_chain`. The default config comes pre-populated with latest-generation models and reasoning effort controls:

```json
{
  "executor_chain": ["codex", "claude", "gemini"],
  "tiers": {
    "high": {
      "codex": "gpt-6.2-astra",
      "claude": "claude-opus-5-5",
      "gemini": "gemini-4-neon"
    },
    "low": {
      "codex": "gpt-6.2-sol",
      "claude": "claude-sonnet-5-5",
      "gemini": "gemini-4-hydrogen"
    }
  },
  "default_effort": {
    "high": "high",
    "low": "medium"
  },
  "effort_map": {
    "gemini": {
      "max": "xhigh"
    }
  },
  "exhaustion_policy": {
    "short_limit": "manual_pause",
    "weekly_limit": "planner_takeover"
  }
}
```

Run a zero-API-cost dry run to verify model & effort resolution (notice how `--effort max` automatically maps to `xhigh` for `agy` / Gemini 4):
```bash
batonflow --dry-run --tier high --effort max --task "Verify setup"
```

---

## 2. Using `batonflow` Directly Inside AI Client Chat

Once initialized, you **do not** need to run `batonflow --tier ...` manually—just talk to **Antigravity, Claude Code (`/batonflow`), Codex, or Cursor** naturally.

### Why normal conversations stay unaffected
The `batonflow` Skill only activates when your prompt mentions `batonflow`, `PLAN.md`, or multi-CLI relay work. Everyday questions like *"Explain `src/auth.ts`"* or *"Fix this typo"* behave normally.

### Example Prompt 1 — Plan first, then relay-execute
> "Use **batonflow** to break down 'Add JWT login + refresh token rotation with tests' into `PLAN.md` following `.batonflow/WORKFLOW.md`. Show me the plan first, and once I approve, dispatch tasks via `batonflow`."

What your Planner client does automatically:
1. Activates the `batonflow` Skill and reads `.batonflow/WORKFLOW.md`.
2. Populates `PLAN.md` with `high` / `low` tiers, batch groups, dependencies, and acceptance criteria.
3. After your approval, runs:
   - Single-step `--tier high` (default effort `high`, or `--effort xhigh`/`max` for deep debugging) for core JWT/auth logic (`T1`, `T2`).
   - Bundled `--tier low` (default effort `medium`, or `--effort low` for quick mechanical edits) for boilerplate routes + unit tests (`T3 + T4`).
4. After each `exit 0`, inspects `git diff`, runs `npm test` / `npm run build`, marks `[x]` in `PLAN.md`, and creates a clean `git commit` checkpoint.

> **Tip:** The first time your Planner executes `batonflow --tier ...` in the terminal, click **Always Allow** so subsequent dispatches run unattended.

---

## 3. Watching Automatic Failover in Action

Try the built-in zero-cost mock simulation to see what happens when your primary Executor (`codex`) hits a 5-hour 429 rate limit:

```bash
batonflow --mock failover --tier high --effort xhigh --task "Implement JWT refresh middleware"
```

Sample output:
```text
[batonflow] DISPATCH executor=codex tier=high model=mock-codex-high effort=xhigh
[codex] HTTP 429 Too Many Requests: You have reached your 5-hour rate limit. Please try again in 45 minutes.
[batonflow] HANDOFF codex (short_limit: try again in 45 minutes) -> claude
[batonflow] DISPATCH executor=claude tier=high model=mock-claude-high effort=xhigh
[batonflow] SUCCESS executor=claude model=mock-claude-high effort=xhigh duration=0.1s log=.batonflow/logs/...
```

`codex` is recorded in `.batonflow/state.json` cooldown, so the next task skips straight to `claude` without wasting time hitting 429 again.

---

## 4. Handling 5-Hour Limits vs. Weekly Limits

### Case A — All Executors hit 5-hour limits (`exit 2`)
With the default `"short_limit": "manual_pause"`:
1. `batonflow` prints:
   ```text
   [batonflow] RESULT exit=2 limit_type=short_limit next_action=manual_pause reset_hint="try again in 45 minutes" executors=codex:short_limit,claude:short_limit
   ```
2. Antigravity discards unverified partial diffs (protecting all committed checkpoints), marks the interrupted task `[!]` in `PLAN.md`, writes the recovery hint under **Latest Handoff Context**, and pauses.
3. After 45 minutes, run `batonflow --reset-state` (optional—expired cooldowns clear automatically) and tell Antigravity:
   > "Quota has reset—read `PLAN.md` and resume remaining tasks with **batonflow**."

> **Want unattended auto-retry through a 5-hour window?** Set `"short_limit": "auto_wait"` in `batonflow.config.json`. `batonflow` parses the reset time (or polls every `poll_interval_seconds` up to `max_wait_seconds`) and retries automatically.

### Case B — All Executors hit weekly / hard quotas (`exit 3`)
With the default `"weekly_limit": "planner_takeover"`:
1. `batonflow` prints:
   ```text
   [batonflow] RESULT exit=3 limit_type=weekly_limit next_action=planner_takeover reset_hint="resets on Monday" executors=codex:weekly_limit,claude:weekly_limit
   ```
2. Antigravity cleans any partial diff, logs the handover in `PLAN.md`, and **seamlessly finishes remaining `PLAN.md` tasks using its own native editing tools**—keeping the same test + `git commit` verification discipline!

> **Want to protect your Planner quota too?** Set `"weekly_limit": "manual_pause"` in `batonflow.config.json`.

---

## 5. Cross-Client Resume (Antigravity ↔ Claude Code)

Suppose Antigravity completed `T1` and `T2`, then paused on `T3` with `[!]` in `PLAN.md`. Later, you open the **same repository in Claude Code** (or a fresh Antigravity session) and type:

> "Read `.batonflow/WORKFLOW.md` and `PLAN.md`, check `git log -n 5` and `batonflow --status`, and continue from the interrupted task `[!]` using batonflow."

Because every completed task is an atomic `git commit` and `PLAN.md` holds the exact handoff context, the new Planner picks up at `T3` with **zero lost context**.

---

## 6. Useful Day-to-Day Commands

```bash
# Inspect active executor cooldowns and exhaustion policies
batonflow --status

# Clear saved cooldowns early (e.g., after quota resets)
batonflow --reset-state

# Force a single executor without chain failover
batonflow --tier high --effort xhigh --executor claude --task "Audit auth edge cases"

# Maximum reasoning effort (codex/claude receive `max`; gemini/agy automatically maps to `xhigh`)
batonflow --tier high --effort max --task "Root-cause race condition in job queue"

# Fast low-effort pass for mechanical edits
batonflow --tier low --effort low --task "Rename env var constants across tests"

# Pass a long multi-line task prompt from a file
batonflow --tier high --task-file .batonflow/current-task.md
```
