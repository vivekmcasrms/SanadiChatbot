namespace Sanadi.Api.Notifications;

public sealed class TicketEmailWorker(IServiceScopeFactory scopes, ILogger<TicketEmailWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var warned = false;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(20));
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<TicketEmailDispatcher>().RunAsync(stoppingToken);
                    warned = false;
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch
                {
                    if (!warned) logger.LogWarning("Ticket email dispatcher unavailable. Check its SQL migration, email settings and delegated SSO authorization. Ticket processing continues.");
                    warned = true;
                }

                if (stoppingToken.IsCancellationRequested || !await timer.WaitForNextTickAsync(stoppingToken)) break;
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown can arrive while waiting for the next tick as well as during dispatch.
        }
    }
}
