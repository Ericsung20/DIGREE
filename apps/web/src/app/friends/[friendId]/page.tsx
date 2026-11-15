'use client';

import Link from 'next/link';
import {useParams} from 'next/navigation';
import {useEffect, useState} from 'react';
import {EmptyState, Screen, secondary} from '@/components/screen';
import {WeeklyTimetable} from '@/components/weekly-timetable';
import {currentTermOf, useTerms} from '@/lib/data/catalog';
import {loadFriendSchedule, useFriends, type FriendScheduleView} from '@/lib/data/friends';

export default function FriendSchedulePage() {
  const {friendId} = useParams<{friendId: string}>();
  const friend = useFriends().find((item) => item.id === friendId && item.status === 'accepted');
  const terms = useTerms();
  const term = currentTermOf(terms);
  const key = `${friendId}:${term}:${friend?.theirVisibility}`;
  const [loaded, setLoaded] = useState<{key: string; view: FriendScheduleView} | null>(null);
  const view = loaded?.key === key ? loaded.view : null;
  useEffect(() => {
    if (!friend) return;
    let active = true;
    const load = () => {
      loadFriendSchedule(friend, term).then((schedule) => {
        if (active) setLoaded({key, view: schedule});
      }).catch(() => {
        if (active) setLoaded({key, view: {access: 'none'}});
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [friend, key, term]);
  return (
    <Screen title={friend ? `${friend.name}’s schedule` : 'Friend’s schedule'} back={{href: '/friends', label: 'Back to friends'}}
      description={terms.find((item) => item.id === term)?.label}>
      {!friend || view?.access === 'none' ? <EmptyState title="Schedule unavailable" body="This friend can share their schedule with you from Sharing settings." /> :
        !view ? <p role="status">Loading schedule…</p> :
        view.access === 'free_busy' ? <section className="surface"><p className="mb-3 text-sm">Free/busy times</p><WeeklyTimetable items={[{label: 'Busy', meetings: view.blocks}]} /></section> :
        <section className="surface"><WeeklyTimetable items={view.items} /></section>}
      <Link href="/friends/sharing" className={`${secondary} mt-4 w-full`}>Sharing settings</Link>
    </Screen>
  );
}
