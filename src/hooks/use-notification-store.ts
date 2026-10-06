
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Notification {
    id: string;
    title: string;
    description: string;
    time: string;
    read: boolean;
    type: 'sale' | 'message' | 'account' | 'review' | 'product' | 'default';
    link: string;
}

const initialNotifications: Notification[] = [];

interface NotificationState {
  notifications: Notification[];
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

export const useNotificationStore = create(
  persist<NotificationState>(
    (set) => ({
      notifications: initialNotifications,
      markAsRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        })),
      markAllAsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),
    }),
    {
      name: 'notification-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
