/**
 * Microsoft Edge Neural Text-to-Speech Service
 * 
 * Generates natural human-like speech (ElevenLabs quality) without GPU or API keys.
 * Uses Microsoft Edge Neural Voice models (Indian English, US English, Hinglish).
 */

import { EdgeTTS } from 'node-edge-tts';

// Recommended high-clarity professional voices
export const NEURAL_VOICES = {
  'en-IN-female': 'en-IN-NeerjaNeural',     // Professional Indian English Female (HR Recruiter)
  'en-IN-male': 'en-IN-PrabhatNeural',       // Clear Indian English Male (Technical Lead)
  'en-US-female': 'en-US-AriaNeural',        // US English Female (Neutral & Polished)
  'en-US-male': 'en-US-GuyNeural',          // US English Male (Conversational & Natural)
  'hi-IN-female': 'hi-IN-SwaraNeural',       // Hindi/Hinglish Female
  'hi-IN-male': 'hi-IN-MadhurNeural'         // Hindi/Hinglish Male
};

/**
 * Synthesizes text into an MP3 audio buffer using Microsoft Neural Voices
 */
export async function generateNeuralAudio(text, options = {}) {
  const voice = options.voice || NEURAL_VOICES['en-IN-female'];
  const rate = options.rate || '+0%';
  const pitch = options.pitch || '+0Hz';

  const tts = new EdgeTTS({
    voice,
    lang: voice.substring(0, 5),
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate,
    pitch,
    timeout: 15000
  });

  const chunks = [];
  try {
    for await (const chunk of tts.streamAudio(text)) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      }
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.warn(`[NeuralTTS] Edge TTS generation failed for "${voice}": ${err.message}. Falling back to standard.`);
    throw err;
  }
}
