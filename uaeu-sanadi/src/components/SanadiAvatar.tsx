import fallbackAvatar from "@/assets/sanadi-avatar.png.asset.json";
import meeraAvatar from "@/assets/meera-avatar.jpg";
import suhailAvatar from "@/assets/suhail-avatar.jpg";
import { cn } from "@/lib/utils";
import { useVoiceSettings, type VoicePersona } from "@/lib/voice-settings";
import type { AssistantState } from "@/lib/assistant-state";

const PERSONA_FACES: Record<VoicePersona, { src: string; alt: string }> = {
  meera: { src: meeraAvatar, alt: "Meera — Sanadi Assistant" },
  suhail: { src: suhailAvatar, alt: "Suhail — Sanadi Assistant" },
};

/**
 * Visual identity of the Sanadi digital assistant.
 * Not a real person — label it as "Sanadi Assistant" only.
 *
 * The face follows the student's chosen voice persona (Meera or Suhail).
 * The portrait itself stays static; presence is conveyed by lightweight
 * CSS animation around it (breathing, rings, glow). All motion is disabled
 * automatically under `prefers-reduced-motion`.
 *
 * Future upgrades (animated image, Live2D, 3D, lip-sync, TTS-driven motion)
 * can swap the <img> without changing any caller: the state contract stays.
 */
export function SanadiAvatar({
  className,
  state = "idle",
  level = 0,
  animated = true,
}: {
  className?: string;
  /** Presence state; drives the surrounding animation only. */
  state?: AssistantState;
  /** 0..1 mic level, used by the listening ring. */
  level?: number;
  /** Set false for purely decorative/static placements. */
  animated?: boolean;
}) {
  const active = animated && state !== "idle";
  const { settings } = useVoiceSettings();
  const face = PERSONA_FACES[settings.persona] ?? { src: fallbackAvatar.url, alt: "Sanadi Assistant" };

  return (
    <span
      className={cn("sanadi-avatar relative inline-flex shrink-0", className)}
      data-state={animated ? state : "static"}
      style={
        state === "listening"
          ? ({ "--sanadi-level": String(Math.min(1, Math.max(0, level))) } as React.CSSProperties)
          : undefined
      }
    >
      {active ? <span className="sanadi-avatar-ring" aria-hidden /> : null}
      <img
        src={face.src}
        alt={face.alt}
        className="sanadi-avatar-img size-full aspect-square rounded-full border border-border/60 bg-surface object-cover object-top"
        loading="eager"
        decoding="async"
      />
    </span>
  );
}
