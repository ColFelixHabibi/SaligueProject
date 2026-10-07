
'use client';

import { friendlyError } from '@/lib/errors';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';

export default function BuyerSettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setEmail(user.email || '');
    }
  }, [user]);

  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    try {
      const { error: authError } = await supabase.auth.updateUser({ data: { display_name: displayName } });
      if (authError) throw authError;
      const { error: profileError } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', user.uid);
      if (profileError) throw profileError;
      toast({
        title: 'Success',
        description: 'Your profile has been updated.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: friendlyError(error),
      });
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPasswordSaving(true);

    if (!user) {
        toast({ variant: 'destructive', title: 'Error', description: 'Not logged in.' });
        setIsPasswordSaving(false);
        return;
    }
    if (newPassword !== confirmPassword) {
        toast({ variant: 'destructive', title: 'Error', description: 'New passwords do not match.' });
        setIsPasswordSaving(false);
        return;
    }
    if (!newPassword) {
        toast({ variant: 'destructive', title: 'Error', description: 'Please fill all password fields.' });
        setIsPasswordSaving(false);
        return;
    }

    try {
        const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
        if (passwordError) throw passwordError;
            
            toast({
                title: 'Success',
                description: 'Your password has been changed successfully.',
            });
            setNewPassword('');
            setConfirmPassword('');
    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Error changing password',
            description: friendlyError(error),
        });
    } finally {
        setIsPasswordSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      <Card>
        <form onSubmit={handleSaveChanges}>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>
              Update your public-facing name.
            </CardDescription>
          </CardHeader>
          <CardContent>
              <div className="space-y-2">
                <Label htmlFor="displayName">Full Name</Label>
                <Input 
                  id="displayName" 
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your Name"
                />
              </div>
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit">Save</Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <form onSubmit={handlePasswordChange}>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Set or update the password for this account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input 
                  id="newPassword" 
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input 
                  id="confirmPassword" 
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={isPasswordSaving}>Update Password</Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>
                Your login email. This cannot be changed.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={email} readOnly disabled />
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
