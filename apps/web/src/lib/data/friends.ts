import expected from '../../mocks/expected.json';
import {IS_MOCK, supabase} from '../supabase';
import {getBundles, type Meeting} from './catalog';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

// Friends and schedule sharing. Real mode uses friendships, schedule_permissions and the
// schedule_visibility / schedule_free_busy RPCs from the DB handoff.
export type Visibility = 'private' | 'free_busy' | 'full';
export const VISIBILITY_LABEL: Record<Visibility, string> = {private: 'Private', free_busy: 'Free/busy only', full: 'Full schedule'};

export type Friend = {
  /** Mock: a local id. Real: the other account's id, which doubles as their friend code. */
  id: string;
  name: string;
  status: 'incoming' | 'outgoing' | 'accepted';
  /** What I let this person see. Private until I change it. */
  myVisibility: Visibility;
  /** Mock only: what this sample person shares with me, and which fixture schedule they have. */
  theirVisibility?: Visibility;
  schedule?: number | null;
};

type Slot = Pick<Meeting, 'day' | 'start_min' | 'end_min'>;
export type FriendScheduleView = {access: 'none'} | {access: 'free_busy'; blocks: Slot[]} | {access: 'full'; items: {label: string; meetings: Slot[]}[]};

const SEED: Friend[] = [
  {id: 'f1', name: 'Jordan', status: 'accepted', theirVisibility: 'full', myVisibility: 'private', schedule: 1},
  {id: 'f2', name: 'Sam', status: 'accepted', theirVisibility: 'free_busy', myVisibility: 'private', schedule: 2},
  {id: 'f3', name: 'Riley', status: 'accepted', theirVisibility: 'private', myVisibility: 'private', schedule: 0},
  {id: 'f4', name: 'Alex', status: 'incoming', theirVisibility: 'full', myVisibility: 'private', schedule: 0},
];
const NONE: Friend[] = [];
const KEY = 'digree.friends';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function myId(): Promise<string | null> {
  return (await supabase().auth.getUser()).data.user?.id ?? null;
}
/** The code a friend types to send me a request. Null in mock mode. */
export const myFriendCode = (): Promise<string | null> => (IS_MOCK ? Promise.resolve(null) : myId());

// RLS returns only friendships I am part of, and only my own permission rows.
async function fetchFriends(): Promise<Friend[]> {
  const db = supabase();
  const me = await myId();
  const [links, perms] = await Promise.all([db.from('friendships').select('requester_id, receiver_id, status'), db.from('schedule_permissions').select('viewer_id, visibility')]);
  if (links.error) throw links.error;
  if (perms.error) throw perms.error;
  const mine = new Map((perms.data as {viewer_id: string; visibility: Visibility}[]).map((p) => [p.viewer_id, p.visibility]));
  return (links.data as {requester_id: string; receiver_id: string; status: string}[])
    .filter((l) => l.status !== 'blocked')
    .map((l) => {
      const other = l.requester_id === me ? l.receiver_id : l.requester_id;
      // No display names exist in the database yet, so a friend is shown by a short form of their code.
      return {id: other, name: `Friend ${other.slice(0, 8)}`, status: l.status === 'accepted' ? 'accepted' : l.requester_id === me ? 'outgoing' : 'incoming', myVisibility: mine.get(other) ?? 'private'};
    });
}

export const useFriends: () => Friend[] = IS_MOCK ? () => useStore(KEY, SEED) : () => useRemote(KEY, NONE, fetchFriends);
const all = () => (IS_MOCK ? readStore(KEY, SEED) : getRemote(KEY, NONE));
const put = (next: Friend[]) => (IS_MOCK ? writeStore(KEY, next) : setRemote(KEY, next));
/** Filter matching the friendship row between me and one other account, whichever of us sent it. */
const pair = (me: string, other: string) => `and(requester_id.eq.${me},receiver_id.eq.${other}),and(requester_id.eq.${other},receiver_id.eq.${me})`;

/**
 * Mock rule for reading a friend's schedule, mirroring can_view_schedule / schedule_free_busy:
 * nothing unless the friendship is accepted AND they shared; free/busy carries times only, no course names.
 */
export function viewFriendSchedule(friend: Friend | undefined): FriendScheduleView {
  if (!friend || friend.status !== 'accepted' || !friend.theirVisibility || friend.theirVisibility === 'private' || friend.schedule == null) return {access: 'none'};
  const selected = expected.results[friend.schedule]?.selected ?? [];
  if (friend.theirVisibility === 'full') return {access: 'full', items: selected.map((s) => ({label: s.course_code, meetings: s.meetings as Meeting[]}))};
  return {access: 'free_busy', blocks: selected.flatMap((s) => s.meetings.map((m) => ({day: m.day as Meeting['day'], start_min: m.start_min, end_min: m.end_min})))};
}

