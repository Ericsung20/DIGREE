'use client';

import {useState} from 'react';
import {EmptyState, Screen, field} from '@/components/screen';
import {VISIBILITY_LABEL, setMyVisibility, useFriends, type Visibility} from '@/lib/data/friends';

export default function SharingPage() {
  const friends = useFriends().filter((friend) => friend.status === 'accepted');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title="Sharing settings" back={{href: '/friends', label: 'Back to friends'}}
      description="Your schedule starts private. Choose what each friend can see.">
      {!friends.length && <EmptyState title="No friends yet" body="Sharing options appear when a friend request is accepted." />}
      <ul className="space-y-2">
        {friends.map((friend) => <li key={friend.id} className="surface">
          <label className="block text-sm font-extrabold">{friend.name} can see
            <select className={field} value={friend.myVisibility} disabled={busy === friend.id} onChange={async (event) => {
              setBusy(friend.id);
              setError(null);
              try {setError(await setMyVisibility(friend.id, event.target.value as Visibility));}
              catch {setError('Couldn’t save your sharing setting.');}
              finally {setBusy(null);}
            }}>
              {Object.entries(VISIBILITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </li>)}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-accent">{error}</p>}
    </Screen>
  );
}
