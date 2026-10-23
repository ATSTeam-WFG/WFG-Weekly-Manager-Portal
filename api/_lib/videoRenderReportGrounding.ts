import type { AtsReport } from '../../src/lib/atsReport.js'
import type { VideoStoryboard } from '../../src/lib/videoStoryboard.js'

type GroundingResult =
  | { ok: true }
  | { ok: false; code: 'UNSUPPORTED_NUMERIC_CLAIM' | 'INVALID_SOURCE_TOPIC' }

function numbers(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? []
}

function sourceText(report: AtsReport): string {
  return [
    report.openingParagraph,
    ...report.topics.flatMap((topic) => [
      topic.title,
      topic.statusSummary,
      topic.next,
      ...topic.bullets,
    ]),
  ].join(' ')
}

export function validateRenderReportGrounding(
  storyboard: VideoStoryboard,
  report: AtsReport,
): GroundingResult {
  const sourceNumbers = new Set(numbers(sourceText(report)))

  for (const scene of storyboard.scenes) {
    if (scene.sourceTopicIndexes !== undefined) {
      if (!Array.isArray(scene.sourceTopicIndexes) ||
          !scene.sourceTopicIndexes.every(
            (index) =>
              Number.isInteger(index) &&
              index >= 0 &&
              index < report.topics.length,
          )) {
        return { ok: false, code: 'INVALID_SOURCE_TOPIC' }
      }
    }

    // Opening and closing are fixed brand-framing scenes.
    // Their wording still requires separate editorial approval.
    if (scene.type === 'opening' || scene.type === 'closing') {
      continue
    }

    const claims = [
      scene.title,
      scene.eyebrow ?? '',
      scene.body ?? '',
      scene.next ?? '',
      scene.narrationText ?? '',
      ...(scene.bullets ?? []),
      ...(scene.metrics ?? []).flatMap((metric) => [
        metric.label,
        metric.value,
        metric.context ?? '',
      ]),
    ].join(' ')

    for (const number of numbers(claims)) {
      if (!sourceNumbers.has(number)) {
        return { ok: false, code: 'UNSUPPORTED_NUMERIC_CLAIM' }
      }
    }
  }

  return { ok: true }
}
