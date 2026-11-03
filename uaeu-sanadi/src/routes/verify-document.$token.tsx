import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy verification path: older printed letters keep working. */
export const Route = createFileRoute("/verify-document/$token")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/verify/$token", params: { token: params.token } });
  },
});
