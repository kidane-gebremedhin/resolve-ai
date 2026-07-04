"use client";

export type CardButton = {
  label: string;
  action: "send_message" | "open_url" | "submit_form";
  value: string;
  variant?: "primary" | "secondary";
};

export type CardBlockData = {
  type: "card";
  imageUrl?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  price?: string;
  buttons: CardButton[];
};

export function CardBlockRenderer({
  block,
  primaryColor,
  onSendMessage,
}: {
  block: CardBlockData;
  primaryColor?: string;
  onSendMessage?: (text: string) => void;
}) {
  return (
    <div className="w-[240px] flex-shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      {block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageUrl}
          alt={block.title}
          className="h-32 w-full object-cover"
        />
      ) : null}
      <div className="p-3">
        {block.badge ? (
          <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            {block.badge}
          </span>
        ) : null}
        <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {block.title}
        </p>
        {block.subtitle ? (
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{block.subtitle}</p>
        ) : null}
        {block.price ? (
          <p className="mt-1 text-base font-bold text-neutral-900 dark:text-neutral-100">
            {block.price}
          </p>
        ) : null}
        {block.buttons.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {block.buttons.map((btn, i) => (
              <button
                key={i}
                className="rounded-lg px-3 py-1.5 text-xs font-medium transition"
                style={
                  btn.variant === "primary"
                    ? { background: primaryColor ?? "#1e40af", color: "#fff" }
                    : { border: `1px solid ${primaryColor ?? "#1e40af"}`, color: primaryColor ?? "#1e40af" }
                }
                onClick={() => {
                  if (btn.action === "send_message" && onSendMessage) {
                    onSendMessage(btn.value);
                  } else if (btn.action === "open_url") {
                    window.open(btn.value, "_blank", "noopener,noreferrer");
                  }
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
