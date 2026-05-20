import RevealAnimation from '../animation/RevealAnimation';
import LinkButton from '../ui/button/LinkButton';

const contactInfo = [
  { id: 1, type: 'email', value: 'hello@nextsaas.com', href: 'mailto:hello@nextsaas.com' },
  { id: 2, type: 'phone', value: '(239) 555-0108', href: 'tel:2395550108' },
  { id: 3, type: 'address', value: '4140 Parker Rd, Allentown, NM 31134' },
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
    <RevealAnimation delay={0.1}>
      <section className="py-[100px] bg-background-3 dark:bg-background-5">
        <div className="main-container">
          <div className="flex lg:gap-10 flex-col space-y-18 lg:space-y-0 lg:flex-row lg:justify-between">
            <div className="space-y-9 flex-1 flex lg:flex-col md:flex-row flex-col justify-between md:gap-10 lg:gap-0">
              <div className="space-y-7 flex-1">
                <div className="space-y-3">
                  <RevealAnimation delay={0.1}>
                    <h2 className="max-w-[517px]">Support when you need It</h2>
                  </RevealAnimation>
                  <RevealAnimation delay={0.2}>
                    <p className="max-w-[372px]">Our support team is here to guide you—whether you're picking a plan or filing a claim.</p>
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
              <ul className="md:space-y-6 space-y-4 flex-1">
                {contactInfo.map((info, index) => (
                  <RevealAnimation key={info.id} delay={0.4 + index * 0.1}>
                    <li className="flex items-center gap-2">
                      <span className="size-10 bg-white dark:bg-background-8 rounded-full flex items-center justify-center">
                        {getIcon(info.type)}
                      </span>
                      <p>
                        {info.href ? (
                          <a href={info.href}>{info.value}</a>
                        ) : info.value}
                      </p>
                    </li>
                  </RevealAnimation>
                ))}
              </ul>
            </div>

            <RevealAnimation delay={0.4}>
              <div className="md:p-[42px] p-7 bg-white dark:bg-background-6 rounded-[20px] lg:max-w-[605px] flex-1">
                <form action="#" method="post">
                  <fieldset className="w-full flex flex-col gap-2 items-start justify-start md:mb-8 mb-5">
                    <label htmlFor="fullName" className="text-tagline-1 text-secondary dark:text-accent font-medium">Full Name</label>
                    <input type="text" name="fullName" id="fullName" required placeholder="Enter your name" className="rounded-full placeholder:text-tagline-1 border border-stroke-3 dark:border-stroke-7 dark:bg-background-6 dark:placeholder:text-accent/60 dark:text-accent w-full px-[18px] py-3 focus-visible:outline focus-visible:outline-primary-500 placeholder:font-normal font-normal" />
                  </fieldset>
                  <fieldset className="w-full flex flex-col gap-2 items-start justify-start md:mb-8 mb-5">
                    <label htmlFor="emailAddress" className="text-tagline-1 text-secondary dark:text-accent font-medium">Email address</label>
                    <input type="email" required name="emailAddress" id="emailAddress" placeholder="Enter your email" className="rounded-full placeholder:text-tagline-1 border border-stroke-3 dark:border-stroke-7 dark:bg-background-6 dark:placeholder:text-accent/60 dark:text-accent w-full px-[18px] py-3 focus-visible:outline focus-visible:outline-primary-500 placeholder:font-normal font-normal" />
                  </fieldset>
                  <fieldset className="w-full flex flex-col gap-2 items-start justify-start mb-4">
                    <label htmlFor="messages" className="text-tagline-1 text-secondary dark:text-accent font-medium">Message</label>
                    <textarea name="messages" id="messages" required placeholder="Enter your message" className="rounded-xl placeholder:text-tagline-1 border border-stroke-3 dark:border-stroke-7 dark:bg-background-6 dark:placeholder:text-accent/60 dark:text-accent w-full px-[18px] py-3 min-h-[120px] resize-none focus-visible:outline focus-visible:outline-primary-500 placeholder:font-normal font-normal" />
                  </fieldset>
                  <fieldset className="flex items-center gap-2 mb-4">
                    <label htmlFor="agree-terms" className="flex items-center gap-x-3">
                      <input id="agree-terms" type="checkbox" className="sr-only peer" required />
                      <span className="size-4 rounded-full border border-stroke-3 dark:border-stroke-7 relative after:absolute after:size-2.5 after:bg-primary-500 after:rounded-full after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:opacity-0 peer-checked:after:opacity-100 peer-checked:border-primary-500 cursor-pointer" />
                    </label>
                    <label htmlFor="agree-terms" className="text-tagline-3 cursor-pointer text-secondary/60 dark:text-accent/60">
                      I agree with the{' '}
                      <a href="#" className="text-primary-500 underline text-tagline-3">terms and conditions</a>
                    </label>
                  </fieldset>
                  <button type="submit" className="btn btn-secondary dark:btn-accent btn-md w-full before:content-none first-letter:uppercase hover:btn-green">
                    Submit
                  </button>
                </form>
              </div>
            </RevealAnimation>
          </div>
        </div>
      </section>
    </RevealAnimation>
  );
};

export default Contact;
