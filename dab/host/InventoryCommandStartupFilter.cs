using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace ShopStream;

public sealed class InventoryCommandStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, nextMiddleware) =>
        {
            var method = context.Request.Method;
            if (!HttpMethods.IsGet(method) && !HttpMethods.IsHead(method) && !HttpMethods.IsOptions(method)
                && context.Request.Headers["X-Inventory-Command"] != "1")
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new
                {
                    error = new
                    {
                        code = "CommandHeaderRequired",
                        message = "Writes require the inventory client request header."
                    }
                });
                return;
            }
            await nextMiddleware(context);
        });
        next(app);
    };
}
