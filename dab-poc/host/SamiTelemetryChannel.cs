using Microsoft.ApplicationInsights.Channel;

namespace ShopStream;

public sealed class SamiTelemetryChannel(ITelemetryChannel inner) : ITelemetryChannel
{
    public bool? DeveloperMode
    {
        get => inner.DeveloperMode;
        set => inner.DeveloperMode = value;
    }

    public string EndpointAddress
    {
        get => inner.EndpointAddress;
        set
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var endpoint)
                || Uri.Compare(endpoint, new Uri(inner.EndpointAddress), UriComponents.SchemeAndServer,
                    UriFormat.SafeUnescaped, StringComparison.OrdinalIgnoreCase) != 0)
            {
                throw new InvalidOperationException("DAB telemetry cannot change the configured ingestion origin.");
            }
            // The owner retains its AAD endpoint and credentials, not each logger's key-only defaults.
        }
    }

    public void Send(ITelemetry item) => inner.Send(item);
    public void Flush() => inner.Flush();

    // The entry point owns shutdown; disposing a DAB logger must not stop the shared exporter.
    public void Dispose() { }
}
