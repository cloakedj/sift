export function retryDelay(attempt: number) {
  return Math.min(30_000, 100 * 2 ** attempt);
}
