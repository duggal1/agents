export const OPENAI_COMPATIBLE_BASE_URL_HINT =
  "Paste the OpenAI-compatible address from your server. Sapphire adds /v1 if needed.";

/** Connect when base URL and model id are set. */
export function openAiCompatibleConnectReady(input: { baseUrl: string; modelId: string }): boolean {
  return Boolean(input.baseUrl.trim() && input.modelId.trim());
}

export function openAiCompatibleProbeSuccessMessage(modelCount: number): string {
  return modelCount
    ? `Found ${modelCount} model${modelCount === 1 ? "" : "s"}.`
    : "Server found. Enter a model name.";
}

/** Default loopback endpoint of a local model server (Ollama's port). */
export const LOCAL_MODEL_BASE_URL = "http://127.0.0.1:11434/v1";

/** Loopback ports served by the local model hosts Sapphire detects (Ollama, oMLX, EXO, LM Studio, Unsloth). */
const LOCAL_MODEL_PORTS = new Set(["11434", "8080", "52415", "1234", "8888"]);

/**
 * Whether a base URL points at a loopback port served by a local model host.
 * Those endpoints authenticate nothing, so the connect UI must not ask for an API key.
 */
export function isLocalModelBaseUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  return loopback && LOCAL_MODEL_PORTS.has(url.port);
}
