-- General chat grounding: search active service guidance, approved FAQs and
-- current student-visible documents BEFORE limiting results. No service mappings
-- or response text is embedded here. Existing service/action rules are unchanged.
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_RetrieveEvidence
    @terms nvarchar(max),
    @lang nvarchar(10) = N'en',
    @overview bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @today date = CONVERT(date, SYSDATETIMEOFFSET());
    DECLARE @separators nvarchar(50) = N'.,;:!?/\-()[]{}"' + NCHAR(10) + NCHAR(13) + NCHAR(9);
    DECLARE @words TABLE (term nvarchar(200) NOT NULL PRIMARY KEY);
    INSERT @words(term)
        SELECT DISTINCT LOWER(CONVERT(nvarchar(200), [value]))
        FROM OPENJSON(@terms)
        WHERE [type] = 1 AND LEN([value]) BETWEEN 2 AND 200;
    DECLARE @count int = (SELECT COUNT(*) FROM @words);
    IF @count = 0 RETURN;

    ;WITH visible_documents AS
    (
        SELECT d.* FROM dbo.knowledge_documents d
        WHERE d.deleted_at IS NULL AND d.is_active = 1
          AND d.approval_status IN (N'approved', N'published')
          AND (d.is_current = 1 OR d.is_current IS NULL)
          AND (d.effective_date IS NULL OR d.effective_date <= @today)
          AND (d.expiry_date IS NULL OR d.expiry_date >= @today)
          AND d.confidentiality = N'public'
          AND d.confidentiality_level IN (N'public', N'student_authenticated')
    ), sources AS
    (
        SELECT d.id AS DocumentId, c.id AS PassageId, d.title AS Title,
               u.name_en AS Unit, d.version AS Version, d.effective_date AS EffectiveDate,
               d.citation_url AS Url, c.content AS Content, N'document' AS SourceType,
               d.title AS SearchTitle, c.content AS SearchContent, 0 AS SourcePriority,
               c.chunk_index AS PassageOrder,
               CASE WHEN LOWER(c.section_title) IN (N'table of contents',N'contents') THEN 3
                    WHEN LOWER(c.section_title) IN (N'overview',N'introduction',N'objective',N'objectives',N'purpose',N'scope') THEN 2
                    ELSE 0 END AS OverviewPriority
        FROM visible_documents d
        JOIN dbo.document_chunks c ON c.document_id = d.id AND c.is_active = 1
        LEFT JOIN dbo.service_units u ON u.id = COALESCE(d.owner_unit_id, d.service_unit_id)
        UNION ALL
        SELECT s.id, s.id,
               CASE WHEN @lang = N'ar' THEN COALESCE(NULLIF(s.name_ar,N''),s.name_en) ELSE s.name_en END,
               u.name_en, NULL, NULL, NULL,
               CONCAT(
                   CASE WHEN @lang = N'ar' THEN COALESCE(NULLIF(s.description_ar,N''),s.description_en) ELSE s.description_en END,
                   NCHAR(10), NCHAR(10),
                   CASE WHEN @lang = N'ar' THEN COALESCE(NULLIF(s.instructions_ar,N''),s.instructions_en) ELSE s.instructions_en END),
               N'service', CONCAT(s.name_en,N' ',s.name_ar),
               CONCAT(s.description_en,N' ',s.description_ar,N' ',s.instructions_en,N' ',s.instructions_ar), 2, 0, 0
        FROM dbo.university_services s
        LEFT JOIN dbo.service_units u ON u.id = s.service_unit_id
        WHERE s.is_active = 1 AND s.target_audience IN (N'students',N'student',N'all',N'public')
          AND NULLIF(LTRIM(RTRIM(CONCAT(s.description_en,s.description_ar,s.instructions_en,s.instructions_ar))),N'') IS NOT NULL
        UNION ALL
        SELECT COALESCE(d.id,f.id), f.id,
               CASE WHEN @lang = N'ar' THEN COALESCE(NULLIF(f.question_ar,N''),f.question_en) ELSE f.question_en END,
               u.name_en, d.version, f.effective_date, d.citation_url,
               CASE WHEN @lang = N'ar' THEN COALESCE(NULLIF(f.answer_ar,N''),f.answer_en) ELSE f.answer_en END,
               N'faq', CONCAT(f.question_en,N' ',f.question_ar,N' ',f.search_keywords),
               CONCAT(f.answer_en,N' ',f.answer_ar), 1, 0, 0
        FROM dbo.faq_items f
        LEFT JOIN visible_documents d ON d.id = f.document_id
        LEFT JOIN dbo.service_units u ON u.id = f.service_unit_id
        WHERE f.is_active = 1 AND f.approval_status = N'approved'
          AND f.effective_date <= @today AND (f.expiry_date IS NULL OR f.expiry_date >= @today)
          AND (f.document_id IS NULL OR d.id IS NOT NULL)
    ), matched AS
    (
        SELECT s.*, matches.Hits, titleMatches.TitleHits
        FROM sources s
        CROSS APPLY (SELECT
            N' ' + LOWER(TRANSLATE(CONCAT(s.SearchTitle,N' ',s.SearchContent),
                @separators, REPLICATE(N' ',LEN(@separators)))) + N' ' AS Body,
            N' ' + LOWER(TRANSLATE(s.SearchTitle,
                @separators, REPLICATE(N' ',LEN(@separators)))) + N' ' AS Heading
        ) normalized
        CROSS APPLY (SELECT COUNT(*) AS Hits
            FROM @words w WHERE CHARINDEX(N' '+w.term+N' ',normalized.Body) > 0
        ) matches
        CROSS APPLY (SELECT COUNT(*) AS TitleHits
            FROM @words w WHERE CHARINDEX(N' '+w.term+N' ',normalized.Heading) > 0
        ) titleMatches
        WHERE matches.Hits > 0
    )
    SELECT TOP (8) DocumentId, Title, Unit, Version, EffectiveDate, Url, Content,
           CONVERT(decimal(18,6), Hits * 1.0 / @count) AS Score, SourceType
    FROM matched
    ORDER BY Hits DESC, TitleHits DESC, SourcePriority DESC,
             CASE WHEN @overview=1 THEN OverviewPriority ELSE 0 END DESC,
             EffectiveDate DESC, DocumentId,
             CASE WHEN @overview=1 THEN PassageOrder ELSE 0 END, PassageId;
END;
GO
