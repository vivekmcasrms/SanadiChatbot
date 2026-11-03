CREATE TABLE public.program_requirement_baskets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES public.academic_programs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  basket_type TEXT NOT NULL,
  required_credit_hours INTEGER NOT NULL,
  required_course_count INTEGER NOT NULL,
  effective_catalog_year TEXT NOT NULL,
  max_credit_hours_per_category INTEGER,
  selection_note_en TEXT,
  selection_note_ar TEXT,
  course_list_verified BOOLEAN NOT NULL DEFAULT true,
  source_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (program_id, code, effective_catalog_year)
);

GRANT SELECT ON public.program_requirement_baskets TO authenticated;
GRANT ALL ON public.program_requirement_baskets TO service_role;
ALTER TABLE public.program_requirement_baskets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Baskets are readable by signed-in users"
  ON public.program_requirement_baskets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage baskets"
  ON public.program_requirement_baskets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'system_admin'));

CREATE TABLE public.program_basket_courses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  basket_id UUID NOT NULL REFERENCES public.program_requirement_baskets(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  category_label TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (basket_id, course_id)
);

GRANT SELECT ON public.program_basket_courses TO authenticated;
GRANT ALL ON public.program_basket_courses TO service_role;
ALTER TABLE public.program_basket_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Basket courses are readable by signed-in users"
  ON public.program_basket_courses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage basket courses"
  ON public.program_basket_courses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'system_admin'));

CREATE INDEX idx_basket_courses_basket ON public.program_basket_courses(basket_id);
CREATE INDEX idx_baskets_program ON public.program_requirement_baskets(program_id);

CREATE TRIGGER update_program_requirement_baskets_updated_at
  BEFORE UPDATE ON public.program_requirement_baskets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_program_basket_courses_updated_at
  BEFORE UPDATE ON public.program_basket_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();