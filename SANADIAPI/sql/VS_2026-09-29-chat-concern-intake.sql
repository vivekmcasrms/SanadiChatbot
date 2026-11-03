-- Read the authenticated student's persisted Enquiry proposal for the existing approval flow.
-- No business routing, titles or response text is hardcoded here.
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetConcernProposal
    @userId uniqueidentifier,
    @conversationId uniqueidentifier,
    @messageId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT m.metadata
    FROM dbo.messages m
    JOIN dbo.conversations c ON c.id=m.conversation_id
    WHERE c.id=@conversationId AND c.user_id=@userId
      AND m.id=@messageId AND m.role=N'assistant';
END;
GO
