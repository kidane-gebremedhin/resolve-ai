'use client';

import { useState, type FormEvent } from 'react';
import { API_URL } from '@/lib/app-urls';
import RevealAnimation from '../animation/RevealAnimation';

const ForgotPasswordHero = () => {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('request failed');
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="lg:pt-[180px] pt-[120px] lg:pb-[100px] pb-[70px]">
      <div className="main-container">
        <RevealAnimation delay={0.1}>
          <div className="max-w-[480px] mx-auto bg-background-1 dark:bg-background-6 rounded-[20px] py-14 px-8">
            <h1 className="text-heading-5 font-medium text-foreground mb-2">Forgot your password?</h1>
            <p className="text-tagline-2 text-foreground/70 mb-6">
              Enter your account email and we&apos;ll send you a link to reset it.
            </p>
            {sent ? (
              <div>
                <p className="text-tagline-2 text-foreground mb-6">
                  If an account exists for <span className="font-medium">{email}</span>, a password reset
                  link is on its way. Check your inbox (and spam) — the link expires in 1 hour.
                </p>
                <a
                  href="/login"
                  className="btn btn-md btn-primary hover:btn-secondary dark:hover:btn-accent w-full before:content-none first-letter:uppercase inline-flex justify-center"
                >
                  Back to log in
                </a>
              </div>
            ) : (
              <form onSubmit={onSubmit}>
                <fieldset className="space-y-2 mb-4">
                  <label htmlFor="email" className="block text-tagline-2 font-medium text-foreground select-none">
                    Your email
                  </label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="auth-form-input"
                    placeholder="Email address"
                  />
                </fieldset>
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
                  {pending ? 'Sending…' : 'Send reset link'}
                </button>
                <p className="text-center text-tagline-2 text-foreground font-normal mt-6">
                  <a href="/login" className="footer-link-v2 font-medium">Back to log in</a>
                </p>
              </form>
            )}
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default ForgotPasswordHero;
