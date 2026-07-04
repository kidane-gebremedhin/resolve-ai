// Speech-to-text service — wraps OpenAI Whisper by default.
// Returns the full transcript as a string.
// Set STT_API_KEY to the OpenAI API key (or any OpenAI-compatible key).
// Set STT_BASE_URL to override the API base (default: OpenAI).

const baseUrl = process.env.STT_BASE_URL ?? "https://api.openai.com/v1";

export async function transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.STT_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("STT_API_KEY (or OPENAI_API_KEY) is not configured.");
  }

  // Build a multipart/form-data body using the standard FormData API (Node 18+).
  const form = new FormData();
  form.append("model", "whisper-1");
  // Whisper accepts webm/opus, mp4, ogg, wav, etc. The filename extension hint
  // helps the API detect the container format when MIME type alone is ambiguous.
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "wav";
  form.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
  form.append("response_format", "json");

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`STT ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
