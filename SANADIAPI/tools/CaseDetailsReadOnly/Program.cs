using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Sanadi.Api.Http;
using Sanadi.Api.Security;
using Sanadi.Application.Data;
using Sanadi.Infrastructure;
using Sanadi.Infrastructure.Persistence;

// Read-only validation of the exact UI query against the existing API data service.
var root = Path.GetFullPath(args[0]);
var config = new ConfigurationBuilder().AddJsonFile(Path.Combine(root, "SANADIAPI/Sanadi.Api/appsettings.json")).Build();
var services = new ServiceCollection().AddLogging().AddSanadiInfrastructure(config).BuildServiceProvider();
await using var scope = services.CreateAsyncScope();
await using var db = scope.ServiceProvider.GetRequiredService<ISqlConnectionFactory>().Create();
var row = await db.QuerySingleAsync<(Guid Id, Guid Student, string? Due)>("""
    SELECT id, student_id Student, CONVERT(varchar(10),resolution_due_at,23) Due FROM dbo.cases WHERE case_number=@reference
    """, new { reference = args[1] });
var source = File.ReadAllText(Path.Combine(root, "UAEU-SANAD-MAIN-2/src/routes/_authenticated/requests.$caseId.tsx"));
var url = Regex.Match(source, @"`(/api/v1/data/cases\?select=[^`]+)`").Groups[1].Value.Replace("${caseId}", row.Id.ToString());
if (string.IsNullOrEmpty(url)) throw new Exception("UI query not found");
var context = new DefaultHttpContext(); context.Request.QueryString = new QueryString(url[url.IndexOf('?')..]);
var request = PostgrestQueryParser.Parse("cases", "GET", context.Request.Query, context.Request.Headers, null);
var data = scope.ServiceProvider.GetRequiredService<IDataQueryService>();
var user = new CurrentUser { UserId = row.Student, IsAuthenticated = true, Roles = ["student"] };
var result = await data.ExecuteAsync(request, user, default);
var item = JsonSerializer.SerializeToElement(result.Data)[0];
if (item.GetProperty("service_units").ValueKind == JsonValueKind.Null) throw new Exception("Unit embed is missing");
var unit = item.GetProperty("service_units").GetProperty("name_en").GetString();
var expected = item.GetProperty("expected_resolution_date").ValueKind == JsonValueKind.Null
    ? item.GetProperty("resolution_due_at").GetString()?[..10]
    : item.GetProperty("expected_resolution_date").GetString();
if (expected != row.Due) throw new Exception("The stored deadline was not returned");
Console.WriteLine($"PASS existing API data service: responsible unit={unit}; displayed deadline={expected}; category returned from stored relationship");
var other = await data.ExecuteAsync(request, new CurrentUser { UserId = Guid.NewGuid(), IsAuthenticated = true, Roles = ["student"] }, default);
if (JsonSerializer.SerializeToElement(other.Data).GetArrayLength() != 0) throw new Exception("Another student can read the case");
Console.WriteLine("PASS unrelated student cannot read the request");
