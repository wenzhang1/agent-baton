# agent-baton Standard Planner Workflow (`WORKFLOW.md`)

> **Pass the coding baton across any AI CLI—with automatic failover and zero lost context.**

This document is a **client-agnostic operational specification** for any AI agent acting as the **Planner** (e.g., Antigravity / Gemini, Claude Code, Codex, Cursor). Follow these rules whenever operating in agent-baton Planner mode.

---

## 1. Role Boundary & Coexistence with `AGENTS.md` / `CLAUDE.md`

- **Planner (You)**: Owns architecture, task decomposition, `PLAN.md`, dispatching tasks via `agent-baton`, inspecting `git diff`, running verification (tests/lint/build), creating `git commit` checkpoints, and handling failover/takeover.
- **Executor (Invoked via `agent-baton`)**: Owns implementing the assigned coding task directly inside the repository. Executors automatically receive `[AGENT_BATON_EXECUTOR_MODE]` and `AGENT_BATON_ROLE=executor`:
  - Executors **still follow** the repository's existing `AGENTS.md` / `CLAUDE.md` coding standards.
  - Executors **must never** edit `PLAN.md` or recursively invoke `agent-baton` (enforced by a hard recursion lock).

---

## 2. Dynamic Task Batching Rules

Before dispatching from `PLAN.md`, group pending `[ ]` tasks dynamically by risk and coupling:

| Risk / Coupling Profile | Batch Size | Examples |
| :--- | :---: | :--- |
| **High-risk / core logic** | **1 task** (single-step) | Auth & security, DB migrations, concurrency/state machines, core API contracts, complex refactors |
| **Low-risk / tightly-coupled boilerplate** | **2–3 tasks** (bundled) | DTO/type definitions + CRUD handlers, repetitive UI views, unit test suites for one module, docs/config updates |

**Never** bundle a high-risk task with unrelated low-risk tasks, and never dispatch a batch whose dependencies (`Depends On`) are not yet `[x]`.

---

## 3. Capability Tier Decision Rules (`--tier high` vs `--tier low`)

Choose the lowest tier that can reliably succeed on the first try:

- Use `--tier high` when the task involves:
  - Non-trivial architecture, cross-module design, or subtle bug root-cause fixes
  - Security, cryptography, authentication, or data-migration logic
  - Ambiguous requirements or multi-file refactors with tight invariants
  - A retry escalation after `--tier low` failed twice on the same task
- Use `--tier low` when the task involves:
  - Well-scoped feature additions following established patterns in the repo
  - Unit/integration tests, boilerplate CRUD, styling, documentation, or config edits
  - Targeted small fixes with crystal-clear file paths and acceptance criteria

---

## 4. Dispatch & Verification Loop

For each task (or batch) in `PLAN.md`:

### Step A — Dispatch to Executor
Run `agent-baton` with a **self-contained prompt** (include exact file paths, constraints, and acceptance criteria). For multi-line prompts, prefer `--task-file`:

```bash
agent-baton --tier <high|low> --task "<clear task description + acceptance criteria>"
# or for longer prompts:
agent-baton --tier <high|low> --task-file .agent-baton/current-task.md
```

### Step B — Handle Exit Code

| Exit Code | Meaning | Planner Action |
| :---: | :--- | :--- |
| **`0`** | Executor succeeded | Proceed to **Step C (Verification & Commit)** |
| **`1`** | Normal failure, build/code error, or timeout | Inspect the log path printed by `agent-baton`. Refine instructions or pass error details back and retry (**max 2 retries** per task). |
| **`2`** | All executors unavailable/exhausted (at least one **short-term / 5-hour** limit) | Follow **Section 5 (Checkpoint & Exhaustion Policy)** based on `next_action=...` |
| **`3`** | All usable executors exhausted by **weekly / hard quota** limits | Follow **Section 5 (Checkpoint & Exhaustion Policy)** based on `next_action=...` |

### Step C — Verification & Commit Checkpoint (Mandatory on Exit `0`)
Never trust an Executor's self-report blindly. Always verify:

