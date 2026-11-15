'use client';

import Link from 'next/link';
import {EmptyState, Screen, secondary} from '@/components/screen';
import {myChatRooms} from '@/lib/data/chat';
import {useCourseRecords} from '@/lib/data/course-records';

export default function ChatPage() {
  const rooms = myChatRooms(useCourseRecords());
  return (
    <Screen title="Chat">
      <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">Self-reported course membership. Not verified by UW.</p>
      {rooms.length === 0 ? (
        <>
          <EmptyState title="No course chats yet" body="Chats open for the courses you report taking this term." />
          <Link href="/profile" className={`${secondary} block text-center`}>
            Add courses
          </Link>
        </>
      ) : (
        <ul className="mt-2">
          {rooms.map((r) => (
            <li key={r.room_id}>
              <Link href={`/chat/${r.room_id}`} className="flex items-center justify-between gap-2 border-b border-neutral-200 py-3 text-sm focus-visible:outline-2 focus-visible:outline-accent">
                <span>
                  <span className="block font-semibold">{r.course_code}</span>
                  <span className="text-xs text-neutral-600">You are {r.my_alias}</span>
                </span>
                <span className="text-xs text-neutral-600">{r.participant_count} here</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
