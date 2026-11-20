using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

[assembly: HostingStartup(typeof(ShopStream.InventoryHostingStartup))]

if (args.FirstOrDefault() == "start")
{
    var startupAssembly = typeof(ShopStream.InventoryHostingStartup).Assembly.GetName().Name!;
    var existing = Environment.GetEnvironmentVariable("ASPNETCORE_HOSTINGSTARTUPASSEMBLIES");
    Environment.SetEnvironmentVariable("ASPNETCORE_HOSTINGSTARTUPASSEMBLIES",
        string.IsNullOrEmpty(existing) ? startupAssembly : $"{existing};{startupAssembly}");
}

return Cli.Program.Main(args);

namespace ShopStream
{
    public sealed class InventoryHostingStartup : IHostingStartup
    {
        public void Configure(IWebHostBuilder builder)
        {
            builder.ConfigureServices(services =>
                services.AddTransient<IStartupFilter, InventoryCommandStartupFilter>());
        }
    }
}
