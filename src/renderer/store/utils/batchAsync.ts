/**
 * Concurrency-limited batch executor for async operations.
 * Prevents unbounded parallel IPC calls that can exhaust the renderer heap.
 */
export async function batchAsync<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}
