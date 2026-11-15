'use client';

import {useParams} from 'next/navigation';
import {useRef, useState} from 'react';
import {EmptyState, Screen, field, primary} from '@/components/screen';
import type {ChatRoom} from '@/lib/data/chat';
import {useChatRooms, useChatThread} from '@/lib/data/chat-live';
import {useCourseRecords, type CourseRecord} from '@/lib/data/course-records';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
const backToChat = {href: '/chat', label: 'Back to chats'};

function ChatUnavailable({denied}: {denied: boolean}) {
  return (
    <Screen title="Chat" back={backToChat}>
      <EmptyState title={denied ? "You're not in this chat" : 'Couldn’t load chat'} body={denied ? 'Chats are limited to courses you report taking this term.' : 'Refresh the page to try again.'} />
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
    <Screen title={room.course_code} back={backToChat}>
      <p className="surface text-sm font-bold text-neutral-600">
        {room.participant_count + Number(!room.my_alias && !!alias)} here{alias && ' · You are ' + alias} · Based on courses members enter themselves
      </p>
      {status === 'loading' && <p role="status" className="py-8 text-center text-sm text-neutral-600">Loading messages…</p>}
      {status === 'ready' && messages.length === 0 && <p className="py-8 text-center text-sm text-neutral-600">No messages yet. Say hello.</p>}
      <ul className="mt-4 flex flex-col gap-2.5" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-[20px] px-3.5 py-2.5 text-sm wrap-anywhere shadow-card ${m.mine ? 'self-end rounded-br-md bg-sky-100 text-sky-900' : 'self-start rounded-bl-md bg-white'}`}>
            <span className="mb-0.5 block text-xs font-extrabold opacity-80">
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
        className="mt-4 flex items-end gap-2"
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
        <button type="submit" className={`${primary} max-w-fit shrink-0`} disabled={sending || status !== 'ready' || !text.trim()}>
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
  if (rooms === undefined) return <Screen title="Chat" back={backToChat}><p role="status" className="surface">Loading chat…</p></Screen>;
  const room = rooms?.find((candidate) => candidate.room_id === roomId);
  return room ? <Conversation key={roomId} room={room} records={records} /> : <ChatUnavailable denied={rooms !== null} />;
}
