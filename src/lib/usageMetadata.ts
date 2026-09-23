/**
 * The fields the route proxy writes into a usage row's `metadata_json`, plus the
 * whole blob formatted for display.
 *
 * Only the values the detail panel names on their own are pulled out; everything
 * else stays visible through `formatted`, so a metadata key added on the Rust
 * side still reaches the user without a change here.
 */
export type ParsedUsageMetadata = {
  /**
   * False when the blob is not a JSON object. `formatted` then carries the
   * original text: an unparseable metadata row is exactly the case where seeing
   * what was actually stored matters most.
   */
  valid: boolean;
  /** Pretty-printed JSON when `valid`, the original text when not. */
  formatted: string;
  targetUrl: string | null;
  traceId: string | null;
  /** Stringified because the proxy writes it as a number. */
  durationMs: string | null;
  errorMessage: string | null;
  requestedModel: string | null;
  upstreamModel: string | null;
  /** Upstream body preview, already truncated by the proxy before storage. */
  responseBody: string | null;
};

const EMPTY_FIELDS = {
  targetUrl: null,
  traceId: null,
  durationMs: null,
  errorMessage: null,
  requestedModel: null,
  upstreamModel: null,
  responseBody: null,
} as const;

/** Read one scalar metadata field, treating blank strings as absent. */
function field(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** Keys the response preview is stored under, newest form first. */
export const RESPONSE_BODY_ENCODED_KEY = "response_body_br";
export const RESPONSE_BODY_KEY = "response_body";

/**
 * Whether `text` has the shape of the base64 form rather than a plain preview.
 *
 * Base64 output is padded to a multiple of four; a preview of a JSON or SSE body
 * starts with `{`, `[`, a quote or a `data:` keyword, so it fails either the
 * length test or the alphabet test. Anything doubtful is treated as plain text,
 * because misreading here shows the user gibberish instead of the body.
 */
export function looksBase64(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
}

/**
 * Decode the stored response preview into the upstream text.
 *
 * Rows written since the preview was compressed hold base64 of a brotli stream;
 * older rows hold the preview as plain text. Both have to keep working, because
 * `usage_events` is never pruned — the history is the point.
 *
 * Async because the platform's own brotli lives behind the streaming
 * `DecompressionStream`, and pulling in a JavaScript decoder for a few kilobytes
 * of already-truncated preview would not pay for itself.
 */
export async function decodeStoredBody(encoded: string): Promise<string> {
  const trimmed = encoded.trim();
  if (!looksBase64(trimmed)) {
    return encoded;
  }
  try {
    return decodeBase64Brotli(trimmed);
  } catch {
    // Shaped like base64, but not a brotli stream: it was a plain preview whose
    // text happened to match. Show it rather than lose it.
    return encoded;
  }
}

/**
 * base64 → brotli → text, using only standard platform APIs.
 *
 * The bytes are pushed through the writable side rather than handed to
 * `new Blob(...).stream()`, because jsdom — the environment the tests run in —
 * ships a `Blob` without `stream()`, and because writing is the shape that needs
 * no intermediate copy.
 */
async function decodeBase64Brotli(encoded: string): Promise<string> {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  // Cast rather than widen: `DecompressionStream` is typed against the DOM
  // spec's `CompressionFormat`, which has not caught up with the brotli value
  // every shipping engine accepts.
  const decompressor = new DecompressionStream("brotli" as CompressionFormat);
  const parts: Uint8Array[] = [];
  const collected = (async () => {
    const reader = decompressor.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        parts.push(value);
      }
    }
  })();

  const writer = decompressor.writable.getWriter();
  try {
    await writer.write(bytes);
    await writer.close();
  } catch (error) {
    // The reader is still waiting on a stream that will now never finish; drop
    // it rather than let its rejection surface as an unhandled one.
    void collected.catch(() => undefined);
    throw error;
  }
  await collected;

  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(merged);
}

/** Resolve the response preview out of a parsed metadata object. */
export function storedResponseBody(record: Record<string, unknown>): string | null {
  return (
    field(record, RESPONSE_BODY_ENCODED_KEY) ?? field(record, RESPONSE_BODY_KEY)
  );
}

/** Split the named fields out of a usage row's stored proxy metadata. */
export function parseUsageMetadata(metadataJson: string): ParsedUsageMetadata {
  let value: unknown;
  try {
    value = JSON.parse(metadataJson);
  } catch {
    return { ...EMPTY_FIELDS, valid: false, formatted: metadataJson };
  }

  const formatted = JSON.stringify(value, null, 2) ?? metadataJson;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    // Valid JSON, but not the object shape the named fields live in.
    return { ...EMPTY_FIELDS, valid: true, formatted };
  }

  const record = value as Record<string, unknown>;
  return {
    valid: true,
    formatted,
    targetUrl: field(record, "target_url"),
    traceId: field(record, "trace_id"),
    durationMs: field(record, "duration_ms"),
    errorMessage: field(record, "error_message"),
    requestedModel: field(record, "requested_model"),
    upstreamModel: field(record, "upstream_model"),
    // Still encoded at this point — the caller decodes what it actually shows,
    // so a compressed preview is never thrown away by a parse that only wanted
    // the model names.
    responseBody: storedResponseBody(record),
  };
}

/**
 * Indent a JSON payload, or hand back the text unchanged.
 *
 * Upstream bodies arrive as plain JSON, as an SSE stream, or truncated mid-token,
 * and only the first of those can be re-indented.
 */
export function prettyJsonOrText(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
