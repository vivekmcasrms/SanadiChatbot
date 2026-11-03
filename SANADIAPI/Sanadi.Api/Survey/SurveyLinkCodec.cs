using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sanadi.Api.Survey;

/// <summary>Purpose-separated, authenticated encryption for emailed survey URLs.</summary>
public sealed class SurveyLinkCodec(IConfiguration configuration)
{
    private sealed record Payload(string CaseNumber, string ServiceType, DateTimeOffset ExpiresAtUtc);

    private byte[] Key()
    {
        var signingKey = configuration["Jwt:SigningKey"];
        if (string.IsNullOrWhiteSpace(signingKey) || signingKey.Length < 32)
            throw new InvalidOperationException("Jwt:SigningKey must be at least 32 characters.");
        return SHA256.HashData(Encoding.UTF8.GetBytes("Sanadi.CustomerPulseSurvey.v1|" + signingKey));
    }

    public string Create(string caseNumber, string serviceType, DateTimeOffset expiresAtUtc)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(new Payload(caseNumber, serviceType, expiresAtUtc));
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(Key(), tag.Length))
            aes.Encrypt(nonce, plaintext, cipher, tag);
        var packed = new byte[1 + nonce.Length + tag.Length + cipher.Length];
        packed[0] = 1;
        nonce.CopyTo(packed, 1);
        tag.CopyTo(packed, 13);
        cipher.CopyTo(packed, 29);
        return Convert.ToBase64String(packed).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public bool TryRead(string? token, out string caseNumber, out string serviceType)
    {
        caseNumber = serviceType = string.Empty;
        if (string.IsNullOrWhiteSpace(token) || token.Length > 2048) return false;
        try
        {
            var encoded = token.Replace('-', '+').Replace('_', '/');
            var packed = Convert.FromBase64String(encoded.PadRight((encoded.Length + 3) / 4 * 4, '='));
            if (packed.Length < 30 || packed[0] != 1) return false;
            var plaintext = new byte[packed.Length - 29];
            using (var aes = new AesGcm(Key(), 16))
                aes.Decrypt(packed.AsSpan(1, 12), packed.AsSpan(29), packed.AsSpan(13, 16), plaintext);
            var payload = JsonSerializer.Deserialize<Payload>(plaintext);
            if (payload is null || payload.ExpiresAtUtc <= DateTimeOffset.UtcNow ||
                string.IsNullOrWhiteSpace(payload.CaseNumber) || string.IsNullOrWhiteSpace(payload.ServiceType))
                return false;
            caseNumber = payload.CaseNumber;
            serviceType = payload.ServiceType;
            return true;
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or JsonException or ArgumentException)
        {
            return false;
        }
    }
}
