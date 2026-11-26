/**
 * Zero-dependency CLI argument parser and help text for batonflow.
 */

import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;

export const HELP_TEXT = `batonflow v${VERSION}
Pass the coding baton across any AI CLI—with automatic failover and zero lost context.

USAGE:
  batonflow init [target-dir] [--adapter antigravity|claude-code|codex|all|none] [--permission-mode safe|yolo] [--force]
  batonflow init --global-skill [all|antigravity|claude-code|codex] [--force]
  batonflow mode <safe|yolo> [--config <path>]
  batonflow --tier <high|low> --task "<description>" [options]
  batonflow --tier <high|low> --task-file <path|-> [options]
  batonflow --status [--config <path>]
  batonflow --reset-state [--config <path>]

SUBCOMMANDS:
  init [target-dir]         Initialize batonflow config, templates, universal Agent Skill, and
                            adapters into the current directory or target-dir.
                            Options: --adapter <antigravity|claude-code|codex|all|none> (default: all)
                                     --permission-mode <safe|yolo> (default: safe)
                                     --global-skill [all|antigravity|claude-code|codex]
                                       (install universal Skill globally without touching cwd)
                                     --force (overwrite existing config/templates/skill)
  mode <safe|yolo>          Switch built-in executor commands in batonflow.config.json between:
                              safe : scoped workspace-write autonomy (recommended default)
                              yolo : full-bypass flags (isolated containers / VMs ONLY)

OPTIONS:
  --tier <high|low>         Model capability tier to route (required for task execution)
  --effort <level>          Reasoning/thinking effort: low | medium | high | xhigh | max
                            (defaults to config default_effort[tier]; mapped via effort_map)
  --task <text>             Task description / prompt sent to the Executor
  --task-file <path|->      Read task description from file (or "-" for stdin)
  --executor <name>         Force a single specific executor (disables chain failover)
  --config <path>           Path to config JSON (default: ./batonflow.config.json)
  --dry-run                 Print resolved executor chain, models, and commands without running
  --mock [scenario]         Run built-in mock simulation without real API calls.
                            Scenarios: failover (default), success, short-limit,
                            weekly-limit, error, auto-wait
  --ignore-cooldown         Ignore active cooldown windows in .batonflow/state.json
  --no-prefix               Do not prepend executor_prompt_prefix to the task
  --status                  Show current cooldown state and active exhaustion policies
  --reset-state             Clear saved cooldown state (.batonflow/state.json)
  -h, --help                Show this help message
  -v, --version             Show version

EXIT CODES:
  0  Task executed successfully by an Executor
  1  Normal execution failure, timeout, configuration error, or blocked nested call
  2  All executors unavailable/rate-limited (at least one short-term / 5-hour limit)
  3  All usable executors exhausted by weekly / hard quota limits

EXAMPLES:
  cd /path/to/your-project && batonflow init
  batonflow init --adapter claude-code
  batonflow --tier high --task "Implement JWT refresh middleware with unit tests"
  batonflow --tier low --task-file .batonflow/current-task.md
  batonflow --tier high --executor claude --task "Refactor auth store"
  batonflow --mock failover --tier high --task "Demo automatic relay"
  batonflow --dry-run --tier low --task "Add unit tests for parser"
`;

export const INIT_HELP_TEXT = `batonflow init v${VERSION}
Safely initialize batonflow into your current directory, a target project, or as a universal global Agent Skill.

USAGE:
  batonflow init [target-dir] [options]
  batonflow init --global-skill [all|antigravity|claude-code|codex] [--force]

OPTIONS:
  --adapter <mode>          Client adapters to install:
                            antigravity | claude-code | codex | all | none (default: all)
  --permission-mode <mode>  Executor non-interactive permission preset:
                            safe (default: workspace-write / acceptEdits / --mode=auto)
                            yolo (isolated containers/VMs ONLY: --yolo / --dangerously-skip-permissions)
  --global-skill [target]   Install universal Agent Skill globally without creating project files.
                            Targets: all (default), antigravity, claude-code, codex
                            - codex/universal: ~/.agents/skills/batonflow/SKILL.md
                            - antigravity:     ~/.gemini/config/skills/batonflow/SKILL.md
                            - claude-code:     ~/.claude/skills/batonflow/SKILL.md
  --force                   Overwrite existing batonflow.config.json, PLAN.md, and adapter/skill files
  -h, --help                Show this help message

EXAMPLES:
  cd ~/projects/my-app && batonflow init
  batonflow init --permission-mode yolo
  batonflow init --adapter claude-code
  batonflow init --global-skill
  batonflow init --global-skill claude-code
`;

