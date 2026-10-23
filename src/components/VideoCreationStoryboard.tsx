import {
  estimateStoryboardDurationSeconds,
  formatDurationLabel,
  LEADERSHIP_IMPORTANCE_LABELS,
  LEADERSHIP_IMPORTANCE_VALUES,
  sceneBulletsToText,
  sceneMetricsToText,
  textToSceneBullets,
  textToSceneMetrics,
  VISUAL_CONCEPT_LABELS,
  VISUAL_CONCEPT_VALUES,
  type LeadershipImportance,
  type VideoStoryboard,
  type VideoStoryboardScene,
  type VisualConcept,
} from '../lib/videoStoryboard'

interface VideoCreationStoryboardProps {
  storyboard: VideoStoryboard
  onChange: (storyboard: VideoStoryboard) => void
  onBackToSource: () => void
  onContinueToPresenter: () => void
}

const SOURCE_TYPE_LABEL: Record<VideoStoryboard['sourceType'], string> = {
  'weekly-summary': 'Weekly Summary',
  'leadership-report': 'Leadership Report',
}

// A pinned scene (opening/closing) keeps the video's brand-consistent
// start/end fixed — the admin can still edit its text, but never delete or
// reorder it away from its position.
function isPinnedScene(scene: VideoStoryboardScene): boolean {
  return scene.type === 'opening' || scene.type === 'closing'
}

