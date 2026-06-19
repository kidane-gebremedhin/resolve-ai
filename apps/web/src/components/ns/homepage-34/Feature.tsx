import { services } from '@/data/ns-services';
import { cn } from '@/utils/ns-cn';
import RevealAnimation from '../animation/RevealAnimation';
import LinkButton from '../ui/button/LinkButton';

const Feature = () => {
  const data = services.slice(0, 4);
  return (
    <section
      className="py-20 md:py-[100px] hero-reveal-up"
      style={{ backgroundImage: "url('/images/gradient/gradient-39.png')", backgroundRepeat: 'no-repeat', backgroundPosition: 'bottom', backgroundSize: 'cover', animationDelay: '0.1s' }}
    >
        <div className="main-container">
          <div className="space-y-3 text-center md:mb-[70px] mb-13">
            <h2 className="text-accent hero-reveal-up" style={{ animationDelay: '0.1s' }}>All-in-one customer support platform</h2>
            <p className="max-w-[472px] mx-auto text-accent/60 hero-reveal-up" style={{ animationDelay: '0.2s' }}>
              From AI resolution to real-time insights, we provide everything you need to delight customers at scale.
            </p>
          </div>
          <div className="space-y-14">
            <div className="grid grid-cols-12 md:gap-8 gap-y-5">
              {data.map((feature, index) => (
                <div key={feature.slug} className="col-span-12 md:col-span-6 hero-reveal-up" style={{ animationDelay: `${0.3 + index * 0.1}s` }}>
                  <div className="bg-white hover:-translate-y-2 duration-500 ease-in-out dark:bg-black rounded-[20px] lg:p-8 p-6 lg:space-y-8 space-y-6">
                    <div className="space-y-4 lg:space-y-6">
                      <div>
                        <span className={cn('text-4xl lg:text-[52px] text-secondary dark:text-accent', feature.icon)} />
                      </div>
                      <div className="space-y-2">
                        <h3 className="lg:text-heading-5 text-heading-6">{feature.title}</h3>
                        <p className="line-clamp-2">{feature.description}</p>
                      </div>
                    </div>
                    <div>
                      <LinkButton
                        href="/features"
                        className="btn btn-white hover:btn-secondary btn-md dark:btn-transparent dark:hover:btn-accent w-[90%] md:w-auto mx-auto md:mx-0"
                      >
                        View feature
                      </LinkButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <RevealAnimation delay={0.7}>
              <div className="text-center">
                <LinkButton href="/contact" className="btn btn-md border-0 btn-green hover:btn-secondary w-[90%] md:w-auto mx-auto md:mx-0">
                  Talk to sales
                </LinkButton>
              </div>
            </RevealAnimation>
          </div>
        </div>
      </section>
  );
};

export default Feature;
