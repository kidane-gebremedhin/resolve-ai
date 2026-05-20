import { cn } from '@/utils/ns-cn';
import RevealAnimation from '../animation/RevealAnimation';

const CheckIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={10} height={8} viewBox="0 0 11 8" fill="none" className={cn('shrink-0', className)}>
    <path d="M4.81661 7.25605L10.2491 1.92144C10.5836 1.5959 10.5836 1.0697 10.2491 0.744158C9.91446 0.418614 9.37363 0.418614 9.03904 0.744158L4.2116 5.49012L1.96096 3.28807C1.62636 2.96253 1.08554 2.96253 0.750945 3.28807C0.416352 3.61362 0.416352 4.13982 0.750945 4.46536L3.6066 7.25605C3.77347 7.41841 3.99253 7.5 4.2116 7.5C4.43067 7.5 4.64974 7.41841 4.81661 7.25605Z" fill="currentColor" />
  </svg>
);

const featureLabels = ['Pages included', 'Custom design', 'SEO optimization', 'Branding support', 'Social media integration'];

const pricingPlans = [
  {
    id: 'essential',
    name: 'Essential',
    price: 'Free',
    description: 'Free plan for all users',
    buttonText: 'Get started',
    planType: 'basic' as const,
    features: [
      { label: 'Pages included', value: 'Up to 5' },
      { label: 'Custom design', value: true },
      { label: 'SEO optimization', value: true },
      { label: 'Branding support', value: false },
      { label: 'Social media integration', value: false },
    ],
  },
  {
    id: 'advanced',
    name: 'Advanced',
    price: '$99',
    description: 'Plans for advanced users',
    buttonText: 'Get started',
    planType: 'featured' as const,
    features: [
      { label: 'Pages included', value: 'Up to 10' },
      { label: 'Custom design', value: true },
      { label: 'SEO optimization', value: true },
      { label: 'Branding support', value: true },
      { label: 'Social media integration', value: false },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Enterprise',
    description: 'Contact us for enterprise users',
    buttonText: 'Get started',
    planType: 'premium' as const,
    features: [
      { label: 'Pages included', value: 'Unlimited' },
      { label: 'Custom design', value: true },
      { label: 'SEO optimization', value: true },
      { label: 'Branding support', value: true },
      { label: 'Social media integration', value: true },
    ],
  },
];

const Pricing = () => {
  return (
    <RevealAnimation delay={0.1}>
      <section className="lg:py-[100px] py-16 md:py-20 bg-background-2 dark:bg-background-5">
        <div className="max-w-[1440px] mx-auto">
          <div className="lg:py-[100px] py-[50px] lg:px-16 px-6 space-y-10 sm:space-y-[70px]">
            <div className="text-center space-y-5">
              <RevealAnimation delay={0.1}>
                <span className="badge badge-green">Our pricing</span>
              </RevealAnimation>
              <RevealAnimation delay={0.2}>
                <h2 className="lg:max-w-[678px] max-w-[400px] mx-auto">
                  Select the pricing plan that best suits your needs.
                </h2>
              </RevealAnimation>
            </div>

            <div className="grid grid-cols-12 xl:gap-8 md:gap-6 gap-y-6">
              {/* Features column */}
              <div className="col-span-12 xl:col-span-3 md:col-span-6">
                <RevealAnimation delay={0.3}>
                  <div>
                    <div className="md:h-[195px] md:w-[290px]" />
                    <div className="space-y-2.5">
                      <h3 className="text-[1.25rem] leading-[140%]">What's included</h3>
                      <ul>
                        {featureLabels.map((feature, index) => (
                          <li key={feature} className={cn('text-secondary/60 dark:text-accent/60 text-[1rem] leading-[150%] font-normal py-4 pr-6', index < featureLabels.length - 1 && 'border-b border-b-stroke-4 dark:border-b-stroke-8')}>
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </RevealAnimation>
              </div>

              {pricingPlans.map((plan, index) => (
                <div key={plan.id} className="col-span-12 xl:col-span-3 md:col-span-6">
                  <RevealAnimation delay={0.4 + index * 0.1}>
                    <div>
                      <div className={cn('rounded-t-[20px] py-8 px-6 space-y-8', plan.planType === 'featured' ? 'z-10 relative bg-secondary dark:bg-background-7 overflow-hidden' : 'bg-background-3 dark:bg-background-7')}>
                        {plan.planType === 'featured' && (
                          <div className="absolute h-full w-full -top-28 -right-20 -z-[1] pointer-events-none">
                            <img src="/images/gradient/gradient-4.png" alt="pricing bg" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div>
                          <p className={cn('text-[1rem] leading-[150%] font-medium mb-3', plan.planType === 'featured' ? 'text-accent/60' : 'text-secondary/60 dark:text-accent/60')}>{plan.name}</p>
                          <h3 className={cn('text-[1.5rem] leading-[140%] font-normal', plan.planType === 'featured' && 'text-accent')}>{plan.price}</h3>
                          <p className={cn(plan.planType === 'featured' && 'text-accent/60')}>{plan.description}</p>
                        </div>
                        <a
                          href="/contact"
                          className={cn('btn btn-md w-full', plan.planType === 'featured' ? 'btn-primary hover:btn-white border-0' : 'btn-white dark:btn-white-dark hover:btn-primary')}
                        >
                          <span>{plan.buttonText}</span>
                        </a>
                      </div>
                      <div className="rounded-b-[20px] bg-white dark:bg-black">
                        <ul>
                          {plan.features.map((feature, featureIndex) => (
                            <li key={feature.label} className={cn('h-14 px-6 py-4 text-center flex items-center justify-center', featureIndex < plan.features.length - 1 && 'border-b border-b-stroke-4 dark:border-b-stroke-8')}>
                              {typeof feature.value === 'string' ? (
                                <p className="font-medium text-secondary/60 dark:text-accent/60">{feature.value}</p>
                              ) : feature.value ? (
                                <span className="size-[18px] shrink-0 bg-secondary dark:bg-accent rounded-full flex items-center justify-center">
                                  <CheckIcon className="fill-white dark:fill-secondary" />
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </RevealAnimation>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </RevealAnimation>
  );
};

export default Pricing;
