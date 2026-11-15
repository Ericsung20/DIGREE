'use client';

import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {field, primary} from '@/components/screen';
import {resetRemote} from '@/lib/data/local-store';
import {supabase} from '@/lib/supabase';

// Email + password via Supabase Auth. In mock mode the session gate skips this page.
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(form: FormData) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const credentials = {email: String(form.get('email')), password: String(form.get('password'))};
    try {
      const {data, error} = mode === 'signin' ? await supabase().auth.signInWithPassword(credentials) : await supabase().auth.signUp(credentials);
      if (error) setError(error.message);
      else if (data.session) {
        resetRemote(); // nothing cached from a previous account
        router.replace('/');
      }
      else setNotice('Check your email to confirm your account, then sign in.'); // sign-up with email confirmation on
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 py-6">
      <div className="pt-16 text-center">
        <h1 className="text-3xl font-semibold">DIGREE</h1>
        <p className="mt-2 text-sm text-neutral-600">Plan your schedule around your week.</p>
      </div>
      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
      >
        <label className="block text-xs text-neutral-600">
          Email
          <input name="email" type="email" required autoComplete="email" placeholder="name@wisc.edu" className={field} />
        </label>
        <label className="block text-xs text-neutral-600">
          Password
          <input name="password" type="password" required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} className={field} />
        </label>
        {error && (
          <p role="alert" className="text-xs text-accent">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-xs text-neutral-600">
            {notice}
          </p>
        )}
        <button type="submit" disabled={busy} className={primary}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(null);
          setNotice(null);
        }}
        className="mt-4 w-full text-center text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
      <p className="mt-6 text-center text-xs text-neutral-600">DIGREE is a planning tool. It does not register you for courses or verify enrollment.</p>
    </main>
  );
}