export const MODE_HELP_TEXT = `batonflow mode v${VERSION}
Switch built-in executor permission presets in batonflow.config.json while preserving your models, policies, and custom executors.

USAGE:
  batonflow mode <safe|yolo> [--config <path>]

MODES:
  safe   Scoped workspace-write autonomy (recommended for local dev):
         codex --sandbox workspace-write | claude --permission-mode acceptEdits | agy --mode=auto
  yolo   Full-bypass non-interactive flags (use ONLY in isolated containers / VMs / CI):
         codex --yolo | claude --dangerously-skip-permissions | agy --dangerously-skip-permissions

EXAMPLES:
  batonflow mode yolo
  batonflow mode safe
  batonflow mode yolo --config ./custom.config.json
`;

/**
 * Parse arguments for `batonflow mode <safe|yolo> ...`.
 * @param {string[]} argv
 */
function parseModeArgs(argv) {
  const validModes = new Set(['safe', 'yolo']);
  const opts = {
    command: 'mode',
    mode: null,
    configPath: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--config') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --config');
      }
      opts.configPath = argv[++i];
    } else if (arg.startsWith('--config=')) {
      opts.configPath = arg.slice('--config='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown mode option: ${arg}. Run "batonflow mode --help" for usage.`);
    } else if (!opts.mode) {
      opts.mode = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  if (!opts.help) {
    if (!opts.mode || !validModes.has(opts.mode)) {
      throw new Error('Specify a valid permission mode: "batonflow mode safe" or "batonflow mode yolo".');
    }
  }

  return opts;
}

/**
 * Parse arguments for `batonflow init ...`.
 * @param {string[]} argv
 */
function parseInitArgs(argv) {
  const validAdapters = new Set(['antigravity', 'claude-code', 'codex', 'all', 'none']);
  const validGlobalTargets = new Set(['all', 'antigravity', 'claude-code', 'codex']);
  const validPermissionModes = new Set(['safe', 'yolo']);
  const opts = {
    command: 'init',
    targetDir: null,
    adapter: 'all',
    permissionMode: 'safe',
    globalSkill: false,
    globalSkillTarget: 'all',
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--permission-mode') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --permission-mode (safe|yolo)');
      }
      opts.permissionMode = argv[++i];
    } else if (arg.startsWith('--permission-mode=')) {
      opts.permissionMode = arg.slice('--permission-mode='.length);
    } else if (arg === '--global-skill') {
      opts.globalSkill = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && validGlobalTargets.has(next)) {
        opts.globalSkillTarget = next;
        i += 1;
      }
    } else if (arg.startsWith('--global-skill=')) {
      opts.globalSkill = true;
      opts.globalSkillTarget = arg.slice('--global-skill='.length);
    } else if (arg === '--adapter') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --adapter (antigravity|claude-code|codex|all|none)');
      }
      opts.adapter = argv[++i];
    } else if (arg.startsWith('--adapter=')) {
      opts.adapter = arg.slice('--adapter='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown init option: ${arg}. Run "batonflow init --help" for usage.`);
    } else if (!opts.targetDir) {
      opts.targetDir = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  if (!validAdapters.has(opts.adapter)) {
    throw new Error(
      `Invalid --adapter value "${opts.adapter}". Expected: ${[...validAdapters].join(' | ')}`
    );
  }
  if (!validPermissionModes.has(opts.permissionMode)) {
    throw new Error(
      `Invalid --permission-mode value "${opts.permissionMode}". Expected: safe | yolo`
    );
  }
  if (opts.globalSkill && !validGlobalTargets.has(opts.globalSkillTarget)) {
    throw new Error(
      `Invalid --global-skill target "${opts.globalSkillTarget}". Expected: ${[...validGlobalTargets].join(' | ')}`
    );
  }

  return opts;
}

