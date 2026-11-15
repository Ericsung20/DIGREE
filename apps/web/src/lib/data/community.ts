import {IS_MOCK, supabase} from '../supabase';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

// Community data. Real mode reads and writes the community_posts / community_comments views,
// which carry a generated public_alias and never an account id.
export type Post = {id: string; course_id: string | null; category: string; body: string; public_alias: string; created_at: string; mine: boolean; reported: boolean};
export type Comment = {id: string; post_id: string; body: string; public_alias: string; created_at: string; mine: boolean};

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
  {id: 'p2', course_id: 'math234', category: 'general', body: 'Anyone have tips for the first midterm?', public_alias: 'Quiet Owl', created_at: '2026-11-14T15:00:00Z', mine: false, reported: false},
  {id: 'p1', course_id: 'cs400', category: 'general', body: 'Study group for project 2, Thursday evening.', public_alias: 'Red Heron', created_at: '2026-11-13T18:30:00Z', mine: false, reported: false},
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

const POST_COLUMNS = 'id, public_alias, course_id, category, body, created_at';
const COMMENT_COLUMNS = 'id, post_id, public_alias, body, created_at';
type PostRow = Omit<Post, 'mine' | 'reported'>;
type CommentRow = Omit<Comment, 'mine'>;
const toPost = (r: PostRow): Post => ({...r, mine: readStore(MINE_KEY, NO_IDS).includes(r.id), reported: readStore(REPORTED_KEY, NO_IDS).includes(r.id)});
const toComment = (r: CommentRow): Comment => ({...r, mine: readStore(MINE_KEY, NO_IDS).includes(r.id)});

async function fetchPosts(): Promise<Post[]> {
  const {data, error} = await supabase().from('community_posts').select(POST_COLUMNS).order('created_at', {ascending: false}).limit(100);
  if (error) throw error;
  return (data as PostRow[]).map(toPost);
}
async function fetchComments(): Promise<Comment[]> {
  const {data, error} = await supabase().from('community_comments').select(COMMENT_COLUMNS).order('created_at').limit(500);
  if (error) throw error;
  return (data as CommentRow[]).map(toComment);
}

export const usePosts: () => Post[] = IS_MOCK ? () => useStore(POSTS_KEY, SEED_POSTS) : () => useRemote(POSTS_KEY, NO_POSTS, fetchPosts);
export const useComments: () => Comment[] = IS_MOCK ? () => useStore(COMMENTS_KEY, SEED_COMMENTS) : () => useRemote(COMMENTS_KEY, NO_COMMENTS, fetchComments);
const posts = () => (IS_MOCK ? readStore(POSTS_KEY, SEED_POSTS) : getRemote(POSTS_KEY, NO_POSTS));
const comments = () => (IS_MOCK ? readStore(COMMENTS_KEY, SEED_COMMENTS) : getRemote(COMMENTS_KEY, NO_COMMENTS));
const putPosts = (next: Post[]) => (IS_MOCK ? writeStore(POSTS_KEY, next) : setRemote(POSTS_KEY, next));
const putComments = (next: Comment[]) => (IS_MOCK ? writeStore(COMMENTS_KEY, next) : setRemote(COMMENTS_KEY, next));

/** Feed query: hides reported posts, filters by course tag and search text, newest first. */
export function filterPosts(all: Post[], {courseId, q}: {courseId: string | null; q: string}): Post[] {
  const needle = q.trim().toLowerCase();
  return all
    .filter((p) => !p.reported && (courseId === null || p.course_id === courseId) && p.body.toLowerCase().includes(needle))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Every mutation returns a user-facing error, or null on success.
// The database assigns the author and alias, and only lets authors edit or delete their own rows.
export async function addPost(courseId: string | null, body: string): Promise<string | null> {
  if (IS_MOCK) {
    putPosts([...posts(), {id: crypto.randomUUID(), course_id: courseId, category: 'general', body: body.trim(), public_alias: makeAlias(), created_at: new Date().toISOString(), mine: true, reported: false}]);
    return null;
  }
  const {data, error} = await supabase().from('community_posts').insert({course_id: courseId, category: 'general', body: body.trim()}).select(POST_COLUMNS).single();
  if (error) return error.message;
  remember(MINE_KEY, (data as PostRow).id);
  putPosts([toPost(data as PostRow), ...posts()]);
  return null;
}

export async function updatePost(id: string, body: string): Promise<string | null> {
  if (!IS_MOCK) {
    const {error} = await supabase().from('community_posts').update({body: body.trim()}).eq('id', id);
    if (error) return error.message;
  }
  putPosts(posts().map((p) => (p.id === id && p.mine ? {...p, body: body.trim()} : p)));
  return null;
}

export async function deletePost(id: string): Promise<string | null> {
  if (!posts().some((p) => p.id === id && p.mine)) return 'You can only delete your own posts.';
  if (!IS_MOCK) {
    const {error} = await supabase().from('community_posts').delete().eq('id', id);
    if (error) return error.message;
  }
  putPosts(posts().filter((p) => p.id !== id));
  putComments(comments().filter((c) => c.post_id !== id));
  return null;
}

export async function reportPost(id: string): Promise<string | null> {
  if (!IS_MOCK) {
    // Reports are insert-only for clients: no returning selection.
    const {error} = await supabase().from('post_reports').insert({post_id: id, reason: 'Reported from the app'});
    if (error) return error.message;
    remember(REPORTED_KEY, id);
  }
  putPosts(posts().map((p) => (p.id === id && !p.mine ? {...p, reported: true} : p)));
  return null;
}

export async function addComment(postId: string, body: string): Promise<string | null> {
  if (IS_MOCK) {
    putComments([...comments(), {id: crypto.randomUUID(), post_id: postId, body: body.trim(), public_alias: makeAlias(), created_at: new Date().toISOString(), mine: true}]);
    return null;
  }
  const {data, error} = await supabase().from('community_comments').insert({post_id: postId, body: body.trim()}).select(COMMENT_COLUMNS).single();
  if (error) return error.message;
  remember(MINE_KEY, (data as CommentRow).id);
  putComments([...comments(), toComment(data as CommentRow)]);
  return null;
}

export async function deleteComment(id: string): Promise<string | null> {
  if (!IS_MOCK) {
    const {error} = await supabase().from('community_comments').delete().eq('id', id);
    if (error) return error.message;
  }
  putComments(comments().filter((c) => !(c.id === id && c.mine)));
  return null;
}
