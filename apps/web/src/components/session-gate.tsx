'use client';

import {usePathname, useRouter} from 'next/navigation';
import {useEffect} from 'react';
import {resetRemote} from '@/lib/data/local-store';
import {shouldOnboard} from '@/lib/data/profile';
import {IS_MOCK, supabase} from '@/lib/supabase';

/**
 * Client-side routing guard. Renders nothing.
 * Real mode: no session -> /login. Both modes: no academic profile -> /onboarding.
 * This only steers navigation; the data itself is protected by Row Level Security.
 */
export function SessionGate() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let stale = false;
    (async () => {
      const onLogin = pathname === '/login';
      if (!IS_MOCK) {
        const {data} = await supabase().auth.getSession();
        if (stale) return;
        if (!data.session) return onLogin ? undefined : router.replace('/login');
        if (onLogin) return router.replace('/');
      }
      // Mock mode has no session, so the log-in screen stays reachable as a plain screen.
      if (!onLogin && !pathname.startsWith('/onboarding') && await shouldOnboard() && !stale) router.replace('/onboarding');
    })().catch((error) => console.error('Checking the session failed', error));
    return () => {
      stale = true;
    };
  }, [pathname, router]);
  return null;
}

/** Ends the session and clears everything cached for the account. Mock mode has no session to end. */
export async function signOut(): Promise<void> {
  if (IS_MOCK) return;
  await supabase().auth.signOut();
  resetRemote();
}
