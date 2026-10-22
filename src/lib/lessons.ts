'use client';

import { useEffect, useState } from 'react';
import { Footprints, Gem, Scissors, Shirt, Sparkles, Store, WashingMachine, type LucideIcon } from 'lucide-react';
import { api, mediaUrl, onServerEvent } from './api';

// Community: fashion lessons anyone with an account can teach, in videos up to 4 min 30 s (server: /api/lessons).

export const LESSON_MAX_SECONDS = 270;

export const LESSON_TOPICS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'styling', label: 'Styling', icon: Sparkles },
  { value: 'sewing', label: 'Sewing', icon: Scissors },
  { value: 'care', label: 'Care', icon: WashingMachine },
  { value: 'shoes_accessories', label: 'Shoes & bags', icon: Footprints },
  { value: 'traditional', label: 'Traditional', icon: Gem },
  { value: 'business', label: 'Fashion business', icon: Store },
];
export const topicOf = (value: string) => LESSON_TOPICS.find((t) => t.value === value) ?? { value, label: value, icon: Shirt };

export const LESSON_LANGUAGES = [
  { value: 'rw', label: 'Kinyarwanda' },
  { value: 'sw', label: 'Kiswahili' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];

export type Lesson = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  authorIsShop: boolean;
  official: boolean;
  title: string;
  description: string;
  topic: string;
  language: string;
  video: string | null;
  poster: string | null;
  duration: number | null;
  likeCount: number;
  viewCount: number;
  commentCount?: number;
  liked: boolean;
  mine: boolean;
  // Only for the teacher: hidden after reports (can appeal).
  hidden?: boolean;
  newVoice?: boolean;
  // A duet plays side by side with the lesson it answers.
  duetOf?: { id: string; title: string; video: string; poster: string | null; authorName: string } | null;
  duetCount?: number;
  challenge?: { id: string; title: string } | null;
  // Place in a challenge (by likes), when listed for one.
  rank?: number;
  createdAt: string;
};

export type Challenge = { id: string; title: string; description: string; topic: string; endsAt: string; open: boolean; entries: number; people: number; posters: (string | null)[]; createdAt: string };

const withMedia = (l: Lesson): Lesson => ({
  ...l,
  duetOf: l.duetOf ? { ...l.duetOf, video: mediaUrl(l.duetOf.video) ?? l.duetOf.video, poster: mediaUrl(l.duetOf.poster ?? undefined) ?? null } : null,
  video: mediaUrl(l.video ?? undefined) ?? null,
  poster: mediaUrl(l.poster ?? undefined) ?? null,
  authorAvatar: mediaUrl(l.authorAvatar ?? undefined) ?? null,
});

/** Lessons, newest and fairest first; filtered by topic, teacher, or only people I follow. */
export function useLessons(filter: { topic?: string | null; author?: string; following?: boolean; challenge?: string | null } = {}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const query = new URLSearchParams();
  if (filter.topic) query.set('topic', filter.topic);
  if (filter.author) query.set('author', filter.author);
  if (filter.following) query.set('following', '1');
  if (filter.challenge) query.set('challenge', filter.challenge);
  const qs = query.toString();
  useEffect(() => {
    let active = true;
    const load = () => api<Lesson[]>(`/lessons${qs ? `?${qs}` : ''}`).then((d) => active && setLessons(d.map(withMedia))).catch(() => active && setLessons([]));
    void load();
    const stop = onServerEvent('lessons', () => void load());
    return () => {
      active = false;
      stop();
    };
  }, [qs]);
  return lessons;
}

export const createLesson = (body: { title: string; description: string; topic: string; language: string; challengeId?: string | null; duetOf?: string | null }) => api<Lesson>('/lessons', { body });
export const getLesson = (id: string) => api<Lesson>(`/lessons/${id}`).then(withMedia);

const challengeMedia = (c: Challenge): Challenge => ({ ...c, posters: c.posters.map((p) => mediaUrl(p ?? undefined) ?? null) });
/** Fashion challenges: open ones first, and those that ended in the last month. */
export function useChallenges() {
  const [list, setList] = useState<Challenge[] | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => api<Challenge[]>('/challenges').then((d) => active && setList(d.map(challengeMedia))).catch(() => active && setList([]));
    void load();
    const stop = onServerEvent('lessons', () => void load());
    return () => {
      active = false;
      stop();
    };
  }, []);
  return list;
}
export const getChallenge = (id: string) => api<Challenge>(`/challenges/${id}`).then(challengeMedia);
export const createChallenge = (body: { title: string; description: string; topic: string; days: number }) => api<Challenge>('/challenges', { body });
/** "3 days left", "5 h left", "Ended". */
export function timeLeft(endsAt: string) {
  const ms = Date.parse(endsAt) - Date.now();
  if (ms <= 0) return 'Ended';
  const days = Math.floor(ms / 86_400_000);
  return days >= 1 ? `${days} day${days === 1 ? '' : 's'} left` : `${Math.max(1, Math.floor(ms / 3_600_000))} h left`;
}
export const deleteLesson = (id: string) => api(`/lessons/${id}`, { method: 'DELETE' });
export const likeLesson = (id: string) => api<{ liked: boolean; likeCount: number }>(`/lessons/${id}/like`, { body: {} });
export const viewLesson = (id: string) => api(`/lessons/${id}/view`, { body: {} }).catch(() => {});
export const reportLesson = (id: string, reason: string) => api(`/lessons/${id}/report`, { body: { reason } });

export type LessonComment = { id: string; uid: string; name: string; avatar: string | null; parentId: string | null; kind: 'comment' | 'question'; text: string; teacher: boolean; answered: boolean; createdAt: string };
export const lessonComments = (id: string) => api<LessonComment[]>(`/lessons/${id}/comments`).then((list) => list.map((c) => ({ ...c, avatar: mediaUrl(c.avatar ?? undefined) ?? null })));
export const postLessonComment = (id: string, body: { text: string; kind?: 'comment' | 'question'; parentId?: string }) => api<{ id: string }>(`/lessons/${id}/comments`, { body });
export const deleteLessonComment = (commentId: string) => api(`/lesson-comments/${commentId}`, { method: 'DELETE' });
