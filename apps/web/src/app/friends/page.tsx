'use client';

import {useState} from 'react';
import {Screen, field, secondary} from '@/components/screen';
import {WeeklyTimetable} from '@/components/weekly-timetable';
import {currentTermOf, useTerms} from '@/lib/data/catalog';
import {VISIBILITY_LABEL, acceptFriend, loadFriendSchedule, myFriendCode, removeFriend, sendFriendRequest, setMyVisibility, useFriends, type Friend, type FriendScheduleView, type Visibility} from '@/lib/data/friends';
import {useRemote} from '@/lib/data/local-store';
import {IS_MOCK} from '@/lib/supabase';

const link = 'text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent';
const row = 'flex items-center justify-between gap-2 border-b border-neutral-200 py-2.5 text-sm';

export default function FriendsPage() {
  const friends = useFriends();
  const terms = useTerms();
  const term = currentTermOf(terms) ?? terms.at(-1)?.id ?? null;
  const myCode = useRemote<string | null>('my_friend_code', null, myFriendCode);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{id: string; view: FriendScheduleView | null} | null>(null);

  const pending = friends.filter((f) => f.status !== 'accepted');
  const accepted = friends.filter((f) => f.status === 'accepted');
  const shown = accepted.find((f) => f.id === open?.id); // closes by itself when the friend is removed
  const run = async (action: Promise<string | null>) => setError(await action);

  async function toggle(f: Friend) {
    if (open?.id === f.id) return setOpen(null);
    setOpen({id: f.id, view: null});
    const view = await loadFriendSchedule(f, term);
    setOpen((now) => (now?.id === f.id ? {id: f.id, view} : now));
  }

  return (
    <Screen title="Friends">
      <p className="text-xs text-neutral-600">Schedules are private until you share them. GPA is never shared.</p>

      {!IS_MOCK && (
        <div className="mt-3 rounded-xl bg-neutral-100 p-3 text-xs">
          <p className="text-neutral-600">Your friend code. Share it so a friend can send you a request.</p>
          <p className="mt-1 select-all break-all font-mono">{myCode ?? '…'}</p>
        </div>
      )}

      <h2 className="mt-4 text-sm font-semibold">Requests</h2>
      {pending.length === 0 && <p className="py-2 text-sm text-neutral-600">No pending requests.</p>}
      <ul>
        {pending.map((f) => (
          <li key={f.id} className={row}>
            <span className="font-semibold">{f.name}</span>
            {f.status === 'incoming' ? (
              <span className="flex gap-3">
                <button type="button" className={link} onClick={() => run(acceptFriend(f.id))}>
                  Accept
                </button>
                <button type="button" className={link} onClick={() => run(removeFriend(f.id))}>
                  Decline
                </button>
              </span>
            ) : (
              <span className="flex gap-3">
                <span className="text-neutral-600">Requested</span>
                <button type="button" className={link} onClick={() => run(removeFriend(f.id))}>
                  Cancel
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await sendFriendRequest(input);
          setError(err);
          if (!err) setInput('');
        }}
      >
        <label className="block flex-1 text-xs text-neutral-600">
          {IS_MOCK ? 'Add a friend' : "Add a friend by their code"}
          <input name="friend" value={input} onChange={(e) => setInput(e.target.value)} placeholder={IS_MOCK ? 'Name' : 'Friend code'} autoComplete="off" className={field} />
        </label>
        <button type="submit" className={secondary}>
          Send request
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-xs text-accent">
          {error}
        </p>
      )}

      <h2 className="mt-6 text-sm font-semibold">Your friends</h2>
      {accepted.length === 0 && <p className="py-2 text-sm text-neutral-600">No friends yet.</p>}
      <ul>
        {accepted.map((f) => (
          <li key={f.id} className="border-b border-neutral-200 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <button type="button" aria-expanded={open?.id === f.id} onClick={() => toggle(f)} className="font-semibold focus-visible:outline-2 focus-visible:outline-accent">
                {f.name}
              </button>
              <button type="button" className={link} onClick={() => run(removeFriend(f.id))}>
                Remove
              </button>
            </div>
            <label className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
              {f.name} can see
              <select
                aria-label={`What ${f.name} can see`}
                value={f.myVisibility}
                onChange={(e) => run(setMyVisibility(f.id, e.target.value as Visibility))}
                className="rounded-lg border border-neutral-300 bg-white px-1.5 py-1 text-xs text-neutral-900"
              >
                {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>

      {shown && open && (
        <section aria-label={`${shown.name}'s schedule`} className="mt-4 rounded-xl border border-neutral-200 p-3">
          <h2 className="text-sm font-semibold">{shown.name}</h2>
          {open.view === null && <p className="py-4 text-center text-sm text-neutral-600">Loading…</p>}
          {open.view?.access === 'none' && <p className="py-4 text-center text-sm text-neutral-600">{shown.name} hasn&apos;t shared a schedule with you.</p>}
          {open.view?.access === 'free_busy' && (
            <>
              <p className="mb-2 text-xs text-neutral-600">Free/busy only. Course names are hidden.</p>
              <WeeklyTimetable items={[{label: 'Busy', meetings: open.view.blocks}]} />
            </>
          )}
          {open.view?.access === 'full' && (
            <>
              <p className="mb-2 text-xs text-neutral-600">Full schedule, shared by {shown.name}. Self-reported, not verified by UW.</p>
              <WeeklyTimetable items={open.view.items} />
            </>
          )}
        </section>
      )}
    </Screen>
  );
}
