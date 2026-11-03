using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Infrastructure.Persistence;

public interface ISqlConnectionFactory
{
    SqlConnection Create();
}

public sealed class SqlConnectionFactory(IOptions<SqlOptions> options) : ISqlConnectionFactory
{
    public SqlConnection Create() => new(options.Value.ConnectionString);
}
