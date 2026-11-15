'use client';

import {useParams, useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useState} from 'react';
import {PostLabels} from '@/components/post-labels';
import {EmptyState, Screen, field, primary, secondary} from '@/components/screen';
import {useCourseCodes} from '@/lib/data/catalog';
import {addComment, deleteComment, deletePost, postTitle, reportPost, setVote, updatePost, useComments, usePost, useVote, type Post, type Comment} from '@/lib/data/community';

const action = 'min-h-10 rounded-lg text-sm font-extrabold text-accent';

function Thread({post, back}: {post: Post; back: string}) {
  const router = useRouter();
  const comments = useComments(post.id);
  const vote = useVote(post.id);
  const codes = useCourseCodes(post.course_id ? [post.course_id] : []);
  const [reply, setReply] = useState<Comment | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = new Set(comments.map((comment) => comment.id));
  const branches = new Map<string | null, Comment[]>();
  for (const comment of comments) {
    const key = comment.parent_id && ids.has(comment.parent_id) ? comment.parent_id : null;
    branches.set(key, [...(branches.get(key) ?? []), comment]);
  }
  async function run(change: () => Promise<string | null>, success?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await change();
      if (failure) setError(failure);
      else success?.();
    } catch {
      setError('Couldn’t save your change. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function replies(parent: string | null, depth = 0) {
    const list = branches.get(parent);
    if (!list?.length) return null;
    return <ul className={depth > 0 && depth < 4 ? 'ml-2 border-l border-neutral-200 pl-2' : ''}>
      {list.map((comment) => (
        <li key={comment.id} className="my-2 rounded-2xl bg-neutral-50 px-3 pt-2">
          <p className="text-xs text-neutral-600">{comment.public_alias.slice(0, 14)}</p>
          <p className="my-1 text-sm wrap-anywhere whitespace-pre-wrap">{comment.body}</p>
          <div className="flex gap-4">
            <button className={action} onClick={() => {setReply(comment); document.getElementById('comment')?.focus();}}>Reply</button>
            {comment.mine && <button className={action} disabled={busy} onClick={() => void run(() => deleteComment(post.id, comment.id))}>Delete</button>}
          </div>
          {replies(comment.id, depth + 1)}
        </li>
      ))}
    </ul>;
  }
  return (
    <Screen title="Post" back={{href: back, label: 'Back to community'}}>
      <article className="surface space-y-3">
        <PostLabels post={post} courseCode={post.course_id ? codes[post.course_id] : undefined} feedHref={back} />
        {editing ? <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(() => updatePost(post, String(form.get('title')), String(form.get('body'))), () => setEditing(false));
        }}>
          <input name="title" aria-label="Edit title" defaultValue={postTitle(post)} maxLength={160} required className={field} />
          <textarea name="body" aria-label="Edit body" defaultValue={post.body} required className={field} />
          <button type="submit" className={secondary} disabled={busy}>Save changes</button>
        </form> : <>
          <h2 className="text-2xl font-black wrap-anywhere">{postTitle(post)}</h2>
          <p className="text-xs text-neutral-600">{post.public_alias.slice(0, 14)}</p>
          {(post.title || postTitle(post) !== post.body) && <p className="text-sm wrap-anywhere whitespace-pre-wrap">{post.body}</p>}
        </>}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3">
            <button aria-label="Upvote" aria-pressed={vote.my_vote === 1} className={action} disabled={busy}
              onClick={() => void run(() => setVote(post.id, vote.my_vote === 1 ? 0 : 1))}>↑</button>
            <span aria-label="Vote score" aria-live="polite">{vote.score}</span>
            <button aria-label="Downvote" aria-pressed={vote.my_vote === -1} className={action} disabled={busy}
              onClick={() => void run(() => setVote(post.id, vote.my_vote === -1 ? 0 : -1))}>↓</button>
          </div>
          {post.mine ? <>
            <button className={action} onClick={() => setEditing(!editing)}>{editing ? 'Cancel edit' : 'Edit'}</button>
            <button className={action} disabled={busy} onClick={() => {if (window.confirm('Delete this post?')) void run(() => deletePost(post), () => router.replace(back));}}>Delete</button>
          </> : <button className={action} disabled={busy} onClick={() => void run(() => reportPost(post.id), () => router.replace(back))}>Report</button>}
        </div>
      </article>
      <section className="surface mt-3">
        <h2 className="section-title">Comments</h2>
        {replies(null)}
        <form className="mt-3 space-y-2" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const body = String(new FormData(form).get('comment')).trim();
          if (body) void run(() => addComment(post.id, body, reply?.id ?? null), () => {form.reset(); setReply(null);});
        }}>
          {reply && <p className="text-xs">Replying to {reply.public_alias.slice(0, 14)} <button type="button" className={action} onClick={() => setReply(null)}>Cancel reply</button></p>}
          <textarea id="comment" name="comment" aria-label={reply ? 'Reply' : 'Add a comment'} placeholder={reply ? 'Write a reply' : 'Add a comment'} className={field} required />
          <button type="submit" className={primary} disabled={busy}>{reply ? 'Post reply' : 'Post comment'}</button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-accent">{error}</p>}
      </section>
    </Screen>
  );
}

function PostDetail() {
  const {postId} = useParams<{postId: string}>();
  const params = useSearchParams();
  const from = params.get('from') ?? '';
  const back = from.startsWith('/community?') ? from : '/community';
  const post = usePost(postId);
  if (post) return <Thread post={post} back={back} />;
  return <Screen title="Post" back={{href: back, label: 'Back to community'}}>{post === undefined ? <p role="status">Loading post…</p> : <EmptyState title="Post unavailable" body="This post may have been removed." />}</Screen>;
}

export default function PostDetailPage() {
  return <Suspense fallback={<Screen title="Post"><p role="status">Loading post…</p></Screen>}><PostDetail /></Suspense>;
}
