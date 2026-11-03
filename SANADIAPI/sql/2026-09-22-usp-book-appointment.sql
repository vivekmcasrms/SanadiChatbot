SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_BookAppointment
  @id uniqueidentifier,
  @uid uniqueidentifier,
  @slotId uniqueidentifier,
  @purpose nvarchar(max),
  @code nvarchar(32),
  @caseId uniqueidentifier = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [dbo].[student_appointments] ([id], [student_id], [appointment_slot_id], [purpose], [status], [confirmation_code], [case_id], [booked_by])
  VALUES (@id, @uid, @slotId, @purpose, N'booked', @code, @caseId, @uid);
  UPDATE [dbo].[appointment_slots]
     SET [booked_count] = [booked_count] + 1,
         [status] = CASE WHEN [booked_count] + 1 >= [capacity] THEN N'booked' ELSE [status] END
   WHERE [id] = @slotId;
END
GO
