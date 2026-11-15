'use client';

import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useRef, useState} from 'react';
import {Screen, field, primary, secondary} from '@/components/screen';
import {searchCourses, useCourseCodes, type CourseHit} from '@/lib/data/catalog';
import {FLAIRS, addPost, isFlair} from '@/lib/data/community';

function Composer() {
  const router = useRouter();
  const initial = useSearchParams().get('course');
  const codes = useCourseCodes(initial ? [initial] : []);
  const [course, setCourse] = useState<string | null>(initial);
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(0);

  async function search(value: string) {
    setQ(value);
    setHits([]);
    const ticket = ++latest.current;
    if (value.trim().length < 2) return;
    try {
      const matches = await searchCourses(value);
      if (latest.current === ticket) setHits(matches);
    } catch {
      if (latest.current === ticket) setError('Couldn’t search courses. Try again.');
    }
  }
  const back = initial ? `/community?course=${encodeURIComponent(initial)}` : '/community';
  return (
    <Screen title="New post" back={{href: back, label: 'Back to community'}}>
      <form className="surface space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        const form = new FormData(event.currentTarget);
        const category = String(form.get('flair'));
        if (!isFlair(category)) return setError('Choose a flair.');
        setSaving(true);
        setError(null);
        try {
          const result = await addPost({title: String(form.get('title')), body: String(form.get('body')), category, course_id: course});
          if ('error' in result) setError(result.error);
          else router.replace(`/community/${result.id}?from=${encodeURIComponent(back)}`);
        } catch {
          setError('Couldn’t post. Try again.');
        } finally {
          setSaving(false);
        }
      }}>
        <label className="block text-sm font-extrabold">Title <input className={field} name="title" required maxLength={160} /></label>
        <label className="block text-sm font-extrabold">Flair
          <select name="flair" className={field} required defaultValue="">
            <option value="">Choose a flair</option>
            {Object.entries(FLAIRS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-extrabold">Body <textarea name="body" className={`${field} min-h-32`} required /></label>
        <div>
          <p className="text-sm font-extrabold">Course tag <span className="text-neutral-600">(optional)</span></p>
          {course ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-900">{code || codes[course] || course}</span>
              <button type="button" className={secondary} onClick={() => {setCourse(null); setQ(''); setHits([]);}}>Remove</button>
            </div>
          ) : (
            <>
              <input aria-label="Find a course tag" type="search" placeholder="Search by course code" className={field} value={q} onChange={(e) => void search(e.target.value)} />
              <ul className="mt-1 divide-y divide-neutral-200">
                {hits.map((hit) => <li key={hit.id}><button type="button" className="w-full py-2 text-left text-sm" onClick={() => {setCourse(hit.id); setCode(hit.code);}}>{hit.code}{hit.title && ` · ${hit.title}`}</button></li>)}
              </ul>
            </>
          )}
        </div>
        <p className="text-xs text-neutral-600">Your post shows an anonymous name.</p>
        {error && <p role="alert" className="text-sm text-accent">{error}</p>}
        <button className={primary} type="submit" disabled={saving}>{saving ? 'Posting…' : 'Post'}</button>
      </form>
    </Screen>
  );
}
export default function NewPostPage() {
  return <Suspense fallback={<Screen title="New post"><p role="status">Loading…</p></Screen>}><Composer /></Suspense>;
}
