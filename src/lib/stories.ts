'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api, mediaUrl, onServerEvent } from './api';
import { friendlyError } from './errors';

// Stories ("status"): a photo, a voice note, or a line of words on a colour, that goes by itself after 24 hours.
// One shared list for the whole app, written the same way as the "who is live" store (lives.ts).

export type StoryProduct = { id: string; name: string; price: number; image: string | null };

export type Story = {
  id: string;
  kind: 'image' | 'text' | 'voice';
  // `/media/…` for a photo or a voice note; null for words.
  media: string | null;
  caption: string;
  background: string;
  // How long a voice note runs (seconds); null for a photo or words.
  seconds: number | null;
  // The item a story is about; tapping it opens the product page.
  product: StoryProduct | null;
  createdAt: string;
  expiresAt: string;
  seen: boolean;
  // Who it is for: anyone who follows you, or only the people on your close friends list.
  audience: 'everyone' | 'close';
  // Your own stories only: how many other people watched.
  views?: number;
};

export type StoryPerson = {
  id: string;
  displayName: string;
  username: string | null;
  avatar: string | null;
  role: 'buyer' | 'seller';
  official: boolean;
  // Their ring stays out of this account's bar; their statuses themselves are untouched.
  muted?: boolean;
};

export type StoryGroup = { user: StoryPerson; stories: Story[]; unseen: number };

type State = {
  groups: StoryGroup[];
  people: number;
  unseen: number;
  error: string | null;
  reload: () => void;
};

const FRESH_MS = 60_000;
let state: State | null = null;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
let subscribed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The address a story's photo is drawn from (the app can be hosted away from the server). */
export const storyPhoto = (story: Story) => (story.media ? mediaUrl(story.media) : null);

/** The address a voice status plays from. */
export const storyVoice = (story: Story) => (story.kind === 'voice' && story.media ? mediaUrl(story.media) : null);

/** How long is left before a story clears itself, in whole hours ("23h"). */
export function hoursLeft(expiresAt: string) {
  const left = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(left) || left <= 0) return '0h';
  return `${Math.max(1, Math.round(left / 3_600_000))}h`;
}

function fetchStories(): Promise<void> {
  // Several parts of the page ask together: they all wait on the one request already on its way.
  if (inFlight) return inFlight;
  inFlight = api<{ groups: StoryGroup[]; people: number; unseen: number }>('/stories')
    .then((d) => {
      state = { ...d, error: null, reload: reloadStories };
      fetchedAt = Date.now();
    })
    // No connection: keep the rings already on screen and say what went wrong. Not cached as fresh, so the
    // next page opened tries again by itself.
    .catch((e) => {
      state = { groups: state?.groups ?? [], people: state?.people ?? 0, unseen: state?.unseen ?? 0, error: friendlyError(e), reload: reloadStories };
      fetchedAt = 0;
    })
    .then(() => {
      inFlight = null;
      emit();
    });
  return inFlight;
}

/** Ask the server again now — after posting, or the "Try again" button. */
export function reloadStories() {
  fetchedAt = 0;
  void fetchStories();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Stories the account may watch, kept up to date: a new one, or one that ended, refreshes the rings everywhere. */
export function useStories() {
  useEffect(() => {
    if (!subscribed) {
      subscribed = true;
      onServerEvent('stories', () => {
        fetchedAt = 0;
        void fetchStories();
      });
    }
    if (!state || Date.now() - fetchedAt > FRESH_MS) void fetchStories();
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Posts a status. A photo travels as the data URL `compressImage` makes, a voice note as the phone's recording;
 *  either way the server keeps it as a file. */
export async function postStory(input: { kind: 'image' | 'text' | 'voice'; media?: string; caption?: string; background?: string; productId?: string | null; audience?: 'everyone' | 'close' }) {
  // A photo or a recording is a whole file, and a voice note is turned into an M4A on the server: this is given
  // longer than a usual call.
  const { story } = await api<{ story: Story }>('/stories', { body: input, timeoutMs: 60_000 });
  reloadStories();
  return story;
}

/** Tells the server this status has been watched, which turns the ring grey for everyone else too. */
export async function markStorySeen(id: string) {
  await api(`/stories/${id}/seen`, { method: 'POST' }).catch(() => {});
  // Cheap and local: the list is refreshed on the next page anyway, and a failure to mark it is not worth a message.
  if (state) {
    const groups = state.groups.map((g) => {
      const stories = g.stories.map((s) => (s.id === id ? { ...s, seen: true } : s));
      return { ...g, stories, unseen: stories.filter((s) => !s.seen).length };
    });
    state = { ...state, groups, unseen: groups.reduce((n, g) => n + g.unseen, 0) };
    emit();
  }
}

/** Answers a story. It reaches the author as a notification, like a mention does. */
export async function replyToStory(id: string, text: string) {
  await api(`/stories/${id}/reply`, { body: { text } });
}

/** Removes one of your own stories before its 24 hours are up. */
export async function deleteStory(id: string) {
  await api(`/stories/${id}`, { method: 'DELETE' });
  reloadStories();
}

/** Hides a person's ring from the bar, or brings it back. They are not told, and nothing else about them changes. */
export async function muteStatuses(personId: string, muted: boolean) {
  await api(`/stories/mute/${personId}`, { body: { muted } });
  // Shown at once; the refreshed list confirms it a moment later.
  if (state) {
    state = { ...state, groups: state.groups.map((g) => (g.user.id === personId ? { ...g, user: { ...g.user, muted } } : g)) };
    emit();
  }
  reloadStories();
}

export type CloseFriend = { id: string; name: string; username: string | null; avatar: string | null; official: boolean; verified?: boolean; isShop?: boolean };

/** The close friends list, and the people connected to this account who could be put on it. */
export function closeFriends() {
  return api<{ friends: CloseFriend[]; people: CloseFriend[] }>('/close-friends');
}

/** Adds someone to the close friends list, or takes them off it. */
export function setCloseFriend(personId: string, inside: boolean) {
  return api<{ ok: boolean; in: boolean }>(`/close-friends/${personId}`, { body: { in: inside } });
}
