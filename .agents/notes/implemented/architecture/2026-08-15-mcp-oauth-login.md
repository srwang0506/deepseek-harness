# Agent Note: MCP OAuth login — the SDK's authorization flow with a loopback redirect, plus get/logout

Status: implemented

English | [中文](2026-08-15-mcp-oauth-login.zh.md)

## Problem

`dsh mcp` could add, list, and remove servers but not authenticate them: Streamable HTTP MCP servers that require OAuth were unreachable from the terminal, there was no way to inspect one server's configuration, and no way to clear a stored credential.

## Decision

**The login flow lives in `dsh-mcp-client` and rides the bundled MCP SDK.** `loginMcpServer(url, options)` runs the MCP Authorization sequence end to end: `discoverOAuthServerInfo` (protected-resource metadata with the well-known fallback), `startAuthorization` (PKCE), a loopback redirect listener bound before authorization so the redirect URI carries a real port, a detached browser open, and `exchangeAuthorization`. The SDK's failure mode shapes the code: metadata discovery returns `undefined` for unreachable servers instead of throwing, so the loopback wait carries a timeout (`timeoutMs`, default five minutes) that turns "nothing ever redirects" into a loud error. The opener is a shell template (`{url}` placeholder, shell-quoted) because the SDK's query parameters contain `&`; `DSH_MCP_OPEN_COMMAND` overrides it and keeps the flow testable with `curl`.

**Credentials live in `$DSH_HOME/mcp-auth.json` and the row's headers.** `dsh mcp login <name>` stores the exchanged tokens in a home-owned JSON document keyed by server name and sets the row's `Authorization: Bearer` header; `dsh mcp logout <name>` clears both. `dsh mcp get <name>` prints one server's configuration with the bearer header masked as `(set)`.

## Consequences

`login.ts` is at per-file 100% coverage — the SDK's `setTimeout` callbacks are passed as named functions with a reject holder rather than anonymous arrows because this toolchain's v8 instrumentation does not credit timer callbacks it cannot attribute, and the `rejectLoginTimeout` helper doubles as the directly-tested timeout primitive. The login flow is covered by a local mock authorization server (discovery, auto-approving `/authorize`, `/token`) in unit tests and by a real-launcher e2e that drives `dsh mcp add/login/get/logout` against the same mock with `curl` as the opener. The platform opener branches are unit-covered through `process.platform` stubs.

## Alternatives considered

- **Implementing OAuth from scratch** — the SDK already ships discovery, PKCE, token exchange, and CORS-tolerant retries; reusing it keeps the flow spec-conformant for free.
- **Handing the token to the client through a settings section** — the bearer header is the transport's own seam; writing it to the row keeps the connection configuration in one place.
- **A device-code flow** — MCP Authorization specifies the authorization-code + PKCE flow with optional extensions; the browser flow is the interoperable baseline, and the loopback listener is small.
