export interface IBlogPost {
  slug: string;
  title: string;
  description: string;
  thumbnail: string;
  publishDate: string;
  readTime: string;
  category: string;
}

export const blogs: IBlogPost[] = [
  {
    slug: 'how-to-deflect-68-percent-of-support-tickets-with-ai',
    title: 'How to Deflect 68% of Support Tickets with AI',
    description: 'Learn how leading support teams train an AI agent on their docs and past tickets to resolve the majority of conversations automatically, without sacrificing quality.',
    thumbnail: '/images/blogs/blog-1.jpg',
    publishDate: 'May 10, 2025',
    readTime: '8 min read',
    category: 'AI & Automation',
  },
  {
    slug: 'building-a-support-ops-playbook-for-fast-growing-teams',
    title: 'Building a Support Ops Playbook for Fast-Growing Teams',
    description: 'A unified inbox isn\'t just about convenience. It\'s about speed. Here\'s how high-growth companies structure their support operations to scale without burning out their agents.',
    thumbnail: '/images/blogs/blog-2.jpg',
    publishDate: 'Apr 28, 2025',
    readTime: '12 min read',
    category: 'Operations',
  },
  {
    slug: 'why-csat-scores-drop-and-how-ai-fixes-it',
    title: 'Why CSAT Scores Drop and How AI Fixes It',
    description: 'Slow response times and inconsistent tone are the top two reasons customers leave negative reviews. Discover how Reply Copilot and Insight Engine help teams stay ahead.',
    thumbnail: '/images/blogs/blog-3.jpg',
    publishDate: 'Apr 15, 2025',
    readTime: '6 min read',
    category: 'Customer Experience',
  },
];
