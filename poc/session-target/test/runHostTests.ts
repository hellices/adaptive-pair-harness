import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  downloadAndUnzipVSCode,
  runTests,
} from "@vscode/test-electron";

const main = async (): Promise<void> => {
  const extensionDevelopmentPath = resolve(__dirname, "../..");
  const extensionTestsPath = resolve(
    extensionDevelopmentPath,
    "dist/test/suite/index.js",
  );
  const temporaryRoot = await mkdtemp("/tmp/ap-poc-");
  const fixture = resolve(temporaryRoot, "workspace");
  await mkdir(fixture);
  try {
    const vscodeExecutablePath = await downloadAndUnzipVSCode({
      version: "insiders",
    });
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        fixture,
        `--user-data-dir=${resolve(temporaryRoot, "user")}`,
        `--extensions-dir=${resolve(temporaryRoot, "extensions")}`,
        "--disable-extensions",
        "--enable-proposed-api=adaptive-pair.adaptive-pair",
        "--skip-welcome",
        "--skip-release-notes",
      ],
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
