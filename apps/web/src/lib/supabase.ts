import {createBrowserClient} from '@supabase/ssr';
import type {SupabaseClient} from '@supabase/supabase-js';

/**
 * Data source switch. Anything but "supabase" means mock: no sign-in, data in localStorage.
 * Separate from DIGREE_MOCK (the optimizer mock) so the database can go live first.
 */
export const IS_MOCK = process.env.NEXT_PUBLIC_DIGREE_DATA !== 'supabase';

let client: SupabaseClient | undefined;

/**
 * Browser client using the public anon key. Every request carries the signed-in user's session,
 * so Row Level Security decides what they can read or write. Never use the service-role key here.
 */
export function supabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, or run with DIGREE_MOCK=1');
  return (client ??= createBrowserClient(url, key));
}
