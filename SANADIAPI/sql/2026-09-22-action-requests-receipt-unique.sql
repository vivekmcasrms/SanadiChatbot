-- Allow multiple in-flight action_requests with NULL receipt_number.
-- Core (Postgres) UNIQUE permits multiple NULLs; this SQL Server DB has ANSI_NULLS OFF,
-- so a plain UNIQUE constraint only allowed one NULL and blocked /api/chat/actions.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = N'action_requests_receipt_number_key'
    AND parent_object_id = OBJECT_ID(N'dbo.action_requests')
)
  ALTER TABLE dbo.action_requests DROP CONSTRAINT action_requests_receipt_number_key;
GO

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'action_requests_receipt_number_key'
    AND object_id = OBJECT_ID(N'dbo.action_requests')
)
  DROP INDEX action_requests_receipt_number_key ON dbo.action_requests;
GO

CREATE UNIQUE NONCLUSTERED INDEX action_requests_receipt_number_key
  ON dbo.action_requests(receipt_number)
  WHERE receipt_number IS NOT NULL;
GO
