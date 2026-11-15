'use client';

import Link from 'next/link';
import {useState} from 'react';
import {Chevron, Screen, field, secondary} from '@/components/screen';
import {acceptFriend, myFriendCode, removeFriend, sendFriendRequest, useFriends} from '@/lib/data/friends';
import {useRemote} from '@/lib/data/local-store';
import {IS_MOCK} from '@/lib/supabase';

const link = 'text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent';
const row = 'surface flex flex-wrap items-center justify-between gap-2 text-sm';

export default function FriendsPage() {
  const friends = useFriends();
  const myCode = useRemote<string | null>('my_friend_code', null, myFriendCode);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pending = friends.filter((f) => f.status !== 'accepted');
  const accepted = friends.filter((f) => f.status === 'accepted');
  const run = async (action: Promise<string | null>) => setError(await action);

  return (
    <Screen title="Friends" back={{href: '/', label: 'Back to schedule'}} description="Schedules are private until you share them. GPA is never shared.">
      {!IS_MOCK && (
        <div className="surface mt-3 text-xs">
          <p className="text-neutral-600">Your friend code. Share it so a friend can send you a request.</p>
          <p className="mt-1 select-all break-all font-mono">{myCode ?? '…'}</p>
        </div>
      )}

      <h2 className="section-title mt-4 mb-2">Requests</h2>
      {pending.length === 0 && <p className="py-2 text-sm text-neutral-600">No pending requests.</p>}
      <ul className="space-y-2">
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
        className="surface mt-2 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await sendFriendRequest(input);
          setError(err);
          if (!err) setInput('');
        }}
      >
        <label className="block min-w-28 flex-1 text-sm font-extrabold">
          {IS_MOCK ? 'Add a friend' : "Add a friend by their code"}
          <input name="friend" value={input} onChange={(e) => setInput(e.target.value)} placeholder={IS_MOCK ? 'Name' : 'Friend code'} autoComplete="off" className={field} />
        </label>
        <button type="submit" className={`${secondary} min-h-12`}>
          Send request
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-xs text-accent">
          {error}
        </p>
      )}

      <h2 className="section-title mt-6 mb-2">Your friends</h2>
      {accepted.length === 0 && <p className="py-2 text-sm text-neutral-600">No friends yet.</p>}
      <ul className="space-y-2">
        {accepted.map((f) => (
          <li key={f.id} className="surface text-sm">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/friends/${encodeURIComponent(f.id)}`} className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl text-left font-black">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-900">{f.name.trim().slice(0, 1).toUpperCase()}</span>
                <span className="wrap-anywhere">{f.name}</span>
                <span className="shrink-0 text-neutral-500"><Chevron /></span>
              </Link>
              <button type="button" className={link} onClick={() => run(removeFriend(f.id))}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Link href="/friends/sharing" className={`${secondary} mt-4 w-full`}>Sharing settings</Link>
    </Screen>
  );
}
