'use client';

import RevealAnimation from '@/components/ns/animation/RevealAnimation';
import { LandingPageShell } from '@/components/ns/landing-page-shell';
import LinkButton from '@/components/ns/ui/button/LinkButton';
import { APP_NAME } from '@/lib/app-config';

const reasons = [
  {
    title: 'Earn money doing what you love:',
    body:
      'Whether you are an SEO expert, content creator, community leader, or ad specialist, there is an opportunity for you.',
  },
  {
    title: 'Trusted by support teams worldwide:',
    body: `${APP_NAME} is built to scale with companies of every size — making it an easy yes for a wide variety of clients.`,
  },
  {
    title: 'Attractive recurring commission:',
    body: 'Earn a share of every subscription you bring in — for as long as the customer stays on the platform.',
  },
];

const steps = [
  {
    id: 1,
    title: 'Apply',
    body: 'Tell us a little about your audience. Most applications are reviewed within 48 hours.',
  },
  {
    id: 2,
    title: 'Share your link',
    body: `Get a personalized referral link and assets you can drop into blogs, videos, and emails.`,
  },
  {
    id: 3,
    title: 'Get paid',
    body: 'Earn recurring commission on every paid plan that signs up through your link.',
  },
];

const AffiliatesPageContent = () => {
  return (
    <LandingPageShell>
      <section className="pt-[160px] md:pt-[200px] pb-14 md:pb-16 lg:pb-[88px] xl:pb-[100px]">
        <div className="main-container">
          <div className="space-y-14 md:space-y-[70px]">
            <RevealAnimation delay={0.1}>
              <div className="md:text-center max-w-[680px] space-y-3 md:space-y-4 mx-auto">
                <span className="badge badge-green mb-2">Affiliates</span>
                <h1 className="font-medium">{APP_NAME} affiliate program</h1>
                <h2 className="text-heading-4">Earn up to 30% recurring commission</h2>
                <p>
                  Become part of the {APP_NAME} family. Help businesses resolve more tickets with AI
                  customer support while you earn generous, recurring commissions — it&apos;s a win-win.
                </p>
                <div className="mt-7 md:mt-10">
                  <LinkButton
                    href="/signup"
                    className="btn btn-primary btn-xl hover:btn-secondary dark:hover:btn-accent w-full md:w-auto block md:inline-block"
                  >
                    Join now
                  </LinkButton>
                </div>
              </div>
            </RevealAnimation>

            <div className="space-y-3 max-w-[830px]">
              <RevealAnimation delay={0.3}>
                <h3>Why join the {APP_NAME} affiliate program?</h3>
              </RevealAnimation>
              <RevealAnimation delay={0.4}>
                <p>
                  Our rapidly growing platform, strong customer satisfaction, and high renewal rates
                  make promoting {APP_NAME} easy and profitable.
                </p>
              </RevealAnimation>
              <RevealAnimation delay={0.5}>
                <ul className="space-y-2 pt-2">
                  {reasons.map((reason) => (
                    <li
                      key={reason.title}
                      className="text-tagline-1 text-secondary/60 dark:text-accent/60 font-normal before:relative before:content-[''] before:w-1.5 before:h-1.5 before:bg-secondary dark:before:bg-accent before:rounded-full before:left-0 before:-translate-y-1/2 before:mr-1 before:inline-block"
                    >
                      <strong className="text-secondary dark:text-accent font-medium">
                        {reason.title}{' '}
                      </strong>
                      <span>{reason.body}</span>
                    </li>
                  ))}
                </ul>
              </RevealAnimation>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14 md:py-16 lg:py-[88px] xl:py-[100px] bg-background-3 dark:bg-background-9">
        <div className="main-container">
          <div className="space-y-10 md:space-y-[70px]">
            <div className="text-center max-w-[602px] space-y-3 mx-auto">
              <RevealAnimation delay={0.1}>
                <span className="badge badge-green mb-5">Process</span>
              </RevealAnimation>
              <RevealAnimation delay={0.2}>
                <h2>How it works</h2>
              </RevealAnimation>
              <RevealAnimation delay={0.3}>
                <p>Becoming a {APP_NAME} affiliate and earning is simple.</p>
              </RevealAnimation>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {steps.map((step, idx) => (
                <RevealAnimation key={step.id} delay={0.2 + idx * 0.1}>
                  <div className="bg-white dark:bg-background-5 rounded-2xl p-6 md:p-8 h-full space-y-3">
                    <span className="inline-flex size-10 items-center justify-center rounded-full bg-primary-500/10 text-primary-500 font-semibold">
                      {step.id}
                    </span>
                    <h4 className="text-heading-5">{step.title}</h4>
                    <p className="text-tagline-2 text-secondary/70 dark:text-accent/60">{step.body}</p>
                  </div>
                </RevealAnimation>
              ))}
            </div>

            <RevealAnimation delay={0.5}>
              <div className="text-center pt-4">
                <LinkButton
                  href="/signup"
                  className="btn btn-primary btn-xl hover:btn-secondary dark:hover:btn-accent w-full md:w-auto block md:inline-block"
                >
                  Apply now
                </LinkButton>
              </div>
            </RevealAnimation>
          </div>
        </div>
      </section>
    </LandingPageShell>
  );
};

export default AffiliatesPageContent;
