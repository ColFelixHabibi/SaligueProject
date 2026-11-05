'use client';

import { noteInterest } from './taste';
import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { ApiError, api, apiUrl, getToken, onServerEvent } from './api';
import type { ChatAttachment, Conversation, Message } from './types';

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
export async function startConversation(about: { productId?: string; orderId?: string; sellerId?: string; userId?: string }, text?: string) {
  if (about.productId) noteInterest(about.productId, 'message');
  const { id } = await api<{ id: string }>('/conversations', { body: { ...about, text } });
  void loadInbox();
  return id;
}

/**
 * Clears a chat for this account: its messages leave the list and the thread, and it stays out of the inbox
 * until the other person writes again. Their side is untouched.
 */
export async function clearConversation(id: string) {
  await api(`/conversations/${id}`, { method: 'DELETE' });
  useInbox.setState((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }));
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

  /** Sends a photo, video or voice note; `onProgress` gets 0–1 while it uploads. */
  const sendFile = useCallback(
    async (kind: ChatAttachment['kind'], file: Blob, onProgress?: (p: number) => void, caption = '') => {
      if (!id) return;
      const message = await uploadChatFile(id, kind, file, onProgress, caption);
      setState((s) => (s && !s.messages.some((m) => m.id === message.id) ? { ...s, messages: [...s.messages, message] } : s));
    },
    [id]
  );

  /** Takes back one of your messages, for both people. */
  const unsend = useCallback(
    async (messageId: string) => {
      if (!id) return;
      await api(`/conversations/${id}/messages/${messageId}`, { method: 'DELETE' });
      setState((s) => (s ? { ...s, messages: s.messages.map((m) => (m.id === messageId ? { ...m, text: '', attachment: null, productId: null, deleted: true } : m)) } : s));
    },
    [id]
  );

  return { data: state, error, send, sendFile, unsend, reload: load };
}

/** Uploads a chat file (with progress, for videos). The server re-makes it and answers with the message. */
function uploadChatFile(conversationId: string, kind: ChatAttachment['kind'], file: Blob, onProgress?: (p: number) => void, caption = '') {
  return new Promise<Message>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', apiUrl(`/conversations/${conversationId}/attachments/${kind}${caption ? `?caption=${encodeURIComponent(caption)}` : ''}`));
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', (file.type || (kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/webm')).split(';')[0]);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Message);
      else reject(new ApiError(xhr.status, data?.error?.code ?? 'server_error', data?.error?.message ?? 'This file could not be sent. Try another one.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'unavailable', 'No connection to Saligue. Check your network and try again.'));
    xhr.send(file);
  });
}

/** Quick replies sellers and buyers use most. */
export const QUICK_QUESTIONS = ['Is this still available?', 'Which sizes do you have?', 'Can you deliver to me today?', 'What is your best price?'];
