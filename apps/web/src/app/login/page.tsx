'use client';

import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {AppIcon, Frame, Wordmark} from '@/components/dg';
import {saveSampleAccount} from '@/lib/data/account';
import {resetRemote} from '@/lib/data/local-store';
import {IS_MOCK, supabase} from '@/lib/supabase';
import {s} from '@/lib/ui/css';
import {isExistingSignup, normalizeEmail} from '@/lib/auth-signup';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}
@keyframes plant{0%{transform:translateY(-40px) rotate(-12deg);opacity:0}55%{transform:translateY(6px) rotate(4deg);opacity:1}75%{transform:translateY(-2px) rotate(-2deg)}100%{transform:none}}
.rise{animation:fadeUp 480ms cubic-bezier(.2,.9,.25,1) both}
.plant{animation:plant 900ms cubic-bezier(.2,.9,.25,1) both}
.field{width:100%;height:54px;box-sizing:border-box;padding:0 16px;border:2px solid transparent;border-radius:18px;background:#FFFFFF;color:#1D1B1A;font-size:16px;font-weight:700;box-shadow:0 1px 3px rgba(40,20,20,.08);outline:none;transition:border-color 200ms ease, box-shadow 200ms ease}
.field:focus{border-color:#1D1B1A;box-shadow:0 0 0 4px rgba(29,27,26,.08)}
.field::placeholder{color:#8A847E;font-weight:600}
.cta{transition:transform 160ms ease, box-shadow 200ms ease}
.cta:active{transform:scale(.97)}
`;

const SIGNUP_DOMAIN = '@wisc.edu';
const LABEL = 'display: flex; flex-direction: column; gap: 6px';
const CAPTION = 'font-size: 14px; font-weight: 800; padding-left: 4px';
const CTA = 'margin-top: 6px; height: 58px; border: none; cursor: pointer; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30)';
const tab = (on: boolean) => `position: relative; z-index: 1; height: 44px; border: none; background: transparent; font-size: 15px; font-weight: 900; cursor: pointer; transition: color 260ms ease; color: ${on ? '#1D1B1A' : '#6E6863'}`;

// Email + password via Supabase Auth. Sample mode has no accounts: the buttons simply lead on.
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{text: string; error: boolean} | null>(null);
  const login = mode === 'login';
  const fail = (text: string) => setMessage({text, error: true});

  async function submit() {
    if (busy) return;
    setMessage(null);
    const address = normalizeEmail(email);
    if (IS_MOCK) {
      if (!login) saveSampleAccount({name: name.trim() || null, email: address || null});
      return router.replace(login ? '/' : '/onboarding');
    }
    if (!login && !address.toLowerCase().endsWith(SIGNUP_DOMAIN)) return fail('Only @wisc.edu emails can join.');
    if (!login && password.length < 8) return fail('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      const {data, error} = login
        ? await supabase().auth.signInWithPassword({email: address, password})
        : await supabase().auth.signUp({email: address, password, options: {data: {name: name.trim()}}});
      if (error) fail(error.code === 'user_already_exists' ? 'An account already exists for this email. Log in or reset your password.' : error.message);
      else if (!login && isExistingSignup(data.user)) fail('An account already exists for this email. Log in or reset your password.');
      else if (data.session) {
        resetRemote(); // nothing cached from a previous account
        router.replace(login ? '/' : '/onboarding');
      } else setMessage({text: 'Check your email to confirm your account, then log in.', error: false}); // sign-up with email confirmation on
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (busy) return;
    const address = email.trim();
    if (IS_MOCK) return setMessage({text: 'Sample mode has no password. Tap Log in.', error: false});
    if (!address) return fail('Enter your UW email first.');
    setBusy(true);
    try {
      const {error} = await supabase().auth.resetPasswordForEmail(address);
      if (error) fail(error.message);
      else setMessage({text: `We sent a reset link to ${address}.`, error: false});
    } finally {
      setBusy(false);
    }
  }

  const pick = (next: 'login' | 'signup') => {
    setMode(next);
    setMessage(null);
  };

  return (
    <Frame css={CSS} extra="padding: 0 24px 28px">
      <div style={s('flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding-top: 20px')}>
        <AppIcon className="plant" style="width: 92px; height: 92px" />
        <Wordmark className="rise" style="font-size: 44px; font-weight: 900; letter-spacing: -0.03em; line-height: 1; animation-delay: 200ms" />
        <span className="rise" style={s('font-size: 17px; font-weight: 700; color: #5F5A55; text-align: center; animation-delay: 280ms')}>Classes, schedules and GPA for UW–Madison</span>
      </div>

      <form className="rise" noValidate onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }} style={s('display: flex; flex-direction: column; gap: 14px; animation-delay: 360ms')}>
        <div role="tablist" aria-label="Account" style={s('position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 4px; border-radius: 22px; background: #ECE8E3')}>
          <span aria-hidden="true" style={s(`position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 18px; background: #FFFFFF; box-shadow: 0 2px 8px rgba(40,20,20,0.10); transition: transform 380ms cubic-bezier(.2,.9,.25,1.15); transform: translateX(${login ? '0' : '100%'})`)} />
          <button type="button" role="tab" aria-selected={login} onClick={() => pick('login')} style={s(tab(login))}>Log in</button>
          <button type="button" role="tab" aria-selected={!login} onClick={() => pick('signup')} style={s(tab(!login))}>Sign up</button>
        </div>

        <div style={s(`overflow: hidden; transition: max-height 380ms cubic-bezier(.2,.9,.25,1), opacity 260ms ease, margin 380ms ease; ${login ? 'max-height: 0; opacity: 0; margin-bottom: -14px' : 'max-height: 100px; opacity: 1; margin-bottom: 0'}`)}>
          <label style={s(LABEL)}><span style={s(CAPTION)}>Name</span><input className="field" type="text" name="name" autoComplete="name" placeholder="What should we call you?" value={name} onChange={(event) => setName(event.target.value)} tabIndex={login ? -1 : 0} /></label>
        </div>
        <label style={s(LABEL)}><span style={s(CAPTION)}>UW email</span><input className="field" type="email" name="email" autoComplete="email" placeholder="netid@wisc.edu" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label style={s(LABEL)}><span style={s(CAPTION)}>Password</span><input className="field" type="password" name="password" autoComplete={login ? 'current-password' : 'new-password'} placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} /></label>

        {message && <span role={message.error ? 'alert' : 'status'} style={s(`align-self: center; text-align: center; font-size: 13px; font-weight: 700; color: ${message.error ? '#8C1D2B' : '#5F5A55'}`)}>{message.text}</span>}

        {login ? (
          <>
            <button type="submit" className="cta" disabled={busy} style={s(CTA)}>Log in</button>
            <button type="button" onClick={() => void forgot()} style={s('align-self: center; min-height: 40px; border: none; background: transparent; color: #3D3936; font-size: 14px; font-weight: 800; cursor: pointer')}>Forgot password?</button>
          </>
        ) : (
          <>
            <button type="submit" className="cta" disabled={busy} style={s(CTA)}>Create account</button>
            <span style={s('align-self: center; min-height: 40px; display: flex; align-items: center; font-size: 13px; font-weight: 700; color: #5F5A55')}>Only @wisc.edu emails can join.</span>
          </>
        )}
      </form>
    </Frame>
  );
}
