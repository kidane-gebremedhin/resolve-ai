'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input, Label } from '@csb/ui';
import { Logo } from '@/components/site/Logo';
import { toast } from '@/lib/toast';

const SSO_ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'Access denied. This portal is restricted to platform administrators.',
  Configuration: 'Sign-in failed. If you used Google SSO, your account may not have platform administrator privileges.',
  OAuthSignin: 'Google sign-in could not be initiated. Please try again.',
  OAuthCallback: 'Google sign-in callback failed. Please try again.',
  OAuthCreateAccount: 'Could not complete Google sign-in. Please try again.',
  OAuthAccountNotLinked: 'An account with this email already exists with different sign-in credentials.',
  Default: 'Sign-in failed. Please try again.',
};

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');
  const urlErrorMessage = urlError
    ? (SSO_ERROR_MESSAGES[urlError] ?? SSO_ERROR_MESSAGES.Default)
    : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  // Shown only once the API reports this account has 2FA — most accounts do
  // not, and asking everyone for a code up front would just confuse them.
  const [totpRequired, setTotpRequired] = useState(false);
  const [code, setCode] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await signIn('credentials', { email, password, code, redirect: false });
    setPending(false);

    if (res?.code === 'totp_required') {
      // The password was correct — this is a prompt, not a failure.
      setTotpRequired(true);
      toast.info('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (res?.code === 'invalid_totp') {
      setTotpRequired(true);
      setCode('');
      toast.error('That code is not valid. Try again, or use a recovery code.');
      return;
    }
    if (res?.error) {
      toast.error('Invalid email or password.');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-sm">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
            Admin
          </span>
        </div>
        <h1 className="mt-5 font-display text-xl font-semibold">Platform sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Restricted to platform administrators.</p>

        {urlErrorMessage && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {urlErrorMessage}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {totpRequired && (
            <div className="space-y-1.5">
              <Label htmlFor="code">Two-factor code</Label>
              <Input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                placeholder="123456"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={32}
                className="tracking-[0.3em]"
              />
              <p className="text-xs text-muted-foreground">
                From your authenticator app, or one of your recovery codes.
              </p>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : totpRequired ? 'Verify code' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          onClick={() => signIn('google', { callbackUrl: '/' })}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </Button>

      </div>
    </div>
  );
}
