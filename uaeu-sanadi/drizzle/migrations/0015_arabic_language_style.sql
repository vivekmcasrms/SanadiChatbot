ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS arabic_style text NOT NULL DEFAULT 'uae_professional'
    CHECK (arabic_style IN ('msa','uae_professional','uae_conversational')),
  ADD COLUMN IF NOT EXISTS voice_arabic_style text NOT NULL DEFAULT 'uae_conversational'
    CHECK (voice_arabic_style IN ('msa','uae_professional','uae_conversational'));