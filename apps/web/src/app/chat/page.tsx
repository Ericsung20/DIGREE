'use client';

import Link from 'next/link';
import {useState} from 'react';
import {AvatarLink, EmptyNote, Frame, TabBar} from '@/components/dg';
import {nickname, useChatRooms, useRoomPreviews} from '@/lib/data/chat-live';
import {useCourseRecords} from '@/lib/data/course-records';
import {s} from '@/lib/ui/css';
import {courseNumber, plural, stamp} from '@/lib/ui/format';
import {useCourseTone} from '@/lib/ui/palette';

const CSS = `
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(62,106,36,.45)}70%{box-shadow:0 0 0 7px rgba(62,106,36,0)}100%{box-shadow:0 0 0 0 rgba(62,106,36,0)}}
.rise{animation:fadeUp 440ms cubic-bezier(.2,.9,.25,1) both}
.live{animation:pulse 1.8s ease-out infinite}
.room{transition:transform 160ms ease, box-shadow 200ms ease}
.room:hover{box-shadow:0 10px 24px rgba(40,20,20,.08)}
.room:active{transform:scale(.98)}
`;

const ACTIVE_MS = 10 * 60_000; // a room counts as live while its last message is this fresh

export default function ChatRoomsPage() {
  const rooms = useChatRooms(useCourseRecords());
  const previews = useRoomPreviews(rooms);
  const toneOf = useCourseTone();
  const [now] = useState(() => Date.now());

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 12px 20px 0; display: flex; flex-direction: column; gap: 4px')}>
        <div style={s('display: flex; align-items: center; justify-content: space-between; height: 44px')}>
          <h1 style={s('margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.02em')}>Chat</h1>
          <AvatarLink />
        </div>
        <p style={s('margin: 0; font-size: 14px; font-weight: 700; color: #5F5A55')}>Anonymous rooms for the classes you’re taking</p>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 16px 20px 16px; display: flex; flex-direction: column; gap: 10px')}>
        {(rooms ?? []).map((room, i) => {
          const tone = toneOf(room.course_id);
          const {last, unread} = previews[room.room_id] ?? {last: null, unread: 0};
          const live = !!last && now - new Date(last.created_at).getTime() < ACTIVE_MS;
          return (
            <Link key={room.room_id} href={`/chat/${room.room_id}`} className="room rise" style={s(`flex-shrink: 0; padding: 14px; border-radius: 22px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); text-decoration: none; color: #1D1B1A; display: flex; gap: 12px; animation-delay: ${40 + i * 60}ms`)}>
              <span style={s(`width: 52px; height: 52px; flex-shrink: 0; border-radius: 18px; background: ${tone.bg}; color: ${tone.fg}; font-size: 14px; font-weight: 900; display: flex; align-items: center; justify-content: center`)}>{courseNumber(room.course_code)}</span>
              <span style={s('flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px')}>
                <span style={s('display: flex; align-items: center; justify-content: space-between')}><span style={s('font-size: 16px; font-weight: 900')}>{room.course_code}</span><span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>{last ? stamp(last.created_at, new Date(now)) : ''}</span></span>
                <span style={s(`font-size: 14px; font-weight: 600; color: ${unread ? '#3D3936' : '#5F5A55'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`)}>{last ? `${nickname(last.alias)}: ${last.body}` : 'No messages yet. Say hello.'}</span>
                <span style={s('display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12px; font-weight: 800; color: #5F5A55')}>
                  <span className={live ? 'live' : undefined} aria-hidden="true" style={s(`width: 8px; height: 8px; border-radius: 4px; background: ${live ? '#3E6A24' : '#C9C3BC'}`)} />
                  {plural(Number(room.participant_count), 'member')}
                  {unread > 0 && <span style={s('margin-left: auto; min-width: 22px; height: 22px; padding: 0 7px; box-sizing: border-box; border-radius: 11px; background: #1D1B1A; color: #FFFFFF; font-size: 12px; font-weight: 900; display: flex; align-items: center; justify-content: center')}>{unread >= 30 ? '30+' : unread}</span>}
                </span>
              </span>
            </Link>
          );
        })}
        {rooms === null && <EmptyNote role="alert">Couldn’t load your chats. Pull up this tab again in a moment.</EmptyNote>}
        {rooms?.length === 0 && <EmptyNote>No class chats yet. A room opens for each course you’re taking this term.</EmptyNote>}

        {rooms !== undefined && <Link href="/onboarding/courses?from=chat" className="rise" style={s(`align-self: center; margin-top: 6px; min-height: 44px; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 800; color: #3D3936; text-decoration: none; animation-delay: ${40 + (rooms?.length ?? 0) * 60}ms`)}>Missing a class? Update what you’re taking</Link>}
      </main>

      <TabBar active="chat" />
    </Frame>
  );
}
