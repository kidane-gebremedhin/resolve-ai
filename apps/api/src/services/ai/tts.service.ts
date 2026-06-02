// Text-to-speech service — wraps an OpenAI-compatible /audio/speech endpoint.
// Returns the synthesised MP3 as a Buffer so route handlers can stream it
// back with the appropriate content-type.

const baseUrl = process.env.TTS_BASE_URL ?? "https://api.openai.com/v1";
const defaultModel = process.env.TTS_MODEL ?? "tts-1";
const defaultVoice = process.env.TTS_VOICE ?? "alloy";

const MAX_INPUT_CHARS = 4096;

export interface SynthesizeOptions {
  voice?: string;
  model?: string;
}

export async function synthesize(text: string, options: SynthesizeOptions = {}): Promise<Buffer> {
  const apiKey = process.env.TTS_API_KEY;
  if (!apiKey) {
    throw new Error("TTS_API_KEY is not configured.");
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("TTS input text is empty.");
  }
  const input = trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  const res = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model ?? defaultModel,
      voice: options.voice ?? defaultVoice,
      input,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TTS ${res.status}: ${body}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
