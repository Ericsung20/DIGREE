'use client';

import Link from 'next/link';
import {useParams} from 'next/navigation';
import {useRef, useState} from 'react';
import {EmptyState, Screen, field, secondary} from '@/components/screen';
import type {ChatRoom} from '@/lib/data/chat';
import {useChatRooms, useChatThread} from '@/lib/data/chat-live';
import {useCourseRecords, type CourseRecord} from '@/lib/data/course-records';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});

function ChatUnavailable({denied}: {denied: boolean}) {
  return (
    <Screen title="Chat">
      <EmptyState title={denied ? "You're not in this chat" : 'Couldn’t load chat'} body={denied ? 'Chats are limited to courses you report taking this term.' : 'Refresh the page to try again.'} />
      <Link href="/chat" className={secondary}>Back to chats</Link>
    </Screen>
  );
}

function Conversation({room, records}: {room: ChatRoom; records: CourseRecord[]}) {
  const {alias, messages, status, send, report} = useChatThread(room, records);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  if (status === 'error' || status === 'denied') return <ChatUnavailable denied={status === 'denied'} />;

  return (
    <Screen title={room.course_code}>
      <p className="text-xs text-neutral-600">
        {room.participant_count + Number(!room.my_alias && !!alias)} here{alias && ' · You are ' + alias} · Self-reported course membership
      </p>
      {status === 'loading' && <p role="status" className="py-8 text-center text-sm text-neutral-600">Loading messages…</p>}
      {status === 'ready' && messages.length === 0 && <p className="py-8 text-center text-sm text-neutral-600">No messages yet. Say hello.</p>}
      <ul className="mt-3 space-y-2" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.mine ? 'ml-10 bg-sky-100 text-sky-900' : 'mr-10 bg-neutral-100'}`}>
            <span className="block text-xs opacity-80">
              {m.alias} · <time dateTime={m.created_at} suppressHydrationWarning>{time(m.created_at)}</time>
            </span>
            {m.body}
            {!m.mine && (
              <button type="button" onClick={async () => setError(await report(m.id))} className="mt-1 block text-xs text-accent focus-visible:outline-2 focus-visible:outline-accent">
                Report
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy.current) return;
          busy.current = true;
          setSending(true);
          try {
            const failure = await send(text);
            setError(failure);
            if (!failure) setText('');
          } finally {
            busy.current = false;
            setSending(false);
          }
        }}
      >
        <input aria-label="Message" placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" className={field} disabled={sending || status !== 'ready'} />
        <button type="submit" className={secondary} disabled={sending || status !== 'ready' || !text.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {error && <p role="alert" className="mt-1 text-xs text-accent">{error}</p>}
    </Screen>
  );
}

export default function ChatRoomPage() {
  const {roomId} = useParams<{roomId: string}>();
  const records = useCourseRecords();
  const rooms = useChatRooms(records);
  if (rooms === undefined) return <Screen title="Chat"><p role="status">Loading chat…</p></Screen>;
  const room = rooms?.find((candidate) => candidate.room_id === roomId);
  return room ? <Conversation key={roomId} room={room} records={records} /> : <ChatUnavailable denied={rooms !== null} />;
}
