ALTER TABLE public.issued_documents
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS issued_documents_message_id_idx
  ON public.issued_documents (message_id) WHERE message_id IS NOT NULL;