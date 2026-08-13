'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { Eye, EyeOff, Check, X } from 'lucide-react';
import RevealAnimation from '../animation/RevealAnimation';
import SocialAuth from './SocialAuth';
import { API_URL as apiUrl } from '@/lib/app-urls';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

type PasswordStrength = {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
};

function checkPassword(pw: string): PasswordStrength {
  return {
    minLength: pw.length >= 8,
    hasUpper: /[A-Z]/.test(pw),
    hasLower: /[a-z]/.test(pw),
    hasNumber: /[0-9]/.test(pw),
    hasSpecial: /[^A-Za-z0-9]/.test(pw),
  };
}

const PASSWORD_RULES: { key: keyof PasswordStrength; label: string }[] = [
  { key: 'minLength', label: 'At least 8 characters' },
  { key: 'hasUpper', label: 'One uppercase letter' },
  { key: 'hasLower', label: 'One lowercase letter' },
  { key: 'hasNumber', label: 'One number' },
  { key: 'hasSpecial', label: 'One special character' },
];

const SignupHero = () => {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const pwStrength = checkPassword(password);
  const pwValid = Object.values(pwStrength).every(Boolean);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!pwValid) {
      setPasswordTouched(true);
      setError('Password does not meet the requirements below.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      // Capture affiliate (?ref=), marketing campaign (?campaign=), and the plan
      // (?plan=) the visitor picked on the pricing page. ref/campaign fall back to
      // the attribution cookies set on landing (AttributionCapture), so they
      // survive navigating pricing → register.
      const params =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const referralCode = params?.get('ref') ?? readCookie('csb_ref') ?? undefined;
      const campaignCode = params?.get('campaign') ?? readCookie('csb_campaign') ?? undefined;
      const plan = params?.get('plan') ?? undefined;
      const cycle = params?.get('cycle') ?? undefined;
      const res = await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, organizationName: name, referralCode, campaignCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error?.message ?? 'Could not create your account.');
        setPending(false);
        return;
      }
      const signInResult = await signIn('credentials', { email, password, redirect: false });
      setPending(false);
      if (signInResult?.error) {
        toast.warning('Account created, but auto-login failed. Please log in.');
        router.push('/login');
        return;
      }
      // New accounts have no subscription yet — go straight to checkout (the
      // /app dashboard is gated until a plan is active). Carry the chosen plan
      // so checkout opens that plan's Paddle overlay directly.
      const checkoutUrl = plan
        ? `/checkout?plan=${encodeURIComponent(plan)}${cycle ? `&cycle=${encodeURIComponent(cycle)}` : ''}`
        : '/checkout';
      router.push(checkoutUrl);
    } catch {
      toast.error('Network error. Try again.');
      setPending(false);
    }
  }

  return (
    <section className="lg:pt-[180px] pt-[120px] lg:pb-[100px] pb-[70px]">
      <div className="main-container">
        <RevealAnimation delay={0.1}>
          <div className="max-w-[480px] mx-auto bg-background-1 dark:bg-background-6 rounded-[20px] py-14 px-8">
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
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPasswordTouched(true); }}
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
                {passwordTouched && (
                  <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    {PASSWORD_RULES.map(({ key, label }) => (
                      <li key={key} className={`flex items-center gap-1.5 text-xs ${pwStrength[key] ? 'text-green-600 dark:text-green-400' : 'text-foreground/50'}`}>
                        {pwStrength[key]
                          ? <Check className="h-3 w-3 shrink-0" />
                          : <X className="h-3 w-3 shrink-0" />}
                        {label}
                      </li>
                    ))}
                  </ul>
                )}
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
