import { Loader2 } from "lucide-react";
import { UaeuLogo } from "@/components/UaeuLogo";

export function SsoTransition({ message = "Redirecting to UAEU SSO sign-in…" }: { message?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-secondary via-background to-background px-4 py-10" aria-busy="true">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card text-center shadow-lg shadow-primary/10">
        <div className="h-2 w-full bg-[linear-gradient(to_bottom,#dc4d58,#c01d2a)]" aria-hidden />
        <div className="px-6 py-8">
          <UaeuLogo className="mx-auto" />
          <span className="mt-6 inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Loader2 className="size-6 animate-spin" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-secondary-foreground">UAEU SSO</h1>
          <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </main>
  );
}
