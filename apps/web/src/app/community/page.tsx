'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useState} from 'react';
import {EmptyState, Screen, field, secondary} from '@/components/screen';
import {PostLabels} from '@/components/post-labels';
import {useCourseCodes} from '@/lib/data/catalog';
import {FLAIRS, filterPosts, isFlair, postTitle, usePosts} from '@/lib/data/community';

function Feed() {
  const params = useSearchParams();
  const router = useRouter();
  const rawFlair = params.get('flair') ?? '';
  const flair = isFlair(rawFlair) ? rawFlair : null;
  const course = params.get('course');
  const [q, setQ] = useState('');
  const posts = usePosts();
  const ids = posts.flatMap((post) => post.course_id ? [post.course_id] : []);
  if (course) ids.push(course);
  const codes = useCourseCodes(ids);
  const shown = filterPosts(posts, {courseId: course, q, flair, courseCodes: codes});
  const feedUrl = (category: string) => {
    const query = new URLSearchParams();
    if (course) query.set('course', course);
    if (category) query.set('flair', category);
    return query.size ? `/community?${query}` : '/community';
  };

  return (
    <Screen title="Community" actions={<Link className={secondary} href={`/community/new${course ? `?course=${encodeURIComponent(course)}` : ''}`}>New post</Link>}>
      <input type="search" aria-label="Search posts" placeholder="Search questions, tips and courses" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
      <nav aria-label="Post flair" className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 py-2">
        {[['', 'All'], ...Object.entries(FLAIRS)].map(([value, label]) => (
          <Link key={value} href={feedUrl(value)} scroll={false} aria-current={(flair ?? '') === value ? 'true' : undefined}
            className="choice-chip shrink-0 aria-[current=true]:bg-neutral-900 aria-[current=true]:text-white">{label}</Link>
        ))}
      </nav>
      {ids.length > 0 && <label className="block text-xs font-extrabold">Course tag
        <select aria-label="Filter by course tag" className={field} value={course ?? ''} onChange={(event) => {
          const value = event.target.value;
          const query = new URLSearchParams();
          if (value) query.set('course', value);
          if (flair) query.set('flair', flair);
          router.push(query.size ? `/community?${query}` : '/community', {scroll: false});
        }}>
          <option value="">All courses</option>
          {[...new Set(ids)].sort((a, b) => (codes[a] ?? a).localeCompare(codes[b] ?? b)).map((id) =>
            <option key={id} value={id}>{codes[id] ?? id}</option>)}
        </select>
      </label>}
      {course && <p className="my-2 text-sm">Course: <strong>{codes[course] ?? course}</strong> <Link className="ml-1 text-accent underline" href={flair ? `/community?flair=${flair}` : '/community'}>Clear</Link></p>}
      {shown.length === 0 ? <EmptyState title="No posts found" body="Try another flair or search term." /> : (
        <ul className="mt-2 space-y-3">
          {shown.map((post) => (
            <li key={post.id} className="surface space-y-2">
              <PostLabels post={post} courseCode={post.course_id ? codes[post.course_id] : undefined} feedHref={feedUrl(flair ?? '')} />
              <Link href={`/community/${post.id}?from=${encodeURIComponent(feedUrl(flair ?? ''))}`} className="block">
                <h2 className="section-title break-words">{postTitle(post)}</h2>
                {post.title && <p className="mt-1 line-clamp-2 wrap-anywhere text-sm text-neutral-600">{post.body}</p>}
                <p className="mt-2 text-xs font-bold text-neutral-600">{post.public_alias.startsWith('Student-') ? post.public_alias.slice(0, 14) : post.public_alias}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

export default function CommunityPage() {
  return <Suspense fallback={<Screen title="Community"><p role="status">Loading posts…</p></Screen>}><Feed /></Suspense>;
}
