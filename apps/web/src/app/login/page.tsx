'use client';

import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {AuthBrand} from '@/components/brand';
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
    <main className="app-frame flex flex-col px-6 py-8 sm:py-12">
      <div className="grid flex-1 place-items-center py-6">
        <AuthBrand />
      </div>
      <div className="mx-auto w-full max-w-sm">
        <div role="group" aria-label="Account" className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-neutral-100 p-1">
          {(['signin', 'signup'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              disabled={busy}
              className="min-h-11 rounded-full text-sm font-extrabold text-neutral-600 aria-pressed:bg-white aria-pressed:text-neutral-900 aria-pressed:shadow-card"
              onClick={() => {
                if (mode === option) return;
                setMode(option);
                setError(null);
                setNotice(null);
              }}
            >
              {option === 'signin' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
        >
          <label className="block text-sm font-extrabold">
            Email
            <input name="email" type="email" required autoComplete="email" placeholder="name@wisc.edu" className={field} />
          </label>
          <label className="block text-sm font-extrabold">
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
        <p className="mt-6 text-center text-xs text-neutral-600">DIGREE is a planning tool. It does not register you for courses or verify enrollment.</p>
      </div>
    </main>
  );
}
