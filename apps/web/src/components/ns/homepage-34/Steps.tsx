import RevealAnimation from '../animation/RevealAnimation';
import LinkButton from '../ui/button/LinkButton';
import StackCardItem from '../ui/stack-card/StackCardItem';
import StackCardWrapper from '../ui/stack-card/StackCardWrapper';
import { APP_NAME } from '@/lib/app-config';

const stepCards = [
  {
    id: 1,
    title: 'AI Resolution Agent',
    description: `Train once on your docs—${APP_NAME} resolves tickets automatically and knows when to escalate.`,
    gradient: '/images/gradient/gradient-32.png',
    stepImg: '/images/home-page-34/step-1.png',
    stepDarkImg: null,
    maxDescWidth: 'max-w-[281px]',
  },
  {
    id: 2,
    title: 'Unified Inbox',
    description: 'Every channel in one place—email, chat, WhatsApp, Slack—with smart priority queuing.',
    gradient: '/images/gradient/gradient-33.png',
    stepImg: '/images/home-page-34/step-2.png',
    stepDarkImg: '/images/home-page-34/step-2-dark.png',
    maxDescWidth: 'max-w-[250px]',
  },
  {
    id: 3,
    title: 'Reply Copilot',
    description: 'AI-drafted replies with tone controls and live translation across 92+ languages.',
    gradient: '/images/gradient/gradient-34.png',
    stepImg: '/images/home-page-34/step-3.png',
    stepDarkImg: '/images/home-page-34/step-3-dark.png',
    maxDescWidth: 'max-w-[250px]',
  },
  {
    id: 4,
    title: 'Insight Engine',
    description: 'Auto-tagged conversations surface trending issues before they become support crises.',
    gradient: '/images/gradient/gradient-9.png',
    stepImg: '/images/home-page-34/step-4.png',
    stepDarkImg: '/images/home-page-34/step-4-dark.png',
    maxDescWidth: 'max-w-[280px]',
  },
];

const Steps = () => {
  return (
    <RevealAnimation delay={0.1}>
      <section className="relative py-16 md:py-20 lg:py-[100px] bg-background-2 dark:bg-background-5" aria-label="Features section">
        <div className="main-container">
          <div className="grid grid-cols-12 xl:gap-[60px] gap-y-14 items-start justify-items-center">
            <div className="col-span-12 lg:col-span-6 lg:sticky lg:top-28">
              <div className="md:space-y-14 space-y-10 lg:text-left text-center">
                <div className="space-y-3">
                  <RevealAnimation delay={0.1}>
                    <h2 className="xl:max-w-[479px] w-full xl:mx-0 mx-auto">Built for teams who care about customers</h2>
                  </RevealAnimation>
                  <RevealAnimation delay={0.2}>
                    <p>Powerful AI tools that help you respond faster and delight customers at every touchpoint.</p>
                  </RevealAnimation>
                </div>
                <RevealAnimation delay={0.3}>
                  <div>
                    <LinkButton href="/features" className="btn dark:btn-transparent btn-secondary btn-md md:w-auto w-[90%] mx-auto md:mx-0 hover:btn-green">
                      Explore all features
                    </LinkButton>
                  </div>
                </RevealAnimation>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-6">
              <StackCardWrapper topOffset="11vh" gap="24px" initDelay={100} className="sm:flex-1 flex-none w-full sm:order-1 order-2">
                {stepCards.map((step, index) => (
                  <RevealAnimation key={step.id} delay={0.4 + index * 0.1}>
                    <StackCardItem>
                      <div className="p-2 relative rounded-[20px] z-20 flex items-center justify-center sm:max-w-[483px] max-w-full sm:mx-0 mx-auto w-full overflow-hidden">
                        <figure className="absolute pointer-events-none -top-[99%] -left-[88%] size-[1000px] -z-10 rotate-[307deg] opacity-50 select-none">
                          <img src={step.gradient} alt="step gradient" />
                        </figure>
                        <div className="relative z-10 p-8 rounded-[14px] sm:max-w-[467px] max-w-full w-full space-y-6 bg-white dark:bg-black">
                          <div className="space-y-1">
                            <p className="text-heading-5 text-secondary dark:text-accent">{step.title}</p>
                            <p className={`${step.maxDescWidth} w-full`}>{step.description}</p>
                          </div>
                          <figure className="max-w-[385px] w-full rounded-2xl overflow-hidden">
                            {step.stepDarkImg ? (
                              <>
                                <img src={step.stepImg} alt="step" className="dark:hidden block md:max-h-[300px] md:min-h-[300px] w-full object-cover" />
                                <img src={step.stepDarkImg} alt="step" className="hidden dark:block md:max-h-[300px] md:min-h-[300px] w-full object-cover" />
                              </>
                            ) : (
                              <img src={step.stepImg} alt="step" className="md:max-h-[300px] md:min-h-[300px] w-full object-cover" />
                            )}
                          </figure>
                        </div>
                      </div>
                    </StackCardItem>
                  </RevealAnimation>
                ))}
              </StackCardWrapper>
            </div>
          </div>
        </div>
      </section>
    </RevealAnimation>
  );
};

export default Steps;
