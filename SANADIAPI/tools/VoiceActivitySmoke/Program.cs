using System.Diagnostics;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.AI;

// Offline synthetic-audio check. No appsettings, SQL, STT/TTS API, or HTTP client is used.
// Run: dotnet run --project tools/VoiceActivitySmoke -- tools/VoiceActivitySmoke/synthetic-speech.wav
Environment.SetEnvironmentVariable("ORT_DISABLE_TELEMETRY", "1");
if (args.Length < 1) throw new ArgumentException("Pass one or more local synthetic speech WAV paths.");
var cases = new List<(string Name, string? Fixture, float[] Audio, int SignalLength, bool ExpectedSpeech, double Gain)>();
foreach (var path in args)
{
    var speech = ReadPcm16Wave(Path.GetFullPath(path));
    foreach (var (name, gain) in new[] { ("normal-speech", 1f), ("quiet-speech", 0.1f), ("very-quiet-speech", 0.03f) })
    {
        var audio = new float[speech.Length + 32000];
        for (var i = 0; i < speech.Length; i++) audio[i] = speech[i] * gain;
        cases.Add((name, Path.GetFileNameWithoutExtension(path), audio, speech.Length, true, gain));
    }
}
foreach (var kind in new[] { "silence", "clicks", "objects-and-tone", "steady-noise" })
{
    var audio = new float[5 * 16000];
    uint seed = 1234567;
    float Noise()
    {
        seed = unchecked(seed * 1664525 + 1013904223);
        return (float)(seed / 4294967296d * 2 - 1);
    }
    for (var i = 0; i < 3 * 16000; i++)
    {
        var time = i / 16000d;
        var phase = time % 0.4;
        var impact = phase < 0.025 ? Noise() * 0.7 * Math.Exp(-phase * 160) : 0;
        audio[i] = kind switch
        {
            "clicks" => (float)impact,
            "objects-and-tone" => (float)(impact + 0.1 * Math.Sin(2 * Math.PI * 440 * time)),
            "steady-noise" => Noise() * 0.06f + (float)(0.03 * Math.Sin(2 * Math.PI * 120 * time)),
            _ => 0
        };
    }
    cases.Add((kind, null, audio, 3 * 16000, false, 1));
}

var initialization = Stopwatch.StartNew();
// Test-only overrides allow A/B checks against the previous activation gate.
// No application configuration or credentials are loaded.
var configuration = new ConfigurationBuilder().AddEnvironmentVariables("SANADI_VAD_TEST_").Build();
using var detector = new VoiceActivityDetector(configuration);
initialization.Stop();
var results = new List<object>();
var allPassed = true;
foreach (var item in cases)
{
    var opened = Stopwatch.StartNew();
    using var stream = detector.OpenStream();
    opened.Stop();
    var frames = 0;
    var speechEvents = 0;
    var pauseEvents = 0;
    using var guardWave = new MemoryStream();
    using var guardWriter = new BinaryWriter(guardWave, Encoding.ASCII, leaveOpen: true);
    var guardedBytes = ((item.Audio.Length + 511) / 512) * VoiceActivityDetector.FrameBytes;
    guardWriter.Write("RIFF"u8); guardWriter.Write(guardedBytes + 36); guardWriter.Write("WAVEfmt "u8);
    guardWriter.Write(16); guardWriter.Write((short)1); guardWriter.Write((short)1);
    guardWriter.Write(16000); guardWriter.Write(32000); guardWriter.Write((short)2); guardWriter.Write((short)16);
    guardWriter.Write("data"u8); guardWriter.Write(guardedBytes);
    double? firstSpeechMs = null;
    double maximumProbability = 0;
    double processingMs = 0;
    for (var offset = 0; offset < item.Audio.Length; offset += 512)
    {
        var frame = new float[512];
        Array.Copy(item.Audio, offset, frame, 0, Math.Min(frame.Length, item.Audio.Length - offset));
        var pcm = new byte[VoiceActivityDetector.FrameBytes];
        for (var i = 0; i < frame.Length; i++)
        {
            // Match the browser's Math.round and signed PCM16 wire representation.
            var scaled = frame[i] * (frame[i] < 0 ? 32768 : 32767);
            var quantized = (short)Math.Clamp(Math.Floor(scaled + 0.5), short.MinValue, short.MaxValue);
            BinaryPrimitives.WriteInt16LittleEndian(pcm.AsSpan(i * 2, 2), quantized);
        }
        var started = Stopwatch.GetTimestamp();
        guardWriter.Write(pcm);
        var result = stream.ProcessPcm16(pcm);
        processingMs += Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        if (!float.IsFinite(result.Probability)) throw new InvalidOperationException("Non-finite VAD probability.");
        frames++;
        maximumProbability = Math.Max(maximumProbability, result.Probability);
        if (result.Event == "speech")
        {
            speechEvents++;
            firstSpeechMs ??= frames * 32;
        }
        if (result.Event == "pause") pauseEvents++;
    }
    var rms = Math.Sqrt(item.Audio.Take(item.SignalLength).Sum(value => (double)value * value) / item.SignalLength);
    var firstSignal = Array.FindIndex(item.Audio, sample => sample != 0);
    double? firstSignalMs = firstSignal < 0 ? null : firstSignal / 16d;
    var transcriptionAllowed = VoiceInputSpeechGuard.HasSpeech(guardWave.ToArray(), detector, CancellationToken.None);
    var passed = speechEvents == (item.ExpectedSpeech ? 1 : 0) && pauseEvents == (item.ExpectedSpeech ? 1 : 0)
        && transcriptionAllowed == item.ExpectedSpeech;
    allPassed &= passed;
    results.Add(new
    {
        kind = item.Name,
        fixture = item.Fixture,
        gain = Math.Round(item.Gain, 3),
        rms = Math.Round(rms, 6),
        speechEvents,
        pauseEvents,
        transcriptionAllowed,
        firstSpeechMs,
        firstSignalMs,
        activationDelayMs = firstSpeechMs - firstSignalMs,
        maximumProbability = Math.Round(maximumProbability, 5),
        streamInitializationMs = opened.ElapsedMilliseconds,
        averageFrameMs = Math.Round(processingMs / frames, 3),
        frames,
        passed
    });
}
Console.WriteLine(JsonSerializer.Serialize(new
{
    success = allPassed,
    inputFormat = "16 kHz mono PCM16, matching the browser WebSocket frames",
    detectorConstructionMs = initialization.ElapsedMilliseconds,
    results,
    note = "Synthetic local PCM tests only. This executable creates no network client and calls no STT/TTS service or database."
}, new JsonSerializerOptions { WriteIndented = true }));
Environment.ExitCode = allPassed ? 0 : 1;

