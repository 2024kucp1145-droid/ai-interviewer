/**
 * Voice Module: Speech-to-Text (en-IN) & Text-to-Speech (speechSynthesis)
 * Derived from JARVIS voice components with Push-to-Talk and Typing Fallback
 */

export class VoiceManager {
  constructor({ onInterimResult, onFinalResult, onError, onSpeakStart, onSpeakEnd }) {
    this.onInterimResult = onInterimResult || (() => {});
    this.onFinalResult = onFinalResult || (() => {});
    this.onError = onError || (() => {});
    this.onSpeakStart = onSpeakStart || (() => {});
    this.onSpeakEnd = onSpeakEnd || (() => {});

    this.recognition = null;
    this.isListening = false;
    this.synth = window.speechSynthesis || null;
    this.speechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

    this._initRecognition();
  }

  _initRecognition() {
    if (!this.speechSupported) {
      console.warn('Speech recognition not supported in this browser. Falling back to text mode.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-IN'; // Indian English / Hinglish optimized

    this.recognition.onstart = () => {
      this.isListening = true;
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (interimTranscript) {
        this.onInterimResult(interimTranscript);
      }
      if (finalTranscript) {
        this.onFinalResult(finalTranscript);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('Voice recognition error:', event.error);
      this.isListening = false;
      this.onError(event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
    };
  }

  startListening() {
    if (!this.recognition) return false;
    try {
      this.stopSpeaking();
      this.recognition.start();
      this.isListening = true;
      return true;
    } catch (e) {
      console.warn('Start listening failed:', e.message);
      return false;
    }
  }

  stopListening() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {}
      this.isListening = false;
    }
  }

  speak(text) {
    if (!this.synth) return;
    this.stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.lang = 'en-IN';

    // Pick best English voice if available
    const voices = this.synth.getVoices();
    const preferredVoice = voices.find(v => v.lang.includes('en-IN') || v.lang.includes('en-GB') || v.lang.includes('en-US'));
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => this.onSpeakStart();
    utterance.onend = () => this.onSpeakEnd();
    utterance.onerror = () => this.onSpeakEnd();

    this.synth.speak(utterance);
  }

  stopSpeaking() {
    if (this.synth && this.synth.speaking) {
      this.synth.cancel();
    }
  }
}
