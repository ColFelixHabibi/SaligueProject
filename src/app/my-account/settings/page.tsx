
'use client';

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
import { getAuth, updateProfile, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import React, { useState, useEffect } from 'react';
import { app } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

export default function BuyerSettingsPage() {
  const auth = getAuth(app);
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);

  useEffect(() => {
    if (auth.currentUser) {
      setDisplayName(auth.currentUser.displayName || '');
      setEmail(auth.currentUser.email || '');
    }
  }, [auth.currentUser]);

  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    try {
      await updateProfile(auth.currentUser, {
        displayName: displayName,
      });
      toast({
        title: 'Success',
        description: 'Your profile has been updated.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update profile: ' + error.message,
      });
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPasswordSaving(true);

    if (!auth.currentUser) {
        toast({ variant: 'destructive', title: 'Error', description: 'Not logged in.' });
        setIsPasswordSaving(false);
        return;
    }
    if (newPassword !== confirmPassword) {
        toast({ variant: 'destructive', title: 'Error', description: 'New passwords do not match.' });
        setIsPasswordSaving(false);
        return;
    }
    if (!currentPassword || !newPassword) {
        toast({ variant: 'destructive', title: 'Error', description: 'Please fill all password fields.' });
        setIsPasswordSaving(false);
        return;
    }

    try {
        const user = auth.currentUser;
        if (user.email) {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPassword);
            
            toast({
                title: 'Success',
                description: 'Your password has been changed successfully.',
            });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        }
    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Error changing password',
            description: error.message,
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
            <CardDescription>
              Update your password here. Please enter your current password to make changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input 
                  id="currentPassword" 
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
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
