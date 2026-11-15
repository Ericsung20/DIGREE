'use client';

import {useEffect, useRef, useState} from 'react';
import {IS_MOCK, supabase} from '../supabase';
import {myChatRooms, reportMessage, sendMessage, useMessages, useNickDraws, type ChatMessage, type ChatRoom} from './chat';
import {makeAlias} from './community';
import {readStore, useStore, writeStore} from './local-store';
import type {CourseRecord} from './course-records';

type MessageRow = Omit<ChatMessage, 'mine' | 'reported'>;
type Thread = {alias: string | null; messages: MessageRow[]; status: 'loading' | 'ready' | 'denied' | 'error'};
const EMPTY_THREAD: Thread = {alias: null, messages: [], status: 'loading'};
const MESSAGE_COLUMNS = 'id, room_id, alias, body, created_at';

/**
 * The name shown for a chat alias. The database hands out an opaque "Student-…" alias per room;
 * the app shows a friendly two-word name derived from it and from today's date, so names reset every day.
 */
export function nickname(alias: string): string {
  return alias.startsWith('Student-') ? makeAlias(`${alias}|${new Date().toISOString().slice(0, 10)}`) : alias;
}

// When each room was last opened, kept on this device: the database has no read receipts.
const READ = 'digree.chat.read';
const NEVER: Record<string, string> = {};
export function markRoomRead(roomId: string, at: string): void {
  const read = readStore(READ, NEVER);
  if (!(read[roomId] >= at)) writeStore(READ, {...read, [roomId]: at});
}

export type RoomPreview = {last: Pick<ChatMessage, 'alias' | 'body' | 'created_at'> | null; unread: number};
const PREVIEW_DEPTH = 30;

/** Latest message and unread count for each room in the list. */
export function useRoomPreviews(rooms: ChatRoom[] | null | undefined): Record<string, RoomPreview> {
  const read = useStore(READ, NEVER);
  const sample = useMessages();
  const [live, setLive] = useState<Record<string, MessageRow[]>>({});
  const key = (rooms ?? []).map((room) => room.room_id).join(',');
  useEffect(() => {
    if (IS_MOCK || !key) return;
    let active = true;
    async function load() {
      const db = supabase();
      const lists = await Promise.all(key.split(',').map(async (roomId) => {
        const {data, error} = await db.from('chat_messages').select(MESSAGE_COLUMNS).eq('room_id', roomId).order('created_at', {ascending: false}).limit(PREVIEW_DEPTH);
        return [roomId, error ? [] : (data as MessageRow[])] as const;
      }));
      if (active) setLive(Object.fromEntries(lists));
    }
    void load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [key]);
  return Object.fromEntries((rooms ?? []).map((room) => {
    const newestFirst = IS_MOCK
      ? sample.filter((message) => message.room_id === room.room_id && !message.reported).sort((a, b) => b.created_at.localeCompare(a.created_at))
      : live[room.room_id] ?? [];
    const since = read[room.room_id] ?? '';
    const mine = (message: MessageRow) => (IS_MOCK ? (message as ChatMessage).mine : message.alias === room.my_alias);
    return [room.room_id, {last: newestFirst[0] ?? null, unread: newestFirst.filter((message) => message.created_at > since && !mine(message)).length}];
  }));
}

export function useChatRooms(records: CourseRecord[]): ChatRoom[] | null | undefined {
  const draws = useNickDraws();
  const [rooms, setRooms] = useState<ChatRoom[] | null>();
  useEffect(() => {
    if (IS_MOCK) return;
    let active = true;
    async function load() {
      const {data, error} = await supabase().rpc('my_chat_rooms');
      if (active) setRooms(error ? null : data as ChatRoom[]);
    }
    void load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [records]);
  return IS_MOCK ? myChatRooms(records, draws) : rooms;
}

function useSampleThread(room: ChatRoom, records: CourseRecord[]) {
  const messages = useMessages().filter((m) => m.room_id === room.room_id);
  return {
    alias: room.my_alias,
    messages,
    status: 'ready' as const,
    send: async (body: string) => sendMessage(room.room_id, records, body),
    report: async (id: string) => {
      reportMessage(id);
      return null;
    },
  };
}

function useLiveThread(room: ChatRoom) {
  const [thread, setThread] = useState<Thread>(EMPTY_THREAD);
  const [reported, setReported] = useState<string[]>([]);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const roomId = room.room_id;

  useEffect(() => {
    const db = supabase();
    let active = true;
    let revision = 0;

    async function read() {
      const sequence = ++revision;
      const member = await db.rpc('is_room_member', {room_id: roomId});
      if (!active || sequence !== revision) return;
      if (member.error || !member.data) {
        setThread({...EMPTY_THREAD, status: member.error ? 'error' : 'denied'});
        return;
      }
      const joined = await db.rpc('join_chat_room', {room_id: roomId});
      if (!active || sequence !== revision) return;
      if (joined.error) {
        setThread({...EMPTY_THREAD, status: joined.error.code === '42501' ? 'denied' : 'error'});
        return;
      }
      const result = await db.from('chat_messages').select(MESSAGE_COLUMNS).eq('room_id', roomId)
        .order('created_at', {ascending: false}).order('id', {ascending: false}).limit(100);
      if (!active || sequence !== revision) return;
      setThread(result.error
        ? {...EMPTY_THREAD, status: 'error'}
        : {alias: joined.data, messages: result.data.reverse(), status: 'ready'});
    }

    refresh.current = read;
    const channel = db.channel('course-chat:' + roomId)
      .on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'room_id=eq.' + roomId}, () => void read())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void read();
      });
    void read();
    window.addEventListener('focus', read);
    const timer = window.setInterval(read, 15_000);
    return () => {
      active = false;
      window.removeEventListener('focus', read);
      window.clearInterval(timer);
      void db.removeChannel(channel);
    };
  }, [roomId]);

  async function send(body: string): Promise<string | null> {
    if (!body.trim()) return 'Write a message first.';
    if (thread.status !== 'ready' || !thread.alias) return 'Open the chat again and try sending.';
    const result = await supabase().from('chat_messages').insert({room_id: roomId, alias: thread.alias, body: body.trim()}).select(MESSAGE_COLUMNS).single();
    if (result.error) {
      void refresh.current();
      return 'Couldn’t send the message. Check your access and try again.';
    }
    setThread((current) => current.status === 'ready' && !current.messages.some((message) => message.id === result.data.id)
      ? {...current, messages: [...current.messages.slice(-99), result.data]}
      : current);
    return null;
  }

  async function report(id: string): Promise<string | null> {
    const {error} = await supabase().from('chat_reports').insert({message_id: id, reason: 'Reported from the app'});
    if (error) return 'Couldn’t report the message. Try again.';
    setReported((current) => [...current, id]);
    return null;
  }

  return {
    alias: thread.alias,
    messages: thread.messages.map((m) => ({...m, mine: m.alias === thread.alias, reported: reported.includes(m.id)})),
    status: thread.status,
    send,
    report,
  };
}

export const useChatThread = IS_MOCK ? useSampleThread : useLiveThread;
