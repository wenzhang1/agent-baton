# batonflow End-to-End Usage & Antigravity Skill Guide

English | [简体中文](USAGE_GUIDE.zh-CN.md)

This guide walks through real-world usage of **`batonflow`** and its built-in **Antigravity Skill**—from initial setup to automatic multi-CLI failover, 5-hour vs. weekly quota handling, and cross-client checkpoint resume.

---

## 1. Install & Initialize

### Install globally once
```bash
npm install -g batonflow
batonflow --version
```

### Choose how Antigravity loads the `batonflow` Skill
You have two options (both use Antigravity's **Progressive Disclosure**, so normal chats are never slowed down or hijacked):

1. **Project-level Skill (Automatic with `batonflow init`)**
   ```bash
   cd /path/to/your-project
   batonflow init
   ```
   This automatically creates:
   - `.agents/skills/batonflow/SKILL.md` (Antigravity Workspace Skill)
   - `.agent/rules/batonflow.md` (Antigravity Workspace Rule)
   - `batonflow.config.json`, `.batonflow/WORKFLOW.md`, `PLAN.md`
   - `CLAUDE.md` (idempotent marker append) & `.claude/settings.json`

2. **Global Skill (One-time install for all repos on your machine)**
   ```bash
   batonflow init --global-skill
   ```
   This installs `~/.gemini/config/skills/batonflow/SKILL.md` without creating any project files in your current directory. Inside each repository you want to orchestrate, you still run `batonflow init` once to create `batonflow.config.json` and `PLAN.md`.

### Customize `batonflow.config.json` & Verify
Keep only the AI CLIs you actually have installed and signed into in `executor_chain`:

```json
{
  "executor_chain": ["codex", "claude", "gemini"],
  "exhaustion_policy": {
    "short_limit": "manual_pause",
    "weekly_limit": "planner_takeover"
  }
}
```

Run a zero-API-cost dry run to verify command resolution:
```bash
batonflow --dry-run --tier high --task "Verify setup"
```

---

## 2. Using `batonflow` Directly Inside Antigravity Chat

Once initialized, you **do not** need to run `batonflow --tier ...` manually—just talk to Antigravity naturally.

### Why normal conversations stay unaffected
The `batonflow` Skill only activates when your prompt mentions `batonflow`, `PLAN.md`, or multi-CLI relay work. Everyday questions like *"Explain `src/auth.ts`"* or *"Fix this typo"* behave normally.

### Example Prompt 1 — Plan first, then relay-execute
> "Use **batonflow** to break down 'Add JWT login + refresh token rotation with tests' into `PLAN.md` following `.batonflow/WORKFLOW.md`. Show me the plan first, and once I approve, dispatch tasks via `batonflow`."

What Antigravity does automatically:
1. Activates the `batonflow` Skill and reads `.batonflow/WORKFLOW.md`.
2. Populates `PLAN.md` with `high` / `low` tiers, batch groups, dependencies, and acceptance criteria.
3. After your approval, runs:
   - Single-step `--tier high` for core JWT/auth logic (`T1`, `T2`).
   - Bundled `--tier low` for boilerplate routes + unit tests (`T3 + T4`).
4. After each `exit 0`, inspects `git diff`, runs `npm test` / `npm run build`, marks `[x]` in `PLAN.md`, and creates a clean `git commit` checkpoint.

> **Tip:** The first time Antigravity executes `batonflow --tier ...` in the terminal, click **Always Allow** so subsequent dispatches run unattended.

---

## 3. Watching Automatic Failover in Action

Try the built-in zero-cost mock simulation to see what happens when your primary Executor (`codex`) hits a 5-hour 429 rate limit:

```bash
batonflow --mock failover --tier high --task "Implement JWT refresh middleware"
```

Sample output:
```text
[batonflow] DISPATCH executor=codex tier=high model=mock-codex-high
[codex] HTTP 429 Too Many Requests: You have reached your 5-hour rate limit. Please try again in 45 minutes.
[batonflow] HANDOFF codex (short_limit: try again in 45 minutes) -> claude
[batonflow] DISPATCH executor=claude tier=high model=mock-claude-high
[batonflow] SUCCESS executor=claude model=mock-claude-high duration=0.1s log=.batonflow/logs/...
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
batonflow --tier high --executor claude --task "Audit auth edge cases"

# Pass a long multi-line task prompt from a file
batonflow --tier high --task-file .batonflow/current-task.md
```
