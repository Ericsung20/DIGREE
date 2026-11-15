'use client';

import {useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, Svg} from '@/components/dg';
import {initials} from '@/lib/data/account';
import {setMyVisibility, useFriends, type Visibility} from '@/lib/data/friends';
import {s} from '@/lib/ui/css';
import {personTone} from '@/lib/ui/palette';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
`;

const LEVELS: Visibility[] = ['private', 'free_busy', 'full'];
const LABELS = ['Hidden', 'Free / busy', 'Full'];
const DESCRIPTIONS = ['Can’t see your schedule', 'Sees busy times, not course names', 'Sees courses, times and rooms'];

export default function SharingPage() {
  const friends = useFriends().filter((friend) => friend.status === 'accepted');
  const [error, setError] = useState<string | null>(null);

  async function choose(id: string, level: Visibility) {
    setError(null);
    try {
      setError(await setMyVisibility(id, level));
    } catch {
      setError('Couldn’t save your sharing setting. Try again.');
    }
  }

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 6px')}>
        <div style={s('display: flex; align-items: center; height: 44px')}>
          <BackLink href="/friends" label="Back to friends" />
        </div>
        <h1 style={s('margin: 0; padding-left: 10px; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>Who sees your schedule</h1>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 14px 20px 24px; display: flex; flex-direction: column; gap: 10px')}>
        <div className="rise" style={s('flex-shrink: 0; padding: 14px 16px; border-radius: 22px; background: #1D1B1A; color: #FFFFFF; display: flex; align-items: center; gap: 12px')}>
          <span style={s('width: 40px; height: 40px; border-radius: 20px; background: rgba(255,255,255,0.14); display: flex; align-items: center; justify-content: center; flex-shrink: 0')}><Svg size={20} sw={2.4}>{ICON.lock}</Svg></span>
          <span style={s('display: flex; flex-direction: column')}><span style={s('font-size: 15px; font-weight: 900')}>Private by default</span><span style={s('font-size: 13px; font-weight: 600; opacity: 0.8')}>New friends see nothing until you choose.</span></span>
        </div>

        {friends.map((friend, i) => {
          const v = Math.max(0, LEVELS.indexOf(friend.myVisibility));
          const tone = personTone(friend.id);
          return (
            <section key={friend.id} className="rise" style={s(`flex-shrink: 0; padding: 14px; border-radius: 22px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; flex-direction: column; gap: 12px; animation-delay: ${60 + i * 60}ms`)}>
              <div style={s('display: flex; align-items: center; gap: 12px')}>
                <span style={s(`width: 44px; height: 44px; border-radius: 22px; flex-shrink: 0; background: ${tone.bg}; color: ${tone.fg}; font-size: 15px; font-weight: 900; display: flex; align-items: center; justify-content: center`)}>{initials(friend.name)}</span>
                <span style={s('flex: 1; display: flex; flex-direction: column')}><span style={s('font-size: 16px; font-weight: 900')}>{friend.name}</span><span style={s('font-size: 13px; font-weight: 700; color: #5F5A55')}>{DESCRIPTIONS[v]}</span></span>
              </div>
              <div role="radiogroup" aria-label={`Sharing level for ${friend.name}`} style={s('position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 4px; border-radius: 18px; background: #F1EEEA')}>
                <span aria-hidden="true" style={s(`position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / 3); border-radius: 14px; transition: transform 380ms cubic-bezier(.2,.9,.25,1.15), background 260ms ease; transform: translateX(${v * 100}%); background: ${v === 0 ? '#FFFFFF' : '#1D1B1A'}; box-shadow: 0 2px 6px rgba(40,20,20,0.12)`)} />
                {LABELS.map((label, j) => {
                  const on = j === v;
                  return <button key={label} type="button" role="radio" aria-checked={on} onClick={() => void choose(friend.id, LEVELS[j])} style={s(`position: relative; z-index: 1; height: 40px; border: none; background: transparent; font-size: 13px; font-weight: 900; cursor: pointer; transition: color 260ms ease; color: ${on ? (j === 0 ? '#1D1B1A' : '#FFFFFF') : '#5F5A55'}`)}>{label}</button>;
                })}
              </div>
            </section>
          );
        })}
        {friends.length === 0 && <EmptyNote>No friends yet. Sharing options appear once a request is accepted.</EmptyNote>}
        {error && <EmptyNote role="alert">{error}</EmptyNote>}
      </main>
    </Frame>
  );
}
