# batonflow 实战使用与全客户端通用 Skill 指南

[English](USAGE_GUIDE.md) | 简体中文

本文通过完整实战场景，演示如何从零安装 **`batonflow`**、配置**全客户端通用 Agent Skill**（`skills/batonflow/SKILL.md`，原生支持 **Antigravity、Claude Code、Codex CLI、Gemini CLI、Cursor 与 OpenCode**），以及如何在对话中实现自动多 CLI 接力、5 小时/周限额容灾与跨客户端断点续传。

---

## 1. 安装与初始化

### 全局安装（只需一次）
```bash
npm install -g batonflow
batonflow --version
```

### 选择通用 `batonflow` Skill 的安装方式
`skills/batonflow/SKILL.md` 遵循开放的 **Agent Skills** 标准（渐进式加载）——平时只占用极简的 `name` + `description`，不会干扰日常对话，只有涉及 `batonflow` / `PLAN.md` 接力任务时才会激活：

| AI 客户端 | 项目级 Skill 路径（`batonflow init`） | 全局级 Skill 路径（`batonflow init --global-skill`） |
| :--- | :--- | :--- |
| **Antigravity** | `.agents/skills/batonflow/SKILL.md` | `~/.gemini/config/skills/batonflow/SKILL.md` |
| **Codex / Gemini CLI / Cursor / OpenCode** | `.agents/skills/batonflow/SKILL.md` | `~/.agents/skills/batonflow/SKILL.md` |
| **Claude Code** | `.claude/skills/batonflow/SKILL.md` | `~/.claude/skills/batonflow/SKILL.md` |

1. **项目级 Skill（运行 `batonflow init` 自动生成，推荐团队共享）**
   ```bash
   cd /path/to/your-project
   batonflow init
   ```
   会自动在项目中创建：
   - `.agents/skills/batonflow/SKILL.md`（Antigravity / Codex / Gemini CLI / Cursor / OpenCode 通用 Skill）与 `.agent/rules/batonflow.md`
   - `.claude/skills/batonflow/SKILL.md`（Claude Code `/batonflow` Skill）、`CLAUDE.md`（锚点无损追加）与 `.claude/settings.json`
   - `batonflow.config.json`、`.batonflow/WORKFLOW.md`、`PLAN.md`

2. **全局级 Skill（一次安装，本机所有项目与客户端通用）**
   ```bash
   # 一次性安装到全部客户端（Antigravity + Claude Code + Codex/通用目录）：
   batonflow init --global-skill

   # 或仅安装到指定客户端：
   batonflow init --global-skill claude-code
   ```
   仅写入全局 `SKILL.md`，**不会在当前目录生成任何项目文件**。之后在具体需要接力的项目里，仍需运行一次 `batonflow init` 生成 `batonflow.config.json` 和 `PLAN.md`。

