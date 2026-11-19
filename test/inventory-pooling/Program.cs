using System.Data;
using Microsoft.Data.SqlClient;

var database = Environment.GetEnvironmentVariable("SQL_DATABASE");
var server = Environment.GetEnvironmentVariable("SQL_SERVER");
if (string.IsNullOrWhiteSpace(database) || string.IsNullOrWhiteSpace(server)
    || Environment.GetEnvironmentVariable("INVENTORY_TEST_CONFIRM_DATABASE") != database)
    throw new InvalidOperationException("Set SQL_SERVER, SQL_DATABASE and matching INVENTORY_TEST_CONFIRM_DATABASE.");
var settings = new SqlConnectionStringBuilder
{
    DataSource = server, InitialCatalog = database,
    Authentication = SqlAuthenticationMethod.ActiveDirectoryDefault,
    Encrypt = SqlConnectionEncryptOption.Mandatory, TrustServerCertificate = false,
    MinPoolSize = 0, MaxPoolSize = 1, ConnectRetryCount = 0, ConnectTimeout = 60,
    ApplicationName = "ShopStream inventory pool verification " + Guid.NewGuid()
};
const string tenantKey = "http://schemas.microsoft.com/identity/claims/tenantid";
const string actorKey = "http://schemas.microsoft.com/identity/claims/objectidentifier";
var skipReturn = args.Contains("--keep-session-control");
await using var connection = new SqlConnection(settings.ConnectionString);
int? physicalSession = null;
for (var round = 0; round < 3; round++)
{
    if (connection.State == ConnectionState.Closed) await connection.OpenAsync();
    await using (var read = connection.CreateCommand())
    {
        read.CommandText = "SELECT @@SPID, SESSION_CONTEXT(@tenant_key), SESSION_CONTEXT(@actor_key)";
        read.Parameters.Add("@tenant_key", SqlDbType.NVarChar, 128).Value = tenantKey;
        read.Parameters.Add("@actor_key", SqlDbType.NVarChar, 128).Value = actorKey;
        await using var rows = await read.ExecuteReaderAsync();
        await rows.ReadAsync();
        var id = rows.GetInt16(0);
        if (physicalSession is not null && physicalSession != id)
            throw new Exception("A different SQL session was used; this did not prove pool reset.");
        physicalSession = id;
        if (!rows.IsDBNull(1) || !rows.IsDBNull(2))
            throw new Exception("A previous caller's session context survived connection reuse.");
    }
    await using (var write = connection.CreateCommand())
    {
        write.CommandText = "EXEC sys.sp_set_session_context @tenant_key,@tenant; EXEC sys.sp_set_session_context @actor_key,@actor;";
        write.Parameters.Add("@tenant_key", SqlDbType.NVarChar, 128).Value = tenantKey;
        write.Parameters.Add("@actor_key", SqlDbType.NVarChar, 128).Value = actorKey;
        write.Parameters.Add("@tenant", SqlDbType.NVarChar, 36).Value = Guid.NewGuid().ToString();
        write.Parameters.Add("@actor", SqlDbType.NVarChar, 36).Value = Guid.NewGuid().ToString();
        await write.ExecuteNonQueryAsync();
    }
    if (!skipReturn) await connection.CloseAsync();
}
Console.WriteLine("Passed: three leases reused one physical SQL session; both caller claim keys reset on each lease.");
