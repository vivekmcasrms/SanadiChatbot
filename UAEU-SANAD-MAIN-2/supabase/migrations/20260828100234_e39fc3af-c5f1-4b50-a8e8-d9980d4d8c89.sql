DROP INDEX IF EXISTS public.notification_events_dedupe;
CREATE UNIQUE INDEX notification_events_dedupe ON public.notification_events (dedupe_key);
DROP INDEX IF EXISTS public.uq_notification_deliveries_dedupe;
CREATE UNIQUE INDEX uq_notification_deliveries_dedupe ON public.notification_deliveries (dedupe_key);