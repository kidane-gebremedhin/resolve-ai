import RevealAnimation from '../animation/RevealAnimation';
import LinkButton from '../ui/button/LinkButton';

const CTA = () => {
  return (
      <section className="md:py-16 py-20 lg:py-[76px] bg-secondary dark:bg-background-6 hero-reveal-up" style={{ animationDelay: '0.1s' }}>
        <div className="main-container">
          <div className="text-center">
            <RevealAnimation delay={0.1}>
              <span className="badge badge-blur text-ns-yellow mb-5">Let's start</span>
            </RevealAnimation>
            <RevealAnimation delay={0.2}>
              <h2 className="mb-3 text-white">Resolve more. Escalate less. Delight customers.</h2>
            </RevealAnimation>
            <RevealAnimation delay={0.3}>
              <p className="mb-6 text-white/60">
                No complex setup. No steep learning curve. Just AI that works from day one.
              </p>
            </RevealAnimation>
            <RevealAnimation delay={0.4}>
              <div className="text-center">
                <LinkButton href="/pricing" className="btn btn-primary btn-md hover:btn-green w-[90%] md:w-auto mx-auto md:mx-0">
                  Get started today
                </LinkButton>
              </div>
            </RevealAnimation>
          </div>
        </div>
      </section>
  );
};

export default CTA;
