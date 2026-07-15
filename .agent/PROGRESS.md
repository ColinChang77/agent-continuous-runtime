# Progress

- 2026-07-14: Added one-line installers `scripts/install.sh` (macOS/Linux) and
  `scripts/install.ps1` (Windows) that check prerequisites, clone, build, and
  register the global `acr` command. Documented in README "Quick install".
  Verified end-to-end: installer clones + builds from GitHub `main`, built CLI
  runs `acr --help`.

