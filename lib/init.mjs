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

/**
 * Sanitize a user-provided or extracted milestone name into a clean filename slug.
 * @param {string} raw
 */
function slugifyName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Count unfinished [ ] and [!] tasks in PLAN.md (ignoring legend/example prose).
 * @param {string} content
 */
function countUnfinishedTasks(content) {
  let pending = 0;
  let blocked = 0;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*Status legend:/i.test(line)) continue;
    // Table rows: | `T1` | `[ ]` | ... or | T1 | [ ] | ...
    if (/^\s*\|[^|]+\|\s*`?\[\s\]`?\s*\|/.test(line) || /^\s*[-*]\s+\[\s\]\s+/.test(line)) {
      pending += 1;
    } else if (/^\s*\|[^|]+\|\s*`?\[!\]`?\s*\|/.test(line) || /^\s*[-*]\s+\[!\]\s+/.test(line)) {
      blocked += 1;
    }
  }

  return { pending, blocked };
}

/**
 * Build a fresh PLAN.md from templates/PLAN.md while preserving project-level
 * Tech Stack, Repo Conventions, Verification Commands, and Hard Constraints
 * from Section 1 of the previous PLAN.md (when present).
 * @param {string} oldContent
 * @param {string} templateContent
 */
function buildResetPlan(oldContent, templateContent) {
  const sec1OldMatch = oldContent.match(
    /(-\s*\*\*Tech Stack\*\*:[\s\S]*?)(?=\n---\s*\n+##\s*2\.|\n##\s*2\.)/
  );
  const sec1TplMatch = templateContent.match(
    /(-\s*\*\*Tech Stack\*\*:[\s\S]*?)(?=\n---\s*\n+##\s*2\.|\n##\s*2\.)/
  );

  if (sec1OldMatch && sec1TplMatch) {
    return {
      content: templateContent.replace(sec1TplMatch[1], sec1OldMatch[1].trimEnd()),
      preservedConstraints: true,
    };
  }

  return {
    content: templateContent,
    preservedConstraints: false,
  };
}

/**
 * Archive the current PLAN.md into .batonflow/archive/YYYY-MM-DD-<slug>.md
 * and reset PLAN.md for the next active milestone.
 */
export function archivePlan({
  packageRoot,
  name = null,
  planPath = null,
  force = false,
  cwd = process.cwd(),
}) {
  const resolvedPlan = path.resolve(cwd, planPath || 'PLAN.md');
  if (!fs.existsSync(resolvedPlan)) {
    throw new Error(`PLAN.md not found at ${resolvedPlan}. Run "batonflow init" first.`);
  }

  const oldContent = fs.readFileSync(resolvedPlan, 'utf8');
  const { pending, blocked } = countUnfinishedTasks(oldContent);

  if ((pending > 0 || blocked > 0) && !force) {
    throw new Error(
      `Refusing to archive ${resolvedPlan}: found ${pending} pending ([ ]) and ${blocked} interrupted ([!]) task(s). ` +
        'Finish remaining tasks first, or pass --force to archive anyway.'
    );
  }

  const now = new Date();
  const datePrefix = now.toISOString().slice(0, 10);
  const timeFallback = now.toISOString().slice(11, 19).replace(/:/g, '');

  let slug = slugifyName(name);
  if (!slug) {
    const objMatch = oldContent.match(/^\s*-\s*\*\*Objective\*\*:\s*(.+)$/m);
    const objText = objMatch ? objMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
    slug = slugifyName(objText) || `plan-${timeFallback}`;
  }

  const archiveDir = path.join(path.dirname(resolvedPlan), '.batonflow', 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });

  let archivePath = path.join(archiveDir, `${datePrefix}-${slug}.md`);
  let counter = 2;
  while (fs.existsSync(archivePath)) {
    archivePath = path.join(archiveDir, `${datePrefix}-${slug}-${counter}.md`);
    counter += 1;
  }

  fs.writeFileSync(archivePath, oldContent, 'utf8');

  const templatePath = path.join(packageRoot, 'templates', 'PLAN.md');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  const { content: freshPlan, preservedConstraints } = buildResetPlan(oldContent, templateContent);
  fs.writeFileSync(resolvedPlan, freshPlan, 'utf8');

  const relArchive = path.relative(cwd, archivePath) || archivePath;
  console.log(`Archived plan to: ${relArchive}`);
  console.log(
    preservedConstraints
      ? `Reset ${path.basename(resolvedPlan)} for the next milestone (preserved Tech Stack, Verification Commands, and Hard Constraints).`
      : `Reset ${path.basename(resolvedPlan)} to a clean template for the next milestone.`
  );

  return { archivePath, preservedConstraints };
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

/**
 * Safely upgrade framework-managed files (WORKFLOW.md, SKILL.md, rules, CLAUDE.md marker block)
 * inside an existing batonflow project WITHOUT ever touching batonflow.config.json,
 * PLAN.md, or .claude/settings.json.
 */
export function runUpgrade({
  packageRoot,
  targetDir = null,
  adapter = null,
  globalSkill = false,
  globalSkillTarget = 'all',
  cwd = process.cwd(),
}) {
  if (globalSkill) {
    installGlobalSkill({ packageRoot, target: globalSkillTarget, force: true });
    return;
  }

  const resolvedTarget = path.resolve(cwd, targetDir || '.');
  const configPath = path.join(resolvedTarget, 'batonflow.config.json');
  const workflowPath = path.join(resolvedTarget, '.batonflow', 'WORKFLOW.md');

  if (!fs.existsSync(configPath) && !fs.existsSync(workflowPath)) {
    throw new Error(
      `No existing batonflow setup found in ${resolvedTarget}. Run "batonflow init" first.`
    );
  }

  const skillSrc = path.join(packageRoot, 'skills', 'batonflow', 'SKILL.md');
  const agySkillDst = path.join(resolvedTarget, '.agents', 'skills', 'batonflow', 'SKILL.md');
  const agyRuleDst = path.join(resolvedTarget, '.agent', 'rules', 'batonflow.md');
  const claudeSkillDst = path.join(resolvedTarget, '.claude', 'skills', 'batonflow', 'SKILL.md');
  const claudeMdDst = path.join(resolvedTarget, 'CLAUDE.md');

  const hasAgyRule = fs.existsSync(agyRuleDst);
  const hasAgySkill = fs.existsSync(agySkillDst);
  const hasClaudeSkill = fs.existsSync(claudeSkillDst);
  const hasClaudeMarker =
    fs.existsSync(claudeMdDst) && fs.readFileSync(claudeMdDst, 'utf8').includes(START_MARKER);

  const updateUniversalSkill =
    adapter !== null
      ? adapter === 'antigravity' || adapter === 'codex' || adapter === 'all'
      : hasAgySkill || hasAgyRule;
  const updateAgyRule =
    adapter !== null ? adapter === 'antigravity' || adapter === 'all' : hasAgyRule;
  const updateClaude =
    adapter !== null
      ? adapter === 'claude-code' || adapter === 'all'
      : hasClaudeSkill || hasClaudeMarker;

  console.log(`Upgrading batonflow framework files in: ${resolvedTarget}\n`);

  // Always refresh .batonflow/WORKFLOW.md
  copySafe(
    path.join(packageRoot, 'templates', 'WORKFLOW.md'),
    workflowPath,
    '.batonflow/WORKFLOW.md',
    true
  );

  // Ensure .gitignore covers runtime logs/state
  appendGitignoreEntry(resolvedTarget, '.batonflow/logs/');
  appendGitignoreEntry(resolvedTarget, '.batonflow/*.json');

  // Refresh detected (or explicitly selected) client skills & rules
  if (updateUniversalSkill) {
    copySafe(skillSrc, agySkillDst, '.agents/skills/batonflow/SKILL.md', true);
  }
  if (updateAgyRule) {
    copySafe(
      path.join(packageRoot, 'adapters', 'antigravity', 'rules.md'),
      agyRuleDst,
      '.agent/rules/batonflow.md',
      true
    );
  }
  if (updateClaude) {
    copySafe(skillSrc, claudeSkillDst, '.claude/skills/batonflow/SKILL.md', true);
    mergeClaudeMdSnippet(packageRoot, resolvedTarget);
  }

  console.log('\nPreserved user files (untouched):');
  console.log('  - batonflow.config.json');
  console.log('  - PLAN.md');
  console.log('  - .claude/settings.json');
  console.log('\nUpgrade complete!');
}
