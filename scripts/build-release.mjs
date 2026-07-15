import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const distDir = path.join(rootDir, "dist");
const cliEntryPoint = path.join(rootDir, "packages/cli/dist/index.js");
const bundledCliPath = path.join(distDir, "acr.js");
const fakeAgentSourcePath = path.join(
  rootDir,
  "packages/test-fixtures/fake-agent.mjs"
);
const fakeAgentOutputPath = path.join(distDir, "fake-agent.mjs");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [cliEntryPoint],
  outfile: bundledCliPath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["node-pty"],
  legalComments: "none"
});

await chmod(bundledCliPath, 0o755);
await copyFile(fakeAgentSourcePath, fakeAgentOutputPath);
