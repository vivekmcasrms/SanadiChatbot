import { createFileRoute } from "@tanstack/react-router";
import { UnifiedVoiceAdvisor } from "@/components/UnifiedVoiceAdvisor";

export const Route = createFileRoute("/voice")({ component: UnifiedVoiceAdvisor });
