'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@csb/ui';
import { Logo } from '@/components/site/Logo';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn('credentials', { email, password, redirect: false });
    setPending(false);
    if (res?.error) {
      setError('Invalid email or password.');
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
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-4">
          <Button variant="outline" className="w-full" onClick={() => signIn('google', { callbackUrl: '/' })}>
            Continue with Google
          </Button>
        </div>
      </div>
    </div>
  );
}
