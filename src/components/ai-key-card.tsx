'use client';

// The account's own AI key (DeepSeek). Two accounts never share one: the key is kept on the server with the account
// that added it (server/ai-keys.mjs), checked with DeepSeek when saved, and never shown again — only "••••1234".
import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

type AiKey = {
  saved: boolean;
  hint: string | null;
  addedAt: string | null;
  checkedAt: string | null;
  // Whose key this account's AI features use: its own, Saligue's, or none yet.
  source: 'yours' | 'platform' | 'none';
};
type SavedKey = AiKey & { checked: boolean; reason: string | null; balance: string | null };

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Kigali' }) : null;

export function AiKeyCard() {
  const { toast } = useToast();
  const [state, setState] = useState<AiKey | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ deepseek: AiKey }>('/ai/keys')
      .then((r) => setState(r.deepseek))
      .catch(() => setState(null));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const secret = key.trim();
    if (!secret || busy) return;
    setBusy(true);
    try {
      const saved = await api<SavedKey>('/ai/keys/deepseek', { method: 'PUT', body: { key: secret } });
      setState(saved);
      setKey('');
      toast({
        title: saved.checked ? 'Key saved and checked' : 'Key saved',
        description: saved.checked
          ? `DeepSeek accepted this key${saved.balance ? ` · ${saved.balance} left` : ''}. Only this account uses it.`
          : saved.reason ?? 'DeepSeek could not be reached to check it. It will be checked again when you save it next time.',
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Key not saved', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setState(await api<AiKey>('/ai/keys/deepseek', { method: 'DELETE' }));
      toast({ title: 'Key removed', description: 'This account no longer has its own AI key.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not removed', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  // The saved key never travels to the app, so this is the only way a key kept while DeepSeek was unreachable is
  // retried (POST /ai/keys/deepseek/check). It is counted with the same few-checks-an-hour limit.
  const check = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const checked = await api<SavedKey>('/ai/keys/deepseek/check', { method: 'POST' });
      setState(checked);
      toast({
        title: checked.checked ? 'This key works' : 'Not checked yet',
        description: checked.checked
          ? `DeepSeek accepted it${checked.balance ? ` · ${checked.balance} left` : ''}.`
          : checked.reason ?? 'DeepSeek did not answer. Try again in a moment.',
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not check', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Your AI key</CardTitle>
        <CardDescription>
          Add your own DeepSeek key to this account. It is kept with this account only, so another account signed in
          on the same phone never uses it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state?.saved ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Saved key: {state.hint}</p>
              <p className="text-xs text-muted-foreground">
                {state.checkedAt ? `Checked with DeepSeek on ${day(state.checkedAt)}.` : 'Not checked yet.'}
                {state.addedAt ? ` Added on ${day(state.addedAt)}.` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="ghost" onClick={check} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check again
              </Button>
              <Button type="button" variant="ghost" onClick={remove} disabled={busy}>Remove</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {state?.source === 'platform'
              ? 'This account has no key of its own. Saligue’s key writes your descriptions meanwhile.'
              : 'This account has no key of its own, so AI writing asks for one first.'}
          </p>
        )}
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="deepseek-key">DeepSeek key</Label>
            <Input
              id="deepseek-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={busy || !key.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check and save
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Create one at platform.deepseek.com → API keys. It writes your item descriptions on Sell and Edit (Write with
          AI). Only this account can use it, it is never shown again, and you can remove it at any time.
        </p>
      </CardContent>
    </Card>
  );
}
