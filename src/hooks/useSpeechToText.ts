import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was denied. You can continue typing your response.',
  'service-not-allowed': 'Microphone access was denied. You can continue typing your response.',
  'no-speech': "We didn't catch that. Please try again or continue typing.",
  'audio-capture': 'No microphone was found. You can continue typing your response.',
  network: 'Voice input had a connection problem. You can continue typing your response.',
}

const DEFAULT_ERROR_MESSAGE = 'Voice input is not available right now. You can continue typing your response.'

export interface UseSpeechToTextResult {
  isSupported: boolean
  activeField: string | null
  errorField: string | null
  errorMessage: string | null
  start: (field: string, onFinalResult: (transcript: string) => void) => void
  stop: () => void
}

/**
 * A single shared speech-recognition session, reused across every field that
 * calls start() — starting a new field's recognition always stops whatever
 * was previously listening, so only one field can ever be active at once.
 */
export function useSpeechToText(): UseSpeechToTextResult {
  const [activeField, setActiveField] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const SpeechRecognitionCtor = getSpeechRecognitionConstructor()
  const isSupported = SpeechRecognitionCtor !== null

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  // Stop any in-progress recognition if the form using this hook unmounts.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  const start = useCallback(
    (field: string, onFinalResult: (transcript: string) => void) => {
      setErrorField(null)
      setErrorMessage(null)

      if (!SpeechRecognitionCtor) {
        setErrorField(field)
        setErrorMessage(DEFAULT_ERROR_MESSAGE)
        return
      }

      // Stop whatever is currently listening before starting the new field.
      recognitionRef.current?.stop()

      const recognition = new SpeechRecognitionCtor()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            const transcript = result[0].transcript.trim()
            if (transcript) onFinalResult(transcript)
          }
        }
      }

      recognition.onerror = (event) => {
        setErrorField(field)
        setErrorMessage(FRIENDLY_ERROR_MESSAGES[event.error] ?? DEFAULT_ERROR_MESSAGE)
      }

      recognition.onend = () => {
        // Ignore a stale onend from an instance that's already been replaced.
        if (recognitionRef.current !== recognition) return
        recognitionRef.current = null
        setActiveField((current) => (current === field ? null : current))
      }

      recognitionRef.current = recognition
      setActiveField(field)

      try {
        recognition.start()
      } catch {
        recognitionRef.current = null
        setActiveField(null)
        setErrorField(field)
        setErrorMessage(DEFAULT_ERROR_MESSAGE)
      }
    },
    [SpeechRecognitionCtor],
  )

  return { isSupported, activeField, errorField, errorMessage, start, stop }
}
