-- Match the document lifecycle implemented by Knowledge Center. Retains validation.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'knowledge_documents_approval_status_check'
           AND parent_object_id = OBJECT_ID(N'dbo.knowledge_documents'))
    ALTER TABLE dbo.knowledge_documents DROP CONSTRAINT knowledge_documents_approval_status_check;
ALTER TABLE dbo.knowledge_documents WITH CHECK ADD CONSTRAINT knowledge_documents_approval_status_check
    CHECK (approval_status IN (N'draft', N'pending_review', N'approved', N'published', N'rejected',
                               N'needs_revision', N'superseded', N'retired'));
COMMIT TRANSACTION;
