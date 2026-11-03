DROP TRIGGER IF EXISTS trg_track_case_responsibility_ins ON public.cases;
CREATE TRIGGER trg_track_case_responsibility_ins
AFTER INSERT ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.track_case_responsibility();