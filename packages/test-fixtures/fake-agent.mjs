import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function scenario() {
  return process.env.ACR_FAKE_SCENARIO ?? "success";
}

function projectFile(...segments) {
  return path.join(process.cwd(), ...segments);
}

async function writeMarkerFile(name, content) {
  await mkdir(projectFile("fake-agent-output"), { recursive: true });
  await writeFile(projectFile("fake-agent-output", name), content, "utf8");
}

async function main() {
  const resumeInstruction =
    process.env.ACR_FAKE_RESUME_INSTRUCTION ?? "No resume instruction.";
  await mkdir(projectFile("fake-agent-output"), { recursive: true });
  await appendFile(
    projectFile("fake-agent-output", "resume.log"),
    `${resumeInstruction}\n`,
    "utf8"
  );

  switch (scenario()) {
    case "success":
      await writeMarkerFile("success.txt", "completed\n");
      process.stdout.write("FAKE_SUCCESS\n");
      process.exit(0);
      return;
    case "usage_limit":
      await writeMarkerFile("usage-limit.txt", "edited before usage limit\n");
      process.stderr.write("FAKE_USAGE_LIMIT\n");
      process.exit(21);
      return;
    case "partial_crash":
      await writeMarkerFile("partial-crash.txt", "partial edit\n");
      process.stderr.write("FAKE_CRASH\n");
      process.exit(2);
      return;
    case "auth_failure":
      process.stderr.write("FAKE_AUTH_FAILURE\n");
      process.exit(23);
      return;
    case "network_failure":
      process.stderr.write("FAKE_NETWORK_FAILURE\n");
      process.exit(24);
      return;
    case "context_limit":
      await writeMarkerFile(
        "context-limit.txt",
        "edited before context limit\n"
      );
      process.stderr.write("FAKE_CONTEXT_LIMIT\n");
      process.exit(25);
      return;
    case "long_running":
      process.stdout.write("FAKE_LONG_RUNNING\n");
      process.on("SIGINT", () => {
        process.stderr.write("FAKE_SIGINT\n");
        process.exit(130);
      });
      setInterval(() => {
        process.stdout.write("tick\n");
      }, 100);
      return;
    default:
      process.stderr.write("FAKE_UNKNOWN\n");
      process.exit(99);
  }
}

void main();
