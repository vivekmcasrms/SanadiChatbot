using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;
using Sanadi.Application;

namespace Sanadi.Infrastructure.Platform;

public class StorageOptions
{
    /// <summary>Root folder for object storage when running on-premise.</summary>
    public string RootPath { get; set; } = "App_Data/storage";
}

public class LocalFileStorage(IOptions<StorageOptions> options) : IFileStorage
{
    private readonly string _root = options.Value.RootPath;

    private string Resolve(string bucket, string path)
    {
        var full = Path.Combine(_root, bucket, path.Replace("..", ""));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        return full;
    }

    public async Task<string> UploadAsync(string bucket, string path, Stream content, string contentType,
        CancellationToken ct = default)
    {
        var full = Resolve(bucket, path);
        await using var file = File.Create(full);
        await content.CopyToAsync(file, ct);
        return path;
    }

    public Task<Stream> DownloadAsync(string bucket, string path, CancellationToken ct = default) =>
        Task.FromResult<Stream>(File.OpenRead(Resolve(bucket, path)));

    public Task DeleteAsync(string bucket, string path, CancellationToken ct = default)
    {
        var full = Resolve(bucket, path);
        if (File.Exists(full)) File.Delete(full);
        return Task.CompletedTask;
    }
}

public class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "sanadi@uaeu.ac.ae";
    public string FromName { get; set; } = "Sanadi";
    public bool Enabled { get; set; }
}

public class SmtpEmailSender(IOptions<SmtpOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    private readonly SmtpOptions _o = options.Value;

    public async Task SendAsync(string to, string subject, string html, CancellationToken ct = default)
    {
        if (!_o.Enabled || string.IsNullOrWhiteSpace(_o.Host))
        {
            logger.LogInformation("Email suppressed (SMTP disabled): {To} / {Subject}", to, subject);
            return;
        }

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(_o.FromName, _o.FromAddress));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = html }.ToMessageBody();

        using var client = new SmtpClient();
        await client.ConnectAsync(_o.Host, _o.Port, SecureSocketOptions.StartTlsWhenAvailable, ct);
        if (!string.IsNullOrEmpty(_o.User)) await client.AuthenticateAsync(_o.User, _o.Password, ct);
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);
    }
}
