'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { API_URL } from '@/lib/app-urls';
import RevealAnimation from '../animation/RevealAnimation';
import { toastError } from '@/lib/toast';

const ResetPasswordHero = () => {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'This reset link is invalid or has expired.');
      }
      setDone(true);
    } catch (err) {
      toastError(err, 'Could not reset your password.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="lg:pt-[180px] pt-[120px] lg:pb-[100px] pb-[70px]">
      <div className="main-container">
        <RevealAnimation delay={0.1}>
          <div className="max-w-[480px] mx-auto bg-background-1 dark:bg-background-6 rounded-[20px] py-14 px-8">
            <h1 className="text-heading-5 font-medium text-foreground mb-6">Choose a new password</h1>
            {!token ? (
              <p className="text-tagline-2 text-destructive">
                This reset link is missing its token. Please request a new link from the{' '}
                <a href="/forgot-password" className="footer-link-v2 font-medium">forgot password</a> page.
              </p>
            ) : done ? (
              <div>
                <p className="text-tagline-2 text-foreground mb-6">
                  Your password has been reset. You can now log in with your new password.
                </p>
                <a
                  href="/login"
                  className="btn btn-md btn-primary hover:btn-secondary dark:hover:btn-accent w-full before:content-none first-letter:uppercase inline-flex justify-center"
                >
                  Go to log in
                </a>
              </div>
            ) : (
              <form onSubmit={onSubmit}>
                <fieldset className="space-y-2 mb-4">
                  <label htmlFor="password" className="block text-tagline-2 font-medium text-foreground select-none">
                    New password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="auth-form-input pr-11"
                      placeholder="At least 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute inset-y-0 right-3 my-auto flex h-fit items-center text-foreground/60 hover:text-foreground"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </fieldset>
                <fieldset className="space-y-2 mb-4">
                  <label htmlFor="confirm" className="block text-tagline-2 font-medium text-foreground select-none">
                    Confirm password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="confirm"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="auth-form-input"
                    placeholder="Re-enter your new password"
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
                  {pending ? 'Resetting…' : 'Reset password'}
                </button>
              </form>
            )}
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default ResetPasswordHero;
