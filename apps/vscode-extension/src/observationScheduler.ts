import type { Scheduler } from "@adaptive-pair/evidence";
import type { ActivityLedger } from "./activityLedger.js";

export const observationScheduler = (
  scheduler: Scheduler | undefined,
  ledger: ActivityLedger | undefined,
): Scheduler => {
  const baseScheduler: Scheduler = scheduler ?? {
      schedule: (delayMs, callback) => setTimeout(callback, delayMs),
      cancel: handle => {
        if (handle !== undefined) {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        }
      },
    };
  return {
      schedule: (delayMs, callback) => {
        ledger?.recordTimerScheduled();
        return baseScheduler.schedule(delayMs, callback);
      },
      cancel: handle => baseScheduler.cancel(handle),
    };
};