1. **Diff audit**: Run `git status` and `git diff` to ensure changes stay strictly within task scope, contain no debug junk, and did not modify `PLAN.md`.
2. **Automated checks**: Run the test, lint, and build commands listed in `PLAN.md`.
3. **If verification PASSES**:
   - Mark completed task(s) as `[x]` in `PLAN.md`.
   - Record a concise entry in the Relay Log if failover occurred.
   - Commit both code and `PLAN.md` as an atomic checkpoint:
     ```bash
     git add -A && git commit -m "feat(<scope>): <task id> <short summary>"
     ```
4. **If verification FAILS**:
   - Do **not** commit broken code.
   - Collect the exact failing command + error output and re-dispatch to Executor to fix (**maximum 2 retries per task**).
   - If still failing after 2 retries:
     - If currently on `--tier low`, you may optionally do 1 escalated retry on `--tier high`.
     - Otherwise, either fix the targeted defect directly as Planner or revert dirty edits, mark `[!]` in `PLAN.md`, and report the blocker to the user.

---

## 5. Checkpoint Recovery & 3-Mode Exhaustion Policy

When `agent-baton` exits with **`2`** (short-term / 5-hour limit) or **`3`** (weekly / hard quota limit), read the final structured directive printed to `stderr`:

```text
[agent-baton] RESULT exit=<2|3> limit_type=<short_limit|weekly_limit|unavailable> next_action=<planner_takeover|manual_pause> reset_hint="..." executors=...
```

### Step 1 — Protect Committed Checkpoints & Clean Dirty State
Before pausing or switching modes, ensure the working tree is clean of half-finished Executor edits:
1. Check `git status` and `git diff`.
2. **Never** run `git reset --hard HEAD~1` or touch already-committed checkpoints.
3. Discard only unverified, partial working-tree changes left by the aborted task (e.g., `git checkout -- .` and remove untracked scratch files from the failed attempt, preserving any updates you make to `PLAN.md`).

### Step 2 — Act Strictly According to `next_action`

`agent-baton` supports 3 user-configurable policies in `agent-baton.config.json` (`exhaustion_policy.short_limit` and `exhaustion_policy.weekly_limit`):

1. **`next_action=planner_takeover`** *(Default for `weekly_limit` / exit `3`; optional for `short_limit`)*
   - Log the exhaustion event and handover in `PLAN.md` under **Relay & Recovery Log**.
   - **Take over directly**: Use your own native file-editing and terminal tools to complete the remaining `[ ]` / `[!]` tasks in `PLAN.md`.
   - Continue enforcing the exact same **Step C verification + `git commit` checkpoint** discipline for every task.

2. **`next_action=manual_pause`** *(Default for `short_limit` / exit `2`; optional for `weekly_limit` if the user wants to protect Planner quota)*
   - Mark the interrupted task as `[!]` in `PLAN.md`.
   - Fill out the **Latest Handoff Context** block in `PLAN.md` (interruption reason, `limit_type`, `reset_hint`, last `git HEAD` commit, and exact next step).
   - Stop dispatching, report the pause clearly to the user with the `reset_hint`, and wait for the user to resume manually once quota recovers.

3. **`auto_wait`** *(Optional policy for `short_limit` or `weekly_limit`)*
   - Handled automatically inside `agent-baton`: the scheduler parses any reset time from the CLI error (or uses `poll_interval_seconds`), sleeps safely up to `max_wait_seconds`, and retries transparently.
   - If `auto_wait` recovers, `agent-baton` returns `0` normally.
   - If `max_wait_seconds` is exceeded, `agent-baton` exits with `2`/`3` and emits `next_action` set to `auto_wait.on_timeout` (`manual_pause` or `planner_takeover`) — follow rule 1 or 2 above.
   - *Tip for long 5-hour waits*: If your Planner client has a short per-command timeout, either set `short_limit: "manual_pause"` and use your client's scheduler (e.g., `/schedule`) to resume later, or run `agent-baton` in a detached terminal session.

---

## 6. Cross-Client Resume Protocol

When resuming work in a **new session or a completely different AI client**:
1. Read `PLAN.md` (focus on **Global Constraints**, tasks marked `[!]` or `[ ]`, and **Latest Handoff Context**).
2. Run `git status` and `git log -n 5 --oneline` to confirm the exact last verified checkpoint.
3. Run `agent-baton --status` to inspect active executor cooldowns (run `agent-baton --reset-state` if quota has already reset).
4. Resume from the first `[!]` or `[ ]` task with zero lost context.
