import { resolve } from "node:path";
import Mocha from "mocha";

// Entry point loaded by @vscode/test-electron inside the isolated Extension
// Host. It runs the compiled smoke suite under Mocha's TDD interface.
export const run = async (): Promise<void> => {
  const mocha = new Mocha({
    color: true,
    timeout: 120_000,
    ui: "tdd",
  });
  mocha.addFile(resolve(__dirname, "smoke.cjs"));
  await new Promise<void>((resolveRun, reject) => {
    mocha.run((failures) => {
      if (failures === 0) {
        resolveRun();
      } else {
        reject(new Error(`${failures} Adaptive Pair host smoke test(s) failed.`));
      }
    });
  });
};
