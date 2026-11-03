using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>Sentence-sized synthesis units, including Arabic punctuation, without splitting GPA decimals.</summary>
internal sealed class VoiceSentences(string language, Func<string, Task> emit, int firstChunkChars = 600,
    bool naturalPhrasing = false, bool separateFirstSentence = false)
{
    private string pending = "";
    private bool emitted;
    internal async Task Push(string delta, bool final = false)
    {
        pending += delta;
        if (naturalPhrasing)
        {
            await PushNatural(final);
            return;
        }
        while (pending.Length > 0)
        {
            var match = Regex.Match(pending, @"[.!?؟](?=\s)|\n");
            var end = match.Success ? match.Index + match.Length : 0;
            if (!emitted && firstChunkChars < 600)
            {
                // Start TTS at a natural clause boundary while the model keeps writing.
                // For a long clause, use a word boundary; never split numbers or words.
                var clause = Regex.Matches(pending, @"[,،;؛:](?=\s)")
                    .FirstOrDefault(m => m.Index >= 60 && m.Index < firstChunkChars);
                if (clause is not null && (end == 0 || clause.Index < end))
                    end = clause.Index + clause.Length;
                if (pending.Length > firstChunkChars && (end == 0 || end > firstChunkChars))
                {
                    var space = pending.LastIndexOf(' ', firstChunkChars);
                    if (space >= 60) end = space + 1;
                }
            }
            if (end == 0 && pending.Length > 600)
                end = pending.LastIndexOf(' ', 600) + 1;
            if (end == 0 && pending.Length > 1200) end = 1200;
            if (end == 0 && final) end = pending.Length;
            if (end == 0) return;
            var sentence = VoiceSpeechFormatter.ToSpeech(pending[..end], language);
            pending = pending[end..];
            if (!string.IsNullOrWhiteSpace(sentence))
            {
                emitted = true;
                await emit(sentence);
            }
        }
    }

    private async Task PushNatural(bool final)
    {
        while (pending.Length > 0)
        {
            var boundaries = VoicePhrasing.Boundaries(pending).ToList();
            if (final && (boundaries.Count == 0 || boundaries[^1] != pending.Length)) boundaries.Add(pending.Length);
            var end = boundaries.FirstOrDefault();
            var continuation = false;
            var firstTarget = Math.Clamp(firstChunkChars, 100, 180);
            var maximum = emitted ? 600 : Math.Max(240, firstTarget * 2);

            if (end > 0 && end <= maximum)
            {
                // Join short, already-available sentences (e.g. a farewell) in one TTS request.
                // Do not wait for future tokens or add a playback delay.
                foreach (var next in boundaries.Skip(1))
                {
                    if (!emitted && separateFirstSentence) break;
                    if (pending[..end].Trim().Length >= 70 || next > 180) break;
                    end = next;
                }
            }
            else
            {
                // Prefer a punctuation pause. Only use a word boundary for an unusually long clause.
                var clause = Regex.Matches(pending, @"[,،;؛:](?=\s)")
                    .FirstOrDefault(m => m.Index >= 60 && m.Index < maximum);
                if (clause is not null)
                {
                    end = clause.Index + clause.Length;
                    continuation = true;
                }
                else if (pending.Length > maximum)
                {
                    end = pending.LastIndexOf(' ', maximum) + 1;
                    if (end == 0 && pending.Length > 1200) end = 1200;
                    continuation = end > 0;
                }
                else end = 0;
            }
            if (end == 0) return;
            var phrase = VoicePhrasing.Format(pending[..end], language, continuation);
            pending = pending[end..];
            if (phrase.Length == 0) continue;
            emitted = true;
            await emit(phrase);
        }
    }
}
