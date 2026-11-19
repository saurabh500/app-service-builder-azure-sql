using Azure.Identity;
using Microsoft.ApplicationInsights.Extensibility;
using Microsoft.ApplicationInsights.WindowsServer.TelemetryChannel;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

[assembly: HostingStartup(typeof(ShopStream.DabTelemetryStartup))]

if (args.FirstOrDefault() != "start")
{
    return Cli.Program.Main(args);
}
using var owner = new TelemetryConfiguration
{
    ConnectionString = Environment.GetEnvironmentVariable("APPLICATIONINSIGHTS_CONNECTION_STRING")
        ?? throw new InvalidOperationException("APPLICATIONINSIGHTS_CONNECTION_STRING is required.")
};
var channel = new ServerTelemetryChannel();
owner.TelemetryChannel = channel;
owner.SetAzureTokenCredential(new ManagedIdentityCredential());
channel.Initialize(owner);
// DAB also creates logger factories outside its main dependency-injection container.
Azure.DataApiBuilder.Service.Startup.CustomTelemetryChannel = new ShopStream.SamiTelemetryChannel(channel);
var startupAssembly = typeof(ShopStream.DabTelemetryStartup).Assembly.GetName().Name!;
var existing = Environment.GetEnvironmentVariable("ASPNETCORE_HOSTINGSTARTUPASSEMBLIES");
Environment.SetEnvironmentVariable("ASPNETCORE_HOSTINGSTARTUPASSEMBLIES",
    string.IsNullOrEmpty(existing) ? startupAssembly : $"{existing};{startupAssembly}");
try
{
    return Cli.Program.Main(args);
}
finally
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    try
    {
        if (!channel.FlushAsync(timeout.Token).GetAwaiter().GetResult())
        {
            Console.Error.WriteLine("DAB telemetry did not finish flushing before shutdown.");
        }
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine("DAB telemetry shutdown flush exceeded 10 seconds.");
    }
    Azure.DataApiBuilder.Service.Startup.CustomTelemetryChannel = null;
}

namespace ShopStream
{
    public sealed class DabTelemetryStartup : IHostingStartup
    {
        public void Configure(IWebHostBuilder builder)
        {
            builder.ConfigureServices(services =>
            {
                services.AddTransient<IStartupFilter, InventoryCommandStartupFilter>();
                services.PostConfigure<TelemetryConfiguration>(configuration =>
                {
                    if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("APPLICATIONINSIGHTS_CONNECTION_STRING")))
                    {
                        throw new InvalidOperationException("APPLICATIONINSIGHTS_CONNECTION_STRING is required.");
                    }
                    configuration.SetAzureTokenCredential(new ManagedIdentityCredential());
                    Console.WriteLine("DAB Application Insights exporter configured for system-assigned managed identity.");
                });
            });
        }
    }
}
