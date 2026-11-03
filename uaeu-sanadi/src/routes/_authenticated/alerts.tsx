/** University alerts now live in the single Notifications page. */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/alerts")({
  beforeLoad: () => {
    throw redirect({ to: "/my-notifications", search: { tab: "alerts" }, replace: true });
  },
});
