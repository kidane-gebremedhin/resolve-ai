'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import RevealAnimation from '../animation/RevealAnimation';
import SocialAuth from './SocialAuth';

const LoginHero = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `from` is set by the client-side auto-logout when an API call returns
  // "Invalid or expired access token"; honour it as the post-login destination.
  const fromExpired = searchParams.get('from');
  const callbackUrl = fromExpired ?? searchParams.get('callbackUrl') ?? '/app';
  const sessionExpired = searchParams.get('session') === 'expired';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(
    sessionExpired ? 'Your session expired. Please log in again.' : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });
    setPending(false);
    if (!result || result.error) {
      setError('Invalid email or password.');
      return;
    }
    router.push(callbackUrl);
  }

  return (
    <section className="lg:pt-[180px] pt-[120px] lg:pb-[100px] pb-[70px]">
      <div className="main-container">
        <RevealAnimation delay={0.1}>
          <div className="max-w-[480px] mx-auto bg-background-1 dark:bg-background-6 rounded-[20px] py-14 px-8">
            <form className="mb-6" onSubmit={onSubmit}>
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
              <fieldset className="space-y-2 mb-3">
                <label htmlFor="password" className="block text-tagline-2 font-medium text-foreground select-none">
                  Password
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
                    tabIndex={-1}
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-3 my-auto flex h-fit items-center text-foreground/60 hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </fieldset>
              {error ? (
                <p className="text-tagline-2 text-destructive mt-2" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center justify-between">
                <div>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="terms" className="peer sr-only" />
                    <span className="size-5 rounded-full border border-stroke-3 dark:border-stroke-7 relative after:absolute after:size-3 after:bg-primary-500 after:rounded-full after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:opacity-0 peer-checked:after:opacity-100 peer-checked:border-primary-500 cursor-pointer" />
                    <span className="text-tagline-2 text-foreground font-medium select-none">Remember me</span>
                  </label>
                </div>
                <div>
                  <a href="/forgot-password" className="text-tagline-2 text-foreground font-medium underline">Forgot password?</a>
                </div>
              </div>
              <div className="mt-8">
                <button
                  type="submit"
                  disabled={pending}
                  className="btn btn-md btn-primary hover:btn-secondary dark:hover:btn-accent w-full before:content-none first-letter:uppercase disabled:opacity-60"
                >
                  {pending ? 'Logging in…' : 'Log In'}
                </button>
              </div>
            </form>
            <div>
              <p className="text-center text-tagline-2 text-foreground font-normal flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
                <span className="whitespace-nowrap">Not registered yet?</span>
                <a href="/register" className="whitespace-nowrap text-tagline-1 font-medium footer-link-v2">Create an Account</a>
              </p>
              <div className="py-8 text-center">
                <p className="text-tagline-2 font-normal text-foreground">Or</p>
              </div>
              <SocialAuth />
            </div>
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default LoginHero;
