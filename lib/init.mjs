/**
 * Zero-dependency project & universal Agent Skill initializer powering `batonflow init`.
 *
 * Installs the cross-client Agent Skill (`skills/batonflow/SKILL.md`) for:
 *   - Antigravity / Codex / Gemini CLI / Cursor / OpenCode (.agents/skills/batonflow/SKILL.md)
 *   - Claude Code (.claude/skills/batonflow/SKILL.md)
 *
 * Safety guarantees:
 *   - Defaults to current working directory when no targetDir is provided.
 *   - `--global-skill [all|antigravity|claude-code|codex]` installs global SKILL.md files
 *     without creating any project files in cwd.
 *   - Never overwrites existing batonflow.config.json, PLAN.md, SKILL.md, or .claude/settings.json
 *     unless --force is explicitly passed.
 *   - Never overwrites existing CLAUDE.md; appends/updates an idempotent marker block
 *     (<!-- batonflow:start --> ... <!-- batonflow:end -->) preserving all existing rules.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const START_MARKER = '<!-- batonflow:start -->';
const END_MARKER = '<!-- batonflow:end -->';

export const PERMISSION_COMMAND_PRESETS = {
  safe: {
    codex: [
      'codex',
      'exec',
      '--sandbox',
      'workspace-write',
      '-m',
      '{{model}}',
      '-c',
      'model_reasoning_effort={{effort}}',
      '{{task}}',
    ],
    claude: [
      'claude',
      '-p',
      '--permission-mode',
      'acceptEdits',
      '--model',
      '{{model}}',
      '--effort',
      '{{effort}}',
      '{{task}}',
    ],
    gemini: [
      'agy',
      '--mode=auto',
      '-p',
      '{{task}}',
      '--model',
      '{{model}}',
      '--effort',
      '{{effort}}',
    ],
  },
  yolo: {
    codex: [
      'codex',
      'exec',
      '--yolo',
      '-m',
      '{{model}}',
      '-c',
      'model_reasoning_effort={{effort}}',
      '{{task}}',
    ],
    claude: [
      'claude',
      '-p',
      '--dangerously-skip-permissions',
      '--model',
      '{{model}}',
      '--effort',
      '{{effort}}',
      '{{task}}',
    ],
    gemini: [
      'agy',
      '-p',
      '{{task}}',
      '--model',
      '{{model}}',
      '--effort',
      '{{effort}}',
      '--dangerously-skip-permissions',
    ],
  },
};

/**
 * Switch built-in executor commands (codex / claude / gemini) in an existing
 * batonflow.config.json between "safe" (scoped workspace-write) and "yolo" (full-bypass).
 * Preserves all custom models, executor_chain, policies, and third-party executors.
 */
