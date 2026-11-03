-- Same authenticated enrollment source and exclusions as the original textbook agent.
-- No course names, service mappings, Blackboard URLs or response text are hardcoded.
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetTextbookCourses
    @userId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT DISTINCT c.code AS Code, c.title_en AS TitleEn, c.title_ar AS TitleAr, c.credit_hours AS CreditHours
    FROM dbo.student_current_enrollments e
    JOIN dbo.course_sections s ON s.id = e.course_section_id
    JOIN dbo.courses c ON c.id = s.course_id
    WHERE e.student_id = @userId
      AND (e.enrollment_status IS NULL OR e.enrollment_status NOT IN (N'dropped', N'withdrawn'))
    ORDER BY c.code;
END;
GO
