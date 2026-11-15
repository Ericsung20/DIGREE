'use client';

import Link from 'next/link';
import {useParams} from 'next/navigation';
import {useState} from 'react';
import {EmptyState, Screen, field, secondary} from '@/components/screen';
import {myChatRooms, reportMessage, sendMessage, useMessages} from '@/lib/data/chat';
import {useCourseRecords} from '@/lib/data/course-records';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});

export default function ChatRoomPage() {
  const {roomId} = useParams<{roomId: string}>();
  const records = useCourseRecords();
  const all = useMessages();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Membership is re-checked here, so typing a room URL does not open it.
  const room = myChatRooms(records).find((r) => r.room_id === roomId);
  if (!room) {
    return (
      <Screen title="Chat">
        <EmptyState title="You're not in this chat" body="Chats are limited to courses you report taking this term." />
        <Link href="/chat" className={`${secondary} block text-center`}>
          Back to chats
        </Link>
      </Screen>
    );
  }

  const messages = all.filter((m) => m.room_id === room.room_id && !m.reported);
  return (
    <Screen title={room.course_code}>
      <p className="text-xs text-neutral-600">
        {room.participant_count} here · You are {room.my_alias} · Self-reported course membership
      </p>
      {messages.length === 0 && <p className="py-8 text-center text-sm text-neutral-600">No messages yet. Say hello.</p>}
      <ul className="mt-3 space-y-2" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.mine ? 'ml-10 bg-sky-100 text-sky-900' : 'mr-10 bg-neutral-100'}`}>
            <span className="block text-xs opacity-80">
              {m.alias} · <time suppressHydrationWarning>{time(m.created_at)}</time>
            </span>
            {m.body}
            {!m.mine && (
              <button type="button" onClick={() => reportMessage(m.id)} className="mt-1 block text-xs text-accent focus-visible:outline-2 focus-visible:outline-accent">
                Report
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const err = sendMessage(room.room_id, records, text);
          setError(err);
          if (!err) setText('');
        }}
      >
        <input aria-label="Message" placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" className={field} />
        <button type="submit" className={secondary}>
          Send
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-xs text-accent">
          {error}
        </p>
      )}
    </Screen>
  );
}
