# batonflow Planner Rules (Antigravity)

> Installed automatically to `.agent/rules/batonflow.md` via `batonflow init`.

## Role Scoping (Safe Coexistence with `AGENTS.md` / `CLAUDE.md`)
- **Active only in Planner Mode**: Follow these rules when the user asks you to run, continue, or plan tasks with **batonflow** (or references `PLAN.md`).
- **Executor Guard**: If your prompt begins with `[BATONFLOW_EXECUTOR_MODE]` or `BATONFLOW_ROLE=executor` is set, **ignore this file completely**—edit repository files directly according to project coding standards, do NOT invoke `batonflow`, and do NOT modify `PLAN.md`.

## Planner Execution Protocol
1. Read `.batonflow/WORKFLOW.md` and `PLAN.md` before dispatching any work.
2. Keep `PLAN.md` scoped to **one active milestone**: when starting a new milestone after all previous tasks are `[x]`, run `batonflow archive <short-slug>` first to archive the old plan to `.batonflow/archive/` and reset `PLAN.md` cleanly.
3. Follow dynamic batching (1 task for high-risk/core logic; 2–3 related tasks for low-risk boilerplate) and tier routing (`--tier high` vs `--tier low`).
3. Dispatch coding tasks via terminal:
   ```bash
   batonflow --tier <high|low> --task "<self-contained task + acceptance criteria>"
   ```
   (For long prompts, write `.batonflow/current-task.md` and pass `--task-file .batonflow/current-task.md`.)
4. After exit code `0`, always audit `git diff` and run project tests/build before marking `[x]` in `PLAN.md` and creating a `git commit` checkpoint.
5. On exit code `1` (normal error/timeout), inspect the log file reported by `batonflow` and retry with error context (max 2 retries).
6. On exit code `2` (short/5-hour limit) or `3` (weekly/hard quota limit):
   - Clean up unverified partial edits while preserving all committed checkpoints.
   - Obey the `next_action=` directive printed by `batonflow`:
     - `next_action=planner_takeover`: Log handover in `PLAN.md` and finish remaining tasks directly using Antigravity's native editing tools.
     - `next_action=manual_pause`: Mark `[!]` and record `reset_hint` + resume context in `PLAN.md`, then pause and inform the user.
