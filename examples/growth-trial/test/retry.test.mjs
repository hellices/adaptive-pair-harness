import assert from "node:assert/strict";
import test from "node:test";
import { retryUntil } from "../src/retry.mjs";

await test("succeeds on the first attempt without retrying", () => {
  let attempts = 0;
  const succeeded = retryUntil(() => {
    attempts += 1;
    return true;
  }, 3);

  assert.equal(succeeded, true);
  assert.equal(attempts, 1);
});

await test("succeeds on the last allowed attempt", () => {
  let attempts = 0;
  const succeeded = retryUntil(() => {
    attempts += 1;
    return attempts === 3;
  }, 3);

  assert.equal(succeeded, true);
  assert.equal(attempts, 3);
});

for (const maxAttempts of [0, 1, 3]) {
  await test(`returns false after exhausting a limit of ${maxAttempts}`, () => {
    let attempts = 0;
    const succeeded = retryUntil(() => {
      attempts += 1;
      return false;
    }, maxAttempts);

    assert.equal(succeeded, false);
    assert.equal(attempts, maxAttempts);
  });
}

await test("does not accept success after the attempt limit", () => {
  let attempts = 0;
  const succeeded = retryUntil(() => {
    attempts += 1;
    return attempts === 3;
  }, 2);

  assert.equal(succeeded, false);
  assert.equal(attempts, 2);
});
