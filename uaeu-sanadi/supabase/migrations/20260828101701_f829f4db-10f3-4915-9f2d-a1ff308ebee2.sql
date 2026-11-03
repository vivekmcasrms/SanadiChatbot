CREATE POLICY "Students delete their own career analysis versions"
ON public.career_analysis_versions
FOR DELETE
TO authenticated
USING (student_id = auth.uid());

GRANT DELETE ON public.career_analysis_versions TO authenticated;