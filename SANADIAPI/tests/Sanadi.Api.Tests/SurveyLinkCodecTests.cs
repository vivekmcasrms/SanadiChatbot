using Microsoft.Extensions.Configuration;
using Sanadi.Api.Survey;

namespace Sanadi.Api.Tests;

public sealed class SurveyLinkCodecTests
{
    private static SurveyLinkCodec Codec(string key = "a-unique-test-signing-key-at-least-32-characters") =>
        new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:SigningKey"] = key
        }).Build());

    [Fact]
    public void Link_encrypts_reference_and_service_type()
    {
        var codec = Codec();
        var link = codec.Create("REF-12345", "query", DateTimeOffset.UtcNow.AddDays(1));
        Assert.DoesNotContain("REF-12345", link);
        Assert.DoesNotContain("query", link);
        Assert.True(codec.TryRead(link, out var reference, out var serviceType));
        Assert.Equal("REF-12345", reference);
        Assert.Equal("query", serviceType);
    }

    [Fact]
    public void Tampered_or_wrong_key_link_is_rejected()
    {
        var codec = Codec();
        var link = codec.Create("REF-12345", "complaint", DateTimeOffset.UtcNow.AddDays(1));
        var middle = link.Length / 2;
        var tampered = link[..middle] + (link[middle] == 'A' ? 'B' : 'A') + link[(middle + 1)..];
        Assert.False(codec.TryRead(tampered, out _, out _));
        Assert.False(Codec("another-unique-test-signing-key-at-least-32-characters")
            .TryRead(link, out _, out _));
    }

    [Fact]
    public void Expired_link_is_rejected()
    {
        var codec = Codec();
        var link = codec.Create("REF-12345", "alert", DateTimeOffset.UtcNow.AddSeconds(-1));
        Assert.False(codec.TryRead(link, out _, out _));
    }
}
