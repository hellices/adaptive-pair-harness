// Real fixture test executed via `npm run test` (see package.json). It imports
// the runnable module and asserts observable retry behavior, so the pass/fail
// verdict comes from a real process exit code — never from prose.
import assert from "node:assert/strict";
import { retryUntil } from "./src/retry.mjs";

let calls = 0;
const succeedsOnThirdAttempt = () => {
  calls += 1;
  return calls >= 3;
};

const result = retryUntil(succeedsOnThirdAttempt, 5);
assert.equal(
  result,
  3,
  `expected retryUntil to succeed on attempt 3 with max=5, got ${result}`,
);
console.log("retry fixture check passed");
