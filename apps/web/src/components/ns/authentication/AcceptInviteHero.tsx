'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/app-urls';
import RevealAnimation from '../animation/RevealAnimation';
import { toastError } from '@/lib/toast';

type Invite = { organizationName: string; email: string; role: string; needsPassword: boolean };

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; details?: { issues?: { message?: string }[] } };
  };
  return data.error?.details?.issues?.[0]?.message ?? data.error?.message ?? fallback;
}

const AcceptInviteHero = () => {
  const token = useSearchParams().get('token') ?? '';
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(token ? null : 'This invitation link is missing its token.');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/orgs/invites/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, 'This invitation is invalid or has expired.'));
        setInvite((await res.json()) as Invite);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (invite?.needsPassword && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`${API_URL}/orgs/invites/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          ...(invite?.needsPassword ? { password, name: name || undefined } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not accept the invitation.'));
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
      toastError(err, 'Could not accept the invitation.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="lg:pt-[180px] pt-[120px] lg:pb-[100px] pb-[70px]">
      <div className="main-container">
        <RevealAnimation delay={0.1}>
          <div className="max-w-[480px] mx-auto bg-background-1 dark:bg-background-6 rounded-[20px] py-14 px-8">
            <h1 className="text-heading-5 font-medium text-foreground mb-6">Join your team</h1>
            {loadError ? (
              <p className="text-tagline-2 text-destructive" role="alert">
                {loadError}
              </p>
            ) : !invite ? (
              <p className="text-tagline-2 text-foreground">Loading your invitation…</p>
            ) : done ? (
              <>
                <p className="text-tagline-2 text-foreground mb-6">
                  You&apos;ve joined {invite.organizationName}. Log in as {invite.email} to get started.
                </p>
                <a
                  href="/login"
                  className="btn btn-md btn-primary hover:btn-secondary dark:hover:btn-accent w-full before:content-none first-letter:uppercase inline-flex justify-center"
                >
                  Go to log in
                </a>
              </>
            ) : (
              <form onSubmit={onSubmit}>
                <p className="text-tagline-2 text-foreground mb-6">
                  You&apos;ve been invited to join <strong>{invite.organizationName}</strong> as {invite.role}, using{' '}
                  {invite.email}.
                </p>
                {invite.needsPassword ? (
                  <>
                    <fieldset className="space-y-2 mb-4">
                      <label htmlFor="name" className="block text-tagline-2 font-medium text-foreground select-none">
                        Your name
                      </label>
                      <input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="auth-form-input"
                        placeholder="Optional"
                      />
                    </fieldset>
                    <fieldset className="space-y-2 mb-4">
                      <label htmlFor="password" className="block text-tagline-2 font-medium text-foreground select-none">
                        Choose a password
                      </label>
                      <input
                        type="password"
                        id="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="auth-form-input"
                        placeholder="8+ characters, upper, lower, number, symbol"
                      />
                    </fieldset>
                    <fieldset className="space-y-2 mb-4">
                      <label htmlFor="confirm" className="block text-tagline-2 font-medium text-foreground select-none">
                        Confirm password
                      </label>
                      <input
                        type="password"
                        id="confirm"
                        required
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        className="auth-form-input"
                      />
                    </fieldset>
                  </>
                ) : null}
                {error ? (
                  <p className="text-tagline-2 text-destructive mb-2" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={pending}
                  className="btn btn-md btn-primary hover:btn-secondary dark:hover:btn-accent w-full before:content-none first-letter:uppercase disabled:opacity-60 mt-2"
                >
                  {pending ? 'Joining…' : 'Accept invitation'}
                </button>
              </form>
            )}
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default AcceptInviteHero;
