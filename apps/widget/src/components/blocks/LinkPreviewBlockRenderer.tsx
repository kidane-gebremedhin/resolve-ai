"use client";

export type LinkPreviewBlockData = {
  type: "link_preview";
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  favicon?: string;
};

export function LinkPreviewBlockRenderer({ block }: { block: LinkPreviewBlockData }) {
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-xl border border-neutral-200 p-2.5 no-underline transition hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/60"
    >
      {block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageUrl}
          alt=""
          className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
        />
      ) : null}
      <div className="min-w-0">
        {block.siteName ? (
          <p className="text-[10px] text-neutral-500 dark:text-neutral-400">{block.siteName}</p>
        ) : null}
        <p className="line-clamp-2 text-xs font-medium text-neutral-900 dark:text-neutral-100">
          {block.title}
        </p>
        {block.description ? (
          <p className="mt-0.5 line-clamp-2 text-[10px] text-neutral-500 dark:text-neutral-400">
            {block.description}
          </p>
        ) : null}
      </div>
    </a>
  );
}
