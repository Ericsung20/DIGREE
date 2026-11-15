'use client';

import {useParams} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, SR_ONLY, Svg} from '@/components/dg';
import {rerollNickname, type ChatRoom} from '@/lib/data/chat';
import {markRoomRead, nickname, useChatRooms, useChatThread} from '@/lib/data/chat-live';
import {useCourseRecords, type CourseRecord} from '@/lib/data/course-records';
import {IS_MOCK} from '@/lib/supabase';
import {s} from '@/lib/ui/css';
import {courseNumber, plural} from '@/lib/ui/format';
import {personTone, useCourseTone} from '@/lib/ui/palette';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes inL{0%{opacity:0;transform:translateX(-16px) scale(.94)}100%{opacity:1;transform:none}}
@keyframes inR{0%{opacity:0;transform:translateX(16px) scale(.94)}100%{opacity:1;transform:none}}
@keyframes dot{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
.inL{animation:inL 360ms cubic-bezier(.2,.9,.25,1.2) both}
.inR{animation:inR 360ms cubic-bezier(.2,.9,.25,1.2) both}
.d{display:inline-block;width:7px;height:7px;border-radius:4px;background:#6E6863;animation:dot 1.1s ease-in-out infinite}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.92)}
.composer{flex:1;height:48px;box-sizing:border-box;padding:0 16px;border:2px solid transparent;border-radius:24px;background:#F4F1ED;color:#1D1B1A;font-size:15px;font-weight:700;outline:none;transition:border-color 200ms ease, background 200ms ease}
.composer:focus{border-color:#1D1B1A;background:#FFFFFF}
.composer::placeholder{color:#8A847E}
`;

function Shell({title, badge, sub, children}: {title: string; badge?: {text: string; bg: string; fg: string}; sub?: string; children: React.ReactNode}) {
  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 14px 10px 10px; display: flex; flex-direction: column; gap: 10px; background: #F7F5F2')}>
        <div style={s('display: flex; align-items: center; gap: 6px; height: 48px')}>
          <BackLink href="/chat" label="Back to rooms" />
          {badge && <span style={s(`width: 40px; height: 40px; border-radius: 14px; background: ${badge.bg}; color: ${badge.fg}; font-size: 13px; font-weight: 900; display: flex; align-items: center; justify-content: center`)}>{badge.text}</span>}
          <span style={s('flex: 1; display: flex; flex-direction: column')}><span style={s('font-size: 17px; font-weight: 900')}>{title}</span>{sub && <span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>{sub}</span>}</span>
        </div>
      </header>
      {children}
    </Frame>
  );
}

function Conversation({room, records}: {room: ChatRoom; records: CourseRecord[]}) {
  const {alias, messages, status, send, report} = useChatThread(room, records);
  const tone = useCourseTone()(room.course_id);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [spin, setSpin] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // Messages that were already there when the room opened appear in place; later ones slide in.
  const [opening, setOpening] = useState<Set<string> | null>(null);
  if (status === 'ready' && opening === null) setOpening(new Set(messages.map((message) => message.id)));

  const newest = messages.at(-1)?.created_at;
  useEffect(() => {
    if (status === 'ready') markRoomRead(room.room_id, newest ?? new Date().toISOString());
  }, [status, newest, room.room_id]);

  async function submit() {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    try {
      const failure = await send(text);
      setError(failure);
      if (!failure) setText('');
    } finally {
      busy.current = false;
    }
  }

  if (status === 'error' || status === 'denied') {
    return (
      <Shell title={room.course_code} badge={{text: courseNumber(room.course_code), bg: tone.bg, fg: tone.fg}}>
        <main style={s('flex: 1; min-height: 0; padding: 8px 16px 12px')}>
          <EmptyNote role="alert">{status === 'denied' ? 'You’re not in this chat. Rooms are for the courses you’re taking this term.' : 'Couldn’t load this chat. Go back and open it again.'}</EmptyNote>
        </main>
      </Shell>
    );
  }

  const me = alias ? nickname(alias) : null;
  const mine = personTone(me ?? '');
  const has = text.trim().length > 0;
  const members = Number(room.participant_count) + Number(!room.my_alias && !!alias); // the count predates my own first visit

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 14px 10px 10px; display: flex; flex-direction: column; gap: 10px; background: #F7F5F2')}>
        <div style={s('display: flex; align-items: center; gap: 6px; height: 48px')}>
          <BackLink href="/chat" label="Back to rooms" />
          <span style={s(`width: 40px; height: 40px; border-radius: 14px; background: ${tone.bg}; color: ${tone.fg}; font-size: 13px; font-weight: 900; display: flex; align-items: center; justify-content: center`)}>{courseNumber(room.course_code)}</span>
          <span style={s('flex: 1; display: flex; flex-direction: column')}><span style={s('font-size: 17px; font-weight: 900')}>{room.course_code}</span><span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>{plural(members, 'member')}</span></span>
        </div>
        {me && (
          <div style={s('margin-left: 10px; min-height: 48px; padding: 0 6px 0 14px; border-radius: 18px; background: #FFFFFF; display: flex; align-items: center; gap: 10px')}>
            <span style={s(`width: 30px; height: 30px; border-radius: 15px; flex-shrink: 0; font-size: 13px; font-weight: 900; display: flex; align-items: center; justify-content: center; transition: background 300ms ease; background: ${mine.bg}; color: ${mine.fg}`)}>{me.charAt(0)}</span>
            <span style={s('flex: 1; font-size: 14px; font-weight: 700; color: #3D3936')}>You’re <strong style={s(`font-weight: 900; color: ${mine.fg}`)}>{me}</strong> here</span>
            {/* Aliases are assigned by the database and cannot be redrawn there yet, so the button exists in sample mode only. */}
            {IS_MOCK && (
              <button type="button" className="press" aria-label="Get a new nickname" onClick={() => {
                rerollNickname(room.room_id);
                setSpin(spin + 1);
              }} style={s('width: 40px; height: 40px; border: none; border-radius: 20px; background: #F1EEEA; color: #1D1B1A; display: flex; align-items: center; justify-content: center; cursor: pointer')}>
                <Svg size={18} sw={2.4} style={s(`transition: transform 500ms cubic-bezier(.2,.9,.25,1.2); transform: rotate(${spin * 360}deg)`)}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></Svg>
              </button>
            )}
          </div>
        )}
      </header>

      <main aria-live="polite" style={s('flex: 1; min-height: 0; overflow: auto; padding: 8px 16px 12px; display: flex; flex-direction: column-reverse; gap: 10px')}>
        {error && <p role="alert" style={s('margin: 0; align-self: center; font-size: 13px; font-weight: 700; color: #8C1D2B')}>{error}</p>}
        {[...messages].reverse().map((m) => {
          const who = nickname(m.alias);
          const c = personTone(who);
          const fresh = opening !== null && !opening.has(m.id);
          return (
            <div key={m.id} className={fresh ? (m.mine ? 'inR' : 'inL') : ''} style={s(`flex-shrink: 0; display: flex; gap: 8px; align-items: ${m.mine ? 'flex-end' : 'flex-start'}; align-self: ${m.mine ? 'flex-end' : 'flex-start'}; flex-direction: row`)}>
              {!m.mine && <span style={s(`width: 32px; height: 32px; flex-shrink: 0; margin-top: 18px; border-radius: 16px; font-size: 13px; font-weight: 900; display: flex; align-items: center; justify-content: center; background: ${c.bg}; color: ${c.fg}`)}>{who.charAt(0)}</span>}
              <div style={s('display: flex; flex-direction: column; gap: 4px; max-width: 250px; align-items: inherit')}>
                {!m.mine && <span style={s('font-size: 12px; font-weight: 900; color: #5F5A55; padding-left: 4px')}>{who}</span>}
                <button type="button" onClick={() => !m.mine && !m.reported && setMenu(menu === m.id ? null : m.id)} style={s(`padding: 11px 15px; border: none; text-align: left; font-size: 15px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; cursor: ${m.mine ? 'default' : 'pointer'}; ${m.mine ? 'border-radius: 20px 20px 6px 20px; background: #1D1B1A; color: #FFFFFF' : m.reported ? 'border-radius: 20px 20px 20px 6px; background: #F1EEEA; color: #6E6863; font-style: italic' : `border-radius: 20px 20px 20px 6px; background: #FFFFFF; color: #1D1B1A; box-shadow: 0 1px 2px rgba(40,20,20,0.06)${menu === m.id ? '; box-shadow: 0 0 0 2px #1D1B1A' : ''}`}`)}>{m.reported ? 'Message reported' : m.body}</button>
                {menu === m.id && !m.mine && !m.reported && (
                  <button type="button" className="inL press" onClick={async () => {
                    setMenu(null);
                    setError(await report(m.id));
                  }} style={s('align-self: flex-start; height: 34px; padding: 0 12px; border: none; border-radius: 17px; background: #1D1B1A; color: #FFFFFF; font-size: 13px; font-weight: 900; display: flex; align-items: center; gap: 6px; cursor: pointer')}><Svg size={14} sw={2.6}>{ICON.flag}</Svg>Report message</button>
                )}
              </div>
            </div>
          );
        })}
        <span style={s('flex-shrink: 0; align-self: center; height: 26px; padding: 0 12px; border-radius: 13px; background: #ECE8E3; color: #5F5A55; font-size: 12px; font-weight: 800; display: flex; align-items: center')}>{status === 'loading' ? 'Loading messages…' : 'Today · names reset every day'}</span>
      </main>

      <div style={s('flex-shrink: 0; padding: 10px 14px 24px 16px; background: #FFFFFF; border-radius: 24px 24px 0 0; box-shadow: 0 -6px 24px rgba(40,20,20,0.06); display: flex; align-items: center; gap: 8px')}>
        <label style={s('flex: 1; display: flex')}><span style={s(SR_ONLY)}>Message</span><input className="composer" type="text" autoComplete="off" enterKeyHint="send" placeholder="Message the class anonymously" value={text} disabled={status !== 'ready'} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit();
        }} /></label>
        <button type="button" className="press" aria-label="Send" onClick={() => void submit()} style={s(`width: 48px; height: 48px; flex-shrink: 0; border: none; border-radius: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 220ms ease, transform 260ms cubic-bezier(.2,.9,.25,1.4); ${has ? 'background: #8C1D2B; color: #FFFFFF; transform: scale(1)' : 'background: #ECE8E3; color: #8A847E; transform: scale(0.9)'}`)}><Svg size={20} sw={2.6}>{ICON.send}</Svg></button>
      </div>
    </Frame>
  );
}

export default function ChatRoomPage() {
  const {roomId} = useParams<{roomId: string}>();
  const records = useCourseRecords();
  const rooms = useChatRooms(records);
  const room = rooms?.find((candidate) => candidate.room_id === roomId);
  if (room) return <Conversation key={roomId} room={room} records={records} />;
  return (
    <Shell title="Chat">
      <main style={s('flex: 1; min-height: 0; padding: 8px 16px 12px')}>
        {rooms === null && <EmptyNote role="alert">Couldn’t load this chat. Go back and open it again.</EmptyNote>}
        {rooms && <EmptyNote>You’re not in this chat. Rooms are for the courses you’re taking this term.</EmptyNote>}
      </main>
    </Shell>
  );
}
