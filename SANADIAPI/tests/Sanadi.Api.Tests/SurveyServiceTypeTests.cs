using Sanadi.Api.Controllers;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class SurveyServiceTypeTests
{
    [Theory]
    [InlineData("Inquiry", "Inquiry", "query")]
    [InlineData("Complaint", "Complaint", "complaint")]
    [InlineData("Alert", "Alert", "alert")]
    [InlineData("Suggestion", "Suggestion", "suggestion")]
    [InlineData(" inquiry ", "Inquiry", "query")]
    public void Settings_use_public_category_while_ticket_lookup_uses_database_category(
        string input, string settingType, string ticketType)
    {
        var actual = SurveyController.Types(input);
        Assert.Equal(settingType, actual.ServiceType);
        Assert.Equal(ticketType, actual.DatabaseType);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unsupported")]
    public void Unknown_category_is_rejected(string? input)
        => Assert.Throws<SanadiException>(() => SurveyController.Types(input));
}
