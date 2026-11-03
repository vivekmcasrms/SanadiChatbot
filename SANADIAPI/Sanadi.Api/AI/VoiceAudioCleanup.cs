using System.Buffers.Binary;

namespace Sanadi.Api.AI;

/// <summary>Suppresses low-level generated noise in pauses, preserving speech and WAV timing.</summary>
internal static class VoiceAudioCleanup
{
    internal static byte[] Apply(byte[] wav)
    {
        if (!ConfiguredSpeech.ValidWave(wav)) return wav;
        var rate = 0; var channels = 0; var block = 0; var dataOffset = 0; var dataLength = 0;
        var encoding = 0; var sampleBytes = 0;
        for (var offset = 12; offset + 8 <= wav.Length;)
        {
            var size = (int)BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(offset + 4));
            if (wav.AsSpan(offset, 4).SequenceEqual("fmt "u8))
            {
                var format = wav.AsSpan(offset + 8, size);
                if (size < 16) return wav;
                encoding = BinaryPrimitives.ReadUInt16LittleEndian(format);
                var bits = BinaryPrimitives.ReadUInt16LittleEndian(format[14..]);
                if (!(encoding == 1 && bits == 16 || encoding == 3 && bits == 32)) return wav;
                sampleBytes = bits / 8;
                channels = BinaryPrimitives.ReadUInt16LittleEndian(format[2..]);
                rate = BinaryPrimitives.ReadInt32LittleEndian(format[4..]);
                block = BinaryPrimitives.ReadUInt16LittleEndian(format[12..]);
            }
            if (wav.AsSpan(offset, 4).SequenceEqual("data"u8))
            {
                if (dataOffset != 0) return wav;
                dataOffset = offset + 8; dataLength = size;
            }
            offset += 8 + size + (size & 1);
        }
        if (channels is < 1 or > 2 || rate is < 8000 or > 96000 || block != channels * sampleBytes ||
            dataOffset == 0 || dataLength % block != 0 || dataLength / block < rate / 5) return wav;
        var frameSamples = rate / 100; // 10 ms analysis windows.
        var samples = dataLength / block;
        var frames = (samples + frameSamples - 1) / frameSamples;
        var levels = new double[frames];
        for (var frame = 0; frame < frames; frame++)
        {
            var end = Math.Min(samples, (frame + 1) * frameSamples);
            var count = (end - frame * frameSamples) * channels;
            double sum = 0;
            for (var i = frame * frameSamples * channels; i < end * channels; i++)
            {
                var position = dataOffset + i * sampleBytes;
                var value = encoding == 1 ? BinaryPrimitives.ReadInt16LittleEndian(wav.AsSpan(position)) / 32768d
                    : BinaryPrimitives.ReadSingleLittleEndian(wav.AsSpan(position));
                if (!double.IsFinite(value)) return wav;
                sum += value * value;
            }
            levels[frame] = Math.Sqrt(sum / count);
        }
        var peak = levels.Max();
        if (peak < .02) return wav; // Protect an entirely quiet utterance.
        var threshold = Math.Min(.004, peak * .02);
        var preserve = new bool[frames];
        for (var frame = 0; frame < frames; frame++)
            if (levels[frame] >= threshold)
                Array.Fill(preserve, true, Math.Max(0, frame - 12), Math.Min(frames - 1, frame + 12) - Math.Max(0, frame - 12) + 1);
        if (preserve.All(p => p)) return wav;
        var cleaned = (byte[])wav.Clone();
        var gain = preserve[0] ? 1d : 0d;
        var step = 1d / (rate * .005); // 5 ms fade avoids clicks at noise-gate boundaries.
        for (var i = 0; i < samples; i++)
        {
            gain = preserve[i / frameSamples] ? Math.Min(1, gain + step) : Math.Max(0, gain - step);
            if (gain == 1) continue;
            for (var channel = 0; channel < channels; channel++)
            {
                var offset = dataOffset + (i * channels + channel) * sampleBytes;
                if (encoding == 1)
                {
                    var value = BinaryPrimitives.ReadInt16LittleEndian(wav.AsSpan(offset));
                    BinaryPrimitives.WriteInt16LittleEndian(cleaned.AsSpan(offset), (short)Math.Round(value * gain));
                }
                else
                {
                    var value = BinaryPrimitives.ReadSingleLittleEndian(wav.AsSpan(offset));
                    BinaryPrimitives.WriteSingleLittleEndian(cleaned.AsSpan(offset), (float)(value * gain));
                }
            }
        }
        return cleaned;
    }
}
