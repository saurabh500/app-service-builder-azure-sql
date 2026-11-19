using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using ShopStream;

using var services = new ServiceCollection().AddLogging().BuildServiceProvider();
var app = new ApplicationBuilder(services);
var reachedDab = 0;
new InventoryCommandStartupFilter().Configure(builder => builder.Run(context =>
{
    reachedDab++;
    context.Response.StatusCode = 204;
    return Task.CompletedTask;
}))(app);
var pipeline = app.Build();
for (var round = 0; round < 2; round++)
{
    foreach (var method in new[] { "POST", "PUT", "PATCH", "DELETE" })
    {
        foreach (var header in new[] { "", "wrong", "1" })
        {
            var before = reachedDab;
            var context = new DefaultHttpContext { RequestServices = services };
            context.Request.Method = method;
            context.Request.ContentType = "text/plain";
            if (header.Length > 0) context.Request.Headers["X-Inventory-Command"] = header;
            context.Response.Body = new MemoryStream();
            await pipeline(context);
            if (context.Response.StatusCode != (header == "1" ? 204 : 403)
                || reachedDab - before != (header == "1" ? 1 : 0))
                throw new Exception($"Unsafe-method header check failed: {method}, header={header}");
        }
    }
    foreach (var method in new[] { "GET", "HEAD", "OPTIONS" })
    {
        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.Method = method;
        await pipeline(context);
        if (context.Response.StatusCode != 204) throw new Exception($"Healthy read/preflight blocked: {method}");
    }
}
Console.WriteLine("Passed: unsafe methods require the client header; healthy reads and explicit client calls pass in both rounds.");
