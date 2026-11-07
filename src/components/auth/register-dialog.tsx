
'use client';

import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { yearsAgo } from '@/lib/utils';

import { useState, useId } from 'react';
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
import { AtSign, KeyRound, User, CalendarDays } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { registerWithEmail } from '@/lib/auth-actions';
import { GoogleButton } from './google-button';
import Link from 'next/link';
import { Checkbox } from '../ui/checkbox';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { ScrollArea } from '../ui/scroll-area';

interface RegisterDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSwitchToLogin?: () => void;
    trigger?: React.ReactNode;
}

export function RegisterDialog({ open, onOpenChange, onSwitchToLogin, trigger }: RegisterDialogProps) {
    const { toast } = useToast();
    const t = useT();
    // One account for shopping and selling: it gets a shop from Sell (which sets this before sign-up), never from a switch here.
    const role = useUserRoleStore((s) => s.role);
    const id = useId();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [birthDate, setBirthDate] = useState('');
    const [busy, setBusy] = useState(false);
    const [accepted, setAccepted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await registerWithEmail(name, email, password, role, accepted, birthDate);
            onOpenChange(false);
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: error?.code === 'too_young' ? t('Saligue is for people aged 16 and over') : t('Registration Failed'),
                description: friendlyError(error),
            });
        } finally {
            setBusy(false);
        }
    };

    const handleSwitch = (e: React.MouseEvent) => {
        e.preventDefault();
        if (onSwitchToLogin) {
            onSwitchToLogin();
        }
    }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md p-0 bg-transparent border-0">
        <ScrollArea className="max-h-[90vh]">
            <Card className="rounded-lg border-0">
                <DialogHeader className="p-6 pb-0">
                  <DialogTitle className="text-3xl font-bold tracking-tight text-center">{t('Create an Account')}</DialogTitle>
                  <DialogDescription className="text-muted-foreground text-center">
                    {t('Join Saligue and start your fashion journey today.')}
                  </DialogDescription>
                </DialogHeader>
                <CardContent className="p-6">
                    <div className="space-y-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor={`${id}-name`} className="text-lg font-medium">{t('Full Name')}</Label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input id={`${id}-name`} placeholder="John Doe" className="pl-10 h-12 text-base" required value={name} onChange={(e) => setName(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor={`${id}-email-register`} className="text-lg font-medium">{t('Email')}</Label>
                            <div className="relative">
                                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input id={`${id}-email-register`} type="email" placeholder="you@example.com" className="pl-10 h-12 text-base" required value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor={`${id}-password-register`} className="text-lg font-medium">{t('Password')}</Label>
                            <div className="relative">
                                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input id={`${id}-password-register`} type="password" placeholder={t('At least 6 characters')} minLength={6} className="pl-10 h-12 text-base" required value={password} onChange={(e) => setPassword(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor={`${id}-birth-date`} className="text-lg font-medium">{t('Date of Birth')}</Label>
                            <div className="relative">
                                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input id={`${id}-birth-date`} type="date" autoComplete="bday" max={yearsAgo(16)} min={yearsAgo(120)} className="pl-10 h-12 text-base" required value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                            </div>
                            <p className="text-xs text-muted-foreground">{t('Saligue is for people aged 16 and over. Only your age is kept, and it is never shown to anyone.')}</p>
                        </div>

                        <label className="flex items-start gap-3 text-sm leading-snug">
                            <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" required />
                            <span>
                                {t('I am at least 16 and I accept the')}{' '}
                                <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">{t('Terms of Service')}</Link> {t('and')}{' '}
                                <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">{t('Privacy Policy')}</Link>.
                            </span>
                        </label>

                        <Button type="submit" size="lg" className="w-full text-lg h-14" disabled={busy || !accepted}>{busy ? t('Creating account…') : t('Create Account')}</Button>
                    </form>
                    <GoogleButton role={role} birthDate={birthDate} onDone={() => onOpenChange(false)} />
                    </div>
                    <div className="mt-6 text-center text-sm">
                        {t('Already have an account?')}{' '}
                        <button onClick={handleSwitch} className="font-medium text-primary hover:underline">
                            {t('Log in')}
                        </button>
                    </div>
                </CardContent>
            </Card>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
