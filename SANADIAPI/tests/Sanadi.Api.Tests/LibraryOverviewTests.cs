using System.Data;
using System.Text.Json;
using Dapper;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class LibraryOverviewTests
{
    [Fact]
    public void Maps_native_sql_identifier_date_and_time_values()
    {
        var id = Guid.NewGuid();
        var table = new DataTable();
        table.Columns.Add("LibraryLocationId", typeof(Guid));
        table.Columns.Add("ExceptionDate", typeof(DateTime));
        table.Columns.Add("OpensAt", typeof(TimeSpan));
        table.Columns.Add("ClosesAt", typeof(TimeSpan));
        table.Columns.Add("Closed", typeof(bool));
        table.Rows.Add(id, new DateTime(2026, 9, 28), TimeSpan.FromHours(8), TimeSpan.FromHours(17), false);
        using var reader = table.CreateDataReader();
        var row = Assert.Single(reader.Parse<LibraryController.LibraryExceptionRow>());
        Assert.Equal(id, row.LibraryLocationId);
        Assert.Equal(new DateTime(2026, 9, 28), row.ExceptionDate);
        Assert.Equal("08:00", LibraryController.FormatTime(row.OpensAt));
    }

    [Fact]
    public void Normal_opening_hours_apply_without_an_exception()
    {
        var id = Guid.NewGuid();
        var branches = LibraryController.BuildBranches(
            [new() { Id = id, Code = "main" }],
            [new() { LibraryLocationId = id, DayOfWeek = 0, OpensAt = TimeSpan.FromHours(8), ClosesAt = TimeSpan.FromHours(17) }],
            [], new DateTimeOffset(2026, 9, 28, 10, 30, 0, TimeSpan.FromHours(4)));
        var branch = JsonSerializer.SerializeToElement(branches)[0];
        Assert.True(branch.GetProperty("isOpenNow").GetBoolean());
        Assert.Equal("10:30", branch.GetProperty("localTime").GetString());
        Assert.Equal("08:00", branch.GetProperty("todayOpensAt").GetString());
    }

    [Fact]
    public void Exception_overrides_week_and_next_open_uses_local_calendar()
    {
        var id = Guid.NewGuid();
        var branches = LibraryController.BuildBranches(
            [new() { Id = id, Code = "main" }],
            [new() { LibraryLocationId = id, DayOfWeek = 0, OpensAt = TimeSpan.FromHours(8), ClosesAt = TimeSpan.FromHours(17) },
             new() { LibraryLocationId = id, DayOfWeek = 1, OpensAt = TimeSpan.FromHours(8), ClosesAt = TimeSpan.FromHours(17) }],
            [new() { LibraryLocationId = id, ExceptionDate = new DateTime(2026, 9, 28), Closed = true }],
            new DateTimeOffset(2026, 9, 28, 0, 30, 0, TimeSpan.FromHours(4)));
        var branch = JsonSerializer.SerializeToElement(branches)[0];
        Assert.False(branch.GetProperty("isOpenNow").GetBoolean());
        Assert.Equal(1, branch.GetProperty("nextOpenDay").GetInt32());
        Assert.Equal("08:00", branch.GetProperty("nextOpenAt").GetString());
    }
}
