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
