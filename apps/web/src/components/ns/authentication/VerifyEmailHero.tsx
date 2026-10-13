'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/app-urls';
import RevealAnimation from '../animation/RevealAnimation';

type State = 'pending' | 'done' | 'failed';

const VerifyEmailHero = () => {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>(token ? 'pending' : 'failed');
  const [message, setMessage] = useState('This link is missing its token.');
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    fetch(`${API_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (res.ok) return setState('done');
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setMessage(data.error?.message ?? 'This verification link is invalid or has expired.');
        setState('failed');
      })
      .catch(() => {
        setMessage('We could not reach the server. Please try again.');
        setState('failed');
      });
  }, [token]);

  return (
    <section className="lg:pt-[180px] pt-[120px] lg:pb-[100px] pb-[70px]">
      <div className="main-container">
        <RevealAnimation delay={0.1}>
          <div className="max-w-[480px] mx-auto bg-background-1 dark:bg-background-6 rounded-[20px] py-14 px-8">
            <h1 className="text-heading-5 font-medium text-foreground mb-6">Confirm your email</h1>
            {state === 'pending' ? (
              <p className="text-tagline-2 text-foreground">Confirming your email address…</p>
            ) : state === 'done' ? (
              <>
                <p className="text-tagline-2 text-foreground mb-6">Your email address is confirmed.</p>
                <a
                  href="/app"
                  className="btn btn-md btn-primary hover:btn-secondary dark:hover:btn-accent w-full before:content-none first-letter:uppercase inline-flex justify-center"
                >
                  Continue
                </a>
              </>
            ) : (
              <p className="text-tagline-2 text-destructive" role="alert">
                {message}
              </p>
            )}
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default VerifyEmailHero;
