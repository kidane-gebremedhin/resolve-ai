'use client';

import { testimonials } from '@/data/ns-testimonials';
import { cn } from '@/utils/ns-cn';
import 'swiper/css';
import { Autoplay } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import RevealAnimation from '../../animation/RevealAnimation';
import LinkButton from '../../ui/button/LinkButton';
import GradientOverlay from './GradientOverlay';

interface ReviewsV1Props {
  background?: string;
  badgeColor?: string;
  btnClassName?: string;
  buttonLink?: string;
  sliderClassName?: string;
  badgeText?: string;
}

const ReviewsV1 = ({
  background,
  badgeColor,
  btnClassName,
  buttonLink,
  sliderClassName,
  badgeText = 'Customer Success',
}: ReviewsV1Props) => {
  return (
    <section className={cn('relative pt-14 pb-14 md:pt-16 md:pb-16 lg:pt-[88px] lg:pb-[88px] xl:pt-[100px] xl:pb-[100px]', background)}>
      <div className="main-container flex flex-col gap-[70px] max-[426px]:gap-10">
        <div className="flex flex-col items-center text-center">
          {badgeText && (
            <RevealAnimation delay={0.1}>
              <span className={cn('badge mb-5', badgeColor)}>{badgeText}</span>
            </RevealAnimation>
          )}
          <RevealAnimation delay={0.2}>
            <h2 className="mx-auto mb-4 max-w-[750px] max-[426px]:mb-3">Real apps. Real results.</h2>
          </RevealAnimation>
          <RevealAnimation delay={0.3}>
            <p className="max-w-[490px] max-[426px]:max-w-[320px]">
              &ldquo;Chataxis delivered our entire support stack ahead of schedule, flawless execution and real partnership.&rdquo;
            </p>
          </RevealAnimation>
        </div>

        <RevealAnimation delay={0.4}>
          <div className="relative">
            <Swiper
              className="swiper reviews-swiper"
              spaceBetween={30}
              slidesPerView={1}
              centeredSlides={true}
              loop={true}
              speed={1500}
              autoplay={{ delay: 3000, disableOnInteraction: false }}
              modules={[Autoplay]}
              navigation={false}
              pagination={false}
              breakpoints={{
                640: { slidesPerView: 2 },
                1024: { slidesPerView: 3 },
              }}
            >
              {testimonials.map((review) => (
                <SwiperSlide key={review.id} className="swiper-slide">
                  <div className={cn('bg-background-2 dark:bg-background-5 relative z-0 mx-1 flex flex-col gap-y-8 overflow-hidden rounded-[20px] p-8 sm:mx-0 group', sliderClassName)}>
                    <GradientOverlay />
                    <figure className="relative inline-block size-14 overflow-hidden rounded-full ring-4 ring-white dark:ring-background-5" style={{ background: 'linear-gradient(156deg, #FFF 32.92%, #83E7EE 91%)' }}>
                      <img src={review.avatar} height={100} width={100} alt="avatar" className="max-w-full w-full h-full object-cover" />
                    </figure>
                    <p className="text-secondary/60 dark:text-accent/60 line-clamp-2">{review.quote}</p>
                    <div>
                      <p className="text-secondary dark:text-accent text-lg leading-[1.5] font-medium">{review.name}</p>
                      <p className="text-secondary/60 dark:text-accent/60 text-[0.875rem] leading-[150%]">{review.position}</p>
                    </div>
                  </div>
                </SwiperSlide>
              ))}
            </Swiper>
          </div>
        </RevealAnimation>

        <RevealAnimation delay={0.5}>
          <div className="text-center">
            <LinkButton href={buttonLink || '/testimonials'} className={cn('btn btn-md btn-secondary dark:btn-transparent hover:btn-white w-full sm:w-auto', btnClassName)}>
              View all reviews
            </LinkButton>
          </div>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default ReviewsV1;
