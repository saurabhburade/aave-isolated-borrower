/** Limit independent RPC reads without changing their result order. */
export async function mapRpc<T, R>(values: readonly T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (!failed && cursor < values.length) {
      const index = cursor++;
      try { results[index] = await read(values[index]); }
      catch (cause) { failed = true; failure = cause; }
    }
  }));
  if (failed) throw failure;
  return results;
}
