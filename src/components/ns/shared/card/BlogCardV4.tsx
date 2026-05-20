import { IBlogPost } from '@/data/ns-blogs';
import { cn } from '@/utils/ns-cn';
import LinkButton from '../../ui/button/LinkButton';

interface BlogCardV4Props {
  blog: IBlogPost;
  className?: string;
}

const BlogCardV4 = ({ blog, className }: BlogCardV4Props) => {
  return (
    <div>
      <article className={cn('rounded-[20px] overflow-hidden bg-background-2 dark:bg-background-7 max-w-[627px] lg:max-w-full lg:mx-0 mx-auto scale-100 hover:scale-[102%] transition-transform duration-500', className)}>
        <figure className="lg:max-w-[629px] max-w-full w-full h-[260px] overflow-hidden rounded-[20px]">
          <img src={blog.thumbnail} alt="blog" className="w-full h-full object-cover" />
        </figure>
        <div className="p-8">
          <div className="flex items-center gap-4">
            <span className="text-[0.875rem] font-medium text-secondary/60 dark:text-accent/60">{blog.publishDate}</span>
            <div className="w-px h-[22px] bg-stroke-2 dark:bg-stroke-6" />
            <span className="text-[0.875rem] font-medium text-secondary/60 dark:text-accent/60">{blog.readTime}</span>
          </div>
          <div className="space-y-4 mt-4">
            <a href={`/blog/${blog.slug}`} className="block">
              <h3 className="text-[1.25rem] leading-[140%] line-clamp-1">{blog.title}</h3>
            </a>
            <p className="max-w-[563px] w-full line-clamp-2">{blog.description}</p>
          </div>
          <div className="xl:mt-11 mt-8">
            <LinkButton href={`/blog/${blog.slug}`} className="btn dark:btn-transparent hover:btn-secondary dark:hover:btn-accent btn-white btn-md w-[85%] md:w-auto mx-auto md:mx-0">
              Read more
            </LinkButton>
          </div>
        </div>
      </article>
    </div>
  );
};

BlogCardV4.displayName = 'BlogCardV4';
export default BlogCardV4;
