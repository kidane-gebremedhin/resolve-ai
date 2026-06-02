'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import RevealAnimation from '../animation/RevealAnimation';
import SocialAuth from './SocialAuth';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const SignupHero = () => {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, organizationName: name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message ?? 'Could not create your account.');
        setPending(false);
        return;
      }
      const signInResult = await signIn('credentials', { email, password, redirect: false });
      setPending(false);
      if (signInResult?.error) {
        setError('Account created, but auto-login failed. Please log in.');
        router.push('/login');
        return;
      }
      router.push('/app');
    } catch {
      setError('Network error. Try again.');
      setPending(false);
    }
  }

  return (
    <section className="lg:pt-[180px] pt-[120px] lg:pb-[100px] pb-[70px]">
      <div className="main-container">
        <RevealAnimation delay={0.1}>
          <div className="max-w-[400px] mx-auto bg-background-1 dark:bg-background-6 rounded-[20px] py-14 px-8">
            <form onSubmit={onSubmit}>
              <fieldset className="space-y-2 mb-4">
                <label htmlFor="organization" className="block text-tagline-2 font-medium text-foreground select-none">
                  Organization Name
                </label>
                <input
                  type="text"
                  id="organization"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="auth-form-input"
                />
              </fieldset>
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
              <fieldset className="space-y-2 mb-4">
                <label htmlFor="password" className="block text-tagline-2 font-medium text-foreground select-none">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    required
                    minLength={8}
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
              <fieldset className="space-y-2 mb-3">
                <label htmlFor="confirm-password" className="block text-tagline-2 font-medium text-foreground select-none">
                  Confirm Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="confirm-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="auth-form-input"
                  placeholder="Re-enter your password"
                />
              </fieldset>
              {error ? (
                <p className="text-tagline-2 text-destructive mt-2" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="mt-8">
                <button
                  type="submit"
                  disabled={pending}
                  className="btn btn-md btn-primary hover:btn-secondary dark:hover:btn-accent w-full before:content-none first-letter:uppercase disabled:opacity-60"
                >
                  {pending ? 'Creating…' : 'Sign up'}
                </button>
              </div>
            </form>
            <div className="py-8 text-center">
              <p className="text-tagline-2 font-normal text-foreground">Or</p>
            </div>
            <SocialAuth />
            <p className="text-center text-tagline-2 text-foreground/60 mt-4">
              Already have an account?{' '}
              <a href="/login" className="text-primary-500 font-medium hover:underline">Log in</a>
            </p>
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default SignupHero;
