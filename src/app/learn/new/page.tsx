'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Columns2, GraduationCap, Loader2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/components/auth/auth-provider';
import { VideoField, uploadVideo } from '@/components/video-field';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { LESSON_LANGUAGES, LESSON_TOPICS, lessonMaxSeconds, createLesson, deleteLesson, getChallenge, getLesson, timeLeft, type Challenge, type Lesson } from '@/lib/lessons';
import { cn } from '@/lib/utils';

/** Teach a fashion lesson: a video up to 4 min 30 s (General studies 10 min), a title and a topic. Anyone with an account. */
export default function NewLessonPage() {
  return (
    <Suspense fallback={null}>
      <NewLesson />
    </Suspense>
  );
}

function NewLesson() {
  // ?challenge=… joins a challenge; ?duet=… answers a lesson side by side.
  const params = useSearchParams();
  const challengeId = params.get('challenge');
  const duetId = params.get('duet');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [duetOf, setDuetOf] = useState<Lesson | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const { user, isAuthLoading } = useAuth();
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState(() => (['styling', 'sewing', 'traditional', 'business', 'general'].includes(params.get('topic') ?? '') ? params.get('topic')! : ''));
  const [language, setLanguage] = useState('rw');
  const [uploading, setUploading] = useState<number | null>(null);
  // A video longer than the new topic allows is dropped (General studies allow 10 min, the others 4 min 30 s).
  const pickTopic = (value: string) => {
    setTopic(value);
    if (video && lessonMaxSeconds(value) < lessonMaxSeconds(topic)) {
      setVideo(null);
      toast({ title: 'Choose the video again', description: 'This topic allows up to 4 min 30 s.' });
    }
  };
  useEffect(() => {
    if (challengeId) getChallenge(challengeId).then((c) => { setChallenge(c); setTopic((t) => t || c.topic); }).catch(() => {});
    if (duetId) getLesson(duetId).then((l) => { setDuetOf(l); setTopic((t) => t || l.topic); setTitle((t) => t || `Duet: ${l.title}`.slice(0, 100)); }).catch(() => {});
  }, [challengeId, duetId]);

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
    if (!topic) return toast({ variant: 'destructive', title: 'Choose a topic' });
    if (!video) return toast({ variant: 'destructive', title: 'Add your video', description: topic === 'general' ? 'Up to 10 min.' : 'Up to 4 min 30 s.' });
    setUploading(0);
    let created: string | null = null;
    try {
      const lesson = await createLesson({ title: title.trim(), description: description.trim(), topic, language, challengeId: challenge?.id, duetOf: duetOf?.id });
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
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6 px-3 py-4 pb-24 min-[360px]:px-4 md:p-8">
      <div className="flex items-center gap-3">
        <GraduationCap className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-extrabold">Teach a lesson</h1>
      </div>
      {challenge && (
        <div className="flex items-center gap-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-950">
          <Trophy className="h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1"><b>{challenge.title}</b> · {timeLeft(challenge.endsAt)}{challenge.description && <span className="block text-xs">{challenge.description}</span>}</span>
        </div>
      )}
      {duetOf && (
        <div className="flex items-center gap-3 rounded-xl border p-3 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {duetOf.poster && <img src={duetOf.poster} alt="" className="h-16 w-12 rounded-md object-cover" />}
          <span className="min-w-0 flex-1"><span className="flex items-center gap-1 font-semibold"><Columns2 className="h-4 w-4 text-primary" /> Duet with {duetOf.authorName}</span><span className="line-clamp-1 text-muted-foreground">{duetOf.title}</span>
            <span className="block text-xs text-muted-foreground">Your video plays beside theirs. Film yourself trying it, doing it your way, or answering.</span></span>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-lg font-medium">Topic *</Label>
        <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3">
          {LESSON_TOPICS.map((t) => (
            <button key={t.value} type="button" onClick={() => pickTopic(t.value)} aria-pressed={topic === t.value}
              className={cn('flex min-w-0 flex-col items-center gap-1 rounded-xl border p-2.5 text-center text-xs font-semibold transition', topic === t.value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
              <t.icon className="h-6 w-6" /> <span className="break-words">{t.label}</span>
              <span className="text-[10px] font-normal text-muted-foreground">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <VideoField key={lessonMaxSeconds(topic)} file={video} onChange={setVideo} uploading={uploading} maxSeconds={lessonMaxSeconds(topic)} label="Video *" optional={false} />

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
