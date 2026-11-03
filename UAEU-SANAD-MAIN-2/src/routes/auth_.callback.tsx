import { createFileRoute } from "@tanstack/react-router";
import { SsoCallbackPage } from "@/components/SsoCallbackPage";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({ meta: [
    { title: "UAEU SSO — Sanadi" },
    { name: "referrer", content: "no-referrer" },
  ] }),
  component: SsoCallbackPage,
});
