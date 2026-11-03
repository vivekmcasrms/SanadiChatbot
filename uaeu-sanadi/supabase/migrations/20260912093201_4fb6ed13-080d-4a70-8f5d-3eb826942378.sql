-- 1. Restrict AI system prompts to staff only
drop policy if exists "Signed-in users read approved prompts" on public.agent_prompt_versions;
create policy "Staff read prompt versions"
on public.agent_prompt_versions
for select
to authenticated
using (public.is_staff(auth.uid()));

-- 2. Scope the own-profile read policy to authenticated users only
drop policy if exists "own profile" on public.profiles;
create policy "own profile"
on public.profiles
for select
to authenticated
using ((id = auth.uid()) OR public.staff_can_view_profile(auth.uid(), id));

-- 3. Scope knowledge-files storage policies to authenticated users only
drop policy if exists "knowledge_files_read" on storage.objects;
drop policy if exists "knowledge_files_insert" on storage.objects;
drop policy if exists "knowledge_files_update" on storage.objects;
drop policy if exists "knowledge_files_delete" on storage.objects;

create policy "knowledge_files_read" on storage.objects
for select to authenticated
using (bucket_id = 'knowledge-files' and public.can_access_knowledge_file(name, auth.uid()));

create policy "knowledge_files_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'knowledge-files' and public.can_access_knowledge_file(name, auth.uid()));

create policy "knowledge_files_update" on storage.objects
for update to authenticated
using (bucket_id = 'knowledge-files' and public.can_access_knowledge_file(name, auth.uid()))
with check (bucket_id = 'knowledge-files' and public.can_access_knowledge_file(name, auth.uid()));

create policy "knowledge_files_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'knowledge-files' and public.can_access_knowledge_file(name, auth.uid()));

-- 4. Privileged ranking function is backend-only; signed-in users may no longer call it directly
revoke execute on function public.search_knowledge_passages(text, text, integer, text, integer, integer, text[], text) from authenticated, anon;
