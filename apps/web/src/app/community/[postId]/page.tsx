'use client';

import {useParams, useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, SR_ONLY, Svg} from '@/components/dg';
import {useCourseCodes} from '@/lib/data/catalog';
import {FLAIRS, addComment, deletePost, isFlair, postTitle, reportPost, setVote, useComments, usePost, useVote, type Comment, type Post} from '@/lib/data/community';
import {s} from '@/lib/ui/css';
import {ago, plural, shortCode} from '@/lib/ui/format';
import {useCourseTone} from '@/lib/ui/palette';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.9)}
.composer{flex:1;height:48px;box-sizing:border-box;padding:0 16px;border:2px solid transparent;border-radius:24px;background:#F4F1ED;color:#1D1B1A;font-size:15px;font-weight:700;outline:none;transition:border-color 200ms ease, background 200ms ease}
.composer:focus{border-color:#1D1B1A;background:#FFFFFF}
.composer::placeholder{color:#8A847E}
`;

const REASONS = ['Spam or ads', 'Harassment or hate', 'Academic dishonesty', 'Something else'];
const voteButton = (on: boolean, color: string) => `width: 44px; height: 40px; border: none; border-radius: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: color 200ms ease, background 200ms ease; ${on ? `background: ${color}; color: #FFFFFF` : 'background: transparent; color: #3D3936'}`;

function Thread({post, back}: {post: Post; back: string}) {
  const router = useRouter();
  const comments = useComments(post.id);
  const vote = useVote(post.id);
  const codes = useCourseCodes(post.course_id ? [post.course_id] : []);
  const tone = useCourseTone()(post.course_id);
  const [now] = useState(() => Date.now());
  const [bump, setBump] = useState(false);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Comment | null>(null);
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const bumpTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(bumpTimer.current), []);

  async function run(change: () => Promise<string | null>, success?: () => void) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const failure = await change();
      if (failure) setError(failure);
      else success?.();
    } catch {
      setError('Couldn’t save your change. Try again.');
    } finally {
      busy.current = false;
    }
  }

  function cast(value: -1 | 1) {
    setBump(true);
    window.clearTimeout(bumpTimer.current);
    bumpTimer.current = window.setTimeout(() => setBump(false), 160);
    void run(() => setVote(post.id, vote.my_vote === value ? 0 : value));
  }

  function send() {
    const body = text.trim();
    if (body) void run(() => addComment(post.id, body, reply?.id ?? null), () => {
      setText('');
      setReply(null);
    });
  }

  // Replies sit one step in from the comment they answer, however deep the thread goes.
  const ids = new Set(comments.map((comment) => comment.id));
  const children = (parent: string | null) => comments.filter((comment) => (comment.parent_id && ids.has(comment.parent_id) ? comment.parent_id : null) === parent);
  const flat: {comment: Comment; depth: number}[] = [];
  const walk = (parent: string | null, depth: number) => children(parent).forEach((comment) => {
    flat.push({comment, depth});
    walk(comment.id, depth + 1);
  });
  walk(null, 0);

  const has = text.trim().length > 0;
  const title = postTitle(post);
  const closeSheet = () => {
    setReport(false);
    if (sent) router.replace(back);
  };

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 14px 0 10px; display: flex; align-items: center; justify-content: space-between; height: 52px')}>
        <BackLink href={back} label="Back to community" />
        <button type="button" className="press" aria-label={post.mine ? 'Delete post' : 'Report post'} onClick={() => {
          setReport(true);
          setSent(false);
          setReason(null);
        }} style={s('width: 44px; height: 44px; border: none; border-radius: 22px; background: transparent; color: #3D3936; display: flex; align-items: center; justify-content: center; cursor: pointer')}><Svg size={20} sw={2.4}>{ICON.flag}</Svg></button>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 4px 20px 16px; display: flex; flex-direction: column; gap: 16px')}>
        <article className="rise" style={s('display: flex; gap: 14px; flex-shrink: 0')}>
          <div style={s('flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0')}>
            <div style={s('display: flex; align-items: center; gap: 6px')}>
              <span style={s('font-size: 12px; font-weight: 900; color: #5F5A55')}>{isFlair(post.category) ? FLAIRS[post.category] : 'Post'}</span>
              {post.course_id && <span style={s(`height: 22px; padding: 0 8px; border-radius: 11px; font-size: 11px; font-weight: 900; display: inline-flex; align-items: center; background: ${tone.bg}; color: ${tone.fg}`)}>{shortCode(codes[post.course_id] ?? post.course_id)}</span>}
            </div>
            <h1 style={s('margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.01em; line-height: 1.25; overflow-wrap: anywhere')}>{title}</h1>
            <span style={s('font-size: 13px; font-weight: 800; color: #5F5A55')}>{post.mine ? 'You' : 'Anonymous'} · {ago(post.created_at, now)}{ago(post.created_at, now) === 'now' ? '' : ' ago'}</span>
            {post.body.trim() !== title.trim() && <p style={s('margin: 0; font-size: 16px; font-weight: 600; line-height: 1.55; color: #2E2B29; overflow-wrap: anywhere; white-space: pre-wrap')}>{post.body}</p>}
          </div>
          <div aria-label="Votes" style={s('flex-shrink: 0; width: 52px; padding: 6px 0; border-radius: 26px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.08); display: flex; flex-direction: column; align-items: center; align-self: flex-start')}>
            <button type="button" className="press" aria-label="Upvote" aria-pressed={vote.my_vote === 1} onClick={() => cast(1)} style={s(voteButton(vote.my_vote === 1, '#8C1D2B'))}><Svg size={22} sw={3}>{ICON.up}</Svg></button>
            <span aria-live="polite" style={s(`display: inline-block; font-size: 16px; font-weight: 900; padding: 2px 0; transition: transform 180ms cubic-bezier(.2,.9,.25,1.6); transform: scale(${bump ? 1.3 : 1})`)}>{vote.score}</span>
            <button type="button" className="press" aria-label="Downvote" aria-pressed={vote.my_vote === -1} onClick={() => cast(-1)} style={s(voteButton(vote.my_vote === -1, '#1D1B1A'))}><Svg size={22} sw={3}>{ICON.down}</Svg></button>
          </div>
        </article>

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 8px; animation-delay: 100ms')}>
          <h2 style={s('margin: 0 0 2px 4px; font-size: 15px; font-weight: 900')}>{plural(comments.length, 'comment')}</h2>
          {flat.map(({comment, depth}) => (
            <div key={comment.id} style={s(`flex-shrink: 0; ${depth ? 'margin-left: 24px; ' : ''}padding: 14px 16px; border-radius: 20px; background: #FFFFFF; display: flex; flex-direction: column; gap: 6px${reply?.id === comment.id ? '; box-shadow: 0 0 0 2px #1D1B1A' : ''}`)}>
              <span style={s('font-size: 13px; font-weight: 900')}>{comment.mine ? 'You' : 'Anonymous'} <span style={s('font-weight: 700; color: #5F5A55')}>· {ago(comment.created_at, now)}</span></span>
              <span style={s('font-size: 15px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap')}>{comment.body}</span>
              {!comment.mine && <button type="button" onClick={() => {
                setReply(reply?.id === comment.id ? null : comment);
                input.current?.focus();
              }} style={s('align-self: flex-start; min-height: 32px; padding: 0; border: none; background: transparent; color: #3D3936; font-size: 13px; font-weight: 900; cursor: pointer')}>Reply</button>}
            </div>
          ))}
          {error && !report && <p role="alert" style={s('margin: 4px; font-size: 13px; font-weight: 700; color: #8C1D2B')}>{error}</p>}
        </section>
      </main>

      <form onSubmit={(event) => {
        event.preventDefault();
        send();
      }} style={s('flex-shrink: 0; padding: 10px 14px 24px 20px; background: #FFFFFF; border-radius: 24px 24px 0 0; box-shadow: 0 -6px 24px rgba(40,20,20,0.06); display: flex; align-items: center; gap: 8px')}>
        <label style={s('flex: 1; display: flex')}><span style={s(SR_ONLY)}>Write a comment</span><input ref={input} className="composer" type="text" autoComplete="off" placeholder={reply ? 'Write a reply' : 'Add a comment'} value={text} onChange={(event) => setText(event.target.value)} /></label>
        <button type="submit" className="press" aria-label="Send comment" style={s(`width: 48px; height: 48px; flex-shrink: 0; border: none; border-radius: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 220ms ease, transform 260ms cubic-bezier(.2,.9,.25,1.4); ${has ? 'background: #8C1D2B; color: #FFFFFF; transform: scale(1)' : 'background: #ECE8E3; color: #8A847E; transform: scale(0.9)'}`)}><Svg size={20} sw={2.6}>{ICON.send}</Svg></button>
      </form>

      <div aria-hidden="true" onClick={closeSheet} style={s(`position: absolute; inset: 0; z-index: 20; background: rgba(29,27,26,0.32); transition: opacity 300ms ease; ${report ? 'opacity: 1; pointer-events: auto' : 'opacity: 0; pointer-events: none'}`)} />
      <section role="dialog" aria-label={post.mine ? 'Delete post' : 'Report post'} aria-hidden={!report} style={s(`position: absolute; left: 0; right: 0; bottom: 0; z-index: 21; box-sizing: border-box; padding: 10px 20px 30px; background: #FFFFFF; border-radius: 28px 28px 0 0; display: flex; flex-direction: column; gap: 14px; transition: transform 420ms cubic-bezier(.2,.9,.25,1.05), visibility 420ms; transform: ${report ? 'translateY(0)' : 'translateY(105%)'}; visibility: ${report ? 'visible' : 'hidden'}`)}>
        <span aria-hidden="true" style={s('align-self: center; width: 40px; height: 5px; border-radius: 3px; background: #DDD8D2')} />
        {post.mine ? (
          <>
            <h2 style={s('margin: 0; font-size: 22px; font-weight: 900')}>Delete this post?</h2>
            <span style={s('font-size: 15px; font-weight: 600; color: #5F5A55')}>It’s yours. Deleting removes it and its comments for everyone.</span>
            {error && <span role="alert" style={s('font-size: 13px; font-weight: 700; color: #8C1D2B')}>{error}</span>}
            <button type="button" onClick={() => void run(() => deletePost(post), () => router.replace(back))} style={s('height: 56px; border: none; border-radius: 20px; font-size: 17px; font-weight: 900; transition: background 220ms ease, color 220ms ease; background: #8C1D2B; color: #FFFFFF; cursor: pointer')}>Delete</button>
          </>
        ) : !sent ? (
          <>
            <h2 style={s('margin: 0; font-size: 22px; font-weight: 900')}>What’s wrong with this post?</h2>
            <div role="radiogroup" style={s('display: flex; flex-direction: column; gap: 6px')}>
              {REASONS.map((label, i) => {
                const on = reason === i;
                return (
                  <button key={label} type="button" role="radio" aria-checked={on} onClick={() => setReason(i)} style={s(`min-height: 52px; padding: 0 14px; border: none; border-radius: 16px; display: flex; align-items: center; gap: 12px; font-size: 15px; font-weight: 800; color: #1D1B1A; cursor: pointer; text-align: left; transition: background 200ms ease; background: ${on ? '#F1EEEA' : '#F7F5F2'}`)}>
                    <span style={s(`width: 22px; height: 22px; box-sizing: border-box; border-radius: 11px; flex-shrink: 0; transition: border-width 200ms ease; border: ${on ? '7px solid #1D1B1A' : '2px solid #A59D94'}`)} />{label}
                  </button>
                );
              })}
            </div>
            {error && <span role="alert" style={s('font-size: 13px; font-weight: 700; color: #8C1D2B')}>{error}</span>}
            <button type="button" onClick={() => reason !== null && void run(() => reportPost(post.id, REASONS[reason]), () => setSent(true))} style={s(`height: 56px; border: none; border-radius: 20px; font-size: 17px; font-weight: 900; transition: background 220ms ease, color 220ms ease; ${reason !== null ? 'background: #8C1D2B; color: #FFFFFF; cursor: pointer' : 'background: #E4DFD9; color: #6E6863; cursor: default'}`)}>Report</button>
          </>
        ) : (
          <div className="rise" style={s('padding: 20px 0 8px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center')}>
            <span style={s('width: 56px; height: 56px; border-radius: 28px; background: #1D1B1A; color: #FFFFFF; display: flex; align-items: center; justify-content: center')}><Svg size={26} sw={3}>{ICON.check}</Svg></span>
            <h2 style={s('margin: 0; font-size: 20px; font-weight: 900')}>Thanks for flagging</h2>
            <span style={s('font-size: 15px; font-weight: 600; color: #5F5A55')}>We’ll review it. You won’t see this post anymore.</span>
            <button type="button" onClick={closeSheet} style={s('margin-top: 6px; height: 48px; padding: 0 28px; border: none; border-radius: 18px; background: #ECE8E3; color: #1D1B1A; font-size: 15px; font-weight: 900; cursor: pointer')}>Done</button>
          </div>
        )}
      </section>
    </Frame>
  );
}

function PostDetail() {
  const {postId} = useParams<{postId: string}>();
  const from = useSearchParams().get('from') ?? '';
  const back = from.startsWith('/community') || from.startsWith('/course/') ? from : '/community';
  const post = usePost(postId);
  // Reporting hides the post from the store at once; the sheet stays up until Done, so keep what was shown.
  const [kept, setKept] = useState<Post | null>(null);
  if (post && post !== kept) setKept(post);
  const shown = post ?? kept;
  if (shown) return <Thread post={shown} back={back} />;
  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 14px 0 10px; display: flex; align-items: center; justify-content: space-between; height: 52px')}>
        <BackLink href={back} label="Back to community" />
      </header>
      <main style={s('flex: 1; min-height: 0; padding: 4px 20px 16px')}>
        {post === null && <EmptyNote>This post isn’t available. It may have been removed.</EmptyNote>}
      </main>
    </Frame>
  );
}

export default function PostDetailPage() {
  return <Suspense fallback={<Frame css={CSS}><span /></Frame>}><PostDetail /></Suspense>;
}
