import {IS_MOCK, supabase} from '../supabase';
import {useRemote, useStore, writeStore} from './local-store';

/** Who is signed in. The name is the one typed at sign-up, kept in the Supabase Auth user metadata. */
export type Account = {name: string | null; email: string | null};

const KEY = 'digree.account';
const NOBODY: Account = {name: null, email: null};
// Mock mode has no account, so it shows the persona from the design file.
const SAMPLE: Account = {name: 'Taylor Kim', email: 'netid@wisc.edu'};

async function fetchAccount(): Promise<Account> {
  const {data} = await supabase().auth.getUser();
  const name = data.user?.user_metadata?.name;
  return {name: typeof name === 'string' && name.trim() ? name.trim() : null, email: data.user?.email ?? null};
}

export const useAccount: () => Account = IS_MOCK ? () => useStore(KEY, SAMPLE) : () => useRemote(KEY, NOBODY, fetchAccount);

/** Mock mode only: remember what was typed on the sign-up screen. */
export function saveSampleAccount(account: Account): void {
  writeStore(KEY, {name: account.name || SAMPLE.name, email: account.email || SAMPLE.email});
}

export const displayName = (account: Account) => account.name ?? account.email?.split('@')[0] ?? 'You';

/** "Taylor Kim" -> "TK"; falls back to the first letters of the email. */
export function initials(name: string | null | undefined, fallback = ''): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words.at(-1)![0]).toUpperCase();
  const single = words[0] ?? fallback.split('@')[0];
  return single.slice(0, 2).toUpperCase();
}
