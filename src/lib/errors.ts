
// Plain-language messages for errors shown to users. Saligue's server already words its messages for people;
// this covers the browser's own errors and anything unexpected.
export function friendlyError(error: unknown): string {
  const e = error as { name?: string; message?: string } | undefined;
  // A request that was cut off (a photo sent to the AI, a slow network) arrives as a name, not a sentence.
  if (e?.name === 'TimeoutError') return 'This is taking too long. Check your network and try again.';
  if (e?.name === 'AbortError') return 'That was stopped. Please try again.';
  if (e?.message === 'Failed to fetch' || e?.message === 'Load failed' || e?.message === 'NetworkError when attempting to fetch resource.') {
    return 'No internet connection. Check your network and try again.';
  }
  return e?.message || 'Something went wrong. Please try again.';
}
