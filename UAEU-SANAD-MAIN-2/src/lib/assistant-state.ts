import { useSyncExternalStore } from "react";

/**
 * Global presence state for the Sanadi avatar.
 * Kept outside React so any component (chat, voice input, future TTS)
 * can drive the avatar without prop drilling.
 *
 * "speaking" is reserved for a future text-to-speech pass.
 */
export type AssistantState =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "speaking"
  | "success"
  | "error";

let current: AssistantState = "idle";
let currentLevel = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** 0..1 microphone amplitude, used by the listening ring. */
export function setAssistantLevel(level: number) {
  const next = Math.round(Math.min(1, Math.max(0, level)) * 20) / 20;
  if (next === currentLevel) return;
  currentLevel = next;
  emit();
}

export function getAssistantLevel() {
  return currentLevel;
}

export function setAssistantState(state: AssistantState) {
  if (current === state) return;
  current = state;
  if (state !== "listening") currentLevel = 0;
  emit();
}

export function getAssistantState() {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAssistantState(): AssistantState {
  return useSyncExternalStore(subscribe, getAssistantState, () => "idle" as const);
}

export function useAssistantLevel(): number {
  return useSyncExternalStore(subscribe, getAssistantLevel, () => 0);
}
