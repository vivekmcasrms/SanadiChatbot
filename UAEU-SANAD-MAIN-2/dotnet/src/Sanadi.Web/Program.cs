using System.Text;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Sanadi.Domain;
using Sanadi.Infrastructure;
using Sanadi.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSanadi(builder.Configuration);
builder.Services.AddControllersWithViews();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHttpContextAccessor();

// Cookie sign-in for the server-rendered UI; bearer tokens for the REST API.
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/auth";
        options.AccessDeniedPath = "/auth";
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
    })
    .AddJwtBearer(options =>
    {
        var secret = builder.Configuration["Auth:JwtSecret"] ?? "";
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = !string.IsNullOrEmpty(builder.Configuration["Auth:Issuer"]),
            ValidIssuer = builder.Configuration["Auth:Issuer"],
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Auth:Audience"] ?? "authenticated",
            ValidateIssuerSigningKey = !string.IsNullOrEmpty(secret),
            IssuerSigningKey = string.IsNullOrEmpty(secret)
                ? null
                : new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
            NameClaimType = "sub",
            RoleClaimType = "sanadi_role",
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("Student", p => p.RequireAuthenticatedUser());
    options.AddPolicy("Staff", p => p.RequireAssertion(c =>
        c.User.Claims.Any(cl => cl.Type == "sanadi_role" && Roles.Staff.Contains(cl.Value))));
    options.AddPolicy("Admin", p => p.RequireClaim("sanadi_role", Roles.SystemAdmin));
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllerRoute("default", "{controller=Home}/{action=Index}/{id?}");
app.MapControllers();

// Apply pending migrations at start-up so a fresh on-premise database is ready.
if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    using var scope = app.Services.CreateScope();
    var context = scope.ServiceProvider.GetRequiredService<SanadiDbContext>();
    if ((await context.Database.GetPendingMigrationsAsync()).Any()
        || context.Database.GetMigrations().Any())
    {
        await context.Database.MigrateAsync();
    }
    else
    {
        // No migrations generated yet: create the schema directly.
        await context.Database.EnsureCreatedAsync();
    }
}

app.Run();
