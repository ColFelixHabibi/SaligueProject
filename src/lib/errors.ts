
// Plain-language messages for errors shown to users. Saligue's server already words its messages for people;
// this covers the browser's own errors and anything unexpected.
export function friendlyError(error: unknown): string {
  const e = error as { message?: string } | undefined;
  if (e?.message === 'Failed to fetch') return 'No internet connection. Check your network and try again.';
  return e?.message || 'Something went wrong. Please try again.';
}
