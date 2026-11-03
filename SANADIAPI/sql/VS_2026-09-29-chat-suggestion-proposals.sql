-- Read the authenticated student's stored proposal before executing a confirmed suggestion.
-- Routing continues to use the active AI/catalogue and existing interaction procedures.
-- No service mapping or response text is embedded in SQL.
CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetSuggestionProposal
    @userId uniqueidentifier,
    @conversationId uniqueidentifier,
    @messageId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT m.metadata
    FROM dbo.messages m
    JOIN dbo.conversations c ON c.id = m.conversation_id
    WHERE c.id = @conversationId AND c.user_id = @userId
      AND m.id = @messageId AND m.role = N'assistant';
END;
GO

-- Preserve the form workflow; chat supplies its actual entry channel.
CREATE OR ALTER PROCEDURE dbo.usp_Interactions_InsertSuggestion
  @id uniqueidentifier,
  @user uniqueidentifier,
  @reference nvarchar(100),
  @title nvarchar(200),
  @description nvarchar(max),
  @benefit nvarchar(max) = NULL,
  @unit uniqueidentifier = NULL,
  @anon bit,
  @lang nvarchar(10),
  @conversation uniqueidentifier = NULL,
  @service nvarchar(100),
  @reasonEn nvarchar(max),
  @reasonAr nvarchar(max),
  @confidence float,
  @channel nvarchar(50) = N'shortcut'
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.suggestions(
    id, student_id, reference_number, title, description, expected_benefit, service_unit_id,
    is_anonymous, language, status, entry_channel, related_conversation_id, routing_service_code,
    routing_reason_en, routing_reason_ar, routing_confidence)
  VALUES(
    @id, @user, @reference, @title, @description, @benefit, @unit, @anon, @lang, N'submitted', @channel,
    @conversation, @service, @reasonEn, @reasonAr, @confidence);
END
GO

