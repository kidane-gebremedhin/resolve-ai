import RevealAnimation from '../animation/RevealAnimation';
import LinkButton from '../ui/button/LinkButton';
import StackCardItem from '../ui/stack-card/StackCardItem';
import StackCardWrapper from '../ui/stack-card/StackCardWrapper';
import { APP_NAME } from '@/lib/app-config';

const stepCards = [
  {
    id: 1,
    title: 'AI resolution agent',
    description: `Trained on your own help docs and website, ${APP_NAME} answers customer questions in seconds and knows when to hand off to a human.`,
    gradient: '/images/gradient/gradient-32.png',
    maxDescWidth: 'max-w-[340px]',
  },
  {
    id: 2,
    title: 'Unified inbox',
    description: 'Every conversation in one shared inbox, so your team and the AI agent work side by side in real time.',
    gradient: '/images/gradient/gradient-33.png',
    maxDescWidth: 'max-w-[320px]',
  },
  {
    id: 3,
    title: 'Reply suggestions',
    description: 'AI-drafted replies your agents can send, edit, or polish, keeping responses fast and on-brand.',
    gradient: '/images/gradient/gradient-34.png',
    maxDescWidth: 'max-w-[320px]',
  },
  {
    id: 4,
    title: 'Analytics & insights',
    description: 'Built-in analytics surface conversation volume, resolution rates, and trends so you can spot issues early.',
    gradient: '/images/gradient/gradient-9.png',
    maxDescWidth: 'max-w-[340px]',
  },
];

const Steps = () => {
  return (
      <section className="relative py-16 md:py-20 lg:py-[100px] bg-background-2 dark:bg-background-5 hero-reveal-up" aria-label="Features section" style={{ animationDelay: '0.1s' }}>
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
                        <div className="relative z-10 p-8 rounded-[14px] sm:max-w-[467px] max-w-full w-full space-y-3 bg-white dark:bg-black">
                          <p className="text-heading-5 text-secondary dark:text-accent">{step.title}</p>
                          <p className={`${step.maxDescWidth} w-full`}>{step.description}</p>
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
  );
};

export default Steps;