static float[] ReadPcm16Wave(string path)
{
    using var input = File.OpenRead(path);
    using var reader = new BinaryReader(input, Encoding.ASCII);
    if (Encoding.ASCII.GetString(reader.ReadBytes(4)) != "RIFF") throw new InvalidDataException("Expected RIFF WAV.");
    reader.ReadUInt32();
    if (Encoding.ASCII.GetString(reader.ReadBytes(4)) != "WAVE") throw new InvalidDataException("Expected WAV audio.");
    ushort format = 0, channels = 0, bits = 0;
    uint rate = 0;
    byte[]? data = null;
    while (input.Position + 8 <= input.Length)
    {
        var id = Encoding.ASCII.GetString(reader.ReadBytes(4));
        var length = reader.ReadUInt32();
        var next = input.Position + length + (length & 1);
        if (next > input.Length) throw new InvalidDataException("Truncated WAV chunk.");
        if (id == "fmt ")
        {
            if (length < 16) throw new InvalidDataException("Invalid WAV format.");
            format = reader.ReadUInt16();
            channels = reader.ReadUInt16();
            rate = reader.ReadUInt32();
            reader.ReadUInt32();
            reader.ReadUInt16();
            bits = reader.ReadUInt16();
        }
        else if (id == "data") data = reader.ReadBytes(checked((int)length));
        input.Position = next;
    }
    if (format != 1 || bits != 16 || channels is < 1 or > 2 || rate is < 8000 or > 192000 || data is null)
        throw new InvalidDataException("Supply mono/stereo 16-bit PCM WAV with a standard sample rate.");
    var source = new float[data.Length / (channels * 2)];
    for (var i = 0; i < source.Length; i++)
        for (var channel = 0; channel < channels; channel++)
            source[i] += BitConverter.ToInt16(data, (i * channels + channel) * 2) / (32768f * channels);
    if (source.Length == 0) throw new InvalidDataException("Empty WAV audio.");
    var ratio = rate / 16000d;
    var output = new float[(int)Math.Floor(source.Length / ratio)];
    for (var i = 0; i < output.Length; i++)
    {
        var start = (int)Math.Floor(i * ratio);
        var end = Math.Min(source.Length, Math.Max(start + 1, (int)Math.Floor((i + 1) * ratio)));
        double sum = 0;
        for (var j = start; j < end; j++) sum += source[j];
        output[i] = (float)(sum / (end - start));
    }
    return output;
}
