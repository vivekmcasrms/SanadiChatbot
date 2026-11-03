using System.Text.Json.Nodes;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class ConfirmedConcernRouteTests
{
    private static readonly InteractionUnitRouting.Unit Unit =
        new(Guid.NewGuid(), "HOUSING", "Housing Services", "خدمات السكن", null, null);

    [Fact]
    public void Saved_complaint_uses_the_approved_active_unit_without_a_second_model_decision()
    {
        var args = new JsonObject { ["unitId"] = Unit.Id.ToString(), ["routingConfidence"] = .91 };
        var route = AssistantController.ConfirmedConcernRoute(args, Unit);
        Assert.Equal(Unit.Id, route.UnitId);
        Assert.Equal(Unit.Code, route.Code);
        Assert.Equal(.91, route.Confidence);
    }

    [Fact]
    public void Existing_proposal_without_confidence_remains_submittable()
    {
        var args = new JsonObject { ["unitId"] = Unit.Id.ToString() };
        var route = AssistantController.ConfirmedConcernRoute(args, Unit);
        Assert.Equal(ChatConcernPlanner.MinimumConfidence, route.Confidence);
    }

    [Fact]
    public void Removed_or_changed_unit_requires_a_new_proposal()
    {
        var args = new JsonObject { ["unitId"] = Unit.Id.ToString() };
        Assert.Throws<SanadiException>(() => AssistantController.ConfirmedConcernRoute(args, null));
        Assert.Throws<SanadiException>(() => AssistantController.ConfirmedConcernRoute(args,
            Unit with { Id = Guid.NewGuid() }));
    }

    [Fact]
    public void Invalid_confidence_is_rejected()
    {
        var args = new JsonObject { ["unitId"] = Unit.Id.ToString(), ["routingConfidence"] = .2 };
        Assert.Throws<SanadiException>(() => AssistantController.ConfirmedConcernRoute(args, Unit));
    }

    [Fact]
    public void Emergency_text_still_classifies_as_alert()
    {
        var input = new InteractionsController.Input("Fire in my room", "There is a fire in my room.",
            "complaint", null, null, null, null, null, null, null, false, null, null, "en");
        var route = new InteractionUnitRouting.Decision(Unit.Id, Unit.Code, Unit.NameEn, Unit.NameAr, .91);
        var classified = InteractionsController.ClassifyConcern(input, route, "complaint");
        Assert.Equal("alert", (string)classified.interactionType);
    }
}
