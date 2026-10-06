
'use client';

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
import { AtSign, KeyRound, Store } from 'lucide-react';
import React, { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { Switch } from '../ui/switch';
import { ScrollArea } from '../ui/scroll-area';
import { GoogleButton } from './google-button';

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
  const id = React.useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { role, setRole } = useUserRoleStore();
  const auth = getAuth(app);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Success is handled by onAuthStateChanged in AuthProvider
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: error.message,
      });
    }
  };

  const handleSwitch = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onSwitchToRegister) {
      onSwitchToRegister();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md p-0 bg-transparent border-0">
        <ScrollArea className="max-h-[90vh]">
            <Card className="rounded-lg border-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-3xl font-bold tracking-tight text-center">Welcome Back</DialogTitle>
                    <DialogDescription className="text-muted-foreground text-center">
                        Log in to access your account and start styling.
                    </DialogDescription>
                </DialogHeader>
                <CardContent className="p-6">
                    <div className="space-y-6">
                        <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor={`${id}-email-login`} className="text-lg font-medium">Email</Label>
                            <div className="relative">
                            <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input id={`${id}-email-login`} type="email" placeholder="you@example.com" className="pl-10 h-12 text-base" required value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor={`${id}-password-login`} className="text-lg font-medium">Password</Label>
                            <div className="relative">
                            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input id={`${id}-password-login`} type="password" placeholder="••••••••" className="pl-10 h-12 text-base" required value={password} onChange={(e) => setPassword(e.target.value)} />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="flex items-center space-x-3">
                                <Store className="h-6 w-6 text-muted-foreground" />
                                <Label htmlFor={`${id}-seller-switch-login`} className="text-base font-medium">
                                    Log in as a Seller
                                </Label>
                            </div>
                            <Switch 
                              id={`${id}-seller-switch-login`} 
                              checked={role === 'seller'} 
                              onCheckedChange={(checked) => setRole(checked ? 'seller' : 'buyer')}
                            />
                        </div>

                        <Button type="submit" size="lg" className="w-full text-lg h-14">Log In</Button>
                        </form>
                        <GoogleButton />
                    </div>
                    <div className="mt-6 text-center text-sm">
                        Don't have an account?{' '}
                        <button onClick={handleSwitch} className="font-medium text-primary hover:underline">
                            Sign up
                        </button>
                    </div>
                </CardContent>
            </Card>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
