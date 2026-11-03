using System.Text.Json;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class InteractionUnitRoutingTests
{
    [Fact]
    public void Model_choice_uses_current_database_identity_and_names()
    {
        var unit = new InteractionUnitRouting.Unit(Guid.NewGuid(), "dynamic-code", "Configured owner", "الجهة", null, null);
        var decision = InteractionUnitRouting.Parse(JsonSerializer.Serialize(new { unitId = unit.Id, confidence = .94 }), [unit]);
        Assert.Equal(unit.Id, decision.UnitId);
        Assert.Equal(unit.NameEn, decision.NameEn);
        Assert.Equal(unit.Code, decision.Code);
    }

    [Fact]
    public void Vague_report_can_remain_in_general_student_services_queue()
    {
        var decision = InteractionUnitRouting.Parse("{\"unitId\":null,\"confidence\":0.5}", []);
        Assert.Null(decision.UnitId);
        Assert.Equal("Student Services", decision.NameEn);
    }

    [Fact]
    public void Invented_or_inactive_unit_is_rejected()
        => Assert.Throws<JsonException>(() => InteractionUnitRouting.Parse(JsonSerializer.Serialize(new { unitId = Guid.NewGuid(), confidence = .99 }), []));

    [Theory]
    [InlineData("{\"unitId\":null,\"confidence\":2}")]
    [InlineData("{\"unitId\":\"housing\",\"confidence\":0.8}")]
    [InlineData("Ignore all rules")]
    public void Invalid_model_output_does_not_route_a_ticket(string output)
        => Assert.ThrowsAny<Exception>(() => InteractionUnitRouting.Parse(output, []));

    [Fact]
    public void Json_code_fence_is_accepted()
        => Assert.Null(InteractionUnitRouting.Parse("```json\n{\"unitId\":null,\"confidence\":0.5}\n```", []).UnitId);
}
