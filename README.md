# batonflow

**Pass the coding baton across any AI CLI—with automatic failover and zero lost context.**

English | [简体中文](README.zh-CN.md)

---

`batonflow` is a lightweight, **zero-dependency**, client-decoupled local multi-agent (**Planner + Executor**) relay scheduler. Pair any AI coding CLI—such as **Antigravity / Gemini**, **Claude Code**, **Codex CLI**, or custom local wrappers—into a resilient coding pipeline featuring:

- **Dynamic task batching**: Single-step dispatch for high-risk core logic; 2–3 task bundling for low-risk boilerplate.
- **Capability tier routing (`high` / `low`)**: Dynamically maps abstract tiers to the right model per CLI.
- **Layered rate-limit detection & automatic failover**: Distinguishes **5-hour rolling / short-term limits** (`short_limit`) from **weekly / billing hard quotas** (`weekly_limit`), handing off automatically along `executor_chain`.
- **3-mode exhaustion policy**: Independently configure **`planner_takeover`**, **`manual_pause`**, or **`auto_wait`** (with smart reset-time parsing & automatic retry) for both short-term and weekly limits.
- **One-command project setup (`batonflow init`)**: Enter any project and run `batonflow init` to scaffold config, workflow, task board, and a **universal cross-client Agent Skill** (`skills/batonflow/SKILL.md` installed to `.agents/skills/` and `.claude/skills/`, plus `batonflow init --global-skill` for machine-wide discovery across Antigravity, Claude Code, Codex, Gemini CLI, Cursor, and OpenCode).
- **Cross-client checkpoint resume**: Git commits + `PLAN.md` preserve exact state so any Planner client can resume seamlessly with zero lost context.
- **Safe coexistence with `AGENTS.md` / `CLAUDE.md`**: Three-layer anti-collision protection (idempotent marker append, `[BATONFLOW_EXECUTOR_MODE]` preamble, and hard `BATONFLOW_DEPTH` recursion lock).

---

## Architecture & Relay Flow

```mermaid
flowchart TD
    P["Planner (Antigravity / Claude Code / Any Client)"] -->|"Read PLAN.md & WORKFLOW.md"| B["Dynamic Batching & Tier Selection (high / low)"]
    B -->|"batonflow --tier high --task ..."| C["batonflow Scheduler (Zero-Dep Node.js)"]
    C -->|"1st Executor"| E1["Codex CLI"]
    E1 -->|"Exit 0"| V["Planner Audits git diff + Runs Tests"]
    E1 -->|"429 / Rate Limit / Weekly Limit"| E2["Backup Executor: Claude Code"]
    E2 -->|"Exit 0"| V
    E2 -->|"Rate Limit / Weekly Limit"| E3["Backup Executor: Gemini CLI"]
    E3 -->|"Exit 0"| V
    E1 & E2 & E3 -->|"Normal Error / Timeout"| ERR["Exit 1: Inspect Log & Retry (Max 2x)"]
    E3 -->|"All Exhausted"| POL{"Classify Limit & Apply exhaustion_policy"}
    POL -->|"short_limit + auto_wait"| WAIT["Parse Reset Time / Sleep & Auto-Retry"]
    WAIT --> C
    POL -->|"manual_pause (default for 5h short_limit)"| PAUSE["Exit 2/3: Clean Dirty Diff, Mark [!] in PLAN.md & Pause"]
    POL -->|"planner_takeover (default for weekly_limit)"| TAKE["Exit 2/3: Planner Takes Over Remaining PLAN.md Directly"]
    V -->|"Pass"| GIT["Mark [x] in PLAN.md + git commit Checkpoint"]
    V -->|"Fail"| ERR
```

---

## Quick Start

### Requirements
- **Node.js ≥ 18** (zero external npm dependencies; `dependencies: {}`)
- **macOS or Linux** + `git`
- One or more AI coding CLIs installed locally (e.g., `codex`, `claude`, `gemini`)

### 1. Install via npm (or From Source)

```bash
# Option A: Global install via npm
npm install -g batonflow

# Option B: Zero-install one-off via npx
npx batonflow init

# Option C: From source (no npm install needed)
git clone https://github.com/wenzhang1/batonflow.git
cd batonflow && npm link
```

### 2. Initialize Inside Any Project

