
'use client';

import { friendlyError } from '@/lib/errors';

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
import { AtSign, User, Store } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { registerWithEmail } from '@/lib/auth-actions';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { ScrollArea } from '../ui/scroll-area';
import { Switch } from '../ui/switch';
import { GoogleButton } from './google-button';

interface RegisterDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSwitchToLogin?: () => void;
    trigger?: React.ReactNode;
}

export function RegisterDialog({ open, onOpenChange, onSwitchToLogin, trigger }: RegisterDialogProps) {
    const { toast } = useToast();
    const { role, setRole } = useUserRoleStore();
    const id = useId();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const result = await registerWithEmail(name, email);
            onOpenChange(false);
            if (result?.confirmationRequired) {
                toast({ title: 'Check your email', description: 'Confirm your email, then set your password in account settings.' });
            }
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Registration Failed',
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
                  <DialogTitle className="text-3xl font-bold tracking-tight text-center">Create an Account</DialogTitle>
                  <DialogDescription className="text-muted-foreground text-center">
                    Join Saligue and start your fashion journey today.
                  </DialogDescription>
                </DialogHeader>
                <CardContent className="p-6">
                    <div className="space-y-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor={`${id}-name`} className="text-lg font-medium">Full Name</Label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input id={`${id}-name`} placeholder="John Doe" className="pl-10 h-12 text-base" required value={name} onChange={(e) => setName(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor={`${id}-email-register`} className="text-lg font-medium">Email</Label>
                            <div className="relative">
                                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input id={`${id}-email-register`} type="email" placeholder="you@example.com" className="pl-10 h-12 text-base" required value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                        </div>

                        <p className="text-sm text-muted-foreground">Confirm your email, then choose a password in account settings.</p>

                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="flex items-center space-x-3">
                                <Store className="h-6 w-6 text-muted-foreground" />
                                <Label htmlFor={`${id}-seller-switch-register`} className="text-base font-medium">
                                    Sign up as a Seller
                                </Label>
                            </div>
                            <Switch 
                              id={`${id}-seller-switch-register`} 
                              checked={role === 'seller'} 
                              onCheckedChange={(checked) => setRole(checked ? 'seller' : 'buyer')}
                            />
                        </div>

                        <Button type="submit" size="lg" className="w-full text-lg h-14" disabled={busy}>{busy ? 'Sending confirmation…' : 'Continue with Email'}</Button>
                    </form>
                    <GoogleButton label="Sign up with Google" onDone={() => onOpenChange(false)} />
                    </div>
                    <div className="mt-6 text-center text-sm">
                        Already have an account?{' '}
                        <button onClick={handleSwitch} className="font-medium text-primary hover:underline">
                            Log in
                        </button>
                    </div>
                </CardContent>
            </Card>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
