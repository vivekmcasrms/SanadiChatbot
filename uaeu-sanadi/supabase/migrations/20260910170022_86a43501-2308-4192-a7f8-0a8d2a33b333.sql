ALTER TABLE public.emergency_contacts
  ADD COLUMN IF NOT EXISTS category_en text,
  ADD COLUMN IF NOT EXISTS category_ar text,
  ADD COLUMN IF NOT EXISTS emergency_type_en text,
  ADD COLUMN IF NOT EXISTS emergency_type_ar text,
  ADD COLUMN IF NOT EXISTS responsible_unit_en text,
  ADD COLUMN IF NOT EXISTS responsible_unit_ar text,
  ADD COLUMN IF NOT EXISTS mobile_number text,
  ADD COLUMN IF NOT EXISTS emergency_number text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS notes_en text,
  ADD COLUMN IF NOT EXISTS notes_ar text,
  ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS emergency_contacts_active_priority_idx
  ON public.emergency_contacts (is_active, priority);

INSERT INTO public.emergency_contacts
  (code, kind, label_en, label_ar, category_en, category_ar, emergency_type_en, emergency_type_ar,
   responsible_unit_en, responsible_unit_ar, mobile_number, emergency_number, email,
   keywords, priority, sort_order, is_active)
VALUES
  ('campus_health', 'campus', 'Urgent Medical Help', 'الإسعاف الطبي العاجل',
   'Health Emergency', 'طوارئ صحية', 'Urgent medical emergency', 'حالة صحية طارئة',
   'Urgent Medical Help', 'الإسعاف الطبي العاجل', '050 927 5824', '4004', NULL,
   ARRAY['medical','health','clinic','ambulance','injury','injured','bleeding','faint','fainted','unconscious','sick','ill','pain','doctor','nurse','breathing','allergic','seizure','heart','accident','طبي','صحية','صحي','إسعاف','مريض','مرض','إصابة','جرح','نزيف','إغماء','ألم','طبيب','تنفس','حساسية','حادث'],
   10, 10, true),
  ('campus_fire', 'campus', 'Operations and Emergency Section', 'قسم العمليات والطوارئ',
   'General Emergency', 'طوارئ عامة', 'Fire / Fire alarm', 'حريق / إنذار حريق',
   'Operations and Emergency Section', 'قسم العمليات والطوارئ', NULL, '6888', 'OES@uaeu.ac.ae',
   ARRAY['fire','smoke','burning','flame','fire alarm','alarm','evacuate','evacuation','explosion','gas leak','حريق','دخان','نار','إنذار','اشتعال','إخلاء','انفجار','تسرب غاز'],
   10, 20, true),
  ('campus_maintenance', 'campus', 'Khadamat', 'خدمات',
   'Maintenance', 'صيانة', 'Electricity / Water / Air Conditioning / Faults', 'كهرباء / مياه / تكييف / أعطال',
   'Khadamat', 'خدمات', NULL, '8000', 'servicedesk@khadamat.ae',
   ARRAY['maintenance','electricity','power','power cut','light','lights','water','leak','leaking','plumbing','air conditioning','ac','a/c','aircon','cooling','heater','fault','broken','not working','elevator','lift','toilet','sink','drain','صيانة','كهرباء','انقطاع الكهرباء','إنارة','مياه','ماء','تسرب','تسريب','سباكة','تكييف','مكيف','تبريد','عطل','أعطال','معطل','لا يعمل','مصعد','حمام','مغسلة'],
   20, 30, true),
  ('campus_security', 'campus', 'FMD — Security and Lost & Found', 'إدارة المرافق — الأمن والمفقودات',
   'Security', 'أمن', 'Security incidents / Lost property', 'حوادث أمنية / فقدان ممتلكات',
   'FMD', 'إدارة المرافق', NULL, '4488', 'LostNFound@uaeu.ac.ae',
   ARRAY['security','guard','theft','stolen','steal','robbery','lost','missing','lost property','lost and found','wallet','phone','bag','laptop','keys','id card','suspicious','intruder','harassment on campus','vandalism','أمن','حارس','سرقة','مسروق','فقدت','فقدان','ضائع','مفقود','محفظة','هاتف','جوال','حقيبة','مفاتيح','بطاقة','مشبوه','تخريب','ممتلكات'],
   20, 40, true)
ON CONFLICT (code) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  label_ar = EXCLUDED.label_ar,
  category_en = EXCLUDED.category_en,
  category_ar = EXCLUDED.category_ar,
  emergency_type_en = EXCLUDED.emergency_type_en,
  emergency_type_ar = EXCLUDED.emergency_type_ar,
  responsible_unit_en = EXCLUDED.responsible_unit_en,
  responsible_unit_ar = EXCLUDED.responsible_unit_ar,
  mobile_number = EXCLUDED.mobile_number,
  emergency_number = EXCLUDED.emergency_number,
  email = EXCLUDED.email,
  keywords = EXCLUDED.keywords,
  priority = EXCLUDED.priority,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();