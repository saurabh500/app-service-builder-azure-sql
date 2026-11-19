using Azure.Identity;
using Microsoft.ApplicationInsights.Extensibility;
using Microsoft.ApplicationInsights.WindowsServer.TelemetryChannel;
using ShopStream;

const string connectionString = "InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://example.invalid/";
using var owner = new TelemetryConfiguration { ConnectionString = connectionString };
var channel = new ServerTelemetryChannel();
owner.TelemetryChannel = channel;
owner.SetAzureTokenCredential(new ManagedIdentityCredential());
channel.Initialize(owner);
var credentialProperty = typeof(ServerTelemetryChannel).GetInterfaces()
    .Single(type => type.Name == "ISupportCredentialEnvelope").GetProperty("CredentialEnvelope")!;
var credential = credentialProperty.GetValue(channel);
Check(credential is not null, "The owner must configure an Azure token credential.");
var endpoint = channel.EndpointAddress;
var shared = new SamiTelemetryChannel(channel);
for (var index = 0; index < 2; index++)
{
    using var loggerConfiguration = new TelemetryConfiguration { ConnectionString = connectionString };
    loggerConfiguration.TelemetryChannel = shared;
    loggerConfiguration.ConnectionString = connectionString;
    Check(ReferenceEquals(credential, credentialProperty.GetValue(channel)),
        "A new logger configuration must not clear the owner's SAMI credential.");
    Check(channel.EndpointAddress == endpoint, "A new logger must not replace the AAD ingestion endpoint.");
}
try
{
    shared.EndpointAddress = "https://another.invalid/v2/track";
    throw new Exception("Changing the configured ingestion origin must fail.");
}
catch (InvalidOperationException) { }
// Calibration: without the shared-channel boundary, DAB's second configuration clears the credential.
using (var keyOnlyConfiguration = new TelemetryConfiguration { ConnectionString = connectionString })
{
    keyOnlyConfiguration.TelemetryChannel = channel;
    Check(credentialProperty.GetValue(channel) is null,
        "The control must reproduce the credential-clearing failure.");
}
Console.WriteLine("PASS: SAMI credential and AAD endpoint survive two logger configurations; foreign origin rejected; unprotected control reproduces the failure. No telemetry sent.");

static void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}
