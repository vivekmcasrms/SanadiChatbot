alter table public.response_performance_logs
  add column if not exists routing_ms integer,
  add column if not exists student_context_ms integer,
  add column if not exists external_api_ms integer,
  add column if not exists model_queue_ms integer;
create index if not exists idx_rpl_path_total on public.response_performance_logs (execution_path, total_duration_ms);