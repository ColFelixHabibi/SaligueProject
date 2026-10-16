'use client';

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { api, onServerEvent } from './api';
import type { Conversation, Message } from './types';

// Direct chat between buyers and shops (server: /api/conversations). Live through server events.

interface InboxState {
  conversations: Conversation[];
  isInitialized: boolean;
}

export const useInbox = create<InboxState>()(() => ({ conversations: [], isInitialized: false }));

/** Total unread messages, for badges. */
export const useUnreadMessages = () => useInbox((s) => s.conversations.reduce((n, c) => n + c.unread, 0));

async function loadInbox() {
  try {
    useInbox.setState({ conversations: await api<Conversation[]>('/conversations'), isInitialized: true });
  } catch (error) {
    console.error('Failed to load messages:', error);
    useInbox.setState({ isInitialized: true });
  }
}

/** Loads the current account's conversations and keeps them up to date. */
export function subscribeToMessages(_uid: string) {
  useInbox.setState({ conversations: [], isInitialized: false });
  void loadInbox();
  return onServerEvent('messages', () => void loadInbox());
}

/**
 * Opens (or continues) the conversation with the shop of an item, the other side of an order, or a shop,
 * optionally sending a first message. Returns the conversation id.
 */
export async function startConversation(about: { productId?: string; orderId?: string; sellerId?: string }, text?: string) {
  const { id } = await api<{ id: string }>('/conversations', { body: { ...about, text } });
  void loadInbox();
  return id;
}

/** One conversation's messages, live, marked as read while it is open. */
export function useConversation(id: string | null) {
  const [state, setState] = useState<{ conversation: Conversation; messages: Message[]; otherReadAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<{ conversation: Conversation; messages: Message[]; otherReadAt: string | null }>(`/conversations/${id}`);
      setState(data);
      setError(null);
      if (data.conversation.unread > 0) {
        await api(`/conversations/${id}/read`, { body: {} });
        void loadInbox();
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not open this conversation.');
    }
  }, [id]);

  useEffect(() => {
    setState(null);
    setError(null);
    if (!id) return;
    void load();
    return onServerEvent('messages', (data: { conversationId?: string }) => {
      if (data?.conversationId === id) void load();
    });
  }, [id, load]);

  const send = useCallback(
    async (text: string, extra: { productId?: string; orderId?: string } = {}) => {
      if (!id) return;
      const message = await api<Message>(`/conversations/${id}/messages`, { body: { text, ...extra } });
      // Show it straight away; the live update brings the same list a moment later.
      setState((s) => (s && !s.messages.some((m) => m.id === message.id) ? { ...s, messages: [...s.messages, message] } : s));
    },
    [id]
  );

  return { data: state, error, send, reload: load };
}

/** Quick replies sellers and buyers use most. */
export const QUICK_QUESTIONS = ['Is this still available?', 'Which sizes do you have?', 'Can you deliver to me today?', 'What is your best price?'];
