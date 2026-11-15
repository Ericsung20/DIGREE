import expected from '../../mocks/expected.json';
import {useEffect} from 'react';
import {IS_MOCK, supabase} from '../supabase';
import type {Meeting} from './catalog';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';
import {readScheduleItems, SAVED_ITEMS} from './saved-schedules';

// A pending request grants no schedule access. The database checks sharing permissions after acceptance.

export type Friend = {
  /** Mock: a local NetID. Real: the other account's UUID. */
  id: string;
  name: string;
  status: 'incoming' | 'outgoing' | 'accepted';
  /** Mock only: which fixture schedule this person has. */
  schedule?: number | null;
};

type Slot = Pick<Meeting, 'day' | 'start_min' | 'end_min'>;
export type FriendScheduleView = {access: 'none'} | {access: 'full'; items: {label: string; meetings: Slot[]}[]};

const SEED: Friend[] = [
  {id: 'f1', name: 'Jordan', status: 'accepted', schedule: 1},
  {id: 'f2', name: 'Sam', status: 'accepted', schedule: 2},
  {id: 'f3', name: 'Riley', status: 'accepted', schedule: 0},
  {id: 'f4', name: 'Alex', status: 'incoming', schedule: 0},
];
const NONE: Friend[] = [];
const KEY = 'digree.friends';
const NETID = /^[a-z][a-z0-9._-]{1,31}$/;
export type FriendSearchResult = {id: string; netid: string};
const MOCK_ACCOUNTS: FriendSearchResult[] = [
  ...SEED.map(({id, name}) => ({id, netid: name.toLowerCase()})),
  {id: 'netid:casey', netid: 'casey'},
];

/** Exact NetID lookup. Searching never creates a request. */
export async function findFriendByNetId(input: string): Promise<{match: FriendSearchResult | null; error: string | null}> {
  const netid = input.trim().toLowerCase();
  if (!NETID.test(netid)) return {match: null, error: 'Enter a valid UW NetID.'};
  if (IS_MOCK) return {match: MOCK_ACCOUNTS.find((account) => account.netid === netid) ?? null, error: null};
  const {data, error} = await supabase().rpc('find_friend_by_netid', {p_netid: netid});
  if (error?.code === 'PGRST202') return {match: null, error: 'Friend search is temporarily unavailable. Try again later.'};
  if (error) return {match: null, error: error.message};
  const row = (data as FriendSearchResult[] | null)?.[0];
  return {match: row ?? null, error: null};
}

async function myId(): Promise<string | null> {
  return (await supabase().auth.getUser()).data.user?.id ?? null;
}
// RLS returns only friendships I am part of. The label RPC reveals their NetIDs.
async function fetchFriends(): Promise<Friend[]> {
  const db = supabase();
  const me = await myId();
  const [links, labels] = await Promise.all([db.from('friendships').select('requester_id, receiver_id, status'), db.rpc('friend_netids')]);
  if (links.error) throw links.error;
  if (labels.error) throw labels.error;
  const names = new Map((labels.data as {id: string; netid: string}[]).map((row) => [row.id, row.netid]));
  return (links.data as {requester_id: string; receiver_id: string; status: string}[])
    .filter((l) => l.status !== 'blocked')
    .map((l) => {
      const other = l.requester_id === me ? l.receiver_id : l.requester_id;
      return {id: other, name: names.get(other) ?? `Friend ${other.slice(0, 8)}`, status: l.status === 'accepted' ? 'accepted' : l.requester_id === me ? 'outgoing' : 'incoming'};
    });
}

function useLiveFriends(): Friend[] {
  const friends = useRemote(KEY, NONE, fetchFriends);
  useEffect(() => {
    const refresh = () => { void fetchFriends().then((next) => setRemote(KEY, next)).catch((error) => console.error('Refreshing friends failed', error)); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return friends;
}
export const useFriends: () => Friend[] = IS_MOCK ? () => useStore(KEY, SEED) : useLiveFriends;
const all = () => (IS_MOCK ? readStore(KEY, SEED) : getRemote(KEY, NONE));
const put = (next: Friend[]) => (IS_MOCK ? writeStore(KEY, next) : setRemote(KEY, next));
/** Filter matching the friendship row between me and one other account, whichever of us sent it. */
const pair = (me: string, other: string) => `and(requester_id.eq.${me},receiver_id.eq.${other}),and(requester_id.eq.${other},receiver_id.eq.${me})`;

/**
 * Mock rule for reading a friend's schedule: acceptance is required.
 */
export function viewFriendSchedule(friend: Friend | undefined): FriendScheduleView {
  if (!friend || friend.status !== 'accepted' || friend.schedule == null) return {access: 'none'};
  const selected = expected.results[friend.schedule]?.selected ?? [];
  return {access: 'full', items: selected.map((s) => ({label: s.course_code, meetings: s.meetings as Meeting[]}))};
}

/** What a friend lets me see for one term. In real mode the database decides; this only asks. */
export async function loadFriendSchedule(friend: Friend, term: string | null): Promise<FriendScheduleView> {
  if (IS_MOCK) return viewFriendSchedule(friend);
  if (friend.status !== 'accepted' || !term) return {access: 'none'};
  const db = supabase();
  const me = await myId();
  const {data: visibility, error} = await db.rpc('schedule_visibility', {owner: friend.id, viewer: me});
  if (error || visibility !== 'full') return {access: 'none'};
  const {data: enrolled, error: enrolledError} = await db.rpc('friend_enrolled_schedule', {p_owner: friend.id, p_term: term});
  if (enrolledError) return {access: 'none'};
  if (enrolled?.length) return {access: 'full', items: (enrolled as {course_code: string; meetings: Slot[]}[]).map((row) => ({label: row.course_code, meetings: row.meetings}))};
  // RLS enforces the owner's full sharing permission on saved schedules and items.
  const {data: schedule, error: scheduleError} = await db.from('saved_schedules')
    .select(`saved_schedule_items!inner(${SAVED_ITEMS})`).eq('user_id', friend.id).eq('term', term).eq('mode', 'planned')
    .order('name', {ascending: false}).order('id').limit(1).maybeSingle();
  if (scheduleError) return {access: 'none'};
  const rows = readScheduleItems(schedule?.saved_schedule_items ?? []);
  return {access: 'full', items: rows.map((r) => ({label: r.course_code, meetings: r.meetings}))};
}

// Mutations return a user-facing error, or null on success.
export async function sendFriendRequest(input: string): Promise<string | null> {
  const clean = input.trim().toLowerCase();
  if (!NETID.test(clean)) return 'Enter a valid UW NetID.';
  if (IS_MOCK) {
    if (!MOCK_ACCOUNTS.some((account) => account.netid === clean)) return 'No account has that NetID.';
    if (all().some((f) => f.name.toLowerCase() === clean)) return 'Already in your list.';
    put([...all(), {id: `netid:${clean}`, name: clean, status: 'outgoing', schedule: null}]);
    return null;
  }
  const {data, error} = await supabase().rpc('send_friend_request', {p_netid: clean});
  if (error?.code === 'PGRST202') return 'Friend requests are temporarily unavailable. Try again later.';
  if (error) return error.message;
  put([...all(), {id: data as string, name: clean, status: 'outgoing'}]);
  return null;
}

export async function acceptFriend(id: string): Promise<string | null> {
  if (!IS_MOCK) {
    const me = await myId();
    const {data, error} = await supabase().from('friendships').update({status: 'accepted'}).eq('requester_id', id).eq('receiver_id', me).eq('status', 'pending').select('receiver_id').maybeSingle();
    if (error) return error.message;
    if (!data) return 'This request is no longer pending.';
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
