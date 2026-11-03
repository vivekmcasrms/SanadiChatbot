-- Preserve the original document details and audit events when a student deletes a letter.
-- Safe to rerun, including after the previous procedure left a verification tombstone.
CREATE OR ALTER PROCEDURE dbo.usp_Documents_DeleteStudentDocument
  @DocumentId uniqueidentifier,
  @id uniqueidentifier,
  @tokenHash nvarchar(128),
  @reference nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @documentType nvarchar(450), @createdAt datetimeoffset;
    SELECT @documentType = document_type, @createdAt = created_at,
           @reference = reference_number
    FROM dbo.issued_documents WITH (UPDLOCK, HOLDLOCK)
    WHERE id = @DocumentId AND student_id = @id AND deleted_at IS NULL;

    IF @documentType IS NULL
      THROW 50001, 'This document is not available.', 1;

    IF NOT EXISTS (
      SELECT 1 FROM dbo.document_verification_tombstones WITH (UPDLOCK, HOLDLOCK)
      WHERE token_hash = @tokenHash
    )
      INSERT INTO dbo.document_verification_tombstones(token_hash, reference_number, reason)
      VALUES(@tokenHash, @reference, N'deleted_by_student');

    INSERT INTO dbo.document_deletion_records(
      document_id, reference_number, document_type, student_id, created_at,
      deletion_type, actor_id)
    VALUES(@DocumentId, @reference, @documentType, @id, @createdAt,
      N'Student Requested', @id);

    -- Keep the audit events, which retain the document reference after deletion.
    UPDATE dbo.document_events SET document_id = NULL WHERE document_id = @DocumentId;
    UPDATE dbo.issued_documents SET superseded_by = NULL WHERE superseded_by = @DocumentId;
    DELETE FROM dbo.issued_documents WHERE id = @DocumentId AND student_id = @id;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;
GO
