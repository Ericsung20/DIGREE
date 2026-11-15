'use client';

import {useSearchParams} from 'next/navigation';
import {Suspense, useState} from 'react';
import {Screen, field, primary, secondary} from '@/components/screen';
import {COURSES, useCourseCodes} from '@/lib/data/catalog';
import {addComment, addPost, deleteComment, deletePost, filterPosts, reportPost, updatePost, useComments, usePosts, type Post} from '@/lib/data/community';
import {useCourseRecords} from '@/lib/data/course-records';
import {IS_MOCK} from '@/lib/supabase';

const link = 'text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent';
const when = (iso: string) => new Date(iso).toLocaleDateString([], {month: 'short', day: 'numeric'});
// Database aliases look like "Student-<32 hex>"; a short prefix is enough to tell authors apart.
const shortAlias = (alias: string) => (alias.startsWith('Student-') ? alias.slice(0, 14) : alias);

function PostCard({post, tagLabel}: {post: Post; tagLabel: string}) {
  const comments = useComments().filter((c) => c.post_id === post.id);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (action: Promise<string | null>) => {
    const err = await action;
    setError(err);
    return err === null;
  };
  return (
    <li className="rounded-xl border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-600">
        <span>
          {shortAlias(post.public_alias)} · <time suppressHydrationWarning>{when(post.created_at)}</time>
        </span>
        <span className="rounded-md bg-sky-100 px-2 py-0.5 text-sky-900">{tagLabel}</span>
      </div>
      {edit === null ? (
        <p className="mt-2 text-sm">{post.body}</p>
      ) : (
        <form
          className="mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (edit.trim() && (await run(updatePost(post.id, edit)))) setEdit(null);
          }}
        >
          <textarea aria-label="Edit post" value={edit} onChange={(e) => setEdit(e.target.value)} className={`${field} min-h-16`} />
          <button type="submit" className={`${secondary} mt-2`}>
            Save
          </button>
        </form>
      )}
      <div className="mt-2 flex gap-4">
        <button type="button" className={link} aria-expanded={open} onClick={() => setOpen(!open)}>
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </button>
        {post.mine ? (
          <>
            <button type="button" className={link} onClick={() => setEdit(post.body)}>
              Edit
            </button>
            <button type="button" className={link} onClick={() => run(deletePost(post.id))}>
              Delete
            </button>
          </>
        ) : (
          <button type="button" className={link} onClick={() => run(reportPost(post.id))}>
            Report
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-accent">
          {error}
        </p>
      )}
      {open && (
        <div className="mt-2 border-t border-neutral-200 pt-2">
          <ul>
            {comments.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 py-1.5 text-sm">
                <span>
                  <span className="block text-xs text-neutral-600">{shortAlias(c.public_alias)}</span>
                  {c.body}
                </span>
                {c.mine && (
                  <button type="button" className={link} onClick={() => run(deleteComment(c.id))}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-1 flex items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (comment.trim() && (await run(addComment(post.id, comment)))) setComment('');
            }}
          >
            <input aria-label="Add a comment" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} className={field} />
            <button type="submit" className={secondary}>
              Send
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

function Feed() {
  const posts = usePosts();
  const records = useCourseRecords();
  // Course Detail links here with ?course=<id>.
  const fromUrl = useSearchParams().get('course');
  const [tag, setTag] = useState<string | null>(fromUrl || null);
  const [q, setQ] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Tag choices: the demo catalog in mock mode; in real mode, the courses in your own history.
  const tagIds = [...new Set([...(IS_MOCK ? COURSES.map((c) => c.id) : records.map((r) => r.course_id)), ...(tag ? [tag] : [])])];
  const codes = useCourseCodes([...tagIds, ...posts.flatMap((p) => (p.course_id ? [p.course_id] : []))]);
  const label = (id: string | null) => (id === null ? 'General' : (codes[id] ?? id));
  const shown = filterPosts(posts, {courseId: tag, q});
  const chip = (id: string | null, text: string) => (
    <button
      key={id ?? 'all'}
      type="button"
      aria-pressed={tag === id}
      onClick={() => setTag(id)}
      className={`shrink-0 rounded-full px-3 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${tag === id ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}
    >
      {text}
    </button>
  );
  return (
    <>
      <input type="search" aria-label="Search posts" placeholder="Search posts" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {chip(null, 'All')}
        {tagIds.map((id) => chip(id, label(id)))}
      </div>
      <form
        className="mt-3 rounded-xl border border-neutral-200 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          const err = await addPost(tag, body);
          setError(err);
          if (!err) setBody('');
        }}
      >
        <textarea aria-label="New post" placeholder="Share a question or tip" value={body} onChange={(e) => setBody(e.target.value)} className={`${field} min-h-16`} />
        {error && (
          <p role="alert" className="mt-1 text-xs text-accent">
            {error}
          </p>
        )}
        <button type="submit" className={`${primary} mt-2 py-2.5`}>
          Post to {label(tag)}
        </button>
        <p className="mt-2 text-xs text-neutral-600">Posts show an anonymous name, never your account.</p>
      </form>
      {shown.length === 0 && <p className="py-8 text-center text-sm text-neutral-600">No posts here yet. Be the first to post.</p>}
      <ul className="mt-3 space-y-2">
        {shown.map((p) => (
          <PostCard key={p.id} post={p} tagLabel={label(p.course_id)} />
        ))}
      </ul>
    </>
  );
}

export default function CommunityPage() {
  return (
    <Screen title="Community">
      <Suspense>
        <Feed />
      </Suspense>
    </Screen>
  );
}
