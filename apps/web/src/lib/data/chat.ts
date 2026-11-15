import {COURSES, CURRENT_TERM} from './catalog';
import {makeAlias} from './community';
import type {CourseRecord} from './course-records';
import {readStore, useStore, writeStore} from './local-store';

// Mock of my_chat_rooms(), is_room_member() and chat_messages from the DB handoff.
// One room per (term, course). Membership comes only from current-term self-reported records.
export type ChatRoom = {room_id: string; term: string; course_id: string; course_code: string; participant_count: number; my_alias: string | null};
export type ChatMessage = {id: string; room_id: string; alias: string; body: string; created_at: string; mine: boolean; reported: boolean};

const roomId = (courseId: string) => `${CURRENT_TERM}-${courseId}`;
const OTHERS: Record<string, number> = {cs400: 23, math234: 30, stat240: 17}; // sample head counts

/** Rooms the user may see: current term + enrolled_self_reported only, sorted by course code. */
export function myChatRooms(records: CourseRecord[]): ChatRoom[] {
  return records
    .filter((r) => r.term === CURRENT_TERM && r.status === 'enrolled_self_reported')
    .map((r) => ({
      room_id: roomId(r.course_id),
      term: r.term,
      course_id: r.course_id,
      course_code: COURSES.find((c) => c.id === r.course_id)?.code ?? r.course_id,
      participant_count: (OTHERS[r.course_id] ?? 0) + 1,
      my_alias: makeAlias(roomId(r.course_id)),
    }))
    .sort((a, b) => a.course_code.localeCompare(b.course_code));
}

/** Membership check used by the room page and by sendMessage, so a typed URL cannot open a room. */
export const isRoomMember = (id: string, records: CourseRecord[]) => myChatRooms(records).some((r) => r.room_id === id);

const KEY = 'digree.chat';
const SEED: ChatMessage[] = [
  {id: 'm1', room_id: roomId('cs400'), alias: 'Red Heron', body: 'Is the lab due Friday?', created_at: '2026-11-14T16:02:00Z', mine: false, reported: false},
  {id: 'm2', room_id: roomId('cs400'), alias: 'Quiet Owl', body: 'Yes, 11:59 PM.', created_at: '2026-11-14T16:05:00Z', mine: false, reported: false},
];

export const useMessages = () => useStore(KEY, SEED);

export function sendMessage(id: string, records: CourseRecord[], body: string): string | null {
  const room = myChatRooms(records).find((r) => r.room_id === id);
  if (!room?.my_alias) return "You're not in this chat.";
  if (!body.trim()) return 'Write a message first.';
  writeStore(KEY, [...readStore(KEY, SEED), {id: crypto.randomUUID(), room_id: id, alias: room.my_alias, body: body.trim(), created_at: new Date().toISOString(), mine: true, reported: false}]);
  return null;
}
export const reportMessage = (messageId: string) => writeStore(KEY, readStore(KEY, SEED).map((m) => (m.id === messageId && !m.mine ? {...m, reported: true} : m)));
