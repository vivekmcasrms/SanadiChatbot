# Sanadi Chatbot

This repository keeps the solution's three applications in separate top-level folders:

- `SANADIAPI` — ASP.NET Core API, domain, application, infrastructure, tests, tools, SQL, and documentation.
- `UAEU-SANAD-MAIN-2` — current UAEU Sanadi web UI.
- `uaeu-sanadi` — companion/alternate Sanadi web application and its .NET support projects.

Local secrets, environment files, dependencies, generated builds, IDE state, logs, and test artifacts are intentionally excluded. Copy the relevant `.env.example` files for the web applications and `SANADIAPI/Sanadi.Api/appsettings.example.json` for the API, then supply local values outside Git.