/**
 * Parse argv (excluding node binary and script path).
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  if (argv[0] === 'init') {
    return parseInitArgs(argv.slice(1));
  }
  if (argv[0] === 'mode') {
    return parseModeArgs(argv.slice(1));
  }

  const opts = {
    command: 'run',
    tier: null,
    effort: null,
    task: null,
    taskFile: null,
    executor: null,
    configPath: null,
    dryRun: false,
    mock: false,
    mockScenario: 'failover',
    ignoreCooldown: false,
    noPrefix: false,
    status: false,
    resetState: false,
    help: false,
    version: false,
  };

  const validEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

  const validMockScenarios = new Set([
    'failover',
    'success',
    'short-limit',
    'weekly-limit',
    'error',
    'auto-wait',
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    const requireValue = (flag) => {
      if (i + 1 >= argv.length) {
        throw new Error(`Missing value for ${flag}`);
      }
      i += 1;
      return argv[i];
    };

    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '--tier':
        opts.tier = requireValue('--tier');
        break;
      case '--effort':
        opts.effort = requireValue('--effort');
        if (!validEfforts.has(opts.effort)) {
          throw new Error(
            `Invalid --effort value "${opts.effort}". Expected: ${[...validEfforts].join(' | ')}`
          );
        }
        break;
      case '--task':
        opts.task = requireValue('--task');
        break;
      case '--task-file':
        opts.taskFile = requireValue('--task-file');
        break;
      case '--executor':
        opts.executor = requireValue('--executor');
        break;
      case '--config':
        opts.configPath = requireValue('--config');
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--mock': {
        opts.mock = true;
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          if (!validMockScenarios.has(next)) {
            throw new Error(
              `Unknown --mock scenario "${next}". Valid scenarios: ${[...validMockScenarios].join(', ')}`
            );
          }
          opts.mockScenario = next;
          i += 1;
        }
        break;
      }
      case '--ignore-cooldown':
        opts.ignoreCooldown = true;
        break;
      case '--no-prefix':
        opts.noPrefix = true;
        break;
      case '--status':
        opts.status = true;
        break;
      case '--reset-state':
        opts.resetState = true;
        break;
      default:
        if (arg.startsWith('--tier=')) {
          opts.tier = arg.slice('--tier='.length);
        } else if (arg.startsWith('--effort=')) {
          opts.effort = arg.slice('--effort='.length);
          if (!validEfforts.has(opts.effort)) {
            throw new Error(
              `Invalid --effort value "${opts.effort}". Expected: ${[...validEfforts].join(' | ')}`
            );
          }
        } else if (arg.startsWith('--task=')) {
          opts.task = arg.slice('--task='.length);
        } else if (arg.startsWith('--task-file=')) {
          opts.taskFile = arg.slice('--task-file='.length);
        } else if (arg.startsWith('--executor=')) {
          opts.executor = arg.slice('--executor='.length);
        } else if (arg.startsWith('--config=')) {
          opts.configPath = arg.slice('--config='.length);
        } else if (arg.startsWith('--mock=')) {
          opts.mock = true;
          const scenario = arg.slice('--mock='.length);
          if (!validMockScenarios.has(scenario)) {
            throw new Error(
              `Unknown --mock scenario "${scenario}". Valid scenarios: ${[...validMockScenarios].join(', ')}`
            );
          }
          opts.mockScenario = scenario;
        } else {
          throw new Error(`Unknown argument: ${arg}. Run "batonflow --help" for usage.`);
        }
    }
  }

  return opts;
}

/**
 * Resolve task text from --task or --task-file (including "-" for stdin).
 * @param {{ task: string | null, taskFile: string | null }} opts
 * @returns {string}
 */
export function resolveTaskText(opts) {
  if (opts.task && opts.taskFile) {
    throw new Error('Specify either --task or --task-file, not both.');
  }
  if (opts.taskFile) {
    if (opts.taskFile === '-') {
      return fs.readFileSync(0, 'utf8').trim();
    }
    if (!fs.existsSync(opts.taskFile)) {
      throw new Error(`Task file not found: ${opts.taskFile}`);
    }
    return fs.readFileSync(opts.taskFile, 'utf8').trim();
  }
  if (opts.task !== null) {
    return opts.task.trim();
  }
  return '';
}
