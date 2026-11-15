import {useEffect, useState} from 'react';
import {IS_MOCK, supabase} from '../supabase';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

// Community data. Real mode reads and writes the community_posts / community_comments views,
// which carry a generated public_alias and never an account id.
export const FLAIRS = {
  question: 'Question',
  recommendation: 'Recommendation',
  tip: 'Tip',
  review: 'Review',
} as const;
export type Flair = keyof typeof FLAIRS;
/** The three kinds a new post can be, in the order the composer and the feed filters show them. */
export const POST_TYPES: Flair[] = ['question', 'review', 'tip'];
export type Post = {id: string; course_id: string | null; category: string; title?: string | null; body: string; public_alias: string; created_at: string; mine: boolean; reported: boolean};
export type Comment = {id: string; post_id: string; parent_id?: string | null; body: string; public_alias: string; created_at: string; mine: boolean};
export const postTitle = (post: Post) => post.title ?? post.body.trim().split('\n', 1)[0].slice(0, 100);
export const isFlair = (value: string): value is Flair => Object.hasOwn(FLAIRS, value);

const ADJ = ['Maple', 'Quiet', 'Calm', 'Red', 'Bright', 'Swift', 'Amber', 'Misty'];
const ANIMAL = ['Fox', 'Owl', 'Otter', 'Heron', 'Lynx', 'Wren', 'Badger', 'Finch'];

/** Anonymous display name. With a seed it is stable (chat rooms); without one it is random (one per post). */
export function makeAlias(seed?: string): string {
  let n = Math.floor(Math.random() * 64);
  if (seed !== undefined) n = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `${ADJ[n % ADJ.length]} ${ANIMAL[Math.floor(n / ADJ.length) % ANIMAL.length]}`;
}

const POSTS_KEY = 'digree.posts';
const COMMENTS_KEY = 'digree.comments';
const SEED_POSTS: Post[] = [
  {id: 'p2', course_id: 'math234', category: 'question', title: 'First midterm prep', body: 'Anyone have tips for the first midterm?', public_alias: 'Quiet Owl', created_at: '2026-11-14T15:00:00Z', mine: false, reported: false},
  {id: 'p1', course_id: 'cs400', category: 'tip', title: 'Project 2 study group', body: 'Study group for project 2, Thursday evening.', public_alias: 'Red Heron', created_at: '2026-11-13T18:30:00Z', mine: false, reported: false},
];
const SEED_COMMENTS: Comment[] = [{id: 'c1', post_id: 'p2', body: 'Practice the old problem sets.', public_alias: 'Calm Otter', created_at: '2026-11-14T16:10:00Z', mine: false}];
const NO_POSTS: Post[] = [];
const NO_COMMENTS: Comment[] = [];

// ponytail: the views hide author ids, so "is this mine?" and "did I report this?" are remembered on this
// device only. A post written elsewhere shows no Edit/Delete here. Ask Back for an is_mine column to fix it.
const MINE_KEY = 'digree.my_content';
const REPORTED_KEY = 'digree.reported';
const NO_IDS: string[] = [];
const remember = (key: string, id: string) => writeStore(key, [...readStore(key, NO_IDS), id]);

const POST_COLUMNS = 'id, public_alias, course_id, category, title, body, created_at';
const COMMENT_COLUMNS = 'id, post_id, parent_id, public_alias, body, created_at';
type PostRow = Omit<Post, 'mine' | 'reported'>;
type CommentRow = Omit<Comment, 'mine'>;
const toPost = (r: PostRow): Post => ({...r, mine: readStore(MINE_KEY, NO_IDS).includes(r.id), reported: readStore(REPORTED_KEY, NO_IDS).includes(r.id)});
const toComment = (r: CommentRow): Comment => ({...r, mine: readStore(MINE_KEY, NO_IDS).includes(r.id)});

async function fetchPosts(): Promise<Post[]> {
  const {data, error} = await supabase().from('community_posts').select(POST_COLUMNS).order('created_at', {ascending: false}).limit(100);
  if (error) throw error;
  return (data as PostRow[]).map(toPost);
}
async function fetchComments(postId: string): Promise<Comment[]> {
  const {data, error} = await supabase().from('community_comments').select(COMMENT_COLUMNS).eq('post_id', postId).order('created_at').limit(500);
  if (error) throw error;
  return (data as CommentRow[]).map(toComment);
}

