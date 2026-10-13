import { hasReadyTalkingPresenter, type VideoStoryboard } from '../lib/videoStoryboard'

interface TalkingPresenterStatusProps {
  storyboard: VideoStoryboard
}

// A single, consistent Ready/Not Set indicator reused across Preview,
// Generate, and Final Download — so a user who skipped (or lost) their
// prepared opening/closing presenter clips can see that at every later
// step, not just inside Presenter & Voice itself. "Ready" only when BOTH
// scenes have a clip attached (see hasReadyTalkingPresenter's own doc).
export default function TalkingPresenterStatus({ storyboard }: TalkingPresenterStatusProps) {
  const ready = hasReadyTalkingPresenter(storyboard)
  // Reuses the existing vc-avatar-consent-badge visual language (Presenter
  // & Voice's own status badges) rather than inventing a new style — green
  // for "ready", the neutral base style for "not set" (this is a legitimate
  // choice, not an error, so it deliberately does not use the badge's red
  // "failed" variant).
  return <span className={`vc-avatar-consent-badge ${ready ? 'vc-avatar-consent-badge-ready' : ''}`}>Talking Presenter: {ready ? 'Ready' : 'Not Set'}</span>
}
