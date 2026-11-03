using System.Buffers.Binary;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Configuration;
using Microsoft.ML.OnnxRuntime;

namespace Sanadi.Api.AI;

public readonly record struct VoiceActivityResult(float Probability, string Event);

/// <summary>Server-local speech detection. The embedded model never downloads or transcribes audio.</summary>
public sealed class VoiceActivityDetector : IDisposable
{
    public const int SampleRate = 16000;
    public const int FrameSamples = 512;
    public const int FrameBytes = FrameSamples * sizeof(short);
    public const int FrameMilliseconds = 32;
    private const string ModelResource = "Sanadi.Voice.silero_vad_v5.onnx";
    private readonly object lifecycle = new();
    private readonly Lazy<InferenceSession> session = new(CreateSession, LazyThreadSafetyMode.ExecutionAndPublication);
    private readonly bool reduceBackgroundActivations;
    private readonly bool conservativeSpeechActivation;
    private readonly int endpointSilenceMs;
    private readonly bool adaptiveEndpoint;
    private bool disposed;

    public VoiceActivityDetector(IConfiguration? configuration = null)
    {
        reduceBackgroundActivations = configuration?.GetValue("Voice:ReduceBackgroundActivations", true) ?? true;
        conservativeSpeechActivation = configuration?.GetValue("Voice:ConservativeSpeechActivation", true) ?? true;
        endpointSilenceMs = Math.Clamp(configuration?.GetValue("Voice:EndpointSilenceMs", 1200) ?? 1200, 640, 2400);
        adaptiveEndpoint = configuration?.GetValue("Voice:AdaptiveEndpoint", true) ?? true;
    }

