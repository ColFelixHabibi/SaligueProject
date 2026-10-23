'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { LESSON_LANGUAGES, loadCues, saveCaptions, type Cue, type Lesson } from '@/lib/lessons';

/**
 * The teacher's captions: correct the words of the automatic captions (timings stay), or type captions
 * (one line per sentence, timed evenly over the video), e.g. for Kinyarwanda.
 */
export function CaptionsEditor({ lesson, onSaved }: { lesson: Lesson; onSaved: () => void }) {
  const { toast } = useToast();
  const own = lesson.captions?.find((c) => c.lang === lesson.language);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (own) loadCues(own.url).then(setCues).catch(() => setCues([]));
    else setCues([]);
  }, [own?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = LESSON_LANGUAGES.find((l) => l.value === lesson.language)?.label ?? lesson.language;

  const save = async () => {
    setBusy(true);
    try {
      await saveCaptions(lesson.id, cues?.length ? { lang: lesson.language, cues } : { lang: lesson.language, text });
      toast({ title: 'Captions saved' });
      onSaved();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (lesson.captionsStatus === 'pending') return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Saligue is writing the captions (about 2 minutes).</p>;
  if (cues === null) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {cues.length ? `Saligue wrote these ${label} captions from your voice. Correct any word.` : `Type what you say in ${label}, one line per sentence. Saligue times them over your video.`}
      </p>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {cues.length ? cues.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-2 text-xs text-muted-foreground">{c.start.slice(3, 8)}</span>
            <input value={c.text} onChange={(e) => setCues(cues.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary" />
          </div>
        )) : <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Muraho! Uyu munsi turiga…\n…'} />}
      </div>
      <Button onClick={save} disabled={busy || (!cues.length && !text.trim())}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save captions</Button>
    </div>
  );
}
