using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceSpeechSynthesisTests
{
    [Fact]
    public void Short_arabic_stays_one_chunk()
    {
        var text = "وعليكم السلام. أنا ميرا. كيف أقدر أساعدك اليوم؟";
        var chunks = VoiceSpeechSynthesis.Chunks(text, 180).ToList();
        Assert.Single(chunks);
        Assert.Equal(text, chunks[0]);
    }

    [Fact]
    public void Long_text_splits_on_sentence_ends()
    {
        var first = new string('a', 100) + ".";
        var second = new string('b', 100) + ".";
        var chunks = VoiceSpeechSynthesis.Chunks(first + " " + second, 120).ToList();
        Assert.Equal(2, chunks.Count);
        Assert.StartsWith("aaa", chunks[0]);
        Assert.StartsWith("bbb", chunks[1]);
    }
}
