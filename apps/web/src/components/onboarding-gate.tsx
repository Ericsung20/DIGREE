'use client';

import {usePathname, useRouter} from 'next/navigation';
import {useEffect} from 'react';
import {secondary} from '@/components/screen';
import {resetRemote} from '@/lib/data/local-store';
import {hasProfile} from '@/lib/data/profile';
import {IS_MOCK, supabase} from '@/lib/supabase';

/**
 * Client-side routing guard. Renders nothing.
 * Real mode: no session -> /login. Both modes: no academic profile -> /onboarding.
 * This only steers navigation; the data itself is protected by Row Level Security.
 */
export function OnboardingGate() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let stale = false;
    (async () => {
      const onLogin = pathname === '/login';
      if (IS_MOCK) {
        if (onLogin) return router.replace('/');
      } else {
        const {data} = await supabase().auth.getSession();
        if (stale) return;
        if (!data.session) return onLogin ? undefined : router.replace('/login');
        if (onLogin) return router.replace('/');
      }
      if (!pathname.startsWith('/onboarding') && !hasProfile()) router.replace('/onboarding');
    })();
    return () => {
      stale = true;
    };
  }, [pathname, router]);
  return null;
}

/** Shown on Profile in real mode only; mock mode has no account to leave. */
export function SignOutButton() {
  const router = useRouter();
  if (IS_MOCK) return null;
  return (
    <button
      type="button"
      className={`${secondary} mt-8 w-full`}
      onClick={async () => {
        await supabase().auth.signOut();
        resetRemote();
        router.replace('/login');
      }}
    >
      Sign out
    </button>
  );
}
