'use client';

import { create } from 'zustand';
import { formatDistanceToNow } from 'date-fns';
import { api, onServerEvent } from '@/lib/api';

// Notifications of the signed-in account, kept on the server (also sent by email, see server/index.mjs).
export interface Notification {
  id: string;
  title: string;
  description: string;
  // "5 minutes ago"
  time: string;
  read: boolean;
  type: 'sale' | 'order' | 'message' | 'account' | 'review' | 'product' | 'default';
  link: string;
}

type ServerNotification = { id: string; type: Notification['type']; title: string; body: string; link: string | null; read: boolean; createdAt: string };

interface NotificationState {
  notifications: Notification[];
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  notifications: [],
  markAsRead: (id) => {
    if (get().notifications.find((n) => n.id === id)?.read) return;
    set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) });
    api('/me/notifications/read', { body: { id } }).catch(() => {});
  },
  markAllAsRead: () => {
    set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) });
    api('/me/notifications/read', { body: {} }).catch(() => {});
  },
}));

async function load() {
  try {
    const rows = await api<ServerNotification[]>('/me/notifications');
    useNotificationStore.setState({
      notifications: rows.map((n) => ({
        id: n.id,
        title: n.title,
        description: n.body,
        time: formatDistanceToNow(new Date(n.createdAt), { addSuffix: true }),
        read: n.read,
        type: n.type,
        link: n.link ?? '',
      })),
    });
  } catch (error) {
    console.error('Failed to load notifications:', error);
  }
}

/** Loads the notifications of the current account and keeps them up to date. */
export function subscribeToNotifications(_uid: string) {
  useNotificationStore.setState({ notifications: [] });
  load();
  return onServerEvent('notifications', () => load());
}