export const usePosts: () => Post[] = IS_MOCK ? () => useStore(POSTS_KEY, SEED_POSTS) : () => useRemote(POSTS_KEY, NO_POSTS, fetchPosts);
export const usePost: (id: string) => Post | null | undefined = IS_MOCK
  ? (id) => usePosts().find((post) => post.id === id && !post.reported) ?? null
  : (id) => useRemote<Post | null | undefined>(`post:${id}`, undefined, async () => {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return null;
    const {data, error} = await supabase().from('community_posts').select(POST_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    const post = data && toPost(data as PostRow);
    return post?.reported ? null : post;
  });
export const useComments: (postId: string) => Comment[] = IS_MOCK
  ? (postId) => useStore(COMMENTS_KEY, SEED_COMMENTS).filter((comment) => comment.post_id === postId)
  : (postId) => useRemote(`${COMMENTS_KEY}:${postId}`, NO_COMMENTS, () => fetchComments(postId));
const comments = (postId: string) => (IS_MOCK ? readStore(COMMENTS_KEY, SEED_COMMENTS) : getRemote(`${COMMENTS_KEY}:${postId}`, NO_COMMENTS));
function updateFeed(update: (posts: Post[]) => Post[]) {
  if (IS_MOCK) return writeStore(POSTS_KEY, update(readStore(POSTS_KEY, SEED_POSTS)));
  const existing = getRemote<Post[] | undefined>(POSTS_KEY, undefined);
  if (existing) setRemote(POSTS_KEY, update(existing));
}
const putComments = (postId: string, next: Comment[]) => (IS_MOCK ? writeStore(COMMENTS_KEY, next) : setRemote(`${COMMENTS_KEY}:${postId}`, next));

/** Feed query: hides reported posts, filters by course tag and search text, newest first. */
export function filterPosts(all: Post[], {courseId, q, flair, courseCodes = {}}: {courseId: string | null; q: string; flair?: Flair | null; courseCodes?: Record<string, string>}): Post[] {
  const needle = q.trim().toLowerCase();
  return all
    .filter((p) => !p.reported && (courseId === null || p.course_id === courseId) && (!flair || p.category === flair) &&
      [p.title, p.body, p.course_id && courseCodes[p.course_id]].some((text) => text?.toLowerCase().includes(needle)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Every mutation returns a user-facing error, or null on success.
// The database assigns the author and alias, and only lets authors edit or delete their own rows.
type PostDraft = {course_id: string | null; category: Flair; title: string; body: string};
export async function addPost(draft: PostDraft): Promise<{id: string} | {error: string}> {
  const values = {...draft, title: draft.title.trim(), body: draft.body.trim()};
  if (!values.title || !values.body || !isFlair(values.category)) return {error: 'Enter a title and body and choose a flair.'};
  if (IS_MOCK) {
    const id = crypto.randomUUID();
    updateFeed((posts) => [...posts, {...values, id, public_alias: makeAlias(), created_at: new Date().toISOString(), mine: true, reported: false}]);
    return {id};
  }
  const {data, error} = await supabase().from('community_posts').insert(values).select(POST_COLUMNS).single();
  if (error) return {error: error.message};
  remember(MINE_KEY, (data as PostRow).id);
  const post = toPost(data as PostRow);
  setRemote(`post:${post.id}`, post);
  updateFeed((posts) => [post, ...posts]);
  return {id: post.id};
}

export async function updatePost(post: Post, title: string, body: string): Promise<string | null> {
  const changes = {title: title.trim(), body: body.trim()};
  if (!changes.title || !changes.body) return 'Enter a title and body.';
  if (!IS_MOCK) {
    const {error} = await supabase().from('community_posts').update(changes).eq('id', post.id);
    if (error) return error.message;
    setRemote(`post:${post.id}`, {...post, ...changes});
  }
  updateFeed((posts) => posts.map((p) => (p.id === post.id && p.mine ? {...p, ...changes} : p)));
  return null;
}

export async function deletePost({id, mine}: Post): Promise<string | null> {
  if (!mine) return 'You can only delete your own posts.';
  if (!IS_MOCK) {
    const {error} = await supabase().from('community_posts').delete().eq('id', id);
    if (error) return error.message;
    setRemote(`post:${id}`, null);
  }
  updateFeed((posts) => posts.filter((p) => p.id !== id));
  putComments(id, comments(id).filter((c) => c.post_id !== id));
  return null;
}

export async function reportPost(id: string, reason = 'Reported from the app'): Promise<string | null> {
  if (!IS_MOCK) {
    // Reports are insert-only for clients: no returning selection.
    const {error} = await supabase().from('post_reports').insert({post_id: id, reason});
    if (error) return error.message;
    remember(REPORTED_KEY, id);
    setRemote(`post:${id}`, null);
  }
  updateFeed((posts) => posts.map((p) => (p.id === id && !p.mine ? {...p, reported: true} : p)));
  return null;
}

export async function addComment(postId: string, body: string, parentId: string | null): Promise<string | null> {
  if (IS_MOCK) {
    putComments(postId, [...comments(postId), {id: crypto.randomUUID(), post_id: postId, parent_id: parentId, body: body.trim(), public_alias: makeAlias(), created_at: new Date().toISOString(), mine: true}]);
    return null;
  }
  const {data, error} = await supabase().from('community_comments').insert({post_id: postId, body: body.trim(), parent_id: parentId}).select(COMMENT_COLUMNS).single();
  if (error) return error.message;
  remember(MINE_KEY, (data as CommentRow).id);
  putComments(postId, [...comments(postId), toComment(data as CommentRow)]);
  return null;
}

export async function deleteComment(postId: string, id: string): Promise<string | null> {
  if (!IS_MOCK) {
    const {error} = await supabase().from('community_comments').delete().eq('id', id);
    if (error) return error.message;
  }
  putComments(postId, comments(postId).filter((c) => !(c.id === id && c.mine)).map((c) => c.parent_id === id ? {...c, parent_id: null} : c));
  return null;
}

type Vote = {score: number; my_vote: number};
const NO_VOTE: Vote = {score: 0, my_vote: 0};
export const useVote: (id: string) => Vote = IS_MOCK
  ? (id) => useStore(`vote:${id}`, NO_VOTE)
  : (id) => useRemote(`vote:${id}`, NO_VOTE, async () => {
    const {data, error} = await supabase().rpc('community_vote_totals', {p_ids: [id]}).maybeSingle();
    if (error) throw error;
    return data as Vote | null ?? NO_VOTE;
  });
export async function setVote(id: string, value: -1 | 0 | 1): Promise<string | null> {
  if (IS_MOCK) {
    writeStore(`vote:${id}`, {score: value, my_vote: value});
  } else {
    const {data, error} = await supabase().rpc('set_community_vote', {p_post: id, p_value: value}).single();
    if (error) return error.message;
    setRemote(`vote:${id}`, data as Vote);
  }
  return null;
}

/** Vote score, my own vote and comment count for the posts on screen. */
export type PostStats = Record<string, {score: number; my_vote: number; comments: number}>;
const NO_STATS: PostStats = {};

async function loadPostStats(ids: string[]): Promise<PostStats> {
  if (!ids.length) return NO_STATS;
  if (IS_MOCK) {
    const all = readStore(COMMENTS_KEY, SEED_COMMENTS);
    return Object.fromEntries(ids.map((id) => [id, {...readStore(`vote:${id}`, NO_VOTE), comments: all.filter((comment) => comment.post_id === id).length}]));
  }
  const db = supabase();
  const [votes, replies] = await Promise.all([
    db.rpc('community_vote_totals', {p_ids: ids}),
    db.from('community_comments').select('post_id').in('post_id', ids).limit(2000),
  ]);
  if (votes.error) throw votes.error;
  if (replies.error) throw replies.error;
  const stats: PostStats = Object.fromEntries(ids.map((id) => [id, {score: 0, my_vote: 0, comments: 0}]));
  for (const vote of votes.data as (Vote & {post_id: string})[]) if (stats[vote.post_id]) Object.assign(stats[vote.post_id], {score: vote.score, my_vote: vote.my_vote});
  for (const reply of replies.data as {post_id: string}[]) if (stats[reply.post_id]) stats[reply.post_id].comments++;
  return stats;
}

/** Loaded each time a screen opens, so a vote or comment made on the post screen shows up in the feed. */
export function usePostStats(ids: string[]): PostStats {
  const key = [...new Set(ids)].sort().join(',');
  const [loaded, setLoaded] = useState<{key: string; stats: PostStats}>({key: '', stats: NO_STATS});
  useEffect(() => {
    let active = true;
    loadPostStats(key ? key.split(',') : [])
      .then((stats) => {
        if (active) setLoaded({key, stats});
      })
      .catch((error) => console.error('Loading post votes failed', error));
    return () => {
      active = false;
    };
  }, [key]);
  return loaded.stats;
}
