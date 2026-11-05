// The words a shopper sees when something goes wrong (src/lib/errors.ts):
//   npm test
// The server already words its own refusals for people; this covers the browser's errors — a cut-off request,
// a photo that took too long, no connection — which arrive as a name, not a sentence.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { friendlyError } = await import('../src/lib/errors.ts');

describe('errors shoppers read', () => {
  test("the server's own wording is shown as it is", () => {
    assert.equal(friendlyError(new Error('Stock ran out while you were paying.')), 'Stock ran out while you were paying.');
    assert.equal(friendlyError({ message: 'Your photo needs a clear view of you.' }), 'Your photo needs a clear view of you.');
  });

  test('a request that was cut off says what happened', () => {
    assert.equal(friendlyError({ name: 'AbortError', message: 'The operation was aborted.' }), 'That was stopped. Please try again.');
    assert.equal(friendlyError({ name: 'TimeoutError', message: 'signal timed out' }), 'This is taking too long. Check your network and try again.');
  });

  test('no connection is said in plain words, whichever browser names it', () => {
    const noConnection = 'No internet connection. Check your network and try again.';
    assert.equal(friendlyError(new TypeError('Failed to fetch')), noConnection);
    assert.equal(friendlyError(new TypeError('Load failed')), noConnection);
    assert.equal(friendlyError(new TypeError('NetworkError when attempting to fetch resource.')), noConnection);
  });

  test('anything unexpected still gives the shopper something to do', () => {
    assert.equal(friendlyError(undefined), 'Something went wrong. Please try again.');
    assert.equal(friendlyError({}), 'Something went wrong. Please try again.');
    assert.equal(friendlyError('a string'), 'Something went wrong. Please try again.');
  });

  test('a browser error message is never shown without being understood', () => {
    // A name alone (no message) must not become "undefined" on screen.
    assert.equal(friendlyError({ name: 'TypeError' }), 'Something went wrong. Please try again.');
  });
});
