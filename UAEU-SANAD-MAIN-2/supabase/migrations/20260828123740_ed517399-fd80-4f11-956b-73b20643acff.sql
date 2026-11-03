
-- 1. Restrict internal AI configuration + tool catalogue to staff
DROP POLICY IF EXISTS "Signed-in users read AI settings" ON public.ai_settings;
CREATE POLICY "Staff read AI settings" ON public.ai_settings
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Signed-in users read the tool catalogue" ON public.agent_tools;
CREATE POLICY "Staff read the tool catalogue" ON public.agent_tools
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- 2. Security definer view -> invoker, not exposed through the API
ALTER VIEW public.case_monitor_v SET (security_invoker = true);
REVOKE ALL ON public.case_monitor_v FROM anon, authenticated;

-- 3. SECURITY DEFINER function execution: default deny, then re-grant what the app needs
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN (
        -- RPCs called by signed-in users from the app
        'admin_case_monitor','admin_case_monitor_detail','admin_case_monitor_summary',
        'admin_governance_overview','admin_governance_report','admin_owner_monitor',
        'admin_owner_performance','admin_unit_monitor','book_appointment_slot',
        'get_service_availability','search_knowledge_passages',
        'delete_my_issued_document','purge_my_issued_document',
        'remove_my_requests','remove_my_suggestions',
        -- helpers referenced by row-level security policies
        'can_access_case','can_approve_knowledge','can_manage_integrations','can_manage_knowledge',
        'can_monitor_all_units','can_monitor_cases','can_see_all_cases','case_monitor_units',
        'has_role','is_housing_staff','is_internship_staff','is_manager','is_staff',
        'owns_case','owns_service_unit','owned_service_units','staff_unit'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- 4. Case evidence storage: verify the uploader can access the case the file belongs to
DROP POLICY IF EXISTS "users upload own evidence" ON storage.objects;
CREATE POLICY "users upload own evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'case-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.can_access_case(NULLIF((storage.foldername(name))[2], '')::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "users update own evidence" ON storage.objects;
CREATE POLICY "users update own evidence" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'case-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.can_access_case(NULLIF((storage.foldername(name))[2], '')::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'case-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.can_access_case(NULLIF((storage.foldername(name))[2], '')::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "users delete own evidence" ON storage.objects;
CREATE POLICY "users delete own evidence" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'case-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.can_access_case(NULLIF((storage.foldername(name))[2], '')::uuid, auth.uid())
  );
