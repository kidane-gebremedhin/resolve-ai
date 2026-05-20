import RevealAnimation from '../animation/RevealAnimation';
import LinkButton from '../ui/button/LinkButton';

const featureItems = [
  { id: 1, text: '68% of tickets resolved automatically.' },
  { id: 2, text: 'Avg. first-response time: 3 minutes.' },
  { id: 3, text: 'SOC 2 certified & enterprise-ready.' },
];

const Hero = () => {
  return (
    <section
      className="bg-cover bg-top bg-no-repeat pt-[170px] md:pt-[206px] md:pb-[100px] pb-[50px] xl:max-h-[1126px] max-h-[900px] relative z-20"
      style={{ backgroundImage: "url('/images/home-page-34/hero-bg.jpg')" }}
    >
      <div className="absolute top-[10%] left-1/2 -translate-x-1/2 max-w-[1365px] mx-auto -z-10">
        <figure>
          <img src="/images/home-page-34/hero-vector.svg" alt="hero" />
        </figure>
      </div>
      <div className="main-container">
        <div className="md:text-center md:space-y-4 space-y-5">
          <RevealAnimation delay={0.1}>
            <h1 className="lg:max-w-[776px] md:max-w-[600px] sm:max-w-[500px] max-w-[380px] mx-auto">
              <span className="hero-text-gradient hero-text-color-2 block">
                Customer support that works while you sleep.
              </span>
            </h1>
          </RevealAnimation>
          <RevealAnimation delay={0.2}>
            <p className="lg:max-w-[700px] md:max-w-[600px] sm:max-w-[500px] max-w-[380px] mx-auto text-accent/60">
              Whether you're a startup or an enterprise, Kida gives you everything you need to resolve tickets faster—from AI automation to real-time insights—all in one platform.
            </p>
          </RevealAnimation>
          <ul className="flex items-center md:gap-9 gap-5 flex-wrap sm:justify-center">
            {featureItems.map((item, index) => (
              <RevealAnimation key={item.id} delay={0.3 + index * 0.1}>
                <li className="flex items-center gap-1.5">
                  <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-accent/20">
                    <svg xmlns="http://www.w3.org/2000/svg" width={11} height={8} viewBox="0 0 11 8" fill="none" className="shrink-0">
                      <path d="M4.81661 7.25605L10.2491 1.92144C10.5836 1.5959 10.5836 1.0697 10.2491 0.744158C9.91446 0.418614 9.37363 0.418614 9.03904 0.744158L4.2116 5.49012L1.96096 3.28807C1.62636 2.96253 1.08554 2.96253 0.750945 3.28807C0.416352 3.61362 0.416352 4.13982 0.750945 4.46536L3.6066 7.25605C3.77347 7.41841 3.99253 7.5 4.2116 7.5C4.43067 7.5 4.64974 7.41841 4.81661 7.25605Z" fill="white" />
                    </svg>
                  </span>
                  <span className="text-accent/60 text-tagline-2">{item.text}</span>
                </li>
              </RevealAnimation>
            ))}
          </ul>
        </div>
        <ul className="flex items-center gap-4 justify-center md:flex-row flex-col mt-14">
          <RevealAnimation delay={0.6} direction="left" offset={50}>
            <li className="w-full sm:w-auto text-center sm:text-left">
              <LinkButton href="/pricing" className="btn hover:btn-secondary border-0 btn-green btn-xl md:w-auto w-[90%] text-center">
                Get started Free
              </LinkButton>
            </li>
          </RevealAnimation>
          <RevealAnimation delay={0.7} direction="left" offset={50}>
            <li className="w-full sm:w-auto text-center sm:text-left">
              <LinkButton href="/features" className="btn btn-dark hover:btn-green hover:border-0 text-center text-white btn-xl md:w-auto w-[90%]" style={{ backgroundColor: 'rgba(252,252,252,0.22)' }}>
                Try live demo
              </LinkButton>
            </li>
          </RevealAnimation>
        </ul>
        <RevealAnimation delay={0.8} instant>
          <div className="lg:mt-[100px] mt-[50px]">
            <figure className="xl:max-w-[1240px] lg:max-w-[900px] max-w-[700px] mx-auto rounded-2xl overflow-hidden">
              <img src="/images/home-page-34/hero.jpg" className="w-full h-full object-cover dark:hidden" alt="AI customer support platform" />
              <img src="/images/home-page-34/hero-dark.jpg" className="w-full h-full object-cover hidden dark:block" alt="AI customer support platform" />
            </figure>
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default Hero;
