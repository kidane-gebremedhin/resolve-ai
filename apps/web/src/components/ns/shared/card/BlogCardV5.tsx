import { IBlogPost } from '@/data/ns-blogs';
import { cn } from '@/utils/ns-cn';
import LinkButton from '../../ui/button/LinkButton';

interface BlogCardV5Props {
  blog: IBlogPost;
  className?: string;
}

const BlogCardV5 = ({ blog, className }: BlogCardV5Props) => {
  return (
    <div>
      <article className={cn('rounded-[20px] scale-100 hover:scale-[102%] transition-transform duration-500 overflow-hidden bg-background-2 dark:bg-background-7 flex sm:flex-row flex-col sm:gap-8 gap-0 max-w-[627px] lg:max-w-full lg:mx-0 mx-auto', className)}>
        <figure className="sm:w-[298.5px] w-full xl:h-[260px] sm:h-auto h-[260px] shrink-0 overflow-hidden rounded-[20px]">
          <img src={blog.thumbnail} alt="blog" className="w-full h-full object-cover" loading="lazy" />
        </figure>
        <div className="sm:py-8 sm:pr-8 p-8 sm:p-0 space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-[0.875rem] font-medium text-secondary/60 dark:text-accent/60">{blog.publishDate}</span>
            <div className="w-px h-[22px] bg-stroke-2 dark:bg-stroke-6" />
            <span className="text-[0.875rem] font-medium text-secondary/60 dark:text-accent/60">{blog.readTime}</span>
          </div>
          <div className="space-y-4">
            <a href={`/blog/${blog.slug}`} className="block">
              <h3 className="text-[1.25rem] leading-[140%] line-clamp-2">{blog.title}</h3>
            </a>
          </div>
          <div>
            <LinkButton href={`/blog/${blog.slug}`} className="btn dark:btn-transparent hover:btn-secondary dark:hover:btn-accent btn-white btn-md w-[85%] md:w-auto mx-auto md:mx-0">
              Read more
            </LinkButton>
          </div>
        </div>
      </article>
    </div>
  );
};

export default BlogCardV5;
