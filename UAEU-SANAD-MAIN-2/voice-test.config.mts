import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['src/lib/voice-interruption.test.ts', 'src/components/VoiceChatMic.test.tsx', 'src/lib/voice-processing-cues.test.ts', 'src/lib/voice-prompt-audio.test.ts', 'src/lib/voice-activity.test.ts', 'src/lib/advisor-audio.test.ts', 'src/lib/advisor-ticket.test.ts', 'src/lib/advisor-room.test.ts', 'src/lib/browser-question.test.ts', 'src/lib/browser-speech.test.ts', 'src/lib/voice-call.test.ts', 'src/lib/voice-call-echo.test.ts', 'src/lib/wav-speech.test.ts', 'src/lib/multilingual-question.test.ts', 'src/lib/multilingual-speech.test.ts', 'src/lib/question-audio.test.ts'], maxWorkers: 1 },
});
