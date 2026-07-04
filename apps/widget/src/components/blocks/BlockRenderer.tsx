"use client";

import { CardBlockRenderer } from "./CardBlockRenderer";
import { CarouselBlockRenderer } from "./CarouselBlockRenderer";
import { FormBlockRenderer } from "./FormBlockRenderer";
import { LinkPreviewBlockRenderer } from "./LinkPreviewBlockRenderer";
import type { MessageBlock } from "../../lib/api-client";

export function BlockRenderer({
  blocks,
  primaryColor,
  onSendMessage,
  conversationId,
  sessionToken,
}: {
  blocks: MessageBlock[];
  primaryColor?: string;
  onSendMessage?: (text: string) => void;
  conversationId?: string;
  sessionToken?: string;
}) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "card":
            return (
              <CardBlockRenderer
                key={i}
                block={block as Parameters<typeof CardBlockRenderer>[0]["block"]}
                primaryColor={primaryColor}
                onSendMessage={onSendMessage}
              />
            );
          case "carousel":
            return (
              <CarouselBlockRenderer
                key={i}
                block={block as Parameters<typeof CarouselBlockRenderer>[0]["block"]}
                primaryColor={primaryColor}
                onSendMessage={onSendMessage}
              />
            );
          case "form":
            return (
              <FormBlockRenderer
                key={i}
                block={block as Parameters<typeof FormBlockRenderer>[0]["block"]}
                primaryColor={primaryColor}
                onSendMessage={onSendMessage}
                conversationId={conversationId}
                sessionToken={sessionToken}
              />
            );
          case "link_preview":
            return (
              <LinkPreviewBlockRenderer
                key={i}
                block={block as Parameters<typeof LinkPreviewBlockRenderer>[0]["block"]}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
