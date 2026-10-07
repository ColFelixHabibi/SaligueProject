'use client';

import { friendlyError } from '@/lib/errors';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { resetPassword } from '@/lib/auth-actions';

function ResetPassword() {
  const { toast } = useToast();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ variant: 'destructive', title: 'Passwords do not match', description: 'Type the same new password twice.' });
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      toast({ title: 'Password changed', description: 'You are signed in with your new password.' });
      router.replace('/');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not change the password', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <p className="text-center">
        This link is incomplete. <Link href="/forgot-password" className="font-medium text-primary hover:underline">Ask for a new one</Link>.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {[
        { id: 'new-password', label: 'New password', value: password, set: setPassword },
        { id: 'confirm-password', label: 'Type it again', value: confirm, set: setConfirm },
      ].map((f) => (
        <div key={f.id} className="space-y-2">
          <Label htmlFor={f.id}>{f.label}</Label>
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input id={f.id} type="password" required minLength={6} autoComplete="new-password" className="h-12 pl-10" value={f.value} onChange={(e) => f.set(e.target.value)} placeholder="At least 6 characters" />
          </div>
        </div>
      ))}
      <Button type="submit" size="lg" className="h-12 w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save new password
      </Button>
      <p className="text-center text-xs text-muted-foreground">You will be signed out on your other devices.</p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Choose a new password</CardTitle>
          <CardDescription>Your Saligue account will use this password from now on.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <ResetPassword />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
