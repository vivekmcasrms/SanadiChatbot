using System.Buffers.Binary;

namespace Sanadi.Api.AI;

/// <summary>Recheck browser PCM before STT. Detects speech, not speaker identity or distance.</summary>
public static class VoiceInputSpeechGuard
{
    /// <returns>Null for other formats, which retain the existing provider validation.</returns>
    public static bool? HasSpeech(byte[] wav, VoiceActivityDetector? detector, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        // Scope to the exact mono PCM16/16 kHz format produced by the current UI.
        // Other upload clients and speech-number verification retain their contracts.
        if (!ConfiguredSpeech.ValidWave(wav)) return null;
        var dataOffset = 0;
        var dataLength = 0;
        var supported = false;
        var formatSeen = false;
        for (var offset = 12; offset + 8 <= wav.Length;)
        {
            var size = (int)BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(offset + 4));
            if (wav.AsSpan(offset, 4).SequenceEqual("fmt "u8))
            {
                if (formatSeen) return null;
                formatSeen = true;
                var format = wav.AsSpan(offset + 8, size);
                supported = size >= 16
                    && BinaryPrimitives.ReadUInt16LittleEndian(format) == 1
                    && BinaryPrimitives.ReadUInt16LittleEndian(format[2..]) == 1
                    && BinaryPrimitives.ReadInt32LittleEndian(format[4..]) == VoiceActivityDetector.SampleRate
                    && BinaryPrimitives.ReadInt32LittleEndian(format[8..]) == VoiceActivityDetector.SampleRate * 2
                    && BinaryPrimitives.ReadUInt16LittleEndian(format[12..]) == 2
                    && BinaryPrimitives.ReadUInt16LittleEndian(format[14..]) == 16;
            }
            if (wav.AsSpan(offset, 4).SequenceEqual("data"u8))
            {
                if (dataOffset != 0) return null;
                dataOffset = offset + 8;
                dataLength = size;
            }
            offset += 8 + size + (size & 1);
        }
        if (!supported || dataOffset == 0 || dataLength % 2 != 0) return null;

        // The hosted adapter reuses the existing singleton model. Standalone tools
        // may create a private instance; all recurrent state remains per recording.
        using var ownedDetector = detector is null ? new VoiceActivityDetector() : null;
        using var stream = (detector ?? ownedDetector!).OpenStream();
        var tail = new byte[VoiceActivityDetector.FrameBytes];
        for (var offset = 0; offset < dataLength; offset += VoiceActivityDetector.FrameBytes)
        {
            ct.ThrowIfCancellationRequested();
            var count = Math.Min(VoiceActivityDetector.FrameBytes, dataLength - offset);
            var frame = wav.AsSpan(dataOffset + offset, count);
            VoiceActivityResult result;
            if (count == VoiceActivityDetector.FrameBytes) result = stream.ProcessPcm16(frame);
            else
            {
                frame.CopyTo(tail);
                result = stream.ProcessPcm16(tail);
            }
            if (result.Event == "speech") return true;
        }
        return false;
    }
}
