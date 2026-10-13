import { useState } from 'react'
import { confirmSubjectMediaConsent, rejectSubjectMediaConsent, VideoConsentError } from '../lib/videoConsentService'
import type { ConsentPolicy, ConsentConfirmations, MediaConsent } from '../lib/videoPresenterConsent'
import { allConfirmed } from '../lib/videoPresenterConsent'
import './VideoConsentInbox.css'

interface VideoConsentInboxProps {
  policy: ConsentPolicy | null
  requests: MediaConsent[]
  onDecided: (consentId: string) => void
  onClose: () => void
}

const EMPTY_CONFIRMATIONS: ConsentConfirmations = {
  rightsConfirmed: false,
  syntheticAuthorizationConfirmed: false,
  purposeConfirmed: false,
  disclosureAcknowledged: false,
}

// Reachable by ANY authenticated user, regardless of admin status — the
// named subject of a consent request is often not the admin who initiated
// it (see App.tsx's always-on pending-request check). Only
// confirm_subject_media_consent/reject_subject_media_consent calls land
// here, both of which the server independently re-verifies are being
// called by the row's own subject_profile_id — this component's UI state
// is never itself trusted as authorization.
export default function VideoConsentInbox({ policy, requests, onDecided, onClose }: VideoConsentInboxProps) {
  const [confirmationsByRequest, setConfirmationsByRequest] = useState<Record<string, ConsentConfirmations>>({})
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)
  const [errorByRequest, setErrorByRequest] = useState<Record<string, string>>({})

  const confirmationsFor = (id: string) => confirmationsByRequest[id] ?? EMPTY_CONFIRMATIONS

  const setConfirmation = (id: string, patch: Partial<ConsentConfirmations>) => {
    setConfirmationsByRequest((prev) => ({ ...prev, [id]: { ...confirmationsFor(id), ...patch } }))
  }

  const handleConfirm = async (request: MediaConsent) => {
    const confirmations = confirmationsFor(request.id)
    setBusyRequestId(request.id)
    setErrorByRequest((prev) => ({ ...prev, [request.id]: '' }))
    try {
      await confirmSubjectMediaConsent(request.id, confirmations)
      onDecided(request.id)
    } catch (err) {
      setErrorByRequest((prev) => ({ ...prev, [request.id]: err instanceof VideoConsentError ? err.message : 'Could not confirm this consent.' }))
    } finally {
      setBusyRequestId(null)
    }
  }

  const handleReject = async (request: MediaConsent) => {
    setBusyRequestId(request.id)
    try {
      await rejectSubjectMediaConsent(request.id)
      onDecided(request.id)
    } catch (err) {
      setErrorByRequest((prev) => ({ ...prev, [request.id]: err instanceof VideoConsentError ? err.message : 'Could not decline this consent.' }))
    } finally {
      setBusyRequestId(null)
    }
  }

  return (
    <div className="vci-overlay" role="dialog" aria-label="Video consent requests">
      <div className="vci-panel">
        <div className="vci-header">
          <h2>Video Consent Requests</h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {requests.length === 0 ? (
          <p className="vci-empty">No pending requests.</p>
        ) : (
          requests.map((request) => {
            const confirmations = confirmationsFor(request.id)
            const canSubmit = allConfirmed(confirmations)
            return (
              <div key={request.id} className="vci-request">
                <p className="vci-request-summary">
                  A WFG admin has requested to use your {request.policyVersion ? 'photo or voice' : 'media'} to create a synthetic presenter avatar for
                  WFG weekly reporting videos. Requested {new Date(request.createdAt).toLocaleDateString()}.
                </p>
                {policy && (
                  <div className="vci-confirmations">
                    {policy.statements.map((statement) => (
                      <label key={statement.key} className="vci-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(statementChecked(confirmations, statement.key))}
                          onChange={(e) => setConfirmation(request.id, statementPatch(statement.key, e.target.checked))}
                        />
                        {statement.text}
                      </label>
                    ))}
                  </div>
                )}
                {errorByRequest[request.id] && <p className="vci-error">{errorByRequest[request.id]}</p>}
                <div className="vci-request-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => handleReject(request)} disabled={busyRequestId === request.id}>
                    Decline
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => handleConfirm(request)} disabled={!canSubmit || busyRequestId === request.id}>
                    {busyRequestId === request.id ? 'Submitting…' : 'Agree & Continue'}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function statementChecked(confirmations: ConsentConfirmations, key: string): boolean {
  switch (key) {
    case 'rights_to_media':
      return confirmations.rightsConfirmed
    case 'synthetic_authorization':
      return confirmations.syntheticAuthorizationConfirmed
    case 'stated_purpose':
      return confirmations.purposeConfirmed
    case 'third_party_disclosure':
      return confirmations.disclosureAcknowledged
    default:
      return false
  }
}

function statementPatch(key: string, value: boolean): Partial<ConsentConfirmations> {
  switch (key) {
    case 'rights_to_media':
      return { rightsConfirmed: value }
    case 'synthetic_authorization':
      return { syntheticAuthorizationConfirmed: value }
    case 'stated_purpose':
      return { purposeConfirmed: value }
    case 'third_party_disclosure':
      return { disclosureAcknowledged: value }
    default:
      return {}
  }
}
