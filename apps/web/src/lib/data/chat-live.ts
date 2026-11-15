'use client';

import {useEffect, useRef, useState} from 'react';
import {IS_MOCK, supabase} from '../supabase';
import {myChatRooms, reportMessage, sendMessage, useMessages, type ChatMessage, type ChatRoom} from './chat';
import type {CourseRecord} from './course-records';

type MessageRow = Omit<ChatMessage, 'mine' | 'reported'>;
type Thread = {alias: string | null; messages: MessageRow[]; status: 'loading' | 'ready' | 'denied' | 'error'};
const EMPTY_THREAD: Thread = {alias: null, messages: [], status: 'loading'};
const MESSAGE_COLUMNS = 'id, room_id, alias, body, created_at';

export function useChatRooms(records: CourseRecord[]): ChatRoom[] | null | undefined {
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
  return IS_MOCK ? myChatRooms(records) : rooms;
}

function useSampleThread(room: ChatRoom, records: CourseRecord[]) {
  const messages = useMessages().filter((m) => m.room_id === room.room_id && !m.reported);
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
    messages: thread.messages.filter((m) => !reported.includes(m.id)).map((m) => ({...m, mine: m.alias === thread.alias})),
    status: thread.status,
    send,
    report,
  };
}

export const useChatThread = IS_MOCK ? useSampleThread : useLiveThread;
