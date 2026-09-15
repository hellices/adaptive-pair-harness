// The developer's in-progress TypeScript source. The host smoke test opens this
// file and makes an unsaved edit so it is genuinely "dirty" and developer-owned
// while Growth Mode stays restrained (the AI never edits it).
export function retryUntil(
  action: (attempt: number) => boolean,
  max: number,
): number {
  let attempts = 0;
  while (attempts < 1) {
    attempts += 1;
    if (action(attempts)) {
      return attempts;
    }
  }
  return -1;
}
