import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';

/**
 * Supabase client for server code (route handlers, server components). It carries the signed-in
 * user's session from the request cookies, so Row Level Security still applies. Anon key only.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({name, value, options}) => store.set(name, value, options));
        } catch {
          // Server components cannot write cookies; the browser client refreshes the session instead.
        }
      },
    },
  });
}
