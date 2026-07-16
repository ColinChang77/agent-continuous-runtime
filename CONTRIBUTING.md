# Contributing

Thanks for your interest in Agent Continuity Runtime (ACR). Contributions of all
kinds are welcome: bug reports, fixes, docs, and features.

## Development setup

Requires **Node.js 22+** (Node 22 LTS is recommended; see the README for why the
PTY backend prefers an LTS line).

```bash
npm install
npm run build
```

## Before opening a pull request

Run the same checks CI runs, and make sure they pass locally:

```bash
npm run ci
```

That runs, in order: formatting check (Prettier), lint (ESLint), typecheck
(TypeScript), tests (Vitest), build, an MCP stdio smoke test, and a packaging
dry run. For quick loops during development:

```bash
npm run format   # auto-fix formatting
npm run test     # run the test suite
```

## Guidelines

- Keep changes focused and match the style of the surrounding code.
- Add or update tests for behavior changes.
- Update `README.md` / `docs/` when you change user-facing behavior.
- CI runs on Linux, macOS, and Windows — keep changes cross-platform (avoid
  hard-coding path separators, line endings, or POSIX-only assumptions).

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report them privately.

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), the same license that covers this project.
