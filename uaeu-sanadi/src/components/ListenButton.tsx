import { useState, useSyncExternalStore } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { detectSpokenLanguage } from "@/lib/voice/normalize";
import { getPlayingKey, speakReply, stopSpeaking, subscribePlayback } from "@/lib/voice/playback";

/** "Listen" control on a finished assistant answer. Never auto-plays. */
export function ListenButton({ id, text }: { id: string; text: string }) {
  const { t } = useI18n();
  const playing = useSyncExternalStore(subscribePlayback, getPlayingKey, () => null) === id;
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    if (playing) {
      stopSpeaking();
      return;
    }
    setLoading(true);
    try {
      await speakReply(id, text, detectSpokenLanguage(text));
    } catch {
      stopSpeaking();
      toast.error(t("voice_listen_failed"));
    } finally {
      setLoading(false);
    }
  };

  const label = playing ? t("voice_listen_stop") : t("voice_listen");
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-8 gap-1 px-2 text-xs text-muted-foreground"
      aria-label={label}
      onClick={() => void onClick()}
    >
      {loading && !playing ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : playing ? (
        <Square className="size-3.5" aria-hidden />
      ) : (
        <Volume2 className="size-3.5" aria-hidden />
      )}
      {label}
    </Button>
  );
}
