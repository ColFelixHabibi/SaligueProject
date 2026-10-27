'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Store, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { updateAccount } from '@/lib/auth-actions';
import { friendlyError } from '@/lib/errors';
import { cn } from '@/lib/utils';

// Square, centred, 512 px JPEG: small enough to load fast everywhere it is shown.
async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This file is not a photo we can read. Try a JPG or PNG.'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const size = Math.min(512, side);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The account's profile photo: shown with the shop on every item, in chats and on orders. */
// With children: just the photo (tap to change) beside them, e.g. the account card on Me.
export function ProfilePhotoField({ name, required, className, onSaved, children }: { name?: string | null; required?: boolean; className?: string; onSaved?: () => void; children?: React.ReactNode }) {
  const { toast } = useToast();
  const avatar = useUserRoleStore((s) => s.avatar);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await updateAccount({ avatar: value });
      toast({ title: value ? 'Profile photo saved' : 'Profile photo removed' });
      onSaved?.();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Photo not saved', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file?: File) => {
    if (!file) return;
    try {
      await save(await squarePhoto(file));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Photo not saved', description: friendlyError(error) });
    }
  };

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <button type="button" onClick={() => input.current?.click()} className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Change profile photo">
        <Avatar className={cn(children ? 'h-16 w-16 border-2' : 'h-20 w-20 border-2', avatar ? 'border-primary' : 'border-dashed border-muted-foreground/40')}>
          <AvatarImage src={avatar ?? undefined} alt="" className="object-cover" />
          <AvatarFallback className="bg-primary/10 text-primary">
            {name ? <span className="text-2xl font-bold">{name.charAt(0).toUpperCase()}</span> : <Store className="h-8 w-8" />}
          </AvatarFallback>
        </Avatar>
        <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow ring-2 ring-background">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </span>
      </button>
      {children ?? <div className="min-w-0 space-y-1.5">
        <p className="font-semibold">Profile photo{required && !avatar && <span className="text-destructive"> *</span>}</p>
        <p className="text-sm text-muted-foreground">
          {required ? 'Buyers see it next to your shop on every item and in messages. Your face or your shop logo.' : 'Shown in messages and on your orders.'}
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={avatar ? 'outline' : 'default'} disabled={busy} onClick={() => input.current?.click()}>
            <Camera className="mr-1.5 h-4 w-4" /> {avatar ? 'Change photo' : 'Add photo'}
          </Button>
          {avatar && !required && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => save(null)}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Remove
            </Button>
          )}
        </div>
      </div>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="hidden" onChange={(e) => {
        void choose(e.target.files?.[0]);
        e.target.value = '';
      }} />
    </div>
  );
}
