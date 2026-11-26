/**
 * Zero-dependency project initializer powering `batonflow init`.
 *
 * Safety guarantees:
 *   - Defaults to current working directory when no targetDir is provided.
 *   - Never overwrites existing batonflow.config.json, PLAN.md, or .claude/settings.json
 *     unless --force is explicitly passed.
 *   - Never overwrites existing CLAUDE.md; appends/updates an idempotent marker block
 *     (<!-- batonflow:start --> ... <!-- batonflow:end -->) preserving all existing rules.
 */

import fs from 'node:fs';
import path from 'node:path';

const START_MARKER = '<!-- batonflow:start -->';
const END_MARKER = '<!-- batonflow:end -->';

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
 * Initialize batonflow into a target repository.
 * @param {{ packageRoot: string, targetDir?: string | null, adapter?: string, force?: boolean, cwd?: string }} options
 */
export function runInit({
  packageRoot,
  targetDir = null,
  adapter = 'all',
  force = false,
  cwd = process.cwd(),
}) {
  const resolvedTarget = path.resolve(cwd, targetDir || '.');
  fs.mkdirSync(resolvedTarget, { recursive: true });

  console.log(`Initializing batonflow in: ${resolvedTarget}\n`);

  // 1. Core config, workflow, and task board
  copySafe(
    path.join(packageRoot, 'batonflow.config.example.json'),
    path.join(resolvedTarget, 'batonflow.config.json'),
    'batonflow.config.json',
    force
  );
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

  // 3. Install selected adapters
  if (adapter === 'antigravity' || adapter === 'all') {
    copySafe(
      path.join(packageRoot, 'adapters', 'antigravity', 'rules.md'),
      path.join(resolvedTarget, '.agent', 'rules', 'batonflow.md'),
      '.agent/rules/batonflow.md',
      force
    );
  }

  if (adapter === 'claude-code' || adapter === 'all') {
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
}
