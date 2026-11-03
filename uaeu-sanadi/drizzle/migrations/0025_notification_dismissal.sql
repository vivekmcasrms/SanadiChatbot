ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
ALTER TABLE public.student_alerts ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;