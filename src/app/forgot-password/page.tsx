'use client';

import { friendlyError } from '@/lib/errors';

import { useState } from 'react';
import Link from 'next/link';
import { AtSign, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { requestPasswordReset } from '@/lib/auth-actions';

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not send the email', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto flex max-w-md flex-col px-4 py-10">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Forgot your password?</CardTitle>
          <CardDescription>Enter the email of your account and we will send you a link to choose a new password.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <MailCheck className="mx-auto h-12 w-12 text-primary" />
              <p>If an account exists for <b>{email}</b>, a reset link is on its way. It works for one hour.</p>
              <p className="text-sm text-muted-foreground">No email? Check your spam folder, or try again.</p>
              <Button variant="outline" onClick={() => setSent(false)}>Try another email</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input id="forgot-email" type="email" required autoComplete="email" className="h-12 pl-10" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
              </div>
              <Button type="submit" size="lg" className="h-12 w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send reset link
              </Button>
            </form>
          )}
          <p className="mt-6 text-center text-sm">
            Remembered it? <Link href="/login" className="font-medium text-primary hover:underline">Log in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
