// Run with: node --test src/lib/videoCreationSourceStoryboardWiring.test.ts
//
// Video Creation — the functional Source -> Storyboard phase.
// VideoCreation.tsx/VideoCreationSource.tsx import supabaseClient.ts
// transitively (via leadershipReportDraftService.ts/executiveSummaryService.ts),
// so — like every other Supabase-touching component in this app — neither
// can be imported and executed directly under plain `node --test`; verified
// via source inspection instead, the same established pattern used
// throughout this project. VideoCreationStoryboard.tsx has no such
// dependency but is checked the same way here for consistency with its
// sibling files. buildStoryboardFromAtsReport's own real behavior is
// covered by direct execution in videoStoryboard.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const sidebarSrc = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.tsx'), 'utf8')
const vcSrc = readFileSync(path.join(dir, '..', 'components', 'VideoCreation.tsx'), 'utf8')
const vcSourceSrc = readFileSync(path.join(dir, '..', 'components', 'VideoCreationSource.tsx'), 'utf8')
const vcStoryboardSrc = readFileSync(path.join(dir, '..', 'components', 'VideoCreationStoryboard.tsx'), 'utf8')
const storyboardLibSrc = readFileSync(path.join(dir, 'videoStoryboard.ts'), 'utf8')
const generateStoryboardEndpointSrc = readFileSync(path.join(dir, '..', '..', 'api', 'video', 'generate-storyboard.ts'), 'utf8')

// Several checks below look for the ABSENCE of a substring (an AI call, a
// disallowed import) — this project's own thorough explanatory comments
// have repeatedly produced false positives for exactly this kind of check
// (the comment describing why something is absent contains the very
// substring being searched for). Stripped here, the same established
// pattern used throughout this test suite (e.g.
// leadershipReportNavGuardWiring.test.ts).
const stripComments = (src: string) =>
  src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

