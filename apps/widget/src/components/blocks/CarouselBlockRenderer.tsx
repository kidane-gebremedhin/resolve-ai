"use client";

import { CardBlockRenderer, type CardBlockData } from "./CardBlockRenderer";

export type CarouselBlockData = {
  type: "carousel";
  cards: CardBlockData[];
};

export function CarouselBlockRenderer({
  block,
  primaryColor,
  onSendMessage,
}: {
  block: CarouselBlockData;
  primaryColor?: string;
  onSendMessage?: (text: string) => void;
}) {
  if (!block.cards || block.cards.length === 0) return null;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 [scroll-snap-type:x_mandatory]">
      {block.cards.map((card, i) => (
        <div key={i} className="[scroll-snap-align:start]">
          <CardBlockRenderer
            block={card}
            primaryColor={primaryColor}
            onSendMessage={onSendMessage}
          />
        </div>
      ))}
    </div>
  );
}