/** What a friend lets me see for one term. In real mode the database decides; this only asks. */
export async function loadFriendSchedule(friend: Friend, term: string | null): Promise<FriendScheduleView> {
  if (IS_MOCK) return viewFriendSchedule(friend);
  if (friend.status !== 'accepted' || !term) return {access: 'none'};
  const db = supabase();
  const me = await myId();
  const {data: visibility, error} = await db.rpc('schedule_visibility', {owner: friend.id, viewer: me});
  if (error || visibility === 'private' || !visibility) return {access: 'none'};
  if (visibility === 'free_busy') {
    const {data, error: e} = await db.rpc('schedule_free_busy', {schedule_owner: friend.id, schedule_term: term, requested_mode: 'planned'});
    return e ? {access: 'none'} : {access: 'free_busy', blocks: data as Slot[]};
  }
  // full: RLS lets an accepted friend with "full" permission read the owner's saved schedules and items.
  const {data: schedules} = await db.from('saved_schedules').select('id').eq('user_id', friend.id).eq('term', term).eq('mode', 'planned').limit(1);
  const id = (schedules as {id: string}[] | null)?.[0]?.id;
  if (!id) return {access: 'full', items: []};
  const {data: items} = await db.from('saved_schedule_items').select('course_id, bundle_id, courses(code)').eq('schedule_id', id);
  const rows = (items ?? []) as unknown as {course_id: string; bundle_id: string; courses: {code: string} | null}[];
  return {
    access: 'full',
    items: await Promise.all(rows.map(async (r) => ({label: r.courses?.code ?? r.course_id, meetings: (await getBundles(r.course_id, term)).find((b) => b.bundle_id === r.bundle_id)?.meetings ?? []}))),
  };
}

// Mutations return a user-facing error, or null on success.
export async function sendFriendRequest(input: string): Promise<string | null> {
  const clean = input.trim();
  if (IS_MOCK) {
    if (!clean) return 'Enter a name.';
    if (all().some((f) => f.name.toLowerCase() === clean.toLowerCase())) return 'Already in your list.';
    put([...all(), {id: crypto.randomUUID(), name: clean, status: 'outgoing', theirVisibility: 'private', myVisibility: 'private', schedule: null}]);
    return null;
  }
  const me = await myId();
  if (!me) return 'Sign in first.';
  if (!UUID.test(clean)) return "That doesn't look like a friend code.";
  if (clean.toLowerCase() === me) return "That's your own code.";
  if (all().some((f) => f.id === clean.toLowerCase())) return 'Already in your list.';
  const {error} = await supabase().from('friendships').insert({requester_id: me, receiver_id: clean.toLowerCase(), status: 'pending'});
  if (error) return error.code === '23503' ? 'No account has that friend code.' : error.message;
  put([...all(), {id: clean.toLowerCase(), name: `Friend ${clean.slice(0, 8).toLowerCase()}`, status: 'outgoing', myVisibility: 'private'}]);
  return null;
}

export async function acceptFriend(id: string): Promise<string | null> {
  if (!IS_MOCK) {
    const me = await myId();
    const {error} = await supabase().from('friendships').update({status: 'accepted'}).eq('requester_id', id).eq('receiver_id', me);
    if (error) return error.message;
  }
  put(all().map((f) => (f.id === id && f.status === 'incoming' ? {...f, status: 'accepted'} : f)));
  return null;
}

/** Declines, cancels or unfriends. Access ends with the row. */
export async function removeFriend(id: string): Promise<string | null> {
  if (!IS_MOCK) {
    const me = await myId();
    if (!me) return 'Sign in first.';
    const {error} = await supabase().from('friendships').delete().or(pair(me, id));
    if (error) return error.message;
  }
  put(all().filter((f) => f.id !== id));
  return null;
}

export async function setMyVisibility(id: string, myVisibility: Visibility): Promise<string | null> {
  if (!IS_MOCK) {
    const me = await myId();
    const {error} = await supabase().from('schedule_permissions').upsert({owner_id: me, viewer_id: id, visibility: myVisibility});
    if (error) return error.message;
  }
  put(all().map((f) => (f.id === id ? {...f, myVisibility} : f)));
  return null;
}
