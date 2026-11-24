
'use client';

import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AtSign, KeyRound } from 'lucide-react';
import React, { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { loginWithEmail, type TwoFactorChallenge } from '@/lib/auth-actions';
import { GoogleButton } from './google-button';
import { SuspendedPanel, type SuspendedProof } from './suspended-panel';
import { TwoFactorCode } from './two-factor-code';
import Link from 'next/link';
import { ScrollArea } from '../ui/scroll-area';

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToRegister?: () => void;
  trigger?: React.ReactNode;
}

export function LoginDialog({
  open,
  onOpenChange,
  onSwitchToRegister,
  trigger
}: LoginDialogProps) {
  const { toast } = useToast();
  const t = useT();
  const id = React.useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // A suspended account is told why and until when, and can ask for a review, right here.
  const [suspended, setSuspended] = useState<{ message: string; proof: SuspendedProof } | null>(null);
  // Two-step sign-in is on for this account: the password was right and a code went to its email, so the dialog stays
  // open until that code is in.
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  // Closing throws away a half-finished sign-in, so reopening never shows a step from last time.
  const setOpen = (next: boolean) => {
    if (!next) {
      setChallenge(null);
      setSuspended(null);
    }
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // One account per person: logging in never changes whether it has a shop.
      const asked = await loginWithEmail(email, password);
      if (asked) {
        setChallenge(asked);
        return;
      }
      setOpen(false);
    } catch (error: any) {
      if (error?.code === 'suspended') {
        setSuspended({ message: error.message, proof: { email, password } });
        return;
      }
      toast({
        variant: 'destructive',
        title: t('Login Failed'),
        description: friendlyError(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onSwitchToRegister) {
      onSwitchToRegister();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md p-0 bg-transparent border-0">
        <ScrollArea className="max-h-[90vh]">
            <Card className="rounded-lg border-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-3xl font-bold tracking-tight text-center">{t('Welcome Back')}</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-center">
                        {t('Log in to access your account and start styling.')}
                    </DialogDescription>
                </DialogHeader>
                <CardContent className="p-6">
                    {suspended ? <SuspendedPanel message={suspended.message} proof={suspended.proof} onBack={() => setSuspended(null)} /> : challenge ? <TwoFactorCode challenge={challenge} onDone={() => setOpen(false)} onBack={() => setChallenge(null)} /> : <>
                    <div className="space-y-6">
                        <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor={`${id}-email-login`} className="text-lg font-medium">{t('Email')}</Label>
                            <div className="relative">
                            <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input id={`${id}-email-login`} type="email" placeholder="you@example.com" autoComplete="email" className="pl-10 h-12 text-base" required value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-baseline justify-between">
                                <Label htmlFor={`${id}-password-login`} className="text-lg font-medium">{t('Password')}</Label>
                                <Link href="/forgot-password" onClick={() => onOpenChange(false)} className="text-sm font-medium text-primary hover:underline">{t('Forgot password?')}</Link>
                            </div>
                            <div className="relative">
                            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input id={`${id}-password-login`} type="password" placeholder="••••••••" autoComplete="current-password" className="pl-10 h-12 text-base" required value={password} onChange={(e) => setPassword(e.target.value)} />
                            </div>
                        </div>

                        <Button type="submit" size="lg" className="w-full text-lg h-14" disabled={busy}>{busy ? t('Logging in…') : t('Log In')}</Button>
                        </form>
                        {/* No date is collected here: a brand-new Google account is asked for it inside the button. */}
                        <GoogleButton onDone={() => setOpen(false)} onSuspended={(message, credential) => setSuspended({ message, proof: { credential } })} />
                    </div>
                    <div className="mt-6 text-center text-sm">
                        {t("Don't have an account?")}{' '}
                        <button onClick={handleSwitch} className="font-medium text-primary hover:underline">
                            {t('Sign up')}
                        </button>
                    </div>
                    </>}
                </CardContent>
            </Card>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
