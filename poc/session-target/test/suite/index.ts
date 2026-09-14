import { resolve } from "node:path";
import Mocha from "mocha";

export const run = async (): Promise<void> => {
  const mocha = new Mocha({
    color: true,
    timeout: 30_000,
    ui: "tdd",
  });
  mocha.addFile(resolve(__dirname, "sessionTargetHost.test.js"));
  await new Promise<void>((resolveRun, reject) => {
    mocha.run(failures => {
      if (failures === 0) {
        resolveRun();
      } else {
        reject(new Error(`${failures} Session Target host test(s) failed.`));
      }
    });
  });
};
