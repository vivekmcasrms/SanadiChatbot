-- Support both API contracts, tokenize questions, and enforce document visibility.
CREATE OR ALTER PROCEDURE dbo.usp_SearchKnowledgePassages
    @limit int = NULL, @domain nvarchar(128) = NULL, @lang nvarchar(20) = NULL, @query nvarchar(max) = NULL,
    @p_query nvarchar(max) = NULL, @p_lang nvarchar(20) = NULL, @p_clearance int = 1,
    @p_domain nvarchar(128) = NULL, @p_limit int = NULL, @p_candidates int = 40,
    @p_section_terms nvarchar(max) = N'[]', @p_query_embedding nvarchar(max) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @query = LOWER(COALESCE(@p_query, @query, N''));
    SET @lang = COALESCE(@p_lang, @lang, N'en');
    SET @domain = COALESCE(@p_domain, @domain);
    SET @limit = COALESCE(@p_limit, @limit, 5);
    SET @limit = CASE WHEN @limit < 1 THEN 1 WHEN @limit > 100 THEN 100 ELSE @limit END;
    DECLARE @today date = CONVERT(date, SYSUTCDATETIME());
    DECLARE @separators nvarchar(50) = N'.,;:!?/\-()[]{}"' + NCHAR(10) + NCHAR(13) + NCHAR(9);
    DECLARE @words TABLE(term nvarchar(200) PRIMARY KEY);
    INSERT @words
        SELECT DISTINCT CONVERT(nvarchar(200),value)
        FROM STRING_SPLIT(TRANSLATE(@query,@separators,REPLICATE(N' ',LEN(@separators))),N' ')
        WHERE LEN(value) BETWEEN 3 AND 200 AND value NOT IN
          (N'the',N'and',N'for',N'are',N'what',N'which',N'how',N'can',N'you',N'please',N'tell',
           N'explain',N'more',N'about',N'uaeu',N'university',N'policy',N'policies',N'الجامعة',N'سياسة');
    DECLARE @count int = (SELECT COUNT(*) FROM @words);
    IF @count = 0 RETURN;

    ;WITH matched AS
    (
        SELECT c.id AS chunk_id, d.id AS source_id, d.title, d.document_type, d.language,
               COALESCE(d.knowledge_domain,N'general') AS knowledge_domain,
               d.confidentiality_level AS confidentiality, d.effective_date, d.version,
               CASE WHEN @lang=N'ar' THEN u.name_ar ELSE u.name_en END AS owning_unit,
               c.page_number,c.section_title,LEFT(c.content,900) AS snippet,d.citation_url,
               matches.hits,headings.hits AS heading_hits,
               CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@p_section_terms) t
                    WHERE t.type=1 AND CHARINDEX(LOWER(t.value),LOWER(COALESCE(c.section_title,N'')))>0)
                    THEN 1 ELSE 0 END AS section_match,
               CASE WHEN d.document_type IN (N'policy',N'regulation') THEN 1.0 ELSE 0.8 END AS authority
        FROM dbo.document_chunks c
        JOIN dbo.knowledge_documents d ON d.id=c.document_id
        LEFT JOIN dbo.service_units u ON u.id=COALESCE(d.owner_unit_id,d.service_unit_id)
        CROSS APPLY (SELECT
            N' '+LOWER(TRANSLATE(CONCAT(d.title,N' ',c.section_title,N' ',c.content),@separators,REPLICATE(N' ',LEN(@separators))))+N' ' AS body,
            N' '+LOWER(TRANSLATE(CONCAT(d.title,N' ',c.section_title),@separators,REPLICATE(N' ',LEN(@separators))))+N' ' AS heading) normalized
        CROSS APPLY (SELECT COUNT(*) AS hits FROM @words w WHERE CHARINDEX(N' '+w.term+N' ',normalized.body)>0) matches
        CROSS APPLY (SELECT COUNT(*) AS hits FROM @words w WHERE CHARINDEX(N' '+w.term+N' ',normalized.heading)>0) headings
        WHERE c.is_active=1 AND d.is_active=1 AND d.deleted_at IS NULL
          AND d.approval_status IN (N'approved',N'published') AND d.is_current=1
          AND d.superseded_by_document_id IS NULL
          AND (d.effective_date IS NULL OR d.effective_date<=@today)
          AND (d.expiry_date IS NULL OR d.expiry_date>=@today)
          AND (@domain IS NULL OR COALESCE(d.knowledge_domain,N'general') IN (@domain,N'general'))
          AND (d.language=@lang OR d.language IS NULL OR d.language=N'mixed')
          AND (d.confidentiality=N'public' OR (@p_clearance>=2 AND d.confidentiality=N'internal')
                OR (@p_clearance>=3 AND d.confidentiality=N'restricted'))
          AND (d.confidentiality_level IN (N'public',N'student_authenticated')
                OR (@p_clearance>=2 AND d.confidentiality_level=N'staff_only')
                OR (@p_clearance>=3 AND d.confidentiality_level=N'restricted')
                OR (@p_clearance>=4 AND d.confidentiality_level=N'highly_restricted'))
          AND matches.hits>0
    )
    SELECT TOP (@limit) chunk_id,source_id,N'document' AS source_type,title,document_type,language,
           knowledge_domain,confidentiality,effective_date,version,owning_unit,page_number,section_title,
           snippet,citation_url,CONVERT(bit,0) AS stale,
           CONVERT(float,hits*1.0/@count) AS lexical_score,
           CONVERT(float,0) AS semantic_score,CONVERT(float,0) AS fuzzy_score,CONVERT(float,authority) AS authority,
           CONVERT(float,0.65*hits/@count+0.15*heading_hits/@count+0.1*section_match+0.1*authority) AS score
    FROM matched
    ORDER BY score DESC,page_number,source_id,chunk_id;
END;
GO
