export function retryUntil(action = () => false, maxAttempts = 0) {
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    if (action()) {
      return true;
    }
  }
  return false;
}