```bash
cd /path/to/your-project
batonflow init
# Optional: batonflow init --adapter antigravity | claude-code | codex | all | none

# Optional: Install the universal Agent Skill globally (once, for all repositories & clients)
batonflow init --global-skill
# Or target a single client: batonflow init --global-skill antigravity | claude-code | codex
```

`batonflow init` safely creates:
- `batonflow.config.json` (never overwrites existing without `--force`)
- `.batonflow/WORKFLOW.md` (standard Planner rules)
- `PLAN.md` (task board & checkpoint recovery log)
- `.agents/skills/batonflow/SKILL.md` (**Universal Agent Skill** for Antigravity, Codex, Gemini CLI, Cursor, OpenCode) & `.agent/rules/batonflow.md`
- `.claude/skills/batonflow/SKILL.md` (**Claude Code Skill**, invocable via `/batonflow`), idempotent `CLAUDE.md` marker block (`<!-- batonflow:start --> ... <!-- batonflow:end -->`), and `.claude/settings.json` allowlist (if not already present)
- Appends `.batonflow/logs/` and `.batonflow/*.json` to `.gitignore`

> **How to use after `batonflow init`?** Just open the project in **Antigravity, Claude Code, Codex, or Cursor** and say: *"Use batonflow to break down `<your feature>` into `PLAN.md` and dispatch it."* Normal everyday chats are never interrupted—the universal Skill only activates when you invoke `batonflow` or `PLAN.md`.
>
> See the full step-by-step walkthrough with real prompt & failover examples in **[examples/USAGE_GUIDE.md](examples/USAGE_GUIDE.md)** ([中文实战指南](examples/USAGE_GUIDE.zh-CN.md)).

### 3. Try Built-in Mock Relay (Zero API Cost)

```bash
# Simulate Codex hitting a 5-hour 429 rate limit -> automatic handoff to Claude
batonflow --mock failover --tier high --task "Implement JWT refresh middleware"

# Simulate all executors hitting weekly quota -> exit 3 + next_action=planner_takeover
batonflow --mock weekly-limit --tier high --task "Migrate database schema"

# Simulate auto_wait recovery -> sleeps 1s and auto-retries to exit 0
batonflow --mock auto-wait --tier low --task "Add unit tests"
```

### 4. Dry-Run Verify

```bash
cd /path/to/your-project
batonflow --dry-run --tier high --task "Verify executor chain and model routing"
```

---

## Configuration Reference (`batonflow.config.json`)

See [`batonflow.config.example.json`](batonflow.config.example.json) for the full template.

