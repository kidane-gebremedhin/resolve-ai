export type MessageBlock =
  | CardBlock
  | CarouselBlock
  | FormBlock
  | LinkPreviewBlock;

export interface CardBlock {
  type: "card";
  imageUrl?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  price?: string;
  buttons: CardButton[];
}

export interface CardButton {
  label: string;
  action: "send_message" | "open_url" | "submit_form";
  value: string;
  variant?: "primary" | "secondary";
}

export interface CarouselBlock {
  type: "carousel";
  cards: CardBlock[];
}

export interface FormBlock {
  type: "form";
  title?: string;
  fields: FormField[];
  submitLabel: string;
  toolKey: string;
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "select" | "textarea";
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
}

export interface LinkPreviewBlock {
  type: "link_preview";
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  favicon?: string;
}
