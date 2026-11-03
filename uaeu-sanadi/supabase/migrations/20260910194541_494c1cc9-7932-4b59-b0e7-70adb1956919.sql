insert into public.university_services (service_unit_id, code, name_en, name_ar, description_en, description_ar, category, target_audience, authentication_required, estimated_processing_days, allows_online_submission, allows_agent_submission, requires_human_approval, instructions_en, instructions_ar, is_active)
values (
  null,
  'SVC-CAMPUS-ENTRY',
  'Campus entry permit (proactive)',
  'تصريح دخول الحرم الجامعي (خدمة استباقية)',
  'This service is now proactive. You do not need to submit a separate request. Simply proceed to the designated parking area and use your UAEU ID to access/open the gate.',
  'أصبحت هذه الخدمة استباقية، ولا تحتاج إلى تقديم طلب منفصل. يمكنك التوجه مباشرة إلى موقف السيارات المخصص واستخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات لفتح البوابة والدخول.',
  'proactive',
  'students',
  false,
  0,
  false,
  false,
  false,
  'This service is now proactive. You do not need to submit a separate request. Simply proceed to the designated parking area and use your UAEU ID to access/open the gate.',
  'أصبحت هذه الخدمة استباقية، ولا تحتاج إلى تقديم طلب منفصل. يمكنك التوجه مباشرة إلى موقف السيارات المخصص واستخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات لفتح البوابة والدخول.',
  true
)
on conflict (code) do update set
  name_en = excluded.name_en,
  name_ar = excluded.name_ar,
  description_en = excluded.description_en,
  description_ar = excluded.description_ar,
  category = excluded.category,
  allows_online_submission = false,
  allows_agent_submission = false,
  requires_human_approval = false,
  instructions_en = excluded.instructions_en,
  instructions_ar = excluded.instructions_ar,
  is_active = true;