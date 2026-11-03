namespace Sanadi.Domain.Exceptions;

public class SanadiException : Exception
{
    public int StatusCode { get; }
    public string Code { get; }

    public SanadiException(string message, int statusCode = 400, string code = "error")
        : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }
}

public sealed class UnauthorizedException() : SanadiException("Unauthorized", 401, "unauthorized");

public sealed class ForbiddenException(string message = "Forbidden") : SanadiException(message, 403, "forbidden");

public sealed class NotFoundException(string message = "Not found") : SanadiException(message, 404, "not_found");
