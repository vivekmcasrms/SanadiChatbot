import { createFileRoute, redirect } from "@tanstack/react-router";

/** FAQ management now lives in the Knowledge Center; old links land on its FAQ tab. */
export const Route = createFileRoute("/_authenticated/knowledge")({
  beforeLoad: () => {
    throw redirect({ to: "/knowledge-center", search: { tab: "faq" }, replace: true });
  },
});