### 核对 `batonflow.config.json` 并演练验证
在 `executor_chain` 中只保留你本机实际已安装并登录的 AI CLI。默认配置已预置最新一代模型与思维强度映射：

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
  },
  "timeout_seconds": 1800,
  "idle_timeout_seconds": 600
}
```

> **超时配置提示**：`idle_timeout_seconds`（默认 `600s`）只要子进程有新输出就会自动续期，`timeout_seconds`（默认 `1800s`）作为单次任务总时长兜底。如果项目有超过 10 分钟全程零输出的静默构建或全量测试，可调大 `idle_timeout_seconds` 或设为 `0` 关闭空闲检测。

运行零额度消耗演练，确认模型与思维强度路由正确（可以看到 `--effort max` 传给 `agy`/Gemini 4 时会自动安全映射为 `xhigh`）：
```bash
batonflow --dry-run --tier high --effort max --task "验证配置与链路"
```

---

## 2. 在 AI 客户端对话中直接使用（全自动接力）

初始化完成后，**无需自己手动敲 `batonflow --tier ...`**，直接在 **Antigravity、Claude Code（支持 `/batonflow`）、Codex 或 Cursor** 对话框发需求即可。

### 平时聊天会被打扰吗？
**不会。** 只有当你提到 `batonflow`、`PLAN.md` 或明确要求多 CLI 接力执行时，才会加载 `batonflow` Skill；日常提问（如“解释这段代码”、“修一个 typo”）完全按正常模式响应。

### 日常极简用法（一句话就够）
因为 `skills/batonflow/SKILL.md` 已内置前置步骤（自动读取 `.batonflow/WORKFLOW.md` 并拆解写入 `PLAN.md`），平时使用时不需要专门把这两个文件名敲出来：

- **新需求**：`用 batonflow 实现用户登录与 JWT 刷新并补全单元测试`
- **Claude Code 里更短**：`/batonflow 实现用户登录与 JWT 刷新并补全单元测试`
- **额度恢复 / 换客户端续传**：`用 batonflow 继续`

> **触发说明**：唯一会不触发的情况，是你**完全没提 `batonflow` 也没提 `PLAN.md`**（例如只说“帮我做个登录功能”）——这时客户端会按普通模式自己直接写代码，不会进入接力流程。只要话里带了 **`batonflow`**，整套规范就会自动生效。

### 完整示例 Prompt（显式指定步骤）
直接对你的 Planner 客户端说：

> 「请使用 **batonflow**，按 `.batonflow/WORKFLOW.md` 的规范把“实现用户登录与 JWT 刷新轮换并补全单元测试”拆解写入 `PLAN.md`。先给我确认，确认后用 `batonflow` 分批派发并验收。」

Planner 会自动执行以下闭环：
1. 激活 `batonflow` Skill 并读取 `.batonflow/WORKFLOW.md`。
2. 在 `PLAN.md` 中拆出任务清单、复杂度档位（`high` / `low`）、分批组、依赖关系与验收标准。
3. 你确认后，自动派发：
   - 高风险核心认证逻辑（`T1`、`T2`）：单步派发 `--tier high`（默认强度 `high`，疑难排查可加 `--effort xhigh` 或 `max`）。
   - 低风险强关联路由与单测（`T3 + T4`）：打包派发 `--tier low`（默认强度 `medium`，简单机械修改可加 `--effort low`）。
4. 每次 `batonflow` 返回 `0` 后，自动检查 `git diff`、运行测试/构建、将 `PLAN.md` 对应项标记为 `[x]` 并执行 `git commit` 存档。

> **小贴士（关于权限确认）**：
> 1. 第一次在终端调用 `batonflow --tier ...` 时，弹窗点击 **Always Allow**，后续 Planner 即可全程无人值守派发。
> 2. 子进程 Executor 默认以非交互模式 + **工作区受限自动写入**运行（`codex --sandbox workspace-write`、`claude --permission-mode acceptEdits`、`agy --mode=auto`），改项目文件不会卡在 `y/n` 确认，同时仍拦截高危系统操作。

---

## 3. 零成本体验自动限流接力（Mock 演示）

运行内置模拟命令，直观查看首选 Executor（`codex`）触发 5 小时 429 限流后如何自动交棒给 `claude`：

```bash
batonflow --mock failover --tier high --effort xhigh --task "实现 JWT 刷新中间件"
```

输出示例：
```text
[batonflow] DISPATCH executor=codex tier=high model=mock-codex-high effort=xhigh
[codex] HTTP 429 Too Many Requests: You have reached your 5-hour rate limit. Please try again in 45 minutes.
[batonflow] HANDOFF codex (short_limit: try again in 45 minutes) -> claude
[batonflow] DISPATCH executor=claude tier=high model=mock-claude-high effort=xhigh
[batonflow] SUCCESS executor=claude model=mock-claude-high effort=xhigh duration=0.1s log=.batonflow/logs/...
```

同时 `codex` 会进入 `.batonflow/state.json` 冷却记录，下一个子任务会直接跳过 `codex` 交给 `claude`，避免重复撞限流。

---

## 4. 5 小时限额 vs 周限额实战场景

### 场景 A：全链路触发 5 小时限额（退出码 `2`）
默认配置 `"short_limit": "manual_pause"`：
1. `batonflow` 输出结构化指令：
   ```text
   [batonflow] RESULT exit=2 limit_type=short_limit next_action=manual_pause reset_hint="try again in 45 minutes" executors=codex:short_limit,claude:short_limit
   ```
2. Antigravity 自动保护已通过的 `git commit`，回滚半成品脏 diff，在 `PLAN.md` 标记 `[!]` 并写入恢复时间提示，然后暂停。
3. 等 45 分钟额度恢复后，直接对 Antigravity 说：
   > 「额度恢复了，请读取 `PLAN.md`，用 **batonflow** 继续未完成的任务。」

> **想过夜无人值守自动等恢复？** 在 `batonflow.config.json` 中把 `"short_limit"` 改为 `"auto_wait"`，`batonflow` 会自动解析报错中的恢复时间（或按 `poll_interval_seconds` 轮询）并在 `max_wait_seconds` 内自动重试。

### 场景 B：全链路触发周限额 / 硬配额耗尽（退出码 `3`）
默认配置 `"weekly_limit": "planner_takeover"`：
1. `batonflow` 输出：
   ```text
   [batonflow] RESULT exit=3 limit_type=weekly_limit next_action=planner_takeover reset_hint="resets on Monday" executors=codex:weekly_limit,claude:weekly_limit
   ```
2. Antigravity 清理脏状态、在 `PLAN.md` 记录交接日志，随后**直接使用自身原生代码编辑能力接管剩余任务**，同样保持“测试通过 → `git commit` 存档”的验收闭环！

> **不想消耗 Planner 自身额度？** 把 `"weekly_limit"` 改成 `"manual_pause"` 即可暂停等待。

---

## 5. 跨客户端无缝断点续传（Antigravity ↔ Claude Code）

假设早上用 Antigravity 完成了 `T1`、`T2`，在 `T3` 因限流暂停并标记了 `[!]`。下午你打开 **Claude Code**（或新开一个 Antigravity 对话），只需输入：

> 「请读取 `.batonflow/WORKFLOW.md` 和 `PLAN.md`，查看 `git log -n 5` 与 `batonflow --status`，用 batonflow 从 `[!]` 任务继续执行。」

由于每个已验收任务都已沉淀为独立 `git commit`，且 `PLAN.md` 完整记录了上下文，新客户端可以**零丢失**直接从 `T3` 接着干。

---

## 6. 计划生命周期：归档旧计划与废弃重来

`PLAN.md` 遵循**单活跃里程碑原则**——始终只保留当前正在进行的这一个计划（保持在 60~120 行），避免历史任务堆积导致 Token 膨胀或编号冲突。

### A. 完成旧计划后开启新计划
当 `PLAN.md` 中所有任务都标记为 `[x]` 后，开启新需求时 Planner 会自动运行 `batonflow archive <简短名称>`（你也可以随时手动运行）：

```bash
batonflow archive jwt-auth
```

效果：
- 将旧计划归档至 `.batonflow/archive/YYYY-MM-DD-jwt-auth.md`（留底备查，Planner 平时不会读取，**零 Token 消耗**）。
- 自动重置 `PLAN.md`，同时**保留你已填写的 Tech Stack、Verification Commands 与 Hard Constraints**。

### B. 觉得当前计划不好，想中途抛弃并重新开始

1. **还没开始写代码，或想保留已提交的前几步代码（只重置计划）**：
   - 直接对 Planner 说：
     > 「放弃当前计划，先用 `batonflow archive abandoned --force` 归档重置 `PLAN.md`，再用 batonflow 重新规划 XXX。」
   - 或在终端手动执行：
     ```bash
     git checkout -- .                    # 丢弃未提交的半成品修改（如有）
     batonflow archive abandoned --force  # 强制归档未完成的旧 PLAN.md 并干净重置
     ```

2. **旧计划已经跑了几步，想把写出的代码也一并彻底回滚**：
   由于每个验收通过的任务都是独立 `git commit`，回滚非常干净：
   ```bash
   git log -n 10 --oneline              # 找到旧计划开始前的干净 commit（例如 abc1234）
   batonflow archive abandoned --force  # 可选：先把旧计划归档留底
   git reset --hard abc1234             # 若已推远程，建议改用：git checkout -b feat/new-plan abc1234
   ```

> **最佳实践**：做大需求前先切一条独立功能分支（`git checkout -b feat/try-a`）；万一中途决定推倒重来，直接切回 `main` 新开分支（`git checkout -b feat/try-b`），零风险无需回滚。

---

## 7. 日常高频命令速查

```bash
# 升级全局 CLI（npm install -g batonflow@latest）后，一键安全刷新当前项目的框架规则与 Skill
# （100% 保留你的 batonflow.config.json、PLAN.md 和 .claude/settings.json）
batonflow upgrade

# 同步刷新所有客户端的全局 Skill
batonflow upgrade --global-skill

# 完成一个里程碑后归档旧 PLAN.md 并智能重置（自动保留技术栈和测试命令，防止 Token 膨胀）
batonflow archive jwt-auth

# 若计划未完成但需强行切换新需求，可加 --force 强制归档
batonflow archive old-prototype --force

# 查看各 Executor 冷却剩余时间与当前耗尽策略
batonflow --status

# 额度提前恢复时，手动清空冷却状态
batonflow --reset-state

# 强制指定某个 Executor 与思维强度（不走链路接力）
batonflow --tier high --effort xhigh --executor claude --task "审查认证边界条件"

# 极限推理强度（codex/claude 用 max，接力到 gemini/agy 时自动映射为 xhigh）
batonflow --tier high --effort max --task "定位任务队列中的并发竞态问题"

# 快速低强度模式（适合简单机械修改）
batonflow --tier low --effort low --task "批量重命名测试中的环境变量常量"

# 通过文件传递超长多行任务 Prompt
batonflow --tier high --task-file .batonflow/current-task.md
```
