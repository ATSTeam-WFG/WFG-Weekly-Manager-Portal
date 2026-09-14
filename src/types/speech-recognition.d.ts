// Minimal ambient typings for the Web Speech API's SpeechRecognition, which
// is not part of TypeScript's standard DOM lib. Named with a "Like" suffix so
// these never collide with a future official type of the same name.
export {}

declare global {
  interface SpeechRecognitionAlternativeLike {
    transcript: string
    confidence: number
  }

  interface SpeechRecognitionResultLike {
    readonly length: number
    isFinal: boolean
    item(index: number): SpeechRecognitionAlternativeLike
    [index: number]: SpeechRecognitionAlternativeLike
  }

  interface SpeechRecognitionResultListLike {
    readonly length: number
    item(index: number): SpeechRecognitionResultLike
    [index: number]: SpeechRecognitionResultLike
  }

  interface SpeechRecognitionEventLike extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultListLike
  }

  interface SpeechRecognitionErrorEventLike extends Event {
    readonly error: string
  }

  interface SpeechRecognitionLike extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    start(): void
    stop(): void
    abort(): void
    onresult: ((ev: SpeechRecognitionEventLike) => void) | null
    onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null
    onend: ((ev: Event) => void) | null
  }

  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}