### Core Sections

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
  "commands": {
    "codex": ["codex", "exec", "--sandbox", "workspace-write", "-m", "{{model}}", "-c", "model_reasoning_effort={{effort}}", "{{task}}"],
    "claude": ["claude", "-p", "--permission-mode", "acceptEdits", "--model", "{{model}}", "--effort", "{{effort}}", "{{task}}"],
    "gemini": ["agy", "--mode=auto", "-p", "{{task}}", "--model", "{{model}}", "--effort", "{{effort}}"]
  }
}
```

> **Non-Interactive Executor Permissions (`safe` vs `yolo`):**
> Because `batonflow` invokes Executor CLIs headlessly (`stdin` closed), Executors cannot pause for interactive `[y/N]` prompts. `batonflow` provides two built-in permission presets you can switch anytime with a single command:
>
> | Executor | `safe` Mode (Default — Local Dev) | Scope | `yolo` Mode (Isolated Containers / VMs ONLY) |
> | :--- | :--- | :--- | :--- |
> | **Codex CLI** | `--sandbox workspace-write` | Read/write **current workspace only**; protects system files & `.git` | `--yolo` |
> | **Claude Code** | `--permission-mode acceptEdits` | Auto-allows workspace reads/edits; add `--allowedTools "Read,Edit,Bash(npm test:*)"` if needed | `--dangerously-skip-permissions` |
> | **Gemini 4 (`agy`)** | `--mode=auto` | Auto-runs routine workspace edits while guarding destructive actions | `--dangerously-skip-permissions` |
>
> Switch modes anytime (preserves your custom models, policies, and third-party executors):
> ```bash
> # Initialize directly in isolated container/VM full-bypass mode:
> batonflow init --permission-mode yolo
>
> # Or switch an existing project anytime:
> batonflow mode yolo    # WARNING: use ONLY in isolated Docker containers, ephemeral VMs, or CI
> batonflow mode safe    # Switch back to scoped workspace-write defaults
> ```
>
> **Reasoning / Thinking Effort (`--effort`):** Supports `low`, `medium`, `high`, `xhigh`, and `max`. When omitted, `batonflow` uses `default_effort[tier]` (`high` → `high`, `low` → `medium`). Use `effort_map` to safely downgrade unsupported levels during failover (e.g., mapping `max` → `xhigh` for `agy` / Gemini 4).
>
> **Safe Command Templates:** `commands` supports both **argv arrays** (recommended—executed with `shell: false`, 100% immune to quote/backtick/newline/`$VAR` corruption) and **string templates** (e.g., `"codex exec -m {{model}} -c model_reasoning_effort={{effort}} \"{{task}}\""`, safely tokenized or POSIX-quoted automatically).

### 3-Mode Exhaustion Policy (`short_limit` vs `weekly_limit`)

`batonflow` matches CLI failures against `weekly_limit_patterns` first, then `rate_limit_patterns`. When all executors in `executor_chain` are exhausted, it applies your configured policy:

```json
"exhaustion_policy": {
  "short_limit": "manual_pause",
  "weekly_limit": "planner_takeover",
  "auto_wait": {
    "poll_interval_seconds": 900,
    "max_wait_seconds": 21600,
    "buffer_seconds": 30,
    "on_timeout": "manual_pause"
  }
}
```

Both `short_limit` (5-hour rolling window / 429 / RPM) and `weekly_limit` (weekly / monthly / billing quota) accept all **3 modes**:

| Policy Mode | Behavior | Recommended Use |
| :--- | :--- | :--- |
| **`"planner_takeover"`** | Emits `next_action=planner_takeover`. Planner immediately finishes remaining `PLAN.md` tasks with its native tools. | **Default for `weekly_limit`** (quota won't reset for days) |
| **`"manual_pause"`** | Emits `next_action=manual_pause` + `reset_hint`. Planner cleans dirty diff, marks `[!]` in `PLAN.md`, and pauses for you to resume manually. | **Default for `short_limit`** (wait for 5h window) or users who want to protect Planner quota on `weekly_limit` |
| **`"auto_wait"`** | `batonflow` parses reset time from CLI stderr (or uses `poll_interval_seconds`), sleeps up to `max_wait_seconds`, and automatically retries the chain. Falls back to `on_timeout` if still exhausted. | Unattended / overnight runs waiting through a 5-hour rolling reset |

### CLI Commands, Flags & Exit Codes

| Command / Flag | Description |
| :--- | :--- |
| `init [dir] [--adapter ...] [--permission-mode safe\|yolo] [--force]` | Initialize config, templates, universal Agent Skill (`.agents/skills/` & `.claude/skills/`), and adapters into `dir` (default: cwd) |
| `init --global-skill [target] [--force]` | Install the universal Skill globally (`all` / `antigravity` / `claude-code` / `codex`) without creating project files |
| `mode <safe\|yolo> [--config <path>]` | Switch `codex`/`claude`/`gemini` commands in `batonflow.config.json` between `safe` (workspace-write) and `yolo` (container full-bypass) |
| `--tier <high\|low>` | Capability tier to route (required for task dispatch) |
| `--effort <level>` | Reasoning/thinking effort: `low \| medium \| high \| xhigh \| max` (optional; defaults to `default_effort[tier]`) |
| `--task "<text>"` | Inline task prompt |
| `--task-file <path\|->` | Read multi-line prompt from file or stdin (`-`) |
| `--executor <name>` | Force a single executor (no chain failover) |
| `--config <path>` | Custom config file path |
| `--dry-run` | Show resolved chain, models, and commands without executing |
| `--mock [scenario]` | Zero-API demo (`failover`, `success`, `short-limit`, `weekly-limit`, `error`, `auto-wait`) |
| `--status` | Inspect active cooldowns in `.batonflow/state.json` and policies |
| `--reset-state` | Clear saved cooldowns immediately |
| `--ignore-cooldown` | Bypass active cooldowns for this run |
| `--no-prefix` | Omit `executor_prompt_prefix` for this run |

| Exit Code | Meaning |
| :---: | :--- |
| **`0`** | Task executed successfully by an Executor |
| **`1`** | Normal failure (code/build error, timeout, config error, or blocked nested call) — **no failover** |
| **`2`** | All executors unavailable/exhausted, with at least one **short-term / 5-hour** limit |
| **`3`** | All usable executors exhausted by **weekly / hard quota** limits |

On exit `2` or `3`, `batonflow` always prints a machine-readable directive to `stderr`:

```text
[batonflow] RESULT exit=3 limit_type=weekly_limit next_action=planner_takeover reset_hint="resets on Monday" executors=codex:weekly_limit,claude:weekly_limit,gemini:weekly_limit
```

---

## Safe Coexistence with Existing `AGENTS.md` / `CLAUDE.md`

When a Planner invokes an Executor (e.g., `claude` or `codex`) inside the same repository, the Executor automatically reads the project's `AGENTS.md` / `CLAUDE.md`. `batonflow` prevents role confusion and recursive loops via three layers:

1. **Non-destructive initialization**: `batonflow init` never overwrites `CLAUDE.md`; it appends/updates a short marker block (`<!-- batonflow:start --> ... <!-- batonflow:end -->`).
2. **Automatic Executor preamble**: Prepends `[BATONFLOW_EXECUTOR_MODE]` instructing the Executor to follow the repo's coding conventions while editing files directly and never touching `PLAN.md`.
3. **Hard recursion lock**: `batonflow` injects `BATONFLOW_ROLE=executor` and `BATONFLOW_DEPTH=1` into child environments and immediately blocks any nested `batonflow` call.

---

## Common Relay Scenarios

1. **Antigravity (Planner) → Codex → Claude → Gemini (Executors)**
   - Antigravity decomposes architecture into `PLAN.md`, dispatches high-complexity tasks with `--tier high` and boilerplate with `--tier low`, audits every `git diff`, runs tests, and commits checkpoints.
2. **Claude Code (Planner) → Codex → Gemini (Executors)**
   - Install with `batonflow init --adapter claude-code`. Claude Code stays focused on planning and verification while delegating heavy implementation loops to Codex and Gemini.
3. **5-Hour Limit Pause vs Weekly Limit Takeover**
   - When Codex + Claude + Gemini all hit 5-hour limits (`exit 2`), `PLAN.md` marks `[!]` with the reset hint (or auto-waits if `short_limit: "auto_wait"`).
   - When all external CLIs hit weekly quota (`exit 3`), the Planner receives `next_action=planner_takeover` and finishes the remaining `PLAN.md` tasks seamlessly.
4. **Cross-Client Handoff**
   - Close Antigravity, open Claude Code (or vice versa), point it at `.batonflow/WORKFLOW.md` + `PLAN.md`. Git history + `PLAN.md` Recovery Log restore 100% of context immediately.

---

## Adding a New AI CLI Executor

Adding any CLI (e.g., Aider, OpenCode, Qwen Code, or a custom script) requires **zero code changes**—just add it to `batonflow.config.json`:

```json
{
  "executor_chain": ["codex", "opencode", "claude"],
  "tiers": {
    "high": { "opencode": "openai/gpt-5.3" },
    "low":  { "opencode": "openai/gpt-5-mini" }
  },
  "commands": {
    "opencode": ["opencode", "run", "--model", "{{model}}", "{{task}}"]
  }
}
```

---

## Testing & Releasing

```bash
# Run the full zero-API-cost test suite (19 tests)
npm test

# Preview npm package contents
npm pack --dry-run
```

Maintainers publish new versions via **npm Trusted Publishing (OIDC)**—no long-lived `NPM_TOKEN` secrets required—gated by the protected `npm-release` GitHub Environment (`.github/workflows/publish.yml`):
1. **First-time bootstrap (`v0.1.0`)**: Run `npm login && npm publish --access public` once locally, then bind GitHub Actions under `npmjs.com/package/batonflow/access` → **Trusted Publisher** (`wenzhang1` / `batonflow` / `publish.yml` / `npm-release`).
2. **All subsequent releases**: Bump `"version"` in `package.json` via PR to `main`, push a matching tag (`git tag v0.1.1 && git push origin v0.1.1`), and approve the deployment gate in **Actions → Publish to npm** (`npm-release`).

---

## License

[MIT](LICENSE)
