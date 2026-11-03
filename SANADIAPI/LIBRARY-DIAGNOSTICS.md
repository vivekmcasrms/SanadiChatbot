# Library error logging

The API uses standard ASP.NET Core `ILogger<T>` providers at Error level.
No custom text files are written. Inspect the error output collected by the
configured hosting/logging provider. No new logging package or directory is needed.

`LIBRARY_FAILURE` records a handled catalogue/OAuth failure with its trace ID,
stage, timeout or HTTP error information. Missing catalogue URLs are logged when
the configuration error is handled. Database exceptions propagate to the central
API exception handler and are logged there once. Routine search, settings,
cache-hit, HTTP-start and success messages are not logged. Request cancellation
is not logged as an upstream error.

Library error entries omit credentials, tokens, cookies, queries, full URLs,
provider response bodies and raw provider exception messages. Library results,
credential selection, caching and request timeouts are unchanged.
