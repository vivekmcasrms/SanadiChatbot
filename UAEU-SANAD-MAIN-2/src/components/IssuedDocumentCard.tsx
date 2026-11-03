/**
 * Shows an already-issued document inside the chat.
 *
 * Download serves the exact stored PDF (same reference number,
 * QR verification link and hash); nothing here regenerates a second copy.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/errors/toast";
import { downloadIssuedDocument } from "@/lib/documents/download";
import { useI18n } from "@/lib/i18n";
import type { IssuedDocumentCard as IssuedDocument } from "@/lib/agent-types";

export function IssuedDocumentCard({ document: doc }: { document: IssuedDocument }) {
  const queryClient = useQueryClient();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [pending, setPending] = useState(false);

  async function download() {
    setPending(true);
    try {
      await downloadIssuedDocument(doc.documentId);
    } catch (error) {
      toastError(error, lang);
    } finally {
      setPending(false);
    }
  }

  async function share() {
    // Sharing always uses the approved public verification page, never the
    // stored PDF or a signed storage URL. The token is the only identifier
    // that appears in the shared link.
    const token =
      doc.verifyToken ?? (doc.verifyUrl ? /\/verify\/([A-Za-z0-9_-]+)/.exec(doc.verifyUrl)?.[1] : null);
    const url = token ? `${window.location.origin}/verify/${encodeURIComponent(token)}` : null;
    if (!url) {
      toast.error(ar ? "لا يوجد رابط تحقق لهذه الوثيقة." : "This document has no verification link.");
      return;
    }
    const title = ar ? doc.titleAr : doc.titleEn;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${title} — ${doc.referenceNumber}`, url });
        return;
      } catch {
        /* the student dismissed the share sheet */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(ar ? "تم نسخ رابط التحقق." : "Verification link copied.");
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-xs">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{ar ? doc.titleAr : doc.titleEn}</p>
          <p className="mt-1 text-muted-foreground">
            {ar ? "الرقم المرجعي" : "Reference"}:{" "}
            <span className="font-mono text-foreground">{doc.referenceNumber}</span>
          </p>
          <p className="text-muted-foreground">
            {ar ? "تاريخ الإصدار" : "Issued"}: {new Date(doc.issuedAt).toLocaleString()}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void download()} disabled={pending}>
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="size-3.5" aria-hidden />
              )}
              {ar ? "تنزيل" : "Download"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void share()}>
              <Share2 className="size-3.5" aria-hidden />
              {ar ? "مشاركة" : "Share"}
            </Button>
          </div>

          <Link
            to="/documents"
            search={{ d_q: doc.referenceNumber, d_page: 1 }}
            onClick={() => { void queryClient.invalidateQueries({ queryKey: ["my-documents"] }); }}
            className="mt-3 inline-block font-medium text-primary hover:underline"
          >
            {ar ? "متاحة أيضاً في وثائقي" : "Also saved in My Documents"}
          </Link>
        </div>
      </div>
    </div>
  );
}
