'use client';

import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {Suspense, useState} from 'react';
import {AvatarLink, Frame, ICON, SR_ONLY, Svg, TabBar} from '@/components/dg';
import {currentTermOf, useCourseCodes, useTerms} from '@/lib/data/catalog';
import {FLAIRS, POST_TYPES, isFlair, postTitle, usePostStats, usePosts, type Flair} from '@/lib/data/community';
import {useCourseRecords} from '@/lib/data/course-records';
import {s} from '@/lib/ui/css';
import {ago, shortCode} from '@/lib/ui/format';
import {useCourseTone} from '@/lib/ui/palette';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}
@keyframes popIn{0%{opacity:0;transform:scale(.5) rotate(-30deg)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 440ms cubic-bezier(.2,.9,.25,1) both}
.fab{animation:popIn 520ms cubic-bezier(.2,.9,.25,1.4) 400ms both;transition:transform 160ms ease}
.fab:active{transform:scale(.92)}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.95)}
.card{transition:transform 160ms ease, box-shadow 200ms ease}
.card:active{transform:scale(.98)}
.field{width:100%;height:48px;box-sizing:border-box;padding:0 16px 0 44px;border:2px solid transparent;border-radius:18px;background:#FFFFFF;color:#1D1B1A;font-size:16px;font-weight:700;box-shadow:0 1px 3px rgba(40,20,20,.08);outline:none;transition:border-color 200ms ease}
.field:focus{border-color:#1D1B1A}
.field::placeholder{color:#8A847E}
`;

const TYPE_CHIPS: {label: string; flair: Flair | null}[] = [{label: 'All', flair: null}, ...POST_TYPES.map((flair) => ({label: `${FLAIRS[flair]}s`, flair}))];

function Feed() {
  const params = useSearchParams();
  const fromLink = params.get('course');
  const linkedFlair = params.get('flair') ?? '';
  const [type, setType] = useState<Flair | null>(isFlair(linkedFlair) ? linkedFlair : null);
  const [course, setCourse] = useState<string | null>(fromLink);
  const [q, setQ] = useState('');
  const [now] = useState(() => Date.now());

  const posts = usePosts();
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const mine = useCourseRecords().filter((record) => record.term === currentTerm && record.status === 'enrolled_self_reported').map((record) => record.course_id);
  const toneOf = useCourseTone();
  // Filter chips: the courses I am taking, plus the one a link brought me here for.
  const chipCourses = [...new Set([...mine, ...(fromLink ? [fromLink] : [])])];
  const codes = useCourseCodes([...chipCourses, ...posts.flatMap((post) => (post.course_id ? [post.course_id] : []))]);
  const tag = (id: string) => shortCode(codes[id] ?? id);

  const needle = q.trim().toLowerCase();
  const listed = posts.filter((post) => !post.reported).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const stats = usePostStats(listed.map((post) => post.id));
  const shown = (post: (typeof listed)[number]) =>
    (type === null || post.category === type) && (!course || post.course_id === course) &&
    (!needle || [post.title, post.body, post.course_id && codes[post.course_id]].some((text) => text?.toLowerCase().includes(needle)));
  const visible = listed.filter(shown).length;
  const chip = (on: boolean, isType: boolean, first: boolean) => `flex-shrink: 0; height: 38px; padding: 0 14px; border: none; border-radius: 19px; font-size: 14px; font-weight: 900; cursor: pointer; transition: background 220ms ease, color 220ms ease; ${on ? 'background: #1D1B1A; color: #FFFFFF' : isType ? 'background: #ECE8E3; color: #3D3936' : 'background: #FFFFFF; color: #3D3936; box-shadow: inset 0 0 0 1.5px #E1DCD6'}${first ? '; margin-left: 8px' : ''}`;

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 12px 20px 0; display: flex; flex-direction: column; gap: 12px')}>
        <div style={s('display: flex; align-items: center; justify-content: space-between; height: 44px')}>
          <h1 style={s('margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.02em')}>Community</h1>
          <AvatarLink />
        </div>
        <label style={s('position: relative; display: block')}>
          <span style={s(SR_ONLY)}>Search posts</span>
          <Svg size={18} sw={2.6} stroke="#6E6863" style={s('position: absolute; left: 16px; top: 15px')}>{ICON.search}</Svg>
          <input className="field" type="text" placeholder="Search questions, reviews, tips" value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <div role="toolbar" aria-label="Filters" style={s('display: flex; gap: 6px; overflow-x: auto; margin: 0 -20px; padding: 0 20px 4px')}>
          {TYPE_CHIPS.map(({label, flair}) => <button key={label} type="button" className="press" aria-pressed={type === flair} onClick={() => setType(flair)} style={s(chip(type === flair, true, false))}>{label}</button>)}
          {chipCourses.map((id, i) => <button key={id} type="button" className="press" aria-pressed={course === id} onClick={() => setCourse(course === id ? null : id)} style={s(chip(course === id, false, i === 0))}>{tag(id)}</button>)}
        </div>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 10px 20px 90px; display: flex; flex-direction: column')}>
        {listed.map((post) => {
          const tone = toneOf(post.course_id);
          return (
            <div key={post.id} style={s(`flex-shrink: 0; overflow: hidden; transition: max-height 420ms cubic-bezier(.2,.9,.25,1), opacity 280ms ease, transform 420ms cubic-bezier(.2,.9,.25,1), padding 420ms ease; ${shown(post) ? 'max-height: 260px; opacity: 1; transform: none; padding-bottom: 10px' : 'max-height: 0; opacity: 0; transform: scale(0.96); padding-bottom: 0'}`)}>
              <Link href={`/community/${post.id}`} className="card" tabIndex={shown(post) ? 0 : -1} style={s('padding: 16px; border-radius: 22px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); text-decoration: none; color: #1D1B1A; display: flex; flex-direction: column; gap: 8px')}>
                <div style={s('display: flex; align-items: center; gap: 6px; flex-wrap: wrap')}>
                  <span style={s('font-size: 12px; font-weight: 900; color: #5F5A55; margin-right: 2px')}>{isFlair(post.category) ? FLAIRS[post.category] : 'Post'}</span>
                  {post.course_id && <span style={s(`height: 22px; padding: 0 8px; border-radius: 11px; font-size: 11px; font-weight: 900; display: inline-flex; align-items: center; background: ${tone.bg}; color: ${tone.fg}`)}>{tag(post.course_id)}</span>}
                </div>
                <span style={s('font-size: 17px; font-weight: 900; line-height: 1.3; overflow-wrap: anywhere')}>{postTitle(post)}</span>
                {post.title && post.body.trim() !== post.title.trim() && <span style={s('font-size: 14px; font-weight: 600; line-height: 1.45; color: #5F5A55; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden')}>{post.body}</span>}
                <div style={s('display: flex; align-items: center; gap: 14px; font-size: 13px; font-weight: 800; color: #5F5A55')}>
                  <span style={s('display: flex; align-items: center; gap: 4px')}><Svg size={15} sw={2.6}>{ICON.up}</Svg>{stats[post.id]?.score ?? 0}</span>
                  <span style={s('display: flex; align-items: center; gap: 4px')}><Svg size={15} sw={2.4}>{ICON.comment}</Svg>{stats[post.id]?.comments ?? 0}</span>
                  <span style={s('margin-left: auto')}>{ago(post.created_at, now)}</span>
                </div>
              </Link>
            </div>
          );
        })}
        {visible === 0 && <p className="rise" style={s('margin: 40px 0 0; text-align: center; font-size: 15px; font-weight: 700; color: #5F5A55')}>Nothing here yet. Be the first to post.</p>}
      </main>

      <Link href={`/community/new${course ? `?course=${encodeURIComponent(course)}` : ''}`} className="fab" aria-label="New post" style={s('position: absolute; right: 20px; bottom: 94px; width: 60px; height: 60px; border-radius: 30px; background: #8C1D2B; color: #FFFFFF; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 24px rgba(140,29,43,0.36); text-decoration: none')}><Svg size={26} sw={2.8} join={false}>{ICON.plus}</Svg></Link>

      <TabBar active="community" extra="position: relative; z-index: 2" />
    </Frame>
  );
}

export default function CommunityPage() {
  return <Suspense fallback={<Frame css={CSS}><span /></Frame>}><Feed /></Suspense>;
}
