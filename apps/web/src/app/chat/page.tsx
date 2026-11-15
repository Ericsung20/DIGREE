'use client';

import Link from 'next/link';
import {Chevron, EmptyState, Screen, secondary} from '@/components/screen';
import {useChatRooms} from '@/lib/data/chat-live';
import {useCourseRecords} from '@/lib/data/course-records';

const roomColors = ['bg-emerald-100 text-emerald-900', 'bg-sky-100 text-sky-900', 'bg-violet-100 text-violet-900', 'bg-amber-100 text-amber-900'];

export default function ChatPage() {
  const rooms = useChatRooms(useCourseRecords());
  return (
    <Screen title="Chat" description="Anonymous rooms for the classes you’re taking">
      <p className="mb-3 rounded-2xl bg-amber-100 px-3.5 py-2.5 text-xs font-bold text-amber-900">Room access is based on the courses you enter yourself.</p>
      {rooms === undefined ? <p role="status" className="mt-4 text-sm text-neutral-600">Loading chats…</p> : rooms === null ? (
        <EmptyState title="Couldn’t load chats" body="Refresh the page to try again." />
      ) : rooms.length === 0 ? (
        <>
          <EmptyState title="No course chats yet" body="Chats open for the courses you report taking this term." />
          <Link href="/profile" className={`${secondary} w-full`}>
            Add courses
          </Link>
        </>
      ) : (
        <ul className="space-y-2.5">
          {rooms.map((r, i) => (
            <li key={r.room_id}>
              <Link href={`/chat/${r.room_id}`} className="surface flex items-center gap-3 transition-shadow hover:shadow-raised">
                <span aria-hidden="true" className={`grid size-12 shrink-0 place-items-center rounded-2xl text-sm font-black ${roomColors[i % roomColors.length]}`}>
                  {r.course_code.match(/\d+[A-Z]*$/i)?.[0] ?? r.course_code.slice(0, 3)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-black wrap-anywhere">{r.course_code}</span>
                  {r.my_alias && <span className="text-xs text-neutral-600">You are {r.my_alias}</span>}
                  <span className="block text-xs font-bold text-neutral-600">{r.participant_count} here</span>
                </span>
                <span className="shrink-0 text-neutral-500"><Chevron /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
