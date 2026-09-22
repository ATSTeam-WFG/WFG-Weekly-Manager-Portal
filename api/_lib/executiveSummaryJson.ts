// Pure, dependency-free JSON-extraction/truncation-detection helper for the
// AI executive-analysis response. Split out of executive-summary.ts solely
// so this logic can be dynamically unit-tested — that file's own heavy
// import graph (Anthropic SDK, Supabase, reportsAnalyticsService, etc.)
// makes it unsafe to import directly in a bare `node --test` run (see
// executiveSummaryPrompt.test.ts's own header for the same limitation).
//
// SECURITY: this module and its callers must never log, throw with, or
// otherwise surface the raw AI response text, the prompt, or any manager
// report content. Every result here is either the extracted JSON string
// itself (handed straight to JSON.parse, never logged) or plain metadata
// (lengths, booleans, counts, category labels) safe for Vercel logs.

// Anthropic's Message.stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence'
// | 'tool_use' | null. Only the string type is needed here, so this module
// stays dependency-free rather than importing the Anthropic SDK's own type.
export type AnthropicStopReason = string | null

export type ExtractJsonResult =
  | { outcome: 'ok'; json: string }
  // The API cut generation off before it finished — checked BEFORE any
  // brace-based inspection, since a partially-emitted large JSON value
  // could coincidentally contain both '{' and '}' characters and pass a
  // naive check even though the object itself was never actually completed.
  | { outcome: 'truncated' }
  | { outcome: 'empty' }
  | { outcome: 'no_json_object'; hasOpenBrace: boolean; hasCloseBrace: boolean }

// Structural, not imported from the Anthropic SDK — keeps this module
// dependency-free. Matches the shape of every member of the SDK's own
// ContentBlock union closely enough: a text block has `type: 'text'` and
// `text: string`; every other block type either has no `text` field at all
// or (checked against the installed SDK's own types) never a `text` field
// of a different, incompatible type.
export interface AiContentBlockLike {
  type: string
  text?: string
}

// Anthropic can legitimately split a single turn's output across more than
// one `text` content block, with no separator implied between them — this
// isn't tied to tool use or extended thinking, and reading only the first
// block (e.g. `content.find(...)`) silently discards the rest, which can
// leave a truncated fragment that still happens to contain brace
// characters and so passes extractAiJson's boundary check while still
// failing JSON.parse. This collects every `text` block in its original
// order and concatenates them into the complete response; any other block
// type (thinking, tool_use, etc.) is skipped entirely. Zero text blocks
// safely yields ''.
export function assembleTextFromContentBlocks(blocks: readonly AiContentBlockLike[]): string {
  return blocks
    .filter((block): block is AiContentBlockLike & { text: string } => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

export function extractAiJson(text: string, stopReason: AnthropicStopReason): ExtractJsonResult {
  if (stopReason === 'max_tokens') {
    return { outcome: 'truncated' }
  }
  if (!text || text.trim().length === 0) {
    return { outcome: 'empty' }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    return { outcome: 'no_json_object', hasOpenBrace: start !== -1, hasCloseBrace: end !== -1 }
  }
  return { outcome: 'ok', json: text.slice(start, end + 1) }
}
