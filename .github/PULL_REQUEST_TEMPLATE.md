## Summary
<!-- Describe what this PR changes and why. -->

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] New AI CLI executor or Planner adapter
- [ ] Documentation update (`README.md` / `README.zh-CN.md` / templates)
- [ ] Tests / CI / Refactoring

## Related Issue
<!-- e.g. Closes #12 -->

## How Has This Been Tested?
- [ ] Ran `npm test` (`node tests/run-tests.mjs`) and all mock tests pass
- [ ] Tested `scripts/init.sh` in a temporary directory (if initialization or adapters changed)
- [ ] Tested against a real local AI CLI (optional — note which CLI & version below)

**Test notes / output:**
```text
<!-- Paste relevant test summary here -->
```

## Checklist
- [ ] Keeps `codebaton` **zero external runtime dependencies** (`dependencies: {}`)
- [ ] Preserves cross-platform compatibility (macOS & Linux, Node.js ≥ 18)
- [ ] Updated `README.md` and `README.zh-CN.md` if CLI flags, config fields, or exit codes changed
- [ ] Added or updated mock test coverage for new behavior
