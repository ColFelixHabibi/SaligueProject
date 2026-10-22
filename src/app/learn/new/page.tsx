'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/components/auth/auth-provider';
import { VideoField, uploadVideo } from '@/components/video-field';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { LESSON_LANGUAGES, LESSON_MAX_SECONDS, LESSON_TOPICS, createLesson, deleteLesson } from '@/lib/lessons';
import { cn } from '@/lib/utils';

/** Teach a fashion lesson: a video up to 4 min 30 s, a title and a fashion topic. Anyone with an account. */
export default function NewLessonPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, isAuthLoading } = useAuth();
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('rw');
  const [uploading, setUploading] = useState<number | null>(null);

  if (!isAuthLoading && !user) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-10 text-center">
        <GraduationCap className="mx-auto h-12 w-12 text-primary" />
        <h1 className="text-2xl font-extrabold">Teach on Saligue</h1>
        <p className="text-muted-foreground">Log in or create a free account to share a fashion lesson.</p>
        <Button asChild><Link href="/login">Log in</Link></Button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!video) return toast({ variant: 'destructive', title: 'Add your video', description: 'A lesson is a video up to 4 min 30 s.' });
    if (!topic) return toast({ variant: 'destructive', title: 'Choose a topic' });
    setUploading(0);
    let created: string | null = null;
    try {
      const lesson = await createLesson({ title: title.trim(), description: description.trim(), topic, language });
      created = lesson.id;
      await uploadVideo(`/lessons/${lesson.id}/video`, video, setUploading);
      toast({ title: 'Lesson posted', description: 'Thank you for teaching!' });
      router.push(`/learn?lesson=${lesson.id}`);
    } catch (error) {
      // Don't leave a lesson without its video.
      if (created) await deleteLesson(created).catch(() => {});
      toast({ variant: 'destructive', title: 'Not posted', description: friendlyError(error) });
      setUploading(null);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6 p-4 pb-24 md:p-8">
      <div className="flex items-center gap-3">
        <GraduationCap className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-extrabold">Teach a lesson</h1>
      </div>

      <VideoField file={video} onChange={setVideo} uploading={uploading} maxSeconds={LESSON_MAX_SECONDS} label="Video *" optional={false} />

      <div className="space-y-2">
        <Label className="text-lg font-medium">Topic *</Label>
        <div className="grid grid-cols-3 gap-2">
          {LESSON_TOPICS.map((t) => (
            <button key={t.value} type="button" onClick={() => setTopic(t.value)} aria-pressed={topic === t.value}
              className={cn('flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-semibold transition', topic === t.value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
              <t.icon className="h-6 w-6" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="lesson-title" className="text-lg font-medium">Title *</Label>
        <Input id="lesson-title" required minLength={3} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 3 ways to tie a kitenge headwrap" />
      </div>

      <div className="space-y-2">
        <Label className="text-lg font-medium">Language</Label>
        <div className="flex flex-wrap gap-2">
          {LESSON_LANGUAGES.map((l) => (
            <button key={l.value} type="button" onClick={() => setLanguage(l.value)} aria-pressed={language === l.value}
              className={cn('rounded-full border px-4 py-1.5 text-sm font-medium', language === l.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{l.label}</button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="lesson-description" className="text-lg font-medium">What you’ll teach</Label>
        <Textarea id="lesson-description" maxLength={2000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Steps, materials, tips…" />
      </div>

      <p className="text-xs text-muted-foreground">Lessons are about fashion only. Lessons reported by several people are hidden while Saligue reviews them.</p>
      <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={uploading != null}>
        {uploading != null && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}{uploading != null ? 'Posting…' : 'Post lesson'}
      </Button>
    </form>
  );
}