    public StreamState OpenStream()
    {
        lock (lifecycle)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            return new StreamState(session.Value, CreateActivityGate());
        }
    }

    internal SpeechActivityGate CreateActivityGate() =>
        new(reduceBackgroundActivations, conservativeSpeechActivation, endpointSilenceMs, adaptiveEndpoint);

    private static InferenceSession CreateSession()
    {
        // Set the native-runtime switch before entering any ONNX Runtime initialization.
        Environment.SetEnvironmentVariable("ORT_DISABLE_TELEMETRY", "1");
        return CreateNativeSession();
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static InferenceSession CreateNativeSession()
    {
        OrtEnv.Instance().DisableTelemetryEvents();
        using var resource = typeof(VoiceActivityDetector).Assembly.GetManifestResourceStream(ModelResource)
            ?? throw new InvalidOperationException("The packaged voice activity model is missing.");
        using var model = new MemoryStream();
        resource.CopyTo(model);
        using var options = new Microsoft.ML.OnnxRuntime.SessionOptions
        {
            IntraOpNumThreads = 1,
            InterOpNumThreads = 1,
            ExecutionMode = ExecutionMode.ORT_SEQUENTIAL,
            LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR
        };
        return new InferenceSession(model.ToArray(), options);
    }

    public void Dispose()
    {
        lock (lifecycle)
        {
            if (disposed) return;
            disposed = true;
            if (session.IsValueCreated) session.Value.Dispose();
        }
    }

    /// <summary>One call's recurrent state; never shared between users or recordings.</summary>
    public sealed class StreamState : IDisposable
    {
        private static readonly string[] InputNames = ["input", "state", "sr"];
        private static readonly string[] OutputNames = ["output", "stateN"];
        private readonly InferenceSession session;
        private readonly float[] frame = new float[FrameSamples];
        private readonly float[] recurrent = new float[2 * 128];
        private readonly long[] sampleRate = [SampleRate];
        private readonly List<OrtValue> inputs = [];
        private readonly RunOptions runOptions;
        private readonly SpeechActivityGate gate;
        private readonly object sync = new();
        private bool disposed;

        internal StreamState(InferenceSession session, SpeechActivityGate activityGate)
        {
            this.session = session;
            gate = activityGate;
            try
            {
                inputs.Add(OrtValue.CreateTensorValueFromMemory(frame, [1, FrameSamples]));
                inputs.Add(OrtValue.CreateTensorValueFromMemory(recurrent, [2, 1, 128]));
                inputs.Add(OrtValue.CreateTensorValueFromMemory(sampleRate, [1]));
                runOptions = new RunOptions();
            }
            catch
            {
                foreach (var input in inputs) input.Dispose();
                throw;
            }
        }

        public VoiceActivityResult ProcessPcm16(ReadOnlySpan<byte> pcm)
        {
            if (pcm.Length != FrameBytes)
                throw new ArgumentException($"A voice activity frame must contain {FrameBytes} PCM16 bytes.", nameof(pcm));
            lock (sync)
            {
                ObjectDisposedException.ThrowIf(disposed, this);
                for (var i = 0; i < FrameSamples; i++)
                    frame[i] = BinaryPrimitives.ReadInt16LittleEndian(pcm.Slice(i * 2, 2)) / 32768f;
                return Process();
            }
        }

        public VoiceActivityResult ProcessFrame(float[] samples)
        {
            ArgumentNullException.ThrowIfNull(samples);
            if (samples.Length != FrameSamples)
                throw new ArgumentException($"A voice activity frame must contain {FrameSamples} samples.", nameof(samples));
            foreach (var sample in samples)
                if (!float.IsFinite(sample) || sample is < -1f or > 1f)
                    throw new ArgumentException("Voice activity samples must be finite normalized PCM.", nameof(samples));
            lock (sync)
            {
                ObjectDisposedException.ThrowIf(disposed, this);
                samples.CopyTo(frame, 0);
                return Process();
            }
        }

        private VoiceActivityResult Process()
        {
            using var output = session.Run(runOptions, InputNames, inputs, OutputNames);
            var probability = output[0].GetTensorDataAsSpan<float>();
            var state = output[1].GetTensorDataAsSpan<float>();
            if (probability.Length != 1 || state.Length != recurrent.Length ||
                !float.IsFinite(probability[0]) || probability[0] is < 0f or > 1f)
                throw new InvalidOperationException("The voice activity model returned an invalid result.");
            foreach (var value in state)
                if (!float.IsFinite(value))
                    throw new InvalidOperationException("The voice activity model returned invalid state.");
            state.CopyTo(recurrent);
            double energy = 0;
            foreach (var sample in frame) energy += (double)sample * sample;
            var rms = (float)Math.Sqrt(energy / FrameSamples);
            return new VoiceActivityResult(probability[0], gate.Update(probability[0], rms));
        }

        public void Dispose()
        {
            lock (sync)
            {
                if (disposed) return;
                disposed = true;
                foreach (var input in inputs) input.Dispose();
                runOptions.Dispose();
                Array.Clear(frame);
                Array.Clear(recurrent);
            }
        }
    }
}

