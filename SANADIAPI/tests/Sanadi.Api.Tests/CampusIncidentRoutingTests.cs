using System.Text.Json;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class CampusIncidentRoutingTests
{
    private static CampusIncidentRouting.Contact Maintenance() => new()
    {
        Id = Guid.NewGuid(), Code = "campus_maintenance", CategoryEn = "Maintenance", CategoryAr = "صيانة",
        TypeEn = "Electricity / Water / Air Conditioning / Faults", UnitEn = "Configured maintenance unit", UnitAr = "جهة الصيانة",
        EmergencyNumber = "test-extension", Email = "maintenance@example.test", Priority = 20,
        Keywords = JsonSerializer.Serialize(new[] { "ac", "a/c", "air conditioning", "not working", "water", "leaking", "مكيف", "تكييف", "لا يعمل", "تسرب" })
    };

    [Theory]
    [InlineData("My room is very hot seems like AC is not working")]
    [InlineData("My a/c is not working")]
    [InlineData("There is water leaking in my room")]
    [InlineData("المكيف في غرفتي لا يعمل")]
    public void Live_incidents_select_the_configured_contact(string message)
    {
        var contact = Maintenance();
        Assert.Same(contact, CampusIncidentRouting.Match(message, [contact]));
    }

    [Theory]
    [InlineData("What skills am I missing?")]
    [InlineData("I need an enrolment letter")]
    [InlineData("What is the air conditioning maintenance policy?")]
    [InlineData("My academic registration is not working")]
    [InlineData("I want to book an appointment")]
    [InlineData("My library book request is not working")]
    [InlineData("My career CV needs improvement")]
    public void Existing_service_questions_are_not_taken_over(string message)
    {
        Assert.Null(CampusIncidentRouting.Match(message, [Maintenance()]));
    }

    [Fact]
    public void Short_keywords_require_word_boundaries()
    {
        var contact = Maintenance();
        contact.Keywords = "[\"ac\"]";
        Assert.Null(CampusIncidentRouting.Match("Help my backpack is missing", [contact]));
    }

    [Fact]
    public void Lost_physical_property_near_library_uses_security()
    {
        var security = new CampusIncidentRouting.Contact { Code = "campus_security", Keywords = "[\"lost\",\"wallet\"]", EmergencyNumber = "security-extension" };
        Assert.Same(security, CampusIncidentRouting.Match("I lost my wallet near the library", [Maintenance(), security]));
    }

    [Fact]
    public void Equal_scores_use_database_priority()
    {
        var first = Maintenance(); var preferred = Maintenance(); preferred.Priority = 1;
        Assert.Same(preferred, CampusIncidentRouting.Match("My AC is not working", [first, preferred]));
    }

    [Fact]
    public void Empty_channels_and_malformed_keywords_cannot_supply_contacts()
    {
        var noChannel = Maintenance(); noChannel.EmergencyNumber = noChannel.Email = null;
        var invalid = Maintenance(); invalid.Keywords = "broken json";
        Assert.Null(CampusIncidentRouting.Match("My AC is not working", [noChannel, invalid]));
    }

    [Fact]
    public void Answer_and_confirmation_use_database_values_and_original_report()
    {
        const string text = "My room is very hot seems like AC is not working";
        var contact = Maintenance();
        var answer = CampusIncidentRouting.Answer(contact, "en");
        Assert.Contains("Configured maintenance unit", answer);
        Assert.Contains("test-extension", answer);
        Assert.Contains("maintenance@example.test", answer);
        Assert.Contains("call 999 immediately", answer);
        Assert.DoesNotContain("could not find", answer);
        var action = AssistantController.IncidentProposal(text, "en", contact, "level_2", false);
        Assert.Equal("report_alert", (string?)action["toolName"]);
        Assert.Equal("Notify Configured maintenance unit now", (string?)action["labelEn"]);
        Assert.Equal(text, (string?)action["args"]?["description"]);
        Assert.Equal("level_2", (string?)action["risk"]);
        Assert.False((bool)action["humanApprovalRequired"]!);
    }

    [Fact]
    public void Configured_staff_approval_is_preserved_in_confirmation()
    {
        var action = AssistantController.IncidentProposal("My AC is not working", "en", Maintenance(), "level_3", true);
        Assert.Equal("level_3", (string?)action["risk"]);
        Assert.True((bool)action["humanApprovalRequired"]!);
    }
}
