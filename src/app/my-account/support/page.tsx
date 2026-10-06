
'use client';

import * as React from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Phone } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';

export default function SupportPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !message) {
      toast({
        variant: 'destructive',
        title: 'Missing Fields',
        description: 'Please select a subject and write a message.',
      });
      return;
    }
    
    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      toast({
        title: 'Request Sent!',
        description: 'Our support team has received your request and will get back to you shortly.',
      });
      setSubject('');
      setMessage('');
      setContact('');
      setIsSubmitting(false);
    }, 1000);
  };

  return (
    <div className="grid gap-6">
      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Contact Support</CardTitle>
            <CardDescription>
              Have an issue or a question? Fill out the form below and our team will get back to you.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" value={user?.displayName || ''} readOnly disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={user?.email || ''} readOnly disabled />
              </div>
            </div>
             <div className="space-y-2">
                <Label htmlFor="contact">Contact Number (Optional)</Label>
                <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input id="contact" type="text" placeholder="Your phone number" className="pl-10" value={contact} onChange={(e) => setContact(e.target.value)} />
                </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Select onValueChange={setSubject} value={subject}>
                <SelectTrigger id="subject">
                  <SelectValue placeholder="Select a subject..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="billing">Billing & Payments</SelectItem>
                  <SelectItem value="technical">Technical Issue</SelectItem>
                  <SelectItem value="account">Account Question</SelectItem>
                  <SelectItem value="order">Order Inquiry</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                placeholder="Please describe your issue in detail..."
                className="min-h-32"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

    