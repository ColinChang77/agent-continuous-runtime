# Progress

- 2026-07-14: Added one-line installers `scripts/install.sh` (macOS/Linux) and
  `scripts/install.ps1` (Windows) that check prerequisites, clone, build, and
  register the global `acr` command. Documented in README "Quick install".
  Verified end-to-end: installer clones + builds from GitHub `main`, built CLI
  runs `acr --help`.
- 2026-07-14: Added `claude-code-alt` adapter for switching between Claude
  accounts. Parameterized `ClaudeCodeAdapter` (`id`, `displayName`,
  `envOverrides`) in `packages/adapter-claude-code`; registered a
  `builtin.claude-code-alt` plugin in `packages/cli` reading
  `ACR_CLAUDE_ALT_HOME` / `ACR_CLAUDE_ALT_API_KEY` / `ACR_CLAUDE_ALT_BASE_URL`.
  Documented in README "Multiple Claude accounts". Verified: build, typecheck,
  adapter tests pass; adapter appears in `adapters list` and launch spec carries
  the alternate HOME/API key. Note: usage-limit circumvention remains out of
  scope per project non-goals.

