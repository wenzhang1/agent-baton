#!/usr/bin/env bash
#
# scripts/init.sh - Safely initialize CodeBaton into any target repository.
#
# Usage:
#   ./scripts/init.sh <target-dir> [--adapter antigravity|claude-code|all|none] [--force]
#
# Safety guarantees:
#   - Never overwrites existing codebaton.config.json, PLAN.md, or .claude/settings.json
#     unless --force is explicitly passed.
#   - Never overwrites existing CLAUDE.md; appends/updates an idempotent marker block
#     (<!-- codebaton:start --> ... <!-- codebaton:end -->) while preserving all existing rules.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_DIR=""
ADAPTER="all"
FORCE=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/init.sh <target-project-dir> [options]

Options:
  --adapter <mode>   Adapter templates to install: antigravity | claude-code | all | none (default: all)
  --force            Overwrite existing codebaton.config.json, PLAN.md, and adapter files
  -h, --help         Show this help message

Examples:
  ./scripts/init.sh ~/projects/my-app
  ./scripts/init.sh ~/projects/my-app --adapter antigravity
  ./scripts/init.sh ~/projects/my-app --adapter claude-code
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --adapter)
      if [[ $# -lt 2 ]]; then
        echo "Error: --adapter requires a value (antigravity|claude-code|all|none)" >&2
        exit 1
      fi
      ADAPTER="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -*)
      echo "Error: Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -z "${TARGET_DIR}" ]]; then
        TARGET_DIR="$1"
      else
        echo "Error: Unexpected positional argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "${TARGET_DIR}" ]]; then
  echo "Error: Please provide a target project directory." >&2
  usage
  exit 1
fi

case "${ADAPTER}" in
  antigravity|claude-code|all|none) ;;
  *)
    echo "Error: Invalid --adapter value '${ADAPTER}'. Expected: antigravity | claude-code | all | none" >&2
    exit 1
    ;;
esac

mkdir -p "${TARGET_DIR}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"

copy_safe() {
  local src="$1"
  local dst="$2"
  local label="$3"

  mkdir -p "$(dirname "${dst}")"
  if [[ -f "${dst}" && "${FORCE}" -ne 1 ]]; then
    echo "  [skip]   ${label} already exists (use --force to overwrite)"
  else
    cp "${src}" "${dst}"
    echo "  [write]  ${label}"
  fi
}

append_gitignore_entry() {
  local gitignore="${TARGET_DIR}/.gitignore"
  local entry="$1"

  touch "${gitignore}"
  if ! grep -Fxq "${entry}" "${gitignore}"; then
    printf '%s\n' "${entry}" >> "${gitignore}"
    echo "  [append] .gitignore += ${entry}"
  fi
}

merge_claude_md_snippet() {
  local target_file="${TARGET_DIR}/CLAUDE.md"
  local snippet_file="${REPO_ROOT}/adapters/claude-code/CLAUDE.md.snippet"
  local start_marker="<!-- codebaton:start -->"
  local end_marker="<!-- codebaton:end -->"

  if [[ ! -f "${target_file}" ]]; then
    cp "${snippet_file}" "${target_file}"
    echo "  [write]  CLAUDE.md (created with CodeBaton snippet)"
    return
  fi

  if grep -Fq "${start_marker}" "${target_file}"; then
    # Replace existing marker block in place while preserving surrounding content.
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v start="${start_marker}" -v end="${end_marker}" -v sfile="${snippet_file}" '
      $0 == start {
        while ((getline line < sfile) > 0) print line
        close(sfile)
        skip = 1
        next
      }
      skip && $0 == end {
        skip = 0
        next
      }
      !skip { print }
    ' "${target_file}" > "${tmp_file}"
    mv "${tmp_file}" "${target_file}"
    echo "  [update] CLAUDE.md (updated CodeBaton marker block; existing rules preserved)"
  else
    printf '\n' >> "${target_file}"
    cat "${snippet_file}" >> "${target_file}"
    echo "  [append] CLAUDE.md (appended CodeBaton block; existing rules preserved)"
  fi
}

echo "Initializing CodeBaton in: ${TARGET_DIR}"
echo ""

# 1. Core config, workflow, and task board
copy_safe "${REPO_ROOT}/codebaton.config.example.json" "${TARGET_DIR}/codebaton.config.json" "codebaton.config.json"
copy_safe "${REPO_ROOT}/templates/WORKFLOW.md" "${TARGET_DIR}/.codebaton/WORKFLOW.md" ".codebaton/WORKFLOW.md"
copy_safe "${REPO_ROOT}/templates/PLAN.md" "${TARGET_DIR}/PLAN.md" "PLAN.md"

# 2. Ensure runtime logs and state are gitignored
append_gitignore_entry ".codebaton/logs/"
append_gitignore_entry ".codebaton/state.json"

# 3. Install selected adapters
if [[ "${ADAPTER}" == "antigravity" || "${ADAPTER}" == "all" ]]; then
  copy_safe "${REPO_ROOT}/adapters/antigravity/rules.md" "${TARGET_DIR}/.agent/rules/codebaton.md" ".agent/rules/codebaton.md"
fi

if [[ "${ADAPTER}" == "claude-code" || "${ADAPTER}" == "all" ]]; then
  merge_claude_md_snippet
  if [[ -f "${TARGET_DIR}/.claude/settings.json" && "${FORCE}" -ne 1 ]]; then
    echo "  [skip]   .claude/settings.json already exists — merge permissions from ${REPO_ROOT}/adapters/claude-code/settings.json manually"
  else
    mkdir -p "${TARGET_DIR}/.claude"
    cp "${REPO_ROOT}/adapters/claude-code/settings.json" "${TARGET_DIR}/.claude/settings.json"
    echo "  [write]  .claude/settings.json"
  fi
fi

echo ""
echo "Done! Next steps:"
echo "  1. Link codebaton globally (once):  cd ${REPO_ROOT} && npm link"
echo "  2. Customize models & policies in:  ${TARGET_DIR}/codebaton.config.json"
echo "  3. Fill in your tasks in:           ${TARGET_DIR}/PLAN.md"
echo "  4. Dry-run verify:                  cd ${TARGET_DIR} && codebaton --dry-run --tier high --task \"Verify setup\""
