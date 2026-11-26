#!/usr/bin/env bash
#
# scripts/init.sh - Safely initialize agent-baton into any target repository.
#
# Tip: Once installed via npm (`npm install -g agent-baton`), you can simply run:
#   cd /path/to/your-project && agent-baton init
#
# Usage:
#   ./scripts/init.sh [target-dir] [--adapter antigravity|claude-code|all|none] [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_DIR="."
ADAPTER="all"
FORCE=0
POSITIONAL_SET=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/init.sh [target-project-dir] [options]

Options:
  --adapter <mode>   Adapter templates to install: antigravity | claude-code | all | none (default: all)
  --force            Overwrite existing agent-baton.config.json, PLAN.md, and adapter files
  -h, --help         Show this help message

Examples:
  ./scripts/init.sh ~/projects/my-app
  ./scripts/init.sh ~/projects/my-app --adapter antigravity
  ./scripts/init.sh --adapter claude-code   # initializes current directory
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
      if [[ "${POSITIONAL_SET}" -eq 0 ]]; then
        TARGET_DIR="$1"
        POSITIONAL_SET=1
      else
        echo "Error: Unexpected positional argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

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
  local start_marker="<!-- agent-baton:start -->"
  local end_marker="<!-- agent-baton:end -->"

  if [[ ! -f "${target_file}" ]]; then
    cp "${snippet_file}" "${target_file}"
    echo "  [write]  CLAUDE.md (created with agent-baton snippet)"
    return
  fi

  if grep -Fq "${start_marker}" "${target_file}"; then
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
    echo "  [update] CLAUDE.md (updated agent-baton marker block; existing rules preserved)"
  else
    printf '\n' >> "${target_file}"
    cat "${snippet_file}" >> "${target_file}"
    echo "  [append] CLAUDE.md (appended agent-baton block; existing rules preserved)"
  fi
}

echo "Initializing agent-baton in: ${TARGET_DIR}"
echo ""

copy_safe "${REPO_ROOT}/agent-baton.config.example.json" "${TARGET_DIR}/agent-baton.config.json" "agent-baton.config.json"
copy_safe "${REPO_ROOT}/templates/WORKFLOW.md" "${TARGET_DIR}/.agent-baton/WORKFLOW.md" ".agent-baton/WORKFLOW.md"
copy_safe "${REPO_ROOT}/templates/PLAN.md" "${TARGET_DIR}/PLAN.md" "PLAN.md"

append_gitignore_entry ".agent-baton/logs/"
append_gitignore_entry ".agent-baton/*.json"

if [[ "${ADAPTER}" == "antigravity" || "${ADAPTER}" == "all" ]]; then
  copy_safe "${REPO_ROOT}/adapters/antigravity/rules.md" "${TARGET_DIR}/.agent/rules/agent-baton.md" ".agent/rules/agent-baton.md"
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
echo "  1. Customize models & policies in:  ${TARGET_DIR}/agent-baton.config.json"
echo "  2. Fill in your tasks in:           ${TARGET_DIR}/PLAN.md"
echo "  3. Dry-run verify:                  cd ${TARGET_DIR} && agent-baton --dry-run --tier high --task \"Verify setup\""
