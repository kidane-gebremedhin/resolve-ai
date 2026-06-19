'use client';

import { useState } from 'react';
import RevealAnimation from '../animation/RevealAnimation';
import { APP_NAME } from '@/lib/app-config';

const tabs = [
  {
    id: 0,
    label: 'Our Mission',
    title: 'Helping teams deliver great support at scale',
    description: `We built ${APP_NAME} to give every support team, from scrappy startups to global enterprises, access to AI-powered tools that actually work. Our mission is to make exceptional customer support the default, not the exception.`,
    image: '/images/home-page-34/about-img-02.svg',
    stats: [
      { value: '2.18M+', label: 'Tickets resolved' },
      { value: '70+', label: 'Countries served' },
    ],
  },
  {
    id: 1,
    label: 'Our Story',
    title: 'Built by support leaders, for support leaders',
    description: `Founded in 2019, ${APP_NAME} started as an internal tool used by a small team obsessed with cutting response times. Today it's a full-featured AI platform serving hundreds of companies globally, with 24/7 uptime and enterprise-grade security.`,
    image: '/images/home-page-34/about-img-03.svg',
    stats: [
      { value: '2019', label: 'Year founded' },
      { value: '150+', label: 'Enterprise clients' },
    ],
  },
  {
    id: 2,
    label: 'Our Values',
    title: 'Speed, empathy, and continuous improvement',
    description: 'We believe great support software starts with great values. We\'re rigorous about accuracy, relentless about performance, and always listening to customers, because your trust is everything.',
    image: '/images/home-page-34/about-img-02.svg',
    stats: [
      { value: '99.9%', label: 'Platform uptime' },
      { value: '94%', label: 'Avg CSAT score' },
    ],
  },
];

const About = () => {
  const [activeTab, setActiveTab] = useState(0);
  const tab = tabs[activeTab];

  return (
      <section className="dark:bg-background-6 overflow-hidden bg-white pt-20 pb-14 sm:pb-36 lg:pt-[88px] xl:pt-[100px] xl:pb-[176px] hero-reveal-up" style={{ animationDelay: '0.1s' }}>
        <div className="main-container">
          <div className="grid grid-cols-12 gap-8 items-center">
            <div className="col-span-12 lg:col-span-6 space-y-8">
              {/* Tab buttons */}
              <div className="flex gap-2 flex-wrap">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`px-5 py-2 rounded-full text-[0.875rem] font-medium transition-all duration-300 ${activeTab === t.id ? 'bg-secondary text-white dark:bg-accent dark:text-secondary' : 'bg-background-3 text-secondary/60 dark:bg-background-7 dark:text-accent/60 hover:bg-background-4'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="space-y-4">
                <RevealAnimation delay={0.1}>
                  <h2 className="xl:max-w-[479px]">{tab.title}</h2>
                </RevealAnimation>
                <RevealAnimation delay={0.2}>
                  <p className="max-w-[450px]">{tab.description}</p>
                </RevealAnimation>
              </div>
              <div className="flex gap-8">
                {tab.stats.map((stat) => (
                  <div key={stat.label}>
                    <p className="text-[2rem] leading-[130%] font-medium text-secondary dark:text-accent">{stat.value}</p>
                    <p className="text-[0.875rem] leading-[150%] text-secondary/60 dark:text-accent/60">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-12 lg:col-span-6">
              <RevealAnimation delay={0.3}>
                <figure className="rounded-[20px] overflow-hidden">
                  <img src={tab.image} alt={tab.title} className="w-full h-full object-cover max-h-[500px]" />
                </figure>
              </RevealAnimation>
            </div>
          </div>
        </div>
      </section>
  );
};

export default About;
