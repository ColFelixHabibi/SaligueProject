'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { saveImage } from '@/lib/save-file';

/** "Save" for a picture: a download on the web, the phone's save/share menu in the app. */
export function SaveImageButton({ url, name, children, ...props }: { url: string; name: string } & ButtonProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button type="button" {...props} disabled={busy || props.disabled} onClick={async () => {
      setBusy(true);
      try {
        await saveImage(url, name);
      } catch {
        toast({ variant: 'destructive', title: 'Not saved', description: 'Try again, or take a screenshot.' });
      } finally {
        setBusy(false);
      }
    }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </Button>
  );
}
