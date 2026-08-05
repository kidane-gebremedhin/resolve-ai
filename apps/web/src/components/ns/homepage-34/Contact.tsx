import RevealAnimation from '../animation/RevealAnimation';
import LinkButton from '../ui/button/LinkButton';
import { APP_NAME } from '@/lib/app-config';
import ContactForm from './ContactForm';

// Branding-bound contact details. The email host stays in sync with the app slug; the phone
// and postal address are shown ONLY when the operator provides real values via env, so the
// live site never displays a placeholder (fake) phone number or address.
const supportEmail = `hello@${APP_NAME.toLowerCase()}.com`;
const supportPhone = process.env.NEXT_PUBLIC_SUPPORT_PHONE;
const supportAddress = process.env.NEXT_PUBLIC_SUPPORT_ADDRESS;

const contactInfo = [
  { id: 1, type: 'email', value: supportEmail, href: `mailto:${supportEmail}` },
  ...(supportPhone
    ? [{ id: 2, type: 'phone', value: supportPhone, href: `tel:${supportPhone.replace(/\D/g, '')}` }]
    : []),
  ...(supportAddress ? [{ id: 3, type: 'address', value: supportAddress }] : []),
];

const EmailIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z" className="stroke-secondary dark:stroke-white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 6L12 13L2 6" className="stroke-secondary dark:stroke-white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PhoneIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.64A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z" className="stroke-secondary dark:stroke-white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LocationIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" className="stroke-secondary dark:stroke-white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="10" r="3" className="stroke-secondary dark:stroke-white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const getIcon = (type: string) => {
  switch (type) {
    case 'email': return <EmailIcon />;
    case 'phone': return <PhoneIcon />;
    case 'address': return <LocationIcon />;
    default: return null;
  }
};

const Contact = () => {
  return (
      <section className="py-[100px] bg-background-3 dark:bg-background-5 hero-reveal-up" style={{ animationDelay: '0.1s' }}>
        <div className="main-container">
          <div className="flex lg:gap-10 flex-col space-y-18 lg:space-y-0 lg:flex-row lg:justify-between">
            <div className="space-y-9 flex-1 flex lg:flex-col md:flex-row flex-col justify-between md:gap-10 lg:gap-0">
              <div className="space-y-7 flex-1">
                <div className="space-y-3">
                  <RevealAnimation delay={0.1}>
                    <h2 className="max-w-[517px]">Support when you need It</h2>
                  </RevealAnimation>
                  <RevealAnimation delay={0.2}>
                    <p className="max-w-[372px]">Our team is here to help, whether you're choosing a plan, setting up your agent, or connecting your tools.</p>
                  </RevealAnimation>
                </div>
                <RevealAnimation delay={0.3}>
                  <div>
                    <LinkButton href="/contact" className="font-medium btn hover:btn-green dark:btn-transparent btn-lg btn-white w-[90%] md:w-auto mx-auto md:mx-0">
                      Contact support
                    </LinkButton>
                  </div>
                </RevealAnimation>
              </div>
              <RevealAnimation delay={0.4}>
                <ul className="md:space-y-6 space-y-4 flex-1">
                  {contactInfo.map((info) => (
                    <li key={info.id} className="flex items-center gap-2">
                      <span className="size-10 bg-white dark:bg-background-8 rounded-full flex items-center justify-center">
                        {getIcon(info.type)}
                      </span>
                      <p>
                        {info.href ? (
                          <a href={info.href}>{info.value}</a>
                        ) : (
                          info.value
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </RevealAnimation>
            </div>

            <RevealAnimation delay={0.4}>
              <div className="md:p-[42px] p-7 bg-white dark:bg-background-6 rounded-[20px] lg:max-w-[605px] flex-1">
                <ContactForm />
              </div>
            </RevealAnimation>
          </div>
        </div>
      </section>
  );
};

export default Contact;
