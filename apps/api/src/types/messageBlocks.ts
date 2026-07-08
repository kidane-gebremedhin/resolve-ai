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
  // Values the model already supplied for this tool call that aren't shown as
  // editable fields (e.g. a booking's eventTypeId/startTime chosen from a slot
  // card). The widget merges these into the submitted payload so the tool's full
  // schema validates — otherwise the submission fails on the missing required args.
  hiddenValues?: Record<string, string>;
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "select" | "textarea" | "number";
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  // Datatype constraints derived from the tool's input JSON schema, enforced
  // client-side so the customer can't submit a value the schema will reject.
  min?: number;
  max?: number;
  step?: number; // 1 for integers
  pattern?: string; // regex source (JSON Schema `pattern`)
  integer?: boolean;
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
