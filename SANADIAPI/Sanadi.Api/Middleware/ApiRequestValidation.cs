using Microsoft.AspNetCore.Mvc;

namespace Sanadi.Api.Middleware;

public static class ApiRequestValidation
{
    public static void Configure(ApiBehaviorOptions options)
    {
        // Do not echo submitted values or parser/CLR internals to clients.
        options.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(new
        {
            error = "Invalid request.", message = "Invalid request.", code = "invalid_request"
        });
    }
}
