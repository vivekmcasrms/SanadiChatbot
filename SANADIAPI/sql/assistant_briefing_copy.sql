-- Assistant empty-state copy lives in dbo.bilingual_terms so it can be edited
-- without a code change. Existing wording is preserved.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

MERGE [dbo].[bilingual_terms] AS t
USING (VALUES
  (N'assistant.greeting',
   N'How can I help you today?',
   N'كيف يمكنني مساعدتك اليوم؟'),
  (N'assistant.briefing.no_profile',
   N'I could not find an academic record linked to your account yet, but I can still answer university questions and open requests.',
   N'لم أجد سجلاً أكاديمياً مرتبطاً بحسابك بعد، لكن يمكنني الإجابة عن أسئلة الجامعة وفتح الطلبات.'),
  (N'assistant.briefing.clear',
   N'Your record is clear today — nothing is blocking you.',
   N'سجلك سليم اليوم — لا توجد عوائق نشطة.'),
  (N'assistant.briefing.blocker_one',
   N'{count} blocker is stopping your registration — I can handle it now.',
   N'يوجد {count} عائق يمنع تسجيلك — يمكنني معالجته الآن.'),
  (N'assistant.briefing.blocker_many',
   N'{count} blockers are stopping your registration — I can handle it now.',
   N'يوجد {count} عائق يمنع تسجيلك — يمكنني معالجته الآن.'),
  (N'assistant.fact.completed_credits', N'Completed credit hours', N'الساعات المكتملة'),
  (N'assistant.fact.graduation_progress', N'Graduation progress', N'التقدم نحو التخرج'),
  (N'assistant.fact.gpa', N'GPA', N'المعدل التراكمي'),
  (N'assistant.fact.active_holds', N'Active holds', N'الإيقافات النشطة'),
  (N'assistant.fact.open_requests', N'Open requests', N'الطلبات المفتوحة'),
  (N'assistant.fact.unread_alerts', N'Unread alerts', N'تنبيهات غير مقروءة')
) AS s (term_category, canonical_en, canonical_ar)
ON t.term_category = s.term_category
WHEN MATCHED THEN
  UPDATE SET
    canonical_en = s.canonical_en,
    canonical_ar = s.canonical_ar,
    is_active = 1,
    updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (term_category, canonical_en, canonical_ar, alternative_en, alternative_ar, is_active)
  VALUES (s.term_category, s.canonical_en, s.canonical_ar, N'[]', N'[]', 1);
GO
