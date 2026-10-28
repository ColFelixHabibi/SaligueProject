'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { getToken } from '@/lib/api';

export const MAX_VIDEO_SECONDS = 90;

/** 270 → "4 min 30 s". */
export const formatLength = (seconds: number) => {
  const m = Math.floor(Math.round(seconds) / 60);
  const s = Math.round(seconds) % 60;
  return m ? `${m} min${s ? ` ${s} s` : ''}` : `${s} s`;
};

/**
 * Reads a video's length on the device, so a too-long video is refused before uploading.
 * null when this browser can't read the format (e.g. iPhone HEVC .mov on Android Chrome): the server checks it then.
 */
function videoLength(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (seconds: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(seconds !== null && Number.isFinite(seconds) ? seconds : null);
    };
    const timer = setTimeout(() => done(null), 8000);
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done(null);
    v.src = url;
  });
}

/** Uploads a video to an item, with progress (the server converts it so it plays everywhere). */
export const uploadItemVideo = (productId: string, file: File, onProgress: (percent: number) => void) =>
  uploadVideo<{ video: string; poster: string; duration: number }>(`/products/${productId}/video`, file, onProgress);

/** Sends a video file to an /api path with progress; the server checks and converts it. */
export function uploadVideo<T>(path: string, file: File, onProgress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      const data = (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error?.message ?? 'The video could not be uploaded.'));
    };
    xhr.onerror = () => reject(new Error('No connection. Check your network and try again.'));
    xhr.send(file);
  });
}

/** Choose a short video (up to 1 min 30 s). The file is kept here until the item is saved. */
export function VideoField({ file, onChange, existing, onRemoveExisting, uploading, maxSeconds = MAX_VIDEO_SECONDS, label = 'Video', optional = true }: {
  file: File | null;
  // Longest video accepted (items 1 min 30 s, lessons 4 min 30 s).
  maxSeconds?: number;
  label?: string;
  optional?: boolean;
  onChange: (file: File | null) => void;
  // A video the item already has (edit page).
  existing?: string | null;
  onRemoveExisting?: () => void;
  // Upload progress in percent while saving.
  uploading?: number | null;
}) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const local = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);
  const preview = local ?? existing ?? null;

  const choose = async (picked?: File) => {
    if (!picked) return;
    if (picked.type && !picked.type.startsWith('video/')) {
      toast({ variant: 'destructive', title: 'Video not added', description: 'Choose a video file.' });
      return;
    }
    const length = await videoLength(picked);
    if (length !== null && length > maxSeconds + 0.5) {
      toast({ variant: 'destructive', title: 'Video too long', description: `It is ${formatLength(length)}. Up to ${formatLength(maxSeconds)}.` });
      return;
    }
    setSeconds(length);
    onChange(picked);
  };

  return (
    <div className="space-y-2">
      <Label className="text-lg font-medium">{label} <span className="text-sm font-normal text-muted-foreground">({optional ? 'optional, ' : ''}up to {formatLength(maxSeconds)})</span></Label>
      {preview ? (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video src={preview} controls playsInline className="max-h-80 w-full" />
          <div className="flex items-center justify-between gap-2 bg-background p-2 text-sm">
            <span className="text-muted-foreground">{file ? `${file.name.slice(0, 28)} · ${seconds ? `${Math.round(seconds)} s` : ''}` : 'Current video'}</span>
            <Button type="button" size="icon" variant="ghost" className="text-destructive" disabled={uploading != null} onClick={() => (file ? onChange(null) : onRemoveExisting?.())} aria-label="Remove video" title="Remove video"><Trash2 className="h-4 w-4" /></Button>
          </div>
          {uploading != null && (
            <div className="space-y-1 bg-background p-2 pt-0 text-xs text-muted-foreground">
              <Progress value={uploading} className="h-2" />
              {uploading < 100 ? `Uploading ${uploading}%` : <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Preparing the video…</span>}
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-muted-foreground transition hover:border-primary hover:text-primary">
          <Film className="h-8 w-8" />
          <span className="text-sm font-medium">Add a video</span>
        </button>
      )}
      <input ref={input} type="file" accept="video/*" className="sr-only" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
