/**
 * In-app preview of an already-issued PDF.
 *
 * The signed URL comes from the stored issued document, so the exact artefact
 * is shown: nothing is regenerated and ownership checks stay on the server.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function PdfPreviewDialog({
  open,
  onOpenChange,
  url,
  title,
  ar,
  onDownload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  title: string;
  ar: boolean;
  onDownload?: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    setObjectUrl(null);
    setFailed(false);
    if (open && url) {
      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("preview failed");
          const blob = await res.blob();
          if (cancelled) return;
          revoke = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: "application/pdf" }));
          setObjectUrl(revoke);
        } catch {
          if (!cancelled) setFailed(true);
        }
      })();
    }
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <div className="h-[70vh] w-full overflow-hidden rounded-lg border bg-muted/30">
          {objectUrl ? (
            <iframe src={objectUrl} title={title} className="size-full" />
          ) : failed ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground">
              <p>
                {ar
                  ? "تعذّر عرض الملف هنا. يمكنك تنزيله بدلاً من ذلك."
                  : "The file could not be displayed here. You can download it instead."}
              </p>
              {onDownload ? (
                <Button size="sm" onClick={onDownload}>
                  {ar ? "تنزيل" : "Download"}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex size-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {onDownload ? (
            <Button size="sm" variant="secondary" onClick={onDownload}>
              {ar ? "تنزيل" : "Download"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            {ar ? "إغلاق" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
