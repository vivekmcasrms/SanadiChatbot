using System.Buffers.Binary;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.AI;

/// <summary>Verifies spoken identifiers before any number audio is returned to the caller.</summary>
internal static class VoiceNumberSpeech
{
    internal static async Task<byte[]> Synthesize(string text, string language,
        Func<string, CancellationToken, Task<byte[]>> synthesize,
        Func<byte[], CancellationToken, Task<string>> transcribe, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var parts = VoiceNumberPronunciation.Parts(text, language);
        if (!parts.Any(p => p.Identifier is not null)) return await synthesize(text, ct);
        if (VoiceNumberPronunciation.ForSpeech(text, language).Length > 6000)
            throw new ArgumentException("Speech pronunciation exceeds the request limit.");

        // Reuse verified segments only within this utterance. Never cache student identifiers.
        var verified = new Dictionary<string, byte[]>();
        var framed = new HashSet<string>();
        var verificationAvailable = true;
        var clips = new List<byte[]>();
        var screenReference = language == "ar" ? "تقدر تقرأ الرقم الصحيح على الشاشة."
            : "You can read the exact number on screen.";
        foreach (var part in parts)
        {
            ct.ThrowIfCancellationRequested();
            byte[]? wav = null;
            if (part.Identifier is { } identifier)
            {
                var digits = new List<byte[]>();
                for (var offset = 0; offset < identifier.Length;)
                {
                    // Use groups of two or three, avoiding a lone trailing digit.
                    var length = identifier.Length - offset == 4 ? 2 : Math.Min(3, identifier.Length - offset);
                    var segment = await Verify(identifier.Substring(offset, length));
                    if (segment is null) { digits.Clear(); break; }
                    digits.Add(segment);
                    offset += length;
                }
                // Make the three-digit groups distinguishable, especially in long repeated runs.
                if (digits.Count > 0) wav = Join(digits, .65);
                // A failed pronunciation must never be presented as the student's ID.
                if (wav is null)
                {
                    return await ScreenReference();
                }
            }
            else wav = await synthesize(part.Text, ct);
            ct.ThrowIfCancellationRequested();
            clips.Add(wav!);
        }
        var combined = Join(clips, .3);
        var completeTranscript = await Recognize(combined);
        if (completeTranscript is not null && VoiceNumberPronunciation.MatchesReply(completeTranscript, text)) return combined;
        // A concatenation that checked correctly in isolation may still be unclear as a
        // whole. Retry only speech, with the complete source sentence as context.
        for (var attempt = 0; verificationAvailable && attempt < 2; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            byte[] candidate;
            try { candidate = await synthesize(text, ct); }
            catch (SanadiException error) when (error.Code is "tts_service_unavailable" or "tts_invalid_audio") { continue; }
            completeTranscript = await Recognize(candidate);
            if (completeTranscript is not null && VoiceNumberPronunciation.MatchesReply(completeTranscript, text))
                return candidate;
        }
        ct.ThrowIfCancellationRequested();
        return await ScreenReference();

        async Task<byte[]> ScreenReference()
        {
            ct.ThrowIfCancellationRequested();
            var audio = await synthesize(screenReference, ct);
            ct.ThrowIfCancellationRequested();
            return audio;
        }

        async Task<string?> Recognize(byte[] candidate)
        {
            using var check = CancellationTokenSource.CreateLinkedTokenSource(ct);
            check.CancelAfter(TimeSpan.FromSeconds(10));
            try
            {
                var recognized = await transcribe(candidate, check.Token);
                ct.ThrowIfCancellationRequested();
                return recognized;
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { verificationAvailable = false; return null; }
            catch (Exception error) when (error is SanadiException or HttpRequestException or InvalidOperationException)
            { verificationAvailable = false; return null; }
        }

        async Task<byte[]?> Verify(string digits)
        {
            ct.ThrowIfCancellationRequested();
            if (!verificationAvailable) return null;
            if (verified.TryGetValue(digits, out var known)) return known;
            byte[]? repeated = null;
            // Reuse a clean single-digit reading with the exact source count. If the
            // service needed framing, first try a short group to avoid repeating "Number".
            if (digits.Length > 1 && digits.All(d => d == digits[0]))
            {
                var single = await Verify(digits[..1]);
                if (!verificationAvailable) return null;
                if (single is not null)
                {
                    repeated = Join(Enumerable.Repeat(single, digits.Length), .3);
                    if (!framed.Contains(digits[..1])) return verified[digits] = repeated;
                }
            }
            for (var attempt = 0; attempt < 4; attempt++)
            {
                ct.ThrowIfCancellationRequested();
                byte[] candidate;
                try { candidate = await synthesize(VoiceNumberPronunciation.DigitPrompt(digits, language,
                    attempt % 2 != 0, framed: attempt >= 2), ct); }
                catch (SanadiException error) when (error.Code is "tts_service_unavailable" or "tts_invalid_audio") { continue; }
                var recognized = await Recognize(candidate);
                if (recognized is null) return null;
                if (VoiceNumberPronunciation.Matches(recognized, digits))
                {
                    verified[digits] = candidate;
                    if (attempt >= 2) framed.Add(digits);
                    return candidate;
                }
            }
            // Retry an unclear short group as separate digits, never with an altered source value.
            if (repeated is not null) return verified[digits] = repeated;
            if (digits.Length == 1) return null;
            var singles = new List<byte[]>();
            foreach (var digit in digits)
            {
                var single = await Verify(digit.ToString());
                if (single is null) return null;
                singles.Add(single);
            }
            return verified[digits] = Join(singles, .3);
        }
    }

    private static byte[] Join(IEnumerable<byte[]> clips, double pause)
    {
        using var output = new MemoryStream();
        byte[]? format = null;
        long dataSizePosition = 0;
        long dataStart = 0;
        foreach (var wav in clips)
        {
            var clip = Read(wav);
            if (format is null)
            {
                format = clip.Format;
                output.Write("RIFF"u8); output.Write(new byte[4]); output.Write("WAVEfmt "u8);
                WriteSize(output, format.Length); output.Write(format);
                if ((format.Length & 1) != 0) output.WriteByte(0);
                output.Write("data"u8); dataSizePosition = output.Position;
                output.Write(new byte[4]); dataStart = output.Position;
            }
            else
            {
                if (!format.AsSpan().SequenceEqual(clip.Format)) throw InvalidAudio();
                // Keep the surrounding explanation separate from the verified number.
                var rate = BinaryPrimitives.ReadInt32LittleEndian(format.AsSpan(4));
                var block = BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(12));
                var silence = new byte[checked((int)(rate * pause) * block)];
                if (BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(14)) == 8) Array.Fill(silence, (byte)128);
                output.Write(silence);
            }
            if (output.Length + clip.Data.Length > ConfiguredSpeech.MaximumWavBytes) throw InvalidAudio();
            output.Write(clip.Data.Span);
        }
        var dataSize = checked((int)(output.Length - dataStart));
        if ((dataSize & 1) != 0) output.WriteByte(0);
        var size = checked((int)output.Length);
        output.Position = dataSizePosition; WriteSize(output, dataSize);
        output.Position = 4; WriteSize(output, size - 8);
        return output.ToArray();
    }

    private static (byte[] Format, ReadOnlyMemory<byte> Data) Read(byte[] wav)
    {
        if (!ConfiguredSpeech.ValidWave(wav)) throw InvalidAudio();
        byte[]? format = null;
        ReadOnlyMemory<byte> data = default;
        for (var offset = 12; offset + 8 <= wav.Length;)
        {
            var size = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(offset + 4)));
            if (wav.AsSpan(offset, 4).SequenceEqual("fmt "u8)) format = wav.AsSpan(offset + 8, size).ToArray();
            if (wav.AsSpan(offset, 4).SequenceEqual("data"u8))
            {
                if (!data.IsEmpty) throw InvalidAudio();
                data = wav.AsMemory(offset + 8, size);
            }
            offset += 8 + size + (size & 1);
        }
        if (format is null || format.Length < 16 || data.IsEmpty) throw InvalidAudio();
        var encoding = BinaryPrimitives.ReadUInt16LittleEndian(format);
        var channels = BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(2));
        var rate = BinaryPrimitives.ReadInt32LittleEndian(format.AsSpan(4));
        var bits = BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(14));
        var block = BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(12));
        if (encoding is not (1 or 3) || channels is < 1 or > 2 || rate is < 8000 or > 96000 ||
            (encoding == 1 ? bits is not (8 or 16 or 24 or 32) : bits is not (32 or 64)) ||
            block != channels * (bits / 8) || data.Length % block != 0) throw InvalidAudio();
        return (format, data);
    }

    private static void WriteSize(Stream output, int size)
    {
        Span<byte> bytes = stackalloc byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(bytes, size); output.Write(bytes);
    }

    private static SanadiException InvalidAudio() => new("Invalid speech audio.", 502, "tts_invalid_audio");
}
