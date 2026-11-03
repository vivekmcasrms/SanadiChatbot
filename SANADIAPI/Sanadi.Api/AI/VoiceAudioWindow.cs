namespace Sanadi.Api.AI;

/// <summary>At most two generated sentences: playing and prefetched. Duplicate/stale acknowledgements do nothing.</summary>
internal sealed class VoiceAudioWindow
{
    private readonly SemaphoreSlim capacity = new(2, 2);
    private readonly HashSet<int> pending = [];
    internal async Task Reserve(int sequence, CancellationToken ct)
    {
        await capacity.WaitAsync(ct);
        lock (pending) pending.Add(sequence);
    }
    internal void Played(int sequence)
    {
        lock (pending)
            if (pending.Remove(sequence)) capacity.Release();
    }
}
