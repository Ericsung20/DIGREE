'use client';

import Link from 'next/link';
import {useParams, useSearchParams} from 'next/navigation';
import {Suspense, useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, Svg} from '@/components/dg';
import {bundleKey, currentTermOf, useBuildingNames, useBundlesFor, useCourseInfo, useTerms, type Meeting} from '@/lib/data/catalog';
import {useChatRooms} from '@/lib/data/chat-live';
import {FLAIRS, isFlair, postTitle, usePostStats, usePosts} from '@/lib/data/community';
import {useCourseRecords} from '@/lib/data/course-records';
import {usePlannedSchedule} from '@/lib/data/saved-schedules';
import {s} from '@/lib/ui/css';
import {DAY_SHORT, dayIndex, meetingSummary, plural, timeOfDay} from '@/lib/ui/format';
import {TONES, useCourseTone} from '@/lib/ui/palette';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}
@keyframes grow{0%{opacity:0;transform:scale(.94)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 460ms cubic-bezier(.2,.9,.25,1) both}
.grow{animation:grow 520ms cubic-bezier(.2,.9,.25,1.1) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.97)}
`;

const TILE = 'padding: 12px 14px; border-radius: 20px; background: #FFFFFF; display: flex; flex-direction: column; gap: 2px';
const ROW = 'min-height: 52px; display: flex; align-items: center; gap: 12px';

/** The next time this class meets, counted from now: "Tue 9:30 AM". */
function nextClass(meetings: Meeting[], now: number): string | null {
  const date = new Date(now);
  const today = (date.getDay() + 6) % 7; // Monday first, like DAYS
  const minute = date.getHours() * 60 + date.getMinutes();
  const upcoming = meetings
    .map((meeting) => ({meeting, wait: ((dayIndex(meeting.day) - today + 7) % 7) * 1440 + meeting.start_min - minute}))
    .map((item) => ({...item, wait: item.wait < 0 ? item.wait + 10_080 : item.wait}))
    .sort((a, b) => a.wait - b.wait)[0];
  return upcoming ? `${DAY_SHORT[dayIndex(upcoming.meeting.day)]} ${timeOfDay(upcoming.meeting.start_min)}` : null;
}

function CourseDetail() {
  const {courseId: raw} = useParams<{courseId: string}>();
  const courseId = decodeURIComponent(raw);
  const params = useSearchParams();
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const term = terms.find((item) => item.id === params.get('term'))?.id ?? currentTerm ?? terms.at(-1)?.id ?? '';
  const plans = params.get('view') === 'plans';
  const [now] = useState(() => Date.now());

  const records = useCourseRecords();
  const plan = usePlannedSchedule(term);
  const course = useCourseInfo(courseId);
  const record = records.find((item) => item.term === term && item.course_id === courseId && (item.status === 'enrolled_self_reported' || item.status === 'completed'));
  const planned = plan?.selected.find((item) => item.course_id === courseId);
  const entry = plans ? planned : record;
  const section = useBundlesFor(entry ? [{term, course_id: courseId, bundle_id: entry.bundle_id}] : [])[bundleKey({term, course_id: courseId, bundle_id: entry?.bundle_id ?? null})];
  const meetings = (plans ? planned?.meetings : section?.meetings) ?? [];
  const buildings = useBuildingNames(meetings.flatMap((meeting) => (meeting.building_id ? [meeting.building_id] : [])));
  const toneOf = useCourseTone();
  const tone = plans ? TONES[Math.max(0, plan?.selected.findIndex((item) => item.course_id === courseId) ?? 0) % TONES.length] : toneOf(courseId);
  const rooms = useChatRooms(records);
  const room = rooms?.find((item) => item.course_id === courseId);

  const posts = usePosts().filter((post) => post.course_id === courseId && !post.reported);
  const stats = usePostStats(posts.map((post) => post.id));
  const top = [...posts].sort((a, b) => (stats[b.id]?.score ?? 0) - (stats[a.id]?.score ?? 0) || b.created_at.localeCompare(a.created_at)).slice(0, 2);

  const code = course?.code ?? record?.course_code ?? planned?.course_code ?? '';
  const label = section?.label ?? entry?.bundle_id ?? '';
  const parts = /^([A-Za-z]+)\s+(\S.*)$/.exec(label);
  const upcoming = term === currentTerm ? nextClass(meetings, now) : null;
  const termLabel = terms.find((item) => item.id === term)?.label ?? '';
  const back = `/?term=${encodeURIComponent(term)}${plans ? '&view=plans' : ''}`;
  const places = [...new Set(meetings.map((meeting) => (meeting.building_id ? buildings[meeting.building_id] ?? meeting.building_id : meeting.mode === 'online_sync' ? 'Online' : '')).filter(Boolean))];

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 0 10px; display: flex; align-items: center; justify-content: space-between; height: 52px')}>
        <BackLink href={back} label="Back to schedule" />
        <span style={s('font-size: 14px; font-weight: 800; color: #5F5A55')}>{termLabel}</span>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 8px 20px 24px; display: flex; flex-direction: column; gap: 14px')}>
        {code && (
          <section className="grow" style={s(`padding: 22px 20px; border-radius: 28px; background: ${tone.bg}; color: ${tone.fg}; display: flex; flex-direction: column; gap: 6px`)}>
            <span style={s('font-size: 15px; font-weight: 900; letter-spacing: 0.02em')}>{code}</span>
            <h1 style={s(`margin: 0; font-size: 30px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.12; color: ${tone.fg === '#1C3D66' ? '#13294A' : tone.fg}`)}>{course?.title ?? code}</h1>
            {upcoming && <span style={s(`margin-top: 8px; align-self: flex-start; height: 30px; padding: 0 12px; border-radius: 15px; background: #FFFFFF; color: ${tone.fg}; font-size: 13px; font-weight: 900; display: flex; align-items: center`)}>Next class · {upcoming}</span>}
          </section>
        )}

        {code && (
          <div className="rise" style={s('display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; animation-delay: 100ms')}>
            <div style={s(TILE)}><span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>Credits</span><span style={s('font-size: 20px; font-weight: 900')}>{entry?.credits ?? course?.credit_options[0] ?? '—'}</span></div>
            <div style={s(TILE)}><span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>Section</span><span style={s('font-size: 20px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{parts?.[2] ?? (label || '—')}</span></div>
            <div style={s(TILE)}><span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>Type</span><span style={s('font-size: 20px; font-weight: 900')}>{parts?.[1].toUpperCase() ?? '—'}</span></div>
          </div>
        )}

        {code && (
          <div className="rise" style={s('padding: 6px 16px; border-radius: 22px; background: #FFFFFF; display: flex; flex-direction: column; animation-delay: 160ms')}>
            <div style={s(`${ROW}; border-bottom: 1px solid #EFEBE6`)}><Svg size={20} sw={2.2} stroke="#6E6863">{ICON.clock}</Svg><span style={s('flex: 1; font-size: 15px; font-weight: 700')}>{meetings.length ? meetingSummary(meetings) : 'No set meeting time'}</span></div>
            <div style={s(`${ROW}; border-bottom: 1px solid #EFEBE6`)}><Svg size={20} sw={2.2} stroke="#6E6863">{ICON.pin}</Svg><span style={s('flex: 1; font-size: 15px; font-weight: 700')}>{places.join(', ') || 'Location not listed'}</span></div>
            <div style={s(ROW)}><Svg size={20} sw={2.2} stroke="#6E6863">{ICON.person}</Svg><span style={s('flex: 1; font-size: 15px; font-weight: 700')}>{section?.instructors.length ? section.instructors.join(', ') : 'Instructor not listed'}</span></div>
          </div>
        )}

        {code && (
          <section className="rise" style={s('display: flex; flex-direction: column; gap: 8px; animation-delay: 220ms')}>
            <div style={s('display: flex; align-items: baseline; justify-content: space-between; padding: 0 4px')}>
              <h2 style={s('margin: 0; font-size: 17px; font-weight: 900')}>From Community</h2>
              <Link href={`/community?course=${encodeURIComponent(courseId)}`} style={s('font-size: 14px; font-weight: 800; color: #3D3936; text-decoration: none')}>See all {posts.length}</Link>
            </div>
            {top.map((post) => (
              <Link key={post.id} href={`/community/${post.id}?from=${encodeURIComponent(`/course/${encodeURIComponent(courseId)}?${params}`)}`} className="press" style={s('padding: 14px 16px; border-radius: 20px; background: #FFFFFF; text-decoration: none; color: #1D1B1A; display: flex; flex-direction: column; gap: 4px')}>
                <span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>{isFlair(post.category) ? FLAIRS[post.category] : 'Post'} · {plural(stats[post.id]?.score ?? 0, 'vote')}</span>
                <span style={s('font-size: 15px; font-weight: 800; line-height: 1.35')}>{postTitle(post)}</span>
              </Link>
            ))}
            {posts.length === 0 && <span style={s('padding: 14px 16px; border-radius: 20px; background: #FFFFFF; font-size: 15px; font-weight: 700; color: #5F5A55')}>Nothing here yet. Be the first to post.</span>}
          </section>
        )}

        {code && (
          <div className="rise" style={s('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; animation-delay: 280ms')}>
            <Link href={room ? `/chat/${room.room_id}` : '/chat'} className="press" style={s('height: 54px; border-radius: 20px; background: #1D1B1A; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; font-weight: 900')}><Svg size={18} sw={2.4}>{ICON.chat}</Svg>Class chat</Link>
            <Link href={plans ? `/dig?term=${encodeURIComponent(term)}` : `/schedule/add?term=${encodeURIComponent(term)}&course=${encodeURIComponent(courseId)}`} className="press" style={s('height: 54px; border-radius: 20px; background: #ECE8E3; color: #1D1B1A; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 900')}>{plans ? 'Dig again' : 'Change section'}</Link>
          </div>
        )}
        {!code && course === null && terms.length > 0 && <EmptyNote>Loading course…</EmptyNote>}
      </main>
    </Frame>
  );
}

export default function CourseDetailPage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><CourseDetail /></Suspense>;
}
