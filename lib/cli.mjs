/**
 * Zero-dependency CLI argument parser and help text for agent-baton.
 */

import fs from 'node:fs';

export const VERSION = '0.1.0';

export const HELP_TEXT = `agent-baton v${VERSION}
Pass the coding baton across any AI CLI—with automatic failover and zero lost context.

USAGE:
  agent-baton init [target-dir] [--adapter antigravity|claude-code|all|none] [--force]
  agent-baton --tier <high|low> --task "<description>" [options]
  agent-baton --tier <high|low> --task-file <path|-> [options]
  agent-baton --status [--config <path>]
  agent-baton --reset-state [--config <path>]

SUBCOMMANDS:
  init [target-dir]         Initialize agent-baton config, templates, and adapters into
                            the current directory (default) or target-dir.
                            Options: --adapter <antigravity|claude-code|all|none> (default: all)
                                     --force (overwrite existing config/templates)

OPTIONS:
  --tier <high|low>         Model capability tier to route (required for task execution)
  --task <text>             Task description / prompt sent to the Executor
  --task-file <path|->      Read task description from file (or "-" for stdin)
  --executor <name>         Force a single specific executor (disables chain failover)
  --config <path>           Path to config JSON (default: ./agent-baton.config.json)
  --dry-run                 Print resolved executor chain, models, and commands without running
  --mock [scenario]         Run built-in mock simulation without real API calls.
                            Scenarios: failover (default), success, short-limit,
                            weekly-limit, error, auto-wait
  --ignore-cooldown         Ignore active cooldown windows in .agent-baton/state.json
  --no-prefix               Do not prepend executor_prompt_prefix to the task
  --status                  Show current cooldown state and active exhaustion policies
  --reset-state             Clear saved cooldown state (.agent-baton/state.json)
  -h, --help                Show this help message
  -v, --version             Show version

EXIT CODES:
  0  Task executed successfully by an Executor
  1  Normal execution failure, timeout, configuration error, or blocked nested call
  2  All executors unavailable/rate-limited (at least one short-term / 5-hour limit)
  3  All usable executors exhausted by weekly / hard quota limits

EXAMPLES:
  cd /path/to/your-project && agent-baton init
  agent-baton init --adapter claude-code
  agent-baton --tier high --task "Implement JWT refresh middleware with unit tests"
  agent-baton --tier low --task-file .agent-baton/current-task.md
  agent-baton --tier high --executor claude --task "Refactor auth store"
  agent-baton --mock failover --tier high --task "Demo automatic relay"
  agent-baton --dry-run --tier low --task "Add unit tests for parser"
`;

export const INIT_HELP_TEXT = `agent-baton init v${VERSION}
Safely initialize agent-baton into your current directory or a specified project path.

USAGE:
  agent-baton init [target-dir] [options]

OPTIONS:
  --adapter <mode>   Adapter templates to install: antigravity | claude-code | all | none (default: all)
  --force            Overwrite existing agent-baton.config.json, PLAN.md, and adapter files
  -h, --help         Show this help message

EXAMPLES:
  cd ~/projects/my-app && agent-baton init
  agent-baton init --adapter antigravity
  agent-baton init ~/projects/my-app --adapter claude-code
`;

/**
 * Parse arguments for `agent-baton init ...`.
 * @param {string[]} argv
 */
function parseInitArgs(argv) {
  const validAdapters = new Set(['antigravity', 'claude-code', 'all', 'none']);
  const opts = {
    command: 'init',
    targetDir: null,
    adapter: 'all',
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--adapter') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --adapter (antigravity|claude-code|all|none)');
      }
      opts.adapter = argv[++i];
    } else if (arg.startsWith('--adapter=')) {
      opts.adapter = arg.slice('--adapter='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown init option: ${arg}. Run "agent-baton init --help" for usage.`);
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

  const opts = {
    command: 'run',
    tier: null,
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
          throw new Error(`Unknown argument: ${arg}. Run "agent-baton --help" for usage.`);
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