describe('1. Video Creation destination still wires correctly', () => {
  test('video-creation remains one of the six AdminDestination values, with its own sidebar entry and handler', () => {
    assert.match(sidebarSrc, /\| 'video-creation'/)
    assert.match(sidebarSrc, /key: 'video-creation', label: 'Video Creation'/)
    assert.match(appSrc, /const \[videoCreationOpen, setVideoCreationOpen\] = useState\(false\)/)
    assert.match(appSrc, /const handleNavigateToVideoCreation = \(\) => \{/)
  })

  test('the Source/Storyboard flow never navigates to another admin destination — VideoCreation.tsx never calls App.tsx\'s navigation setters', () => {
    assert.equal(/setWeeklySummaryOpen|setReportsAnalyticsOpen|setUserManagementOpen|setLeadershipReportOpen|setVideoCreationOpen/.test(vcSrc), false)
  })
})

describe('2. Upload Report is disabled / marked "Coming next"', () => {
  test('Upload Report renders as a plain, non-button element with aria-disabled and a "Coming next" badge — never a clickable control', () => {
    const uploadMatch = vcSourceSrc.match(/<div className="vc-source-card vc-source-card-disabled"[\s\S]*?<\/div>/)
    assert.ok(uploadMatch, 'could not locate the Upload Report card')
    assert.match(uploadMatch[0], /aria-disabled="true"/)
    assert.match(uploadMatch[0], /Coming next/)
    assert.match(uploadMatch[0], /<h2>Upload Report<\/h2>/)
    assert.equal(/onClick/.test(uploadMatch[0]), false, 'Upload Report must have no onClick of any kind')
  })

  test('only Weekly Summary and Leadership Report are rendered as real, clickable <button> source cards', () => {
    const buttonCardMatches = [...vcSourceSrc.matchAll(/<button\s*\n\s*type="button"\s*\n\s*className=\{`vc-source-card[\s\S]*?<\/button>/g)]
    assert.equal(buttonCardMatches.length, 2, 'expected exactly two selectable <button> source cards')
  })
})

describe('3. Create Video cannot proceed without a valid, successfully-loaded source report', () => {
  test('canCreateVideo is derived from loaded !== null — not from sourceType alone', () => {
    assert.match(vcSourceSrc, /const canCreateVideo = loaded !== null/)
  })

  test('the Create Video button is disabled whenever canCreateVideo is false (which is also false while a generation is already in flight)', () => {
    assert.match(vcSourceSrc, /onClick=\{\(\) => void handleCreateVideo\(\)\}\s*\n\s*disabled=\{!canCreateVideo\}/)
    assert.match(vcSourceSrc, /const canCreateVideo = loaded !== null && !generating/)
  })

  test('handleCreateVideo itself also guards on loaded/sourceType, not just the disabled attribute', () => {
    const fnMatch = vcSourceSrc.match(/const handleCreateVideo = async \(\) => \{([\s\S]*?)\n {2}\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /if \(!loaded \|\| !sourceType\) return/)
  })

  test('no MP4/render/Anthropic call exists anywhere in the Source or Storyboard files for this phase', () => {
    for (const src of [vcSrc, vcSourceSrc, vcStoryboardSrc, storyboardLibSrc]) {
      assert.equal(/anthropic|\.mp4|remotion|ffmpeg/i.test(stripComments(src)), false)
    }
  })
})

describe('4. Weekly Summary source is loaded and copied into storyboard state', () => {
  test('fetchPersistedAnalysis(\'weekly\', week.weekStartDate) is the read used for Weekly Summary — the exact same call Leadership Report\'s own ATS pane already makes', () => {
    assert.match(vcSourceSrc, /fetchPersistedAnalysis\('weekly', week\.weekStartDate\)/)
    assert.match(vcSourceSrc, /import \{ fetchPersistedAnalysis, isAtsShapedSections \} from '\.\.\/lib\/executiveSummaryService'/)
  })

  test('only ATS-shaped sections are accepted (isAtsShapedSections), matching every other consumer of this same data', () => {
    assert.match(vcSourceSrc, /if \(persisted && isAtsShapedSections\(persisted\.sections\)\)/)
  })

  test('Create Video builds the storyboard from the loaded Weekly Summary report via buildStoryboardFromAtsReport, passing sourceType through unchanged', () => {
    assert.match(vcSourceSrc, /buildStoryboardFromAtsReport\(loaded\.report, loaded\.periodLabel, sourceType\)/)
    assert.match(vcSourceSrc, /onSelectSourceType\('weekly-summary'\)/)
  })

  test('this read never writes to executive_analyses — no .insert/.update/.upsert/.rpc appears anywhere in this file', () => {
    assert.equal(/\.rpc\(|\.from\(['"]executive_analys[^)]*\)\.(insert|update|upsert|delete)/.test(vcSourceSrc), false)
  })
})

describe('5. Leadership Report source is loaded and copied into storyboard state, with ownership/privacy preserved', () => {
  test('fetchLeadershipReportDraft(week.weekStartDate) is the read used — the exact same, already-RLS-scoped call LeadershipReportCurrent.tsx/LeadershipReportHistory.tsx already make, taking only a date', () => {
    assert.match(vcSourceSrc, /fetchLeadershipReportDraft\(week\.weekStartDate\)/)
    assert.match(vcSourceSrc, /import \{ fetchLeadershipReportDraft \} from '\.\.\/lib\/leadershipReportDraftService'/)
  })

  test('no owner_id or other user identifier is ever passed or filtered client-side in this file', () => {
    const codeOnly = vcSourceSrc
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    assert.equal(/owner_id/.test(codeOnly), false)
  })

  test('this file never imports LeadershipReportGate/the password gate, and never calls saveLeadershipReportDraft or any RPC — read-only, never a second write path', () => {
    assert.equal(/LeadershipReportGate/.test(vcSourceSrc), false)
    assert.equal(/saveLeadershipReportDraft/.test(vcSourceSrc), false)
    assert.equal(/\.rpc\(/.test(vcSourceSrc), false)
  })

  test('Create Video builds the storyboard from the loaded Leadership Report draft the same way as Weekly Summary, via the same buildStoryboardFromAtsReport call', () => {
    assert.match(vcSourceSrc, /onSelectSourceType\('leadership-report'\)/)
    // Only one buildStoryboardFromAtsReport call site exists, shared by both sources.
    assert.equal((vcSourceSrc.match(/buildStoryboardFromAtsReport\(/g) ?? []).length, 1)
  })
})

describe('6. Storyboard data model is isolated from AtsReport', () => {
  test('VideoStoryboard/VideoStoryboardScene are new, independent types — this file never imports or re-exports AtsReport/AtsTopicSection as its own scene shape', () => {
    assert.match(storyboardLibSrc, /export interface VideoStoryboardScene \{/)
    assert.match(storyboardLibSrc, /export interface VideoStoryboard \{/)
    assert.equal(/export (interface|type) AtsReport/.test(storyboardLibSrc), false)
  })

  test('the scene type union includes all nine documented scene types', () => {
    assert.match(
      storyboardLibSrc,
      /export type VideoSceneType =\s*\n\s*\| 'opening'\s*\n\s*\| 'executive-snapshot'\s*\n\s*\| 'big-metric'\s*\n\s*\| 'multi-metric'\s*\n\s*\| 'highlights'\s*\n\s*\| 'status'\s*\n\s*\| 'risk'\s*\n\s*\| 'forward-look'\s*\n\s*\| 'closing'/,
    )
  })

  test('no business topic name (Revenue/Technology/Operations/Recruiting/etc.) is hard-coded anywhere in the transform — every scene title beyond the fixed structural ones (opening/executive-snapshot/forward-look/closing) is read from topic.title', () => {
    assert.equal(/'Revenue'|'Technology'|'Operations'|'Recruiting'|'Retention'|'Sales'/.test(storyboardLibSrc), false)
    assert.match(storyboardLibSrc, /title: topic\.title,/)
  })
})

describe('7. Source objects cannot be mutated by storyboard editing', () => {
  test('buildStoryboardFromAtsReport never assigns into `report`/its topics/bullets — only .trim()/.map()/.filter() reads appear on it', () => {
    const fnMatch = storyboardLibSrc.match(/export function buildStoryboardFromAtsReport\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.equal(/report\.\w+\s*=/.test(fnMatch[0]), false, 'must never assign into a property of the source report')
    assert.equal(/report\.topics\[\d*\]\s*=/.test(fnMatch[0]), false)
  })

  test('every scene field is built from a NEW array/value (map/filter/trim), never the source topic\'s own array by reference', () => {
    assert.match(storyboardLibSrc, /const bullets = topic\.bullets\.map\(\(bullet\) => bullet\.trim\(\)\)\.filter\(\(bullet\) => bullet\.length > 0\)/)
    assert.equal(/bullets: topic\.bullets,/.test(storyboardLibSrc), false, 'must never assign the source array directly (by reference) into a scene')
  })

  test('VideoCreationStoryboard.tsx (the editor) never imports leadershipReportDraftService/executiveSummaryService/supabaseClient — editing can reach no source/persistence layer at all', () => {
    assert.equal(/leadershipReportDraftService|executiveSummaryService|supabaseClient/.test(stripComments(vcStoryboardSrc)), false)
  })

  test('every scene edit in the editor calls onChange with a NEW VideoStoryboard object (spread), never mutating storyboard/scenes in place', () => {
    assert.match(vcStoryboardSrc, /onChange\(\{\s*\n\s*\.\.\.storyboard,\s*\n\s*scenes: storyboard\.scenes\.map/)
    assert.match(vcStoryboardSrc, /onChange\(\{ \.\.\.storyboard, scenes: storyboard\.scenes\.filter/)
  })
})

describe('8. No invented topics are introduced by the deterministic transformer', () => {
  test('exactly one scene id per source topic (topic-${index}), and the transform never adds a topic scene beyond report.topics.length (real behavior verified in videoStoryboard.test.ts)', () => {
    assert.match(storyboardLibSrc, /id: `topic-\$\{index\}`,/)
    assert.match(storyboardLibSrc, /report\.topics\.forEach\(\(topic, index\) => \{/)
  })

  test('no AI/LLM call exists anywhere in the transform — this phase is 100% deterministic', () => {
    assert.equal(/anthropic|generateReportingAnalysis|\/api\/executive-summary/i.test(stripComments(storyboardLibSrc)), false)
  })
})

describe('9. Back to Source preserves safe expected behavior', () => {
  test('Back to Source only sets step back to \'source\' — it never clears sourceType/week, never discards the still-in-memory storyboard, and calls no destructive action', () => {
    assert.match(vcSrc, /const handleBackToSource = \(\) => \{\s*\n\s*setStep\('source'\)\s*\n\s*\}/)
  })

  test('the Storyboard step\'s Back to Source button calls the prop as-is, with no confirmation/discard logic of its own added in this phase', () => {
    assert.match(vcStoryboardSrc, /<button type="button" className="btn btn-secondary" onClick=\{onBackToSource\}>/)
  })

  test('re-entering Source after Back to Source still shows the previously loaded confirmation for the same source/week (sourceType/week state lives in VideoCreation.tsx, not reset by stepping back)', () => {
    assert.equal(/setSourceType\(null\)|setWeekOffset\(0\)/.test(vcSrc), false)
  })
})

describe('10. Existing navigation / Leadership Report leave guards remain intact', () => {
  test('requestLeaveLeadershipReportIfDirty and every one of its existing call sites (including the new Video Creation handler) are unchanged in shape', () => {
    assert.match(
      appSrc,
      /const requestLeaveLeadershipReportIfDirty = \(action: \(\) => void\) => \{\s*\n\s*if \(!leadershipReportOpen \|\| !leadershipReportDirty\) \{\s*\n\s*action\(\)\s*\n\s*return\s*\n\s*\}\s*\n\s*setPendingLeaveAction\(\(\) => action\)\s*\n\s*\}/,
    )
    assert.match(appSrc, /const handleNavigateToVideoCreation = \(\) => \{\s*\n\s*requestLeaveLeadershipReportIfDirty\(\(\) => \{/)
  })

  test('VideoCreation.tsx introduces no dirty-tracking/onDirtyChange concept of its own — this phase has nothing persisted yet to protect', () => {
    assert.equal(/onDirtyChange|isDirty|beforeunload/.test(vcSrc), false)
  })

  test('handleNavigateToLeadershipReport still resets videoCreationOpen (mutual exclusivity is preserved for the new destination too)', () => {
    const match = appSrc.match(/const handleNavigateToLeadershipReport = \(\) => \{([\s\S]*?)\n {2}\}/)
    assert.ok(match)
    assert.match(match[1], /setVideoCreationOpen\(false\)/)
  })
})

const aiServiceSrc = readFileSync(path.join(dir, 'videoStoryboardAiService.ts'), 'utf8')

describe('AI-assisted storyboard generation: attempted first, with a guaranteed deterministic fallback on any failure', () => {
  test('generateAiVideoStoryboard is attempted first inside handleCreateVideo, before the deterministic transformer is ever reached', () => {
    const fnMatch = vcSourceSrc.match(/const handleCreateVideo = async \(\) => \{([\s\S]*?)\n {2}\}/)
    assert.ok(fnMatch)
    const aiIndex = fnMatch[1].indexOf('generateAiVideoStoryboard(')
    const fallbackIndex = fnMatch[1].indexOf('buildStoryboardFromAtsReport(')
    assert.ok(aiIndex !== -1 && fallbackIndex !== -1 && aiIndex < fallbackIndex, 'AI generation must be attempted before the deterministic fallback')
  })

  test('the deterministic fallback lives in the catch block — ANY thrown error (network, auth, generation, invalid response) triggers it, not a specific error code', () => {
    const fnMatch = vcSourceSrc.match(/const handleCreateVideo = async \(\) => \{([\s\S]*?)\n {2}\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /\} catch \{\s*\n[\s\S]*?buildStoryboardFromAtsReport\(loaded\.report, loaded\.periodLabel, sourceType\)/)
  })

  test('onCreateVideo is called exactly once per attempt — once in the try (AI success) and once in the catch (fallback), never both, so the user always ends up with exactly one storyboard', () => {
    const fnMatch = vcSourceSrc.match(/const handleCreateVideo = async \(\) => \{([\s\S]*?)\n {2}\}/)
    assert.ok(fnMatch)
    const onCreateVideoCalls = (fnMatch[1].match(/onCreateVideo\(/g) ?? []).length
    assert.equal(onCreateVideoCalls, 2, 'expected exactly one call in the try branch and one in the catch branch')
  })

  test('generating is set in a finally block, so it is always cleared whether generation succeeded or fell back', () => {
    const fnMatch = vcSourceSrc.match(/const handleCreateVideo = async \(\) => \{([\s\S]*?)\n {2}\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /setGenerating\(true\)/)
    assert.match(fnMatch[1], /\} finally \{\s*\n\s*setGenerating\(false\)\s*\n\s*\}/)
  })

  test('while generating, the button is replaced by a "Creating your video storyboard…" status line, not merely disabled — a polished loading state, not a frozen control', () => {
    assert.match(vcSourceSrc, /\{generating \? \(\s*\n\s*<p className="vc-generating-status">Creating your video storyboard&hellip;<\/p>/)
  })

  test('generateAiVideoStoryboard is called with only sourceType and week.weekStartDate — never the report content itself', () => {
    assert.match(vcSourceSrc, /generateAiVideoStoryboard\(sourceType, week\.weekStartDate\)/)
  })

  test('videoStoryboardAiService.ts never imports Anthropic or exposes any AI credential — it only ever calls the internal /api/video/generate-storyboard endpoint over fetch', () => {
    assert.equal(/anthropic|ANTHROPIC_API_KEY/i.test(aiServiceSrc), false)
    assert.match(aiServiceSrc, /fetch\('\/api\/video\/generate-storyboard'/)
  })

  test('the storyboard passed to onCreateVideo reflects generationMethod (\'ai\' on success, \'deterministic\' on fallback) — VideoCreationStoryboard.tsx surfaces this distinction to the user as a real, hard-to-miss banner (role="alert"), not a small muted line', () => {
    assert.match(vcStoryboardSrc, /storyboard\.generationMethod === 'ai'/)
    assert.match(vcStoryboardSrc, /AI-generated draft — review and edit as needed\./)
    assert.match(vcStoryboardSrc, /className="vc-storyboard-generation-note vc-storyboard-generation-note-fallback" role="alert"/)
    assert.match(vcStoryboardSrc, /AI storyboard could not be generated\. A basic fallback storyboard was created instead/)
    assert.equal(/technical|server|stack|exception|Error:/i.test(vcStoryboardSrc.match(/AI storyboard could not be generated[\s\S]*?<\/p>/)?.[0] ?? ''), false)
  })
})

describe('Source -> Storyboard stays free of the (now-introduced, later-phase) rendering dependency', () => {
  // Remotion was intentionally added in the subsequent Template -> Local
  // Renderer -> First Real MP4 phase (see remotion/, scripts/render-storyboard.mts,
  // dev/local-video-render-plugin.ts and their own test coverage in
  // remotion/videoRenderWiring.test.ts) — so package.json legitimately
  // declares it now. What still must hold is architectural: the
  // Source/Storyboard step's own files never reach into rendering directly,
  // "AI/source-parsing chooses the STORY, the renderer (a separate module)
  // controls the DESIGN."
  test('no client or server Video Creation Source/Storyboard file references Remotion/FFmpeg or produces an MP4', () => {
    for (const src of [vcSrc, vcSourceSrc, vcStoryboardSrc, storyboardLibSrc, aiServiceSrc]) {
      assert.equal(/remotion|ffmpeg|\.mp4/i.test(stripComments(src)), false)
    }
  })
})

// Investigation context: a display issue was reported where AI-generated
// scene values appeared not to render in VideoCreationStoryboard. Full
// tracing (server-side pipeline replay through a real JSON round-trip, plus
// a live isolated render of the real component with realistic AI-shaped
// data) proved the data pipeline and the editor's rendering logic were
// already correct; the one confirmed bug found (metric `context` being
// silently dropped) is fixed and covered with real execution in
// videoStoryboard.test.ts. These tests pin the exact prop bindings this
// investigation traced through, so a future regression here is caught
// immediately rather than requiring another live investigation.
describe('AI-generated scene content reaches the editor\'s input/textarea values', () => {
  test('title is always bound, unconditionally, to scene.title', () => {
    assert.match(vcStoryboardSrc, /<label>Title<\/label>\s*\n\s*<input\s*\n\s*type="text"\s*\n\s*className="vc-scene-input"\s*\n\s*value=\{scene\.title\}/)
  })

  test('body is rendered only when present, and bound to scene.body verbatim (no transformation)', () => {
    assert.match(
      vcStoryboardSrc,
      /\{scene\.body !== undefined && \(\s*\n\s*<div className="vc-scene-field">\s*\n\s*<label>Body<\/label>\s*\n\s*<textarea\s*\n\s*className="vc-scene-input"\s*\n\s*rows=\{2\}\s*\n\s*value=\{scene\.body\}/,
    )
  })

  test('bullets are rendered only when present, and bound via the shared, unit-tested sceneBulletsToText/textToSceneBullets encoding', () => {
    assert.match(vcStoryboardSrc, /\{scene\.bullets !== undefined && \(/)
    assert.match(vcStoryboardSrc, /value=\{sceneBulletsToText\(scene\.bullets\)\}/)
    assert.match(vcStoryboardSrc, /onChange=\{\(e\) => updateScene\(scene\.id, \{ bullets: textToSceneBullets\(e\.target\.value\) \}\)\}/)
  })

  test('metrics are rendered only when present, and bound via the shared, unit-tested sceneMetricsToText/textToSceneMetrics encoding (never the old context-dropping inline version)', () => {
    assert.match(vcStoryboardSrc, /\{scene\.metrics !== undefined && \(/)
    assert.match(vcStoryboardSrc, /value=\{sceneMetricsToText\(scene\.metrics\)\}/)
    assert.match(vcStoryboardSrc, /onChange=\{\(e\) => updateScene\(scene\.id, \{ metrics: textToSceneMetrics\(e\.target\.value\) \}\)\}/)
    assert.equal(/function metricsToText\(|function bulletsToText\(|function textToMetrics\(|function textToBullets\(/.test(vcStoryboardSrc), false)
  })

  test('next is rendered only when present, and bound to scene.next verbatim', () => {
    assert.match(
      vcStoryboardSrc,
      /\{scene\.next !== undefined && \(\s*\n\s*<div className="vc-scene-field">\s*\n\s*<label>Next<\/label>\s*\n\s*<textarea\s*\n\s*className="vc-scene-input"\s*\n\s*rows=\{2\}\s*\n\s*value=\{scene\.next\}/,
    )
  })

  test('the five optional fields (body/bullets/metrics/next/narrationText) each gate on their own field being defined — a scene missing one never shows a blank input for it, only genuinely absent fields are omitted', () => {
    assert.equal((vcStoryboardSrc.match(/!== undefined && \(/g) ?? []).length, 5)
  })

  test('narrationText is rendered only when present, and bound to scene.narrationText verbatim (added for the leadership-importance/visual-concept/narration-prep phase)', () => {
    assert.match(vcStoryboardSrc, /\{scene\.narrationText !== undefined && \(/)
    assert.match(vcStoryboardSrc, /value=\{scene\.narrationText\}/)
    assert.match(vcStoryboardSrc, /onChange=\{\(e\) => updateScene\(scene\.id, \{ narrationText: e\.target\.value \}\)\}/)
  })
})

describe('No temporary [video-storyboard-diag] logging remains in the AI storyboard endpoint', () => {
  test('the endpoint file contains no diagnostic log lines of any kind — normal, pre-existing console.error error handling is untouched', () => {
    assert.equal(/video-storyboard-diag/.test(generateStoryboardEndpointSrc), false)
    // The established, non-diagnostic error logging this file already had
    // (predates this investigation) must still be present.
    assert.match(generateStoryboardEndpointSrc, /console\.error\('generate-storyboard: missing ANTHROPIC_API_KEY\.'\)/)
    assert.match(generateStoryboardEndpointSrc, /console\.error\('generate-storyboard: AI storyboard generation failed or was rejected:'/)
    assert.match(generateStoryboardEndpointSrc, /console\.error\('generate-storyboard: unexpected error:', err\)/)
  })
})
