/**
 * Zero-dependency CLI argument parser and help text for codebaton.
 */

import fs from 'node:fs';

export const VERSION = '0.1.0';

export const HELP_TEXT = `codebaton v${VERSION}
Pass the coding baton across any AI CLI—with automatic failover and zero lost context.

USAGE:
  codebaton --tier <high|low> --task "<description>" [options]
  codebaton --tier <high|low> --task-file <path|-> [options]
  codebaton --status [--config <path>]
  codebaton --reset-state [--config <path>]

OPTIONS:
  --tier <high|low>         Model capability tier to route (required for task execution)
  --task <text>             Task description / prompt sent to the Executor
  --task-file <path|->      Read task description from file (or "-" for stdin)
  --executor <name>         Force a single specific executor (disables chain failover)
  --config <path>           Path to config JSON (default: ./codebaton.config.json)
  --dry-run                 Print resolved executor chain, models, and commands without running
  --mock [scenario]         Run built-in mock simulation without real API calls.
                            Scenarios: failover (default), success, short-limit,
                            weekly-limit, error, auto-wait
  --ignore-cooldown         Ignore active cooldown windows in .codebaton/state.json
  --no-prefix               Do not prepend executor_prompt_prefix to the task
  --status                  Show current cooldown state and active exhaustion policies
  --reset-state             Clear saved cooldown state (.codebaton/state.json)
  -h, --help                Show this help message
  -v, --version             Show version

EXIT CODES:
  0  Task executed successfully by an Executor
  1  Normal execution failure, timeout, configuration error, or blocked nested call
  2  All executors unavailable/rate-limited (at least one short-term / 5-hour limit)
  3  All usable executors exhausted by weekly / hard quota limits

EXAMPLES:
  codebaton --tier high --task "Implement JWT refresh middleware with unit tests"
  codebaton --tier low --task-file .codebaton/current-task.md
  codebaton --tier high --executor claude --task "Refactor auth store"
  codebaton --mock failover --tier high --task "Demo automatic relay"
  codebaton --dry-run --tier low --task "Add unit tests for parser"
`;

/**
 * Parse argv (excluding node binary and script path).
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const opts = {
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
        // Support optional scenario value: --mock failover
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
          throw new Error(`Unknown argument: ${arg}. Run "codebaton --help" for usage.`);
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