/// <summary>Speech onset with an optional background-relative guard; this does not estimate distance.</summary>
public sealed class SpeechActivityGate(bool reduceBackgroundActivations = true, bool conservativeSpeechActivation = false,
    int endpointSilenceMs = 960, bool adaptiveEndpoint = false)
{
    public const float SpeechProbability = 0.5f;
    public const float ContinuationProbability = 0.25f;
    public const int ConfirmationMilliseconds = 96;
    public const int CandidateGapMilliseconds = 64;
    public const int SilenceMilliseconds = 960;
    private const int BackgroundWindow = 32;
    private const int MinimumBackgroundFrames = 8;
    private const int WeakConfirmationMilliseconds = 192;
    public const int ConservativeConfirmationMilliseconds = 192;
    public const int ConservativeBackgroundConfirmationMilliseconds = 384;
    private const float BackgroundProbability = 0.1f;
    private const float ClearSpeechProbability = 0.8f;
    private const float BackgroundContrast = 1.5f;
    private readonly float[] backgroundLevels = new float[BackgroundWindow];
    private int backgroundCount;
    private int backgroundIndex;
    private float backgroundLevel;
    private int candidateMilliseconds;
    private int clearCandidateMilliseconds;
    private int gapMilliseconds;
    private int silenceMilliseconds;
    private int speechMilliseconds;
    private bool ended;
    public bool HasSpeech { get; private set; }

    public string Update(float probability, float? rms = null)
    {
        if (!float.IsFinite(probability) || probability is < 0f or > 1f)
            throw new ArgumentOutOfRangeException(nameof(probability));
        if (rms.HasValue && (!float.IsFinite(rms.Value) || rms.Value is < 0f or > 1f))
            throw new ArgumentOutOfRangeException(nameof(rms));
        if (ended) return "continue";
        if (!HasSpeech)
        {
            // Learn only from confident non-speech outside a speech candidate. Each stream
            // starts uncalibrated; there is no startup calibration wait.
            if (reduceBackgroundActivations && rms.HasValue &&
                probability <= BackgroundProbability && candidateMilliseconds == 0)
                ObserveBackground(rms.Value);

            if (probability >= SpeechProbability)
            {
                candidateMilliseconds += VoiceActivityDetector.FrameMilliseconds;
                gapMilliseconds = 0;
                // Speech probability identifies speech, not which person is speaking.
                // Even confident speech close to background needs more confirmation in
                // conservative mode. Never impose an absolute microphone-volume cutoff.
                var nearBackground = reduceBackgroundActivations && rms.HasValue &&
                    backgroundCount >= MinimumBackgroundFrames &&
                    rms.Value <= backgroundLevel * BackgroundContrast;
                bool confirmed;
                if (reduceBackgroundActivations && conservativeSpeechActivation)
                {
                    // One clearer frame must not turn a weak background candidate into
                    // an immediate interruption. Sustained quiet speech is still accepted.
                    clearCandidateMilliseconds = nearBackground ? 0 :
                        clearCandidateMilliseconds + VoiceActivityDetector.FrameMilliseconds;
                    confirmed = clearCandidateMilliseconds >= ConservativeConfirmationMilliseconds ||
                        candidateMilliseconds >= ConservativeBackgroundConfirmationMilliseconds;
                }
                else
                {
                    // Exact pre-change event timing when the new feature is disabled.
                    var weakAgainstBackground = nearBackground && probability < ClearSpeechProbability;
                    var confirmation = weakAgainstBackground ? WeakConfirmationMilliseconds : ConfirmationMilliseconds;
                    confirmed = candidateMilliseconds >= confirmation;
                }
                if (confirmed)
                {
                    HasSpeech = true;
                    return "speech";
                }
            }
            else
            {
                gapMilliseconds += VoiceActivityDetector.FrameMilliseconds;
                if (gapMilliseconds >= CandidateGapMilliseconds)
                {
                    candidateMilliseconds = 0;
                    clearCandidateMilliseconds = 0;
                }
            }
        }
        else
        {
            if (probability >= ContinuationProbability) speechMilliseconds += VoiceActivityDetector.FrameMilliseconds;
            silenceMilliseconds = probability >= ContinuationProbability
                ? 0 : silenceMilliseconds + VoiceActivityDetector.FrameMilliseconds;
            // A short opening phrase often precedes a hesitation. Give it a little
            // more time; never infer semantic completion from the audio probability.
            var pause = Math.Clamp(endpointSilenceMs, 640, 2400) + (adaptiveEndpoint && speechMilliseconds < 1000 ? 320 : 0);
            if (silenceMilliseconds >= pause)
            {
                ended = true;
                return "pause";
            }
        }
        return "continue";
    }

    private void ObserveBackground(float rms)
    {
        backgroundLevels[backgroundIndex] = rms;
        backgroundIndex = (backgroundIndex + 1) % BackgroundWindow;
        backgroundCount = Math.Min(backgroundCount + 1, BackgroundWindow);
        // A lower quartile limits the effect of intermittent impacts. The estimate has
        // no fixed microphone-gain threshold and is never learned from accepted speech.
        Span<float> ordered = stackalloc float[BackgroundWindow];
        backgroundLevels.AsSpan(0, backgroundCount).CopyTo(ordered);
        ordered = ordered[..backgroundCount];
        ordered.Sort();
        backgroundLevel = ordered[(backgroundCount - 1) / 4];
    }
}
