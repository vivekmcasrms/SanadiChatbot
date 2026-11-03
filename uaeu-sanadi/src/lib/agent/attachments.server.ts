/**
 * Chat attachment plumbing: chat message -> case evidence -> unit notification.
 * Files are uploaded by the student directly to the private `case-evidence`
 * bucket under their own user folder; only the metadata travels through here.
 */
import type { ChatAttachment } from "../agent-types";
import { notifyUnitStaff } from "../ops/notify.server";
import type { Db } from "./tools.server";

export function normalizeAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ChatAttachment[] = [];
  for (const raw of input.slice(0, 5)) {
    const a = raw as Partial<ChatAttachment>;
    if (typeof a?.storagePath !== "string" || typeof a?.fileName !== "string") continue;
    out.push({
      storagePath: a.storagePath,
      fileName: a.fileName.slice(0, 200),
      mimeType: typeof a.mimeType === "string" ? a.mimeType : null,
      sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : null,
    });
  }
  return out;
}

/** Link uploaded files to the student's chat message. */
export async function recordMessageAttachments(
  db: Db,
  messageId: string,
  userId: string,
  attachments: ChatAttachment[],
): Promise<void> {
  if (!attachments.length) return;
  const { error } = await db.from("message_attachments").insert(
    attachments.map((a) => ({
      message_id: messageId,
      user_id: userId,
      storage_path: a.storagePath,
      file_name: a.fileName,
      mime_type: a.mimeType,
      size_bytes: a.sizeBytes,
    })),
  );
  if (error) console.error("[attachments] message link failed", error.message);
}

/**
 * Move the files the student shared in chat onto the case as evidence and tell
 * the responsible unit that a document is waiting for review.
 */
export async function attachToCase(
  db: Db,
  caseId: string,
  userId: string,
  attachments: ChatAttachment[],
  lang: "en" | "ar",
): Promise<number> {
  if (!attachments.length) return 0;
  const { error } = await db.from("case_evidence").insert(
    attachments.map((a) => ({
      case_id: caseId,
      uploaded_by: userId,
      storage_path: a.storagePath,
      file_name: a.fileName,
      mime_type: a.mimeType,
      size_bytes: a.sizeBytes,
    })),
  );
  if (error) {
    console.error("[attachments] case evidence failed", error.message);
    return 0;
  }

  try {
    const { data: row } = await db
      .from("cases")
      .select("case_number, service_unit_id, assigned_to")
      .eq("id", caseId)
      .maybeSingle();
    await notifyUnitStaff(row?.service_unit_id ?? null, row?.assigned_to ?? null, {
      eventType: "information_provided",
      entityType: "case",
      entityId: caseId,
      channels: ["in_app", "email"],
      language: lang,
      actionUrl: `/requests/${caseId}`,
      vars: {
        case_number: row?.case_number ?? "",
        documents: attachments.map((a) => a.fileName).join(", "),
      },
      dedupeKey: `case-evidence:${caseId}:${attachments[0]?.storagePath ?? ""}`,
    });
  } catch (err) {
    console.error("[attachments] notify failed", err);
  }
  return attachments.length;
}