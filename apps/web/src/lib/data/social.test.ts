import {expect, test, vi} from 'vitest';
import {isRoomMember, myChatRooms} from './chat';
import {filterPosts, makeAlias, setVote, type Post} from './community';
import type {CourseRecord} from './course-records';
import {acceptFriend, sendFriendRequest, viewFriendSchedule, type Friend} from './friends';

const friend = (over: Partial<Friend>): Friend => ({id: 'x', name: 'X', status: 'accepted', schedule: 1, ...over});
const record = (course_id: string, over: Partial<CourseRecord> = {}): CourseRecord => ({id: course_id, term: '2027SP', course_id, credits: 3, status: 'enrolled_self_reported', bundle_id: null, counts_toward_major: false, source: 'manual', ...over});

test('friend schedule: no access until the request is accepted', () => {
  expect(viewFriendSchedule(undefined)).toEqual({access: 'none'}); // not a friend at all
  expect(viewFriendSchedule(friend({status: 'incoming'}))).toEqual({access: 'none'});
  expect(viewFriendSchedule(friend({status: 'outgoing'}))).toEqual({access: 'none'});
  expect(viewFriendSchedule(friend({schedule: null}))).toEqual({access: 'none'});
});

test('friend schedule: accepted friends see course codes without private grades', () => {
  const full = viewFriendSchedule(friend({}));
  expect(full.access === 'full' && full.items.map((i) => i.label)).toEqual(['COMP SCI 400', 'MATH 234', 'STAT 240']);
  expect(JSON.stringify(full)).not.toMatch(/gpa|grade/i);
});

test('NetID request stays pending until the recipient accepts', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value)});
  try {
    expect(await sendFriendRequest('newstudent')).toBeNull();
    const pending = (JSON.parse(values.get('digree.friends')!) as Friend[]).find((item) => item.name === 'newstudent');
    expect(pending?.status).toBe('outgoing');
    expect(viewFriendSchedule(pending)).toEqual({access: 'none'});
    expect(await acceptFriend('f4')).toBeNull();
    const accepted = (JSON.parse(values.get('digree.friends')!) as Friend[]).find((item) => item.id === 'f4');
    expect(accepted?.status).toBe('accepted');
    expect(viewFriendSchedule(accepted).access).toBe('full');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('downvotes never show a negative score', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value)});
  try {
    expect(await setVote('post-test', -1)).toBeNull();
    expect(JSON.parse(values.get('vote:post-test')!)).toEqual({score: 0, my_vote: -1});
    expect(await setVote('post-test', 1)).toBeNull();
    expect(JSON.parse(values.get('vote:post-test')!)).toEqual({score: 1, my_vote: 1});
  } finally {
    vi.unstubAllGlobals();
  }
});

test('chat rooms: only current-term self-reported courses, sorted by course code', () => {
  const records = [record('stat240'), record('cs400'), record('math234', {status: 'planned'}), record('demo101', {term: '2026FA', status: 'completed'}), record('demo102', {status: 'withdrawn'})];
  const rooms = myChatRooms(records);
  expect(rooms.map((r) => r.course_code)).toEqual(['COMP SCI 400', 'STAT 240']);
  expect(rooms[0].my_alias).toBe(myChatRooms(records)[0].my_alias); // stable alias per room
  expect(isRoomMember('2027SP-cs400', records)).toBe(true);
  expect(isRoomMember('2027SP-math234', records)).toBe(false); // planned is not membership
  expect(isRoomMember('2027SP-cs400', [])).toBe(false);
  expect(myChatRooms([])).toEqual([]);
});

test('community feed: tag filter, search, hides reported, newest first', () => {
  const post = (id: string, course_id: string | null, body: string, created_at: string, reported = false): Post => ({id, course_id, category: 'general', body, public_alias: makeAlias(), created_at, mine: false, reported});
  const all = [post('a', 'cs400', 'Old lab question', '2026-11-01T00:00:00Z'), post('b', 'math234', 'Midterm tips', '2026-11-03T00:00:00Z'), post('c', 'cs400', 'New LAB thread', '2026-11-05T00:00:00Z'), post('d', 'cs400', 'spam lab', '2026-11-06T00:00:00Z', true)];
  expect(filterPosts(all, {courseId: null, q: ''}).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  expect(filterPosts(all, {courseId: 'cs400', q: ''}).map((p) => p.id)).toEqual(['c', 'a']);
  expect(filterPosts(all, {courseId: null, q: 'lab'}).map((p) => p.id)).toEqual(['c', 'a']);
  expect(filterPosts(all, {courseId: 'math234', q: 'lab'})).toEqual([]);
  const classified = [{...all[0], category: 'question', title: 'Office hours'}, {...all[1], category: 'tip'}];
  expect(filterPosts(classified, {courseId: 'cs400', q: 'Office', flair: 'question'}).map((p) => p.id)).toEqual(['a']);
  expect(filterPosts(classified, {courseId: 'cs400', q: 'lab', flair: 'tip'})).toEqual([]);
});