export function applyPermissionMode({ mode, configPath = null, cwd = process.cwd() }) {
  const preset = PERMISSION_COMMAND_PRESETS[mode];
  if (!preset) {
    throw new Error(`Invalid permission mode "${mode}". Expected: safe | yolo`);
  }

  const resolvedConfig = path.resolve(cwd, configPath || 'batonflow.config.json');
  if (!fs.existsSync(resolvedConfig)) {
    throw new Error(`Config file not found: ${resolvedConfig}. Run "batonflow init" first.`);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolvedConfig, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${resolvedConfig}: ${err.message}`);
  }

  if (!data.commands || typeof data.commands !== 'object') {
    data.commands = {};
  }

  const updated = [];
  for (const [executor, cmd] of Object.entries(preset)) {
    if (Object.prototype.hasOwnProperty.call(data.commands, executor)) {
      data.commands[executor] = [...cmd];
      updated.push(executor);
    }
  }

  fs.writeFileSync(resolvedConfig, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  console.log(`Updated permission mode to "${mode}" in: ${resolvedConfig}`);
  console.log(`Updated executors: ${updated.length > 0 ? updated.join(', ') : '(none matched codex/claude/gemini)'}`);
  if (mode === 'yolo') {
    console.log(
      '\nWARNING: "yolo" mode enables full-bypass flags (--yolo / --dangerously-skip-permissions).'
    );
    console.log(
      '         Use ONLY inside isolated Docker containers, ephemeral VMs, or disposable CI runners!'
    );
    console.log('         Switch back anytime with: batonflow mode safe');
  }
}

function copySafe(src, dst, label, force) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst) && !force) {
    console.log(`  [skip]   ${label} already exists (use --force to overwrite)`);
    return 'skipped';
  }
  fs.copyFileSync(src, dst);
  console.log(`  [write]  ${label}`);
  return 'written';
}

function appendGitignoreEntry(targetDir, entry) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }
  const lines = content.split(/\r?\n/);
  if (lines.includes(entry)) {
    return;
  }
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gitignorePath, `${content}${prefix}${entry}\n`, 'utf8');
  console.log(`  [append] .gitignore += ${entry}`);
}

function mergeClaudeMdSnippet(packageRoot, targetDir) {
  const targetFile = path.join(targetDir, 'CLAUDE.md');
  const snippetPath = path.join(packageRoot, 'adapters', 'claude-code', 'CLAUDE.md.snippet');
  const snippet = fs.readFileSync(snippetPath, 'utf8').trimEnd();

  if (!fs.existsSync(targetFile)) {
    fs.writeFileSync(targetFile, `${snippet}\n`, 'utf8');
    console.log('  [write]  CLAUDE.md (created with batonflow snippet)');
    return;
  }

  const existing = fs.readFileSync(targetFile, 'utf8');
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + END_MARKER.length);
    const updated = `${before}${snippet}${after}`;
    fs.writeFileSync(targetFile, updated.endsWith('\n') ? updated : `${updated}\n`, 'utf8');
    console.log('  [update] CLAUDE.md (updated batonflow marker block; existing rules preserved)');
  } else {
    const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(targetFile, `${existing}${separator}${snippet}\n`, 'utf8');
    console.log('  [append] CLAUDE.md (appended batonflow block; existing rules preserved)');
  }
}

/**
 * Install the universal batonflow Agent Skill globally for one or all supported clients:
 *   - codex (universal): ~/.agents/skills/batonflow/SKILL.md
 *   - antigravity:       ~/.gemini/config/skills/batonflow/SKILL.md
 *   - claude-code:       ~/.claude/skills/batonflow/SKILL.md
 */
export function installGlobalSkill({ packageRoot, target = 'all', force = false }) {
  const homeDir = process.env.BATONFLOW_HOME || os.homedir();
  const src = path.join(packageRoot, 'skills', 'batonflow', 'SKILL.md');

  const targets = [
    {
      key: 'codex',
      label: 'Codex / Universal Agent Skills',
      path: path.join(homeDir, '.agents', 'skills', 'batonflow', 'SKILL.md'),
    },
    {
      key: 'antigravity',
      label: 'Antigravity',
      path: path.join(homeDir, '.gemini', 'config', 'skills', 'batonflow', 'SKILL.md'),
    },
    {
      key: 'claude-code',
      label: 'Claude Code',
      path: path.join(homeDir, '.claude', 'skills', 'batonflow', 'SKILL.md'),
    },
  ];

  const selected = target === 'all' ? targets : targets.filter((t) => t.key === target);

  console.log(`Installing universal batonflow Skill globally (target: ${target}):\n`);
  for (const item of selected) {
    copySafe(src, item.path, `[${item.label}] ${item.path}`, force);
  }

  console.log('\nDone! Your AI clients will now discover the `batonflow` skill automatically across all repos.');
  console.log('Inside each project you want to orchestrate, run `batonflow init` once to create batonflow.config.json and PLAN.md.');
}

/**
 * Initialize batonflow into a target repository (or install global skill only).
 */
export function runInit({
  packageRoot,
  targetDir = null,
  adapter = 'all',
  permissionMode = 'safe',
  globalSkill = false,
  globalSkillTarget = 'all',
  force = false,
  cwd = process.cwd(),
}) {
  if (globalSkill) {
    installGlobalSkill({ packageRoot, target: globalSkillTarget, force });
    return;
  }

  const resolvedTarget = path.resolve(cwd, targetDir || '.');
  const skillSrc = path.join(packageRoot, 'skills', 'batonflow', 'SKILL.md');
  fs.mkdirSync(resolvedTarget, { recursive: true });

  console.log(`Initializing batonflow in: ${resolvedTarget}\n`);

  // 1. Core config, workflow, and task board
  const configDst = path.join(resolvedTarget, 'batonflow.config.json');
  const configStatus = copySafe(
    path.join(packageRoot, 'batonflow.config.example.json'),
    configDst,
    'batonflow.config.json',
    force
  );
  if (permissionMode === 'yolo' && configStatus === 'written') {
    applyPermissionMode({ mode: 'yolo', configPath: configDst, cwd: resolvedTarget });
  }
  copySafe(
    path.join(packageRoot, 'templates', 'WORKFLOW.md'),
    path.join(resolvedTarget, '.batonflow', 'WORKFLOW.md'),
    '.batonflow/WORKFLOW.md',
    force
  );
  copySafe(
    path.join(packageRoot, 'templates', 'PLAN.md'),
    path.join(resolvedTarget, 'PLAN.md'),
    'PLAN.md',
    force
  );

  // 2. Ensure runtime logs and state are gitignored
  appendGitignoreEntry(resolvedTarget, '.batonflow/logs/');
  appendGitignoreEntry(resolvedTarget, '.batonflow/*.json');

  // 3. Install selected client skills & adapters
  if (adapter === 'antigravity' || adapter === 'codex' || adapter === 'all') {
    copySafe(
      skillSrc,
      path.join(resolvedTarget, '.agents', 'skills', 'batonflow', 'SKILL.md'),
      '.agents/skills/batonflow/SKILL.md',
      force
    );
  }

  if (adapter === 'antigravity' || adapter === 'all') {
    copySafe(
      path.join(packageRoot, 'adapters', 'antigravity', 'rules.md'),
      path.join(resolvedTarget, '.agent', 'rules', 'batonflow.md'),
      '.agent/rules/batonflow.md',
      force
    );
  }

  if (adapter === 'claude-code' || adapter === 'all') {
    copySafe(
      skillSrc,
      path.join(resolvedTarget, '.claude', 'skills', 'batonflow', 'SKILL.md'),
      '.claude/skills/batonflow/SKILL.md',
      force
    );
    mergeClaudeMdSnippet(packageRoot, resolvedTarget);
    const claudeSettingsDst = path.join(resolvedTarget, '.claude', 'settings.json');
    const claudeSettingsSrc = path.join(packageRoot, 'adapters', 'claude-code', 'settings.json');
    if (fs.existsSync(claudeSettingsDst) && !force) {
      console.log(
        `  [skip]   .claude/settings.json already exists — merge permissions from ${claudeSettingsSrc} manually`
      );
    } else {
      fs.mkdirSync(path.dirname(claudeSettingsDst), { recursive: true });
      fs.copyFileSync(claudeSettingsSrc, claudeSettingsDst);
      console.log('  [write]  .claude/settings.json');
    }
  }

  console.log('\nDone! Next steps:');
  console.log(`  1. Customize models & policies in:  ${path.join(resolvedTarget, 'batonflow.config.json')}`);
  console.log(`  2. Fill in your tasks in:           ${path.join(resolvedTarget, 'PLAN.md')}`);
  console.log('  3. Dry-run verify:                  batonflow --dry-run --tier high --task "Verify setup"');
  console.log('  4. Optional global Skill (all CLIs): batonflow init --global-skill');
}
