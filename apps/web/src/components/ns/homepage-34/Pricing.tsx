'use client';

import { useState } from 'react';
import { cn } from '@/utils/ns-cn';
import RevealAnimation from '../animation/RevealAnimation';
import { PlanCta } from '@/components/billing/plan-cta';
import { PlanHighlighter } from '@/components/billing/plan-highlighter';

const CheckIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={10} height={8} viewBox="0 0 11 8" fill="none" className={cn('shrink-0', className)}>
    <path d="M4.81661 7.25605L10.2491 1.92144C10.5836 1.5959 10.5836 1.0697 10.2491 0.744158C9.91446 0.418614 9.37363 0.418614 9.03904 0.744158L4.2116 5.49012L1.96096 3.28807C1.62636 2.96253 1.08554 2.96253 0.750945 3.28807C0.416352 3.61362 0.416352 4.13982 0.750945 4.46536L3.6066 7.25605C3.77347 7.41841 3.99253 7.5 4.2116 7.5C4.43067 7.5 4.64974 7.41841 4.81661 7.25605Z" fill="currentColor" />
  </svg>
);

const featureLabels = ['AI messages / mo', 'Websites', 'Knowledge sources', 'Team members', 'Priority support'];

const pricingPlans = [
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: '$70',
    yearlyPrice: '$588',
    yearlyPerMonth: '$49',
    description: 'For small teams getting started',
    buttonText: 'Get started',
    planType: 'basic' as const,
    tier: 'pro',
    features: [
      { label: 'AI messages / mo', value: '2,000' },
      { label: 'Websites', value: '3' },
      { label: 'Knowledge sources', value: '25' },
      { label: 'Team members', value: '5' },
      { label: 'Priority support', value: false },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    monthlyPrice: '$199',
    yearlyPrice: '$1,671.60',
    yearlyPerMonth: '$139',
    description: 'For growing businesses',
    buttonText: 'Get started',
    planType: 'featured' as const,
    tier: 'business',
    features: [
      { label: 'AI messages / mo', value: '20,000' },
      { label: 'Websites', value: '10' },
      { label: 'Knowledge sources', value: '200' },
      { label: 'Team members', value: '25' },
      { label: 'Priority support', value: true },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: '$399',
    yearlyPrice: '$3,351.60',
    yearlyPerMonth: '$279',
    description: 'For large teams at scale',
    buttonText: 'Get started',
    planType: 'premium' as const,
    tier: 'enterprise',
    features: [
      { label: 'AI messages / mo', value: 'Unlimited' },
      { label: 'Websites', value: 'Unlimited' },
      { label: 'Knowledge sources', value: 'Unlimited' },
      { label: 'Team members', value: 'Unlimited' },
      { label: 'Priority support', value: true },
    ],
  },
];

type CatalogPlan = {
  plan: string;
  name: string;
  priceMonthlyUsd: number | null;
  priceYearlyUsd?: number | null;
};

const Pricing = ({ catalog = [] }: { catalog?: CatalogPlan[] }) => {
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
  const byTier = new Map(catalog.map((c) => [c.plan, c]));

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
              {/* Billing billingInterval toggle */}
              <RevealAnimation delay={0.25}>
                <div className="inline-flex items-center gap-1 rounded-full border border-stroke-4 dark:border-stroke-8 p-1">
                  <button
                    onClick={() => setBillingInterval('month')}
                    className={cn(
                      'rounded-full px-4 py-1.5 text-sm font-medium transition',
                      billingInterval === 'month'
                        ? 'bg-secondary dark:bg-accent text-accent dark:text-[#1a1a1c]'
                        : 'text-secondary/80 dark:text-accent/80 hover:text-secondary dark:hover:text-accent',
                    )}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingInterval('year')}
                    className={cn(
                      'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition',
                      billingInterval === 'year'
                        ? 'bg-secondary dark:bg-accent text-accent dark:text-[#1a1a1c]'
                        : 'text-secondary/80 dark:text-accent/80 hover:text-secondary dark:hover:text-accent',
                    )}
                  >
                    Yearly
                    <span className="rounded-full bg-[#22c55e]/15 px-2 py-0.5 text-xs font-semibold text-[#22c55e]">
                      Save ~30%
                    </span>
                  </button>
                </div>
              </RevealAnimation>
            </div>

            <PlanHighlighter className="grid grid-cols-12 xl:gap-8 md:gap-6 gap-y-6">
              {/* Features column */}
              <div className="col-span-12 xl:col-span-3 md:col-span-6">
                <RevealAnimation delay={0.3}>
                  <div>
                    <div className="md:h-[215px] md:w-[290px]" />
                    <div className="space-y-2.5">
                      <h3 className="text-[1.25rem] leading-[140%]">What&apos;s included</h3>
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

              {pricingPlans.map((plan, index) => {
                const override = byTier.get(plan.tier);
                const displayName = override?.name ?? plan.name;
                let displayPrice: string;
                if (billingInterval === 'year') {
                  displayPrice = override?.priceYearlyUsd != null
                    ? `$${override.priceYearlyUsd}`
                    : plan.yearlyPrice;
                } else {
                  displayPrice = override?.priceMonthlyUsd != null
                    ? `$${override.priceMonthlyUsd}`
                    : plan.monthlyPrice;
                }
                const cadence = billingInterval === 'year' ? '/yr' : '/mo';
                const perMonthNote = billingInterval === 'year'
                  ? (override?.priceYearlyUsd != null
                    ? `$${(override.priceYearlyUsd / 12).toFixed(0)}/mo billed annually`
                    : `${plan.yearlyPerMonth}/mo billed annually`)
                  : null;

                return (
                  <div key={plan.id} data-plan-card className="col-span-12 xl:col-span-3 md:col-span-6 cursor-pointer rounded-[20px] transition">
                    <RevealAnimation delay={0.4 + index * 0.1}>
                      <div>
                        <div className={cn('rounded-t-[20px] py-8 px-6 space-y-6', plan.planType === 'featured' ? 'z-10 relative bg-secondary dark:bg-background-7 overflow-hidden' : 'bg-background-3 dark:bg-background-7')}>
                          {plan.planType === 'featured' && (
                            <div className="absolute h-full w-full -top-28 -right-20 -z-[1] pointer-events-none">
                              <img src="/images/gradient/gradient-4.png" alt="pricing bg" className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div>
                            <p className={cn('text-[1rem] leading-[150%] font-medium mb-3', plan.planType === 'featured' ? 'text-accent/60' : 'text-secondary/60 dark:text-accent/60')}>{displayName}</p>
                            <h3 className={cn('text-[1.5rem] leading-[140%] font-normal', plan.planType === 'featured' && 'text-accent')}>
                              {displayPrice}
                              <span className={cn('text-sm font-normal ml-0.5', plan.planType === 'featured' ? 'text-accent/60' : 'text-secondary/60 dark:text-accent/60')}>{cadence}</span>
                            </h3>
                            {perMonthNote && (
                              <p className={cn('text-xs mt-1', plan.planType === 'featured' ? 'text-accent/50' : 'text-secondary/50 dark:text-accent/50')}>
                                {perMonthNote}
                              </p>
                            )}
                            <p className={cn('mt-2', plan.planType === 'featured' && 'text-accent/60')}>{plan.description}</p>
                          </div>
                          <PlanCta
                            tier={plan.tier}
                            className={cn('btn btn-md w-full', plan.planType === 'featured' ? 'btn-primary hover:btn-white border-0' : 'btn-white dark:btn-white-dark hover:btn-primary')}
                          >
                            <span>{plan.buttonText}</span>
                          </PlanCta>
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
                );
              })}
            </PlanHighlighter>
          </div>
        </div>
      </section>
    </RevealAnimation>
  );
};

export default Pricing;
