import { apiFetch } from "@/lib/auth-token";
import type { ActionReceipt, AgentResponse, IssuedDocumentCard, ProposedAction } from "./agent-types";

type Call<T> = { data: T };

export type PerformActionResult = {
  receipt: ActionReceipt | null;
  message: string;
  document?: IssuedDocumentCard | null;
  recovery?: { classification: string; proposedAction: ProposedAction | null } | null;
};

export const askAssistant = ({ data }: Call<{
  message: string;
  conversationId?: string | null;
  lang?: "en" | "ar";
  attachments?: Array<{ storagePath:string; fileName:string; mimeType?:string|null; sizeBytes?:number|null }>;
  supportAgent?: "mira" | "suhail";
}>) => apiFetch<AgentResponse>("/api/chat/ask", { method:"POST", body:JSON.stringify(data) });

export const executeConfirmedAction = ({ data }: Call<{
  toolName:string;
  args?:Record<string,unknown>;
  conversationId?:string|null;
  lang?:"en"|"ar";
  messageId?:string|null;
  actionKey?:string|null;
}>) => apiFetch<PerformActionResult>("/api/chat/actions", { method:"POST", body:JSON.stringify(data) });
