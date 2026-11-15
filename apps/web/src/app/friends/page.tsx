'use client';

import Link from 'next/link';
import {useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, SR_ONLY, Svg} from '@/components/dg';
import {initials} from '@/lib/data/account';
import {acceptFriend, removeFriend, sendFriendRequest, useFriends} from '@/lib/data/friends';
import {s} from '@/lib/ui/css';
import {plural} from '@/lib/ui/format';
import {personTone} from '@/lib/ui/palette';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
@keyframes popIn{0%{opacity:0;transform:scale(.85)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
.pop{animation:popIn 420ms cubic-bezier(.2,.9,.25,1.3) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.96)}
.row{transition:transform 160ms ease, background 200ms ease}
.row:hover{background:#FFFFFF}
.row:active{transform:scale(.98)}
.field{width:100%;height:50px;box-sizing:border-box;padding:0 16px 0 44px;border:2px solid transparent;border-radius:18px;background:#FFFFFF;color:#1D1B1A;font-size:16px;font-weight:700;box-shadow:0 1px 3px rgba(40,20,20,.08);outline:none;transition:border-color 200ms ease}
.field:focus{border-color:#1D1B1A}
.field::placeholder{color:#8A847E}
`;

const ROW = 'min-height: 68px; padding: 10px 12px; box-sizing: border-box; border-radius: 20px; text-decoration: none; color: #1D1B1A; display: flex; align-items: center; gap: 12px';

function Avatar({id, name, size, sharing = true}: {id: string; name: string; size: number; sharing?: boolean}) {
  const tone = personTone(id, sharing);
  return <span style={s(`width: ${size}px; height: ${size}px; border-radius: ${size / 2}px; flex-shrink: 0; background: ${tone.bg}; color: ${tone.fg}; font-size: 16px; font-weight: 900; display: flex; align-items: center; justify-content: center`)}>{initials(name)}</span>;
}

export default function FriendsPage() {
  const friends = useFriends();
  const [input, setInput] = useState('');
  const [note, setNote] = useState<{text: string; error: boolean} | null>(null);
  const [fresh, setFresh] = useState<string | null>(null); // the friend just accepted pops into the list
  const [leaving, setLeaving] = useState<string[]>([]); // request cards fold away before their row changes

  const incoming = friends.filter((friend) => friend.status === 'incoming');
  const outgoing = friends.filter((friend) => friend.status === 'outgoing');
  const accepted = friends.filter((friend) => friend.status === 'accepted');
  const list = [...accepted.filter((friend) => friend.id === fresh), ...accepted.filter((friend) => friend.id !== fresh)];

  async function send() {
    try {
      const failure = await sendFriendRequest(input);
      setNote(failure ? {text: failure, error: true} : {text: 'Request sent. You can see each other’s schedules after they accept.', error: false});
      if (!failure) setInput('');
    } catch {
      setNote({text: 'Couldn’t send the request. Try again.', error: true});
    }
  }

  function answer(id: string, accept: boolean) {
    setLeaving((current) => [...current, id]);
    window.setTimeout(async () => {
      const failure = accept ? await acceptFriend(id) : await removeFriend(id);
      if (failure) setNote({text: failure, error: true});
      else if (accept) setFresh(id);
      setLeaving((current) => current.filter((item) => item !== id));
    }, 420);
  }

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 14px 4px 10px; display: flex; flex-direction: column; gap: 6px')}>
        <div style={s('display: flex; align-items: center; height: 44px')}>
          <BackLink href="/" label="Back to schedule" />
        </div>
        <h1 style={s('margin: 0; padding-left: 10px; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>Friends</h1>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 14px 20px 24px; display: flex; flex-direction: column; gap: 16px')}>
        <form className="rise" onSubmit={(event) => {
          event.preventDefault();
          void send();
        }} style={s('display: flex; flex-direction: column; gap: 8px; flex-shrink: 0')}>
          <div style={s('display: flex; align-items: center; gap: 8px')}>
            <label style={s('position: relative; display: block; flex: 1')}>
              <span style={s(SR_ONLY)}>UW NetID</span>
              <Svg size={18} sw={2.6} stroke="#6E6863" style={s('position: absolute; left: 16px; top: 16px')}>{ICON.search}</Svg>
              <input className="field" type="text" autoComplete="off" enterKeyHint="send" placeholder="UW NetID" value={input} onChange={(event) => {
                setInput(event.target.value);
                setNote(null);
              }} />
            </label>
            <button type="submit" className="press" aria-label="Send friend request" style={s('width: 50px; height: 50px; flex-shrink: 0; border: none; border-radius: 18px; background: #8C1D2B; color: #FFFFFF; font-size: 30px; line-height: 1; cursor: pointer')}>+</button>
          </div>
          {note && <span role={note.error ? 'alert' : 'status'} style={s(`padding: 0 4px; font-size: 13px; font-weight: 700; color: ${note.error ? '#8C1D2B' : '#5F5A55'}`)}>{note.text}</span>}
        </form>

        {incoming.map((friend) => (
          <div key={friend.id} style={s(`flex-shrink: 0; overflow: hidden; transition: max-height 420ms cubic-bezier(.2,.9,.25,1), opacity 260ms ease, transform 420ms cubic-bezier(.2,.9,.25,1), margin 420ms ease; ${leaving.includes(friend.id) ? 'max-height: 0; opacity: 0; transform: scale(0.94) translateY(-10px); margin-top: -16px' : 'max-height: 200px; opacity: 1; transform: none'}`)}>
            <section style={s('padding: 14px; border-radius: 22px; background: #FFFFFF; box-shadow: 0 10px 28px rgba(40,20,20,0.07); display: flex; flex-direction: column; gap: 12px')}>
              <div style={s('display: flex; align-items: center; gap: 12px')}>
                <Avatar id={friend.id} name={friend.name} size={46} />
                <span style={s('flex: 1; display: flex; flex-direction: column')}><span style={s('font-size: 16px; font-weight: 900')}>{friend.name}</span><span style={s('font-size: 13px; font-weight: 700; color: #5F5A55')}>Wants to be friends</span></span>
              </div>
              <div style={s('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px')}>
                <button type="button" className="press" onClick={() => answer(friend.id, false)} style={s('height: 46px; border: none; border-radius: 16px; background: #F1EEEA; color: #1D1B1A; font-size: 15px; font-weight: 900; cursor: pointer')}>Not now</button>
                <button type="button" className="press" onClick={() => answer(friend.id, true)} style={s('height: 46px; border: none; border-radius: 16px; background: #8C1D2B; color: #FFFFFF; font-size: 15px; font-weight: 900; cursor: pointer')}>Accept</button>
              </div>
            </section>
          </div>
        ))}

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 6px; animation-delay: 80ms')}>
          <h2 style={s('margin: 0 0 4px 4px; font-size: 15px; font-weight: 800; color: #5F5A55')}>{plural(accepted.length, 'friend')}</h2>
          {list.map((friend) => {
            return (
              <Link key={friend.id} href={`/friends/${encodeURIComponent(friend.id)}`} className={friend.id === fresh ? 'row pop' : 'row'} style={s(ROW)}>
                <Avatar id={friend.id} name={friend.name} size={46} />
                <span style={s('flex: 1; display: flex; flex-direction: column')}><span style={s('font-size: 16px; font-weight: 900')}>{friend.name}</span><span style={s('font-size: 13px; font-weight: 700; color: #5F5A55')}>{friend.id === fresh ? 'Just added' : 'Schedule available'}</span></span>
                <Svg size={18} sw={2.6} stroke="#8A847E">{ICON.right}</Svg>
              </Link>
            );
          })}
          {outgoing.map((friend) => (
            <div key={friend.id} className="row" style={s(ROW)}>
              <Avatar id={friend.id} name={friend.name} size={46} sharing={false} />
              <span style={s('flex: 1; display: flex; flex-direction: column')}><span style={s('font-size: 16px; font-weight: 900')}>{friend.name}</span><span style={s('font-size: 13px; font-weight: 700; color: #5F5A55')}>Request sent</span></span>
              <button type="button" onClick={() => void removeFriend(friend.id)} style={s('min-height: 32px; padding: 0 4px; border: none; background: transparent; color: #3D3936; font-size: 13px; font-weight: 900; cursor: pointer')}>Cancel</button>
            </div>
          ))}
          {friends.length === 0 && <EmptyNote>No friends yet. Send a request to start comparing schedules.</EmptyNote>}
        </section>
      </main>
    </Frame>
  );
}
