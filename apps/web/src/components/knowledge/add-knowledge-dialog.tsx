"use client";

// Modal with three tabs (Text / Upload / Website) for creating a new
// KnowledgeSource. Calls the API directly:
//   - Text/Website use clientApi (auto-attaches the bearer token).
//   - Upload uses a raw FormData fetch because we can't extend clientApi
//     from outside `apps/web/src/lib/api.ts`.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileText, Upload, Globe } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import { API_URL } from "@/lib/app-urls";
import type { KnowledgeSource } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent this knowledge is added to (knowledge is keyed by (org, agentId)). */
  agentId: string;
  /**
   * Seeds the Text tab's title. Used by the knowledge-gaps worklist so
   * "Write answer" lands the operator on a form already titled with the
   * customer's own question — they only have to type the answer.
   */
  initialTitle?: string;
};

export function AddKnowledgeDialog({ open, onOpenChange, agentId, initialTitle }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"text" | "file" | "website">("text");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Text tab state
  const [textTitle, setTextTitle] = useState(initialTitle ?? "");
  const [textBody, setTextBody] = useState("");

  // Adopt a new prefill each time the dialog is opened from a gap. Keyed on
  // `open` too, so re-opening for a DIFFERENT gap replaces the stale title
  // rather than keeping the first one for the life of the component.
  useEffect(() => {
    if (open && initialTitle) {
      setTextTitle(initialTitle);
      setTab("text");
    }
  }, [open, initialTitle]);

  // File tab state
  const [fileTitle, setFileTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // Website tab state
  const [siteTitle, setSiteTitle] = useState("");
  const [siteUrl, setSiteUrl] = useState("");

  function reset() {
    setTextTitle("");
    setTextBody("");
    setFileTitle("");
    setFile(null);
    setSiteTitle("");
    setSiteUrl("");
    setError(null);
    setSubmitting(false);
  }

  function close() {
    if (submitting) return;
    reset();
    onOpenChange(false);
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clientApi.post<KnowledgeSource>("/knowledge/text", {
        agentId,
        title: textTitle.trim(),
        content: textBody,
      });
      router.refresh();
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create knowledge source.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFile(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Grab the session token from our Next.js route, then fire a multipart
      // request directly. We can't reuse `clientApi.post` (JSON-only) and
      // we can't add an `upload` helper to lib/api.ts (not ours to edit).
      const tokenRes = await fetch("/api/session-token", { cache: "no-store" });
      const { accessToken } = (await tokenRes.json()) as { accessToken?: string };

      const fd = new FormData();
      fd.append("file", file);
      fd.append("agentId", agentId);
      if (fileTitle.trim()) fd.append("title", fileTitle.trim());

      const res = await fetch(`${API_URL}/knowledge/upload`, {
        method: "POST",
        body: fd,
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? `Upload failed (${res.status}).`);
      }
      router.refresh();
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitWebsite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clientApi.post<KnowledgeSource>("/knowledge/website", {
        agentId,
        title: siteTitle.trim(),
        url: siteUrl.trim(),
      });
      router.refresh();
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start website crawl.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add knowledge</DialogTitle>
          <DialogDescription>
            Train your AI agent on documents, articles, or website content.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="text" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Text
            </TabsTrigger>
            <TabsTrigger value="file" className="gap-1.5">
              <Upload className="h-3.5 w-3.5" /> File
            </TabsTrigger>
            <TabsTrigger value="website" className="gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Website
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="mt-4">
            <form onSubmit={submitText} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="text-title">Title</Label>
                <Input
                  id="text-title"
                  required
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  placeholder="Refund policy"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="text-body">Content</Label>
                <Textarea
                  id="text-body"
                  required
                  rows={8}
                  value={textBody}
                  onChange={(e) => setTextBody(e.target.value)}
                  placeholder="Paste your article, policy, or notes here…"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={close} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !textTitle.trim() || !textBody.trim()}>
                  {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Create source
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="file" className="mt-4">
            <form onSubmit={submitFile} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="file-title">Title (optional)</Label>
                <Input
                  id="file-title"
                  value={fileTitle}
                  onChange={(e) => setFileTitle(e.target.value)}
                  placeholder="Defaults to file name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="file-input">File</Label>
                <Input
                  id="file-input"
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.html,.htm,.png,.jpg,.jpeg"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Accepts PDF, DOCX, TXT, MD, CSV, XLSX, HTML, images. Max 25&nbsp;MB.
                </p>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={close} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !file}>
                  {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Upload
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="website" className="mt-4">
            <form onSubmit={submitWebsite} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="site-title">Title</Label>
                <Input
                  id="site-title"
                  required
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="site-url">URL</Label>
                <Input
                  id="site-url"
                  required
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  We&apos;ll crawl the URL with Firecrawl and add the pages to this agent&apos;s knowledge base.
                </p>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={close} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !siteTitle.trim() || !siteUrl.trim()}>
                  {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Start crawl
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
