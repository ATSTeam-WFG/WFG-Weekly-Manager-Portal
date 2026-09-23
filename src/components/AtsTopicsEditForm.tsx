import type { AtsReport, AtsTopicSection } from '../lib/atsReport'
import './AtsTopicsEditForm.css'

interface AtsTopicsEditFormProps {
  report: AtsReport
  onChange: (report: AtsReport) => void
}

const MAX_BULLETS = 5
const EMPTY_TOPIC: AtsTopicSection = { title: '', statusSummary: '', bullets: [''], next: '' }

// The editable counterpart to the read-only, presentation-only
// AtsReportView (src/components/AtsReportView.tsx) — that component is
// frozen/unmodified by this phase, so a separate component owns editing
// instead of adding write behavior to it. Purely a controlled form: it
// never fetches, saves, or calls the AI itself — the caller
// (ExecutiveAnalysisCard) owns `editedSections` state and persists it via
// the existing saveEditedAnalysis RPC on its own Save button, exactly the
// same save path the legacy fixed-7-textarea form already uses.
export default function AtsTopicsEditForm({ report, onChange }: AtsTopicsEditFormProps) {
  const setOpeningParagraph = (value: string) => {
    onChange({ ...report, openingParagraph: value })
  }

  const setTopic = (index: number, topic: AtsTopicSection) => {
    const topics = report.topics.map((t, i) => (i === index ? topic : t))
    onChange({ ...report, topics })
  }

  const addTopic = () => {
    onChange({ ...report, topics: [...report.topics, { ...EMPTY_TOPIC, bullets: [''] }] })
  }

  const removeTopic = (index: number) => {
    onChange({ ...report, topics: report.topics.filter((_, i) => i !== index) })
  }

  const moveTopic = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= report.topics.length) return
    const topics = [...report.topics]
    ;[topics[index], topics[target]] = [topics[target], topics[index]]
    onChange({ ...report, topics })
  }

  const setBullet = (topicIndex: number, bulletIndex: number, value: string) => {
    const topic = report.topics[topicIndex]
    const bullets = topic.bullets.map((b, i) => (i === bulletIndex ? value : b))
    setTopic(topicIndex, { ...topic, bullets })
  }

  const addBullet = (topicIndex: number) => {
    const topic = report.topics[topicIndex]
    if (topic.bullets.length >= MAX_BULLETS) return
    setTopic(topicIndex, { ...topic, bullets: [...topic.bullets, ''] })
  }

  const removeBullet = (topicIndex: number, bulletIndex: number) => {
    const topic = report.topics[topicIndex]
    setTopic(topicIndex, { ...topic, bullets: topic.bullets.filter((_, i) => i !== bulletIndex) })
  }

  return (
    <div className="ats-edit-form">
      <div className="executive-summary-block">
        <h3>Opening Paragraph</h3>
        <textarea
          className="executive-summary-edit-textarea"
          value={report.openingParagraph}
          onChange={(e) => setOpeningParagraph(e.target.value)}
          rows={3}
        />
      </div>

      {report.topics.map((topic, topicIndex) => (
        <div className="ats-edit-topic" key={topicIndex}>
          <div className="ats-edit-topic-header">
            <span className="ats-edit-topic-label">Topic {topicIndex + 1}</span>
            <div className="ats-edit-topic-controls">
              <button
                type="button"
                className="btn btn-secondary ats-edit-icon-btn"
                onClick={() => moveTopic(topicIndex, -1)}
                disabled={topicIndex === 0}
                aria-label="Move topic up"
              >
                &uarr;
              </button>
              <button
                type="button"
                className="btn btn-secondary ats-edit-icon-btn"
                onClick={() => moveTopic(topicIndex, 1)}
                disabled={topicIndex === report.topics.length - 1}
                aria-label="Move topic down"
              >
                &darr;
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => removeTopic(topicIndex)}>
                Remove Topic
              </button>
            </div>
          </div>

          <div className="executive-summary-block">
            <label>Title</label>
            <input
              type="text"
              className="executive-summary-edit-textarea"
              value={topic.title}
              onChange={(e) => setTopic(topicIndex, { ...topic, title: e.target.value })}
            />
          </div>

          <div className="executive-summary-block">
            <label>Status Summary</label>
            <textarea
              className="executive-summary-edit-textarea"
              value={topic.statusSummary}
              onChange={(e) => setTopic(topicIndex, { ...topic, statusSummary: e.target.value })}
              rows={2}
            />
          </div>

          <div className="executive-summary-block">
            <label>Bullets</label>
            {topic.bullets.map((bullet, bulletIndex) => (
              <div className="ats-edit-bullet-row" key={bulletIndex}>
                <input
                  type="text"
                  className="executive-summary-edit-textarea"
                  value={bullet}
                  onChange={(e) => setBullet(topicIndex, bulletIndex, e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary ats-edit-icon-btn"
                  onClick={() => removeBullet(topicIndex, bulletIndex)}
                  disabled={topic.bullets.length <= 1}
                  aria-label="Remove bullet"
                >
                  &times;
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary ats-edit-add-bullet"
              onClick={() => addBullet(topicIndex)}
              disabled={topic.bullets.length >= MAX_BULLETS}
            >
              Add Bullet
            </button>
          </div>

          <div className="executive-summary-block">
            <label>Next</label>
            <textarea
              className="executive-summary-edit-textarea"
              value={topic.next}
              onChange={(e) => setTopic(topicIndex, { ...topic, next: e.target.value })}
              rows={2}
            />
          </div>
        </div>
      ))}

      <button type="button" className="btn btn-secondary" onClick={addTopic}>
        Add Topic
      </button>
    </div>
  )
}