// The Storyboard step: a review/edit surface over the VideoStoryboard the
// Source step already built. Every edit here only ever calls onChange with
// a new VideoStoryboard object — this component never imports
// leadershipReportDraftService/executiveSummaryService, never calls
// saveLeadershipReportDraft or any RPC, and never touches the AtsReport
// the storyboard was originally derived from. Editing here can change what
// the EVENTUAL video will show; it can never change what Weekly
// Summary/Leadership Report itself displays or has saved.
export default function VideoCreationStoryboard({ storyboard, onChange, onBackToSource, onContinueToPresenter }: VideoCreationStoryboardProps) {
  const durationLabel = formatDurationLabel(estimateStoryboardDurationSeconds(storyboard))

  const updateScene = (id: string, patch: Partial<VideoStoryboardScene>) => {
    onChange({
      ...storyboard,
      scenes: storyboard.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
    })
  }

  const deleteScene = (id: string) => {
    onChange({ ...storyboard, scenes: storyboard.scenes.filter((scene) => scene.id !== id) })
  }

  const moveScene = (id: string, direction: -1 | 1) => {
    const index = storyboard.scenes.findIndex((scene) => scene.id === id)
    if (index === -1) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= storyboard.scenes.length) return
    const scenes = [...storyboard.scenes]
    ;[scenes[index], scenes[targetIndex]] = [scenes[targetIndex], scenes[index]]
    onChange({ ...storyboard, scenes })
  }

  return (
    <div className="vc-storyboard">
      <div className="vc-storyboard-summary">
        <h2>Executive Story</h2>
        <p className="vc-storyboard-summary-line">
          {SOURCE_TYPE_LABEL[storyboard.sourceType]} &middot; {storyboard.weekEnding}
        </p>
        <p className="vc-storyboard-summary-line">
          {storyboard.scenes.length} scene{storyboard.scenes.length === 1 ? '' : 's'} &middot; approximately {durationLabel}
        </p>
        {storyboard.generationMethod === 'ai' ? (
          <p className="vc-storyboard-generation-note">AI-generated draft — review and edit as needed.</p>
        ) : (
          <p className="vc-storyboard-generation-note vc-storyboard-generation-note-fallback" role="alert">
            AI storyboard could not be generated. A basic fallback storyboard was created instead — review it
            carefully, or go back and try again.
          </p>
        )}
      </div>

      <div className="vc-scene-list">
        {storyboard.scenes.map((scene, index) => {
          const pinned = isPinnedScene(scene)
          return (
            <div className="vc-scene-card" key={scene.id}>
              <div className="vc-scene-card-header">
                <span className="vc-scene-type-badge">{scene.type}</span>
                {!pinned && (
                  <div className="vc-scene-controls">
                    <button
                      type="button"
                      className="btn btn-secondary vc-scene-icon-btn"
                      onClick={() => moveScene(scene.id, -1)}
                      disabled={index === 0 || isPinnedScene(storyboard.scenes[index - 1])}
                      aria-label="Move scene up"
                    >
                      &uarr;
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary vc-scene-icon-btn"
                      onClick={() => moveScene(scene.id, 1)}
                      disabled={index === storyboard.scenes.length - 1 || isPinnedScene(storyboard.scenes[index + 1])}
                      aria-label="Move scene down"
                    >
                      &darr;
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => deleteScene(scene.id)}>
                      Remove Scene
                    </button>
                  </div>
                )}
              </div>

              {/* Leadership INTELLIGENCE (why this scene exists / how it's told visually) — kept as two
                  compact badge-selects, deliberately separate from the CONTENT fields below, so an admin
                  can see "Risk / Technology Friction / Visual: Bottleneck" at a glance without wading
                  through a technical form. Editable because either the deterministic fallback's safe
                  structural guess or the AI's own classification may need a human correction. */}
              <div className="vc-scene-intelligence">
                <select
                  className={`vc-scene-intelligence-select${scene.leadershipImportance ? '' : ' vc-scene-intelligence-unset'}`}
                  value={scene.leadershipImportance ?? ''}
                  onChange={(e) =>
                    updateScene(scene.id, { leadershipImportance: (e.target.value || undefined) as LeadershipImportance | undefined })
                  }
                  aria-label="Leadership importance"
                >
                  <option value="">Leadership: (none)</option>
                  {LEADERSHIP_IMPORTANCE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {LEADERSHIP_IMPORTANCE_LABELS[value]}
                    </option>
                  ))}
                </select>
                <select
                  className={`vc-scene-intelligence-select${scene.visualConcept ? '' : ' vc-scene-intelligence-unset'}`}
                  value={scene.visualConcept ?? ''}
                  onChange={(e) => updateScene(scene.id, { visualConcept: (e.target.value || undefined) as VisualConcept | undefined })}
                  aria-label="Visual concept"
                >
                  <option value="">Visual: (none)</option>
                  {VISUAL_CONCEPT_VALUES.map((value) => (
                    <option key={value} value={value}>
                      Visual: {VISUAL_CONCEPT_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="vc-scene-field">
                <label>Title</label>
                <input
                  type="text"
                  className="vc-scene-input"
                  value={scene.title}
                  onChange={(e) => updateScene(scene.id, { title: e.target.value })}
                />
              </div>

              {scene.body !== undefined && (
                <div className="vc-scene-field">
                  <label>Body</label>
                  <textarea
                    className="vc-scene-input"
                    rows={2}
                    value={scene.body}
                    onChange={(e) => updateScene(scene.id, { body: e.target.value })}
                  />
                </div>
              )}

              {scene.bullets !== undefined && (
                <div className="vc-scene-field">
                  <label>Bullets (one per line)</label>
                  <textarea
                    className="vc-scene-input"
                    rows={3}
                    value={sceneBulletsToText(scene.bullets)}
                    onChange={(e) => updateScene(scene.id, { bullets: textToSceneBullets(e.target.value) })}
                  />
                </div>
              )}

              {scene.metrics !== undefined && (
                <div className="vc-scene-field">
                  <label>Metrics (one &quot;Label: Value&quot; per line — add &quot; | context&quot; to include optional context)</label>
                  <textarea
                    className="vc-scene-input"
                    rows={2}
                    value={sceneMetricsToText(scene.metrics)}
                    onChange={(e) => updateScene(scene.id, { metrics: textToSceneMetrics(e.target.value) })}
                  />
                </div>
              )}

              {scene.next !== undefined && (
                <div className="vc-scene-field">
                  <label>Next</label>
                  <textarea
                    className="vc-scene-input"
                    rows={2}
                    value={scene.next}
                    onChange={(e) => updateScene(scene.id, { next: e.target.value })}
                  />
                </div>
              )}

              {scene.narrationText !== undefined && (
                <div className="vc-scene-field">
                  <label>Narration (spoken version — for a future voiceover; not narrated yet)</label>
                  <textarea
                    className="vc-scene-input"
                    rows={2}
                    value={scene.narrationText}
                    onChange={(e) => updateScene(scene.id, { narrationText: e.target.value })}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="vc-storyboard-actions">
        <button type="button" className="btn btn-secondary" onClick={onBackToSource}>
          Back to Source
        </button>
        <button type="button" className="btn btn-primary" onClick={onContinueToPresenter}>
          Continue to Presenter &amp; Voice
        </button>
      </div>
    </div>
  )
}
