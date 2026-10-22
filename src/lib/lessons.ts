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
  liked: boolean;
  mine: boolean;
  newVoice?: boolean;
  createdAt: string;
};

const withMedia = (l: Lesson): Lesson => ({
  ...l,
  video: mediaUrl(l.video ?? undefined) ?? null,
  poster: mediaUrl(l.poster ?? undefined) ?? null,
  authorAvatar: mediaUrl(l.authorAvatar ?? undefined) ?? null,
});

/** Lessons, newest and fairest first; filtered by topic, teacher, or only people I follow. */
export function useLessons(filter: { topic?: string | null; author?: string; following?: boolean } = {}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const query = new URLSearchParams();
  if (filter.topic) query.set('topic', filter.topic);
  if (filter.author) query.set('author', filter.author);
  if (filter.following) query.set('following', '1');
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

export const createLesson = (body: { title: string; description: string; topic: string; language: string }) => api<Lesson>('/lessons', { body });
export const deleteLesson = (id: string) => api(`/lessons/${id}`, { method: 'DELETE' });
export const likeLesson = (id: string) => api<{ liked: boolean; likeCount: number }>(`/lessons/${id}/like`, { body: {} });
export const viewLesson = (id: string) => api(`/lessons/${id}/view`, { body: {} }).catch(() => {});
export const reportLesson = (id: string, reason: string) => api(`/lessons/${id}/report`, { body: { reason } });
