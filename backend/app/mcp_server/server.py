"""Assemble the FastMCP app: OAuth-gated Streamable HTTP + the login page.

Run with:  uvicorn app.mcp_main:app --port 9000
"""

from urllib.parse import urlsplit

from mcp.server.auth.settings import (
    AuthSettings,
    ClientRegistrationOptions,
    RevocationOptions,
)
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import AnyHttpUrl

from ..config import settings
from ..database import Base, engine
from . import models as _oauth_models  # noqa: F401  (register tables on Base)
from .provider import provider

# The scopes an MCP client can hold. One coarse scope for v1: full calendar
# read+write on the user's behalf (no team/org admin writes).
SCOPES = ["calendar"]

_issuer = AnyHttpUrl(settings.mcp_issuer_url)

# This server is deliberately client-agnostic: any MCP client may connect, so
# nothing here may assume a particular vendor's origin or transport quirks.
#
# DNS-rebinding protection defaults to allowing NOTHING, so every request
# arriving with our real public Host was rejected 421 Misdirected Request -
# after a fully successful OAuth handshake, which made it look like a login
# failure (see git log for the full trap).
#
# We keep the Host check (derived from MCP_ISSUER_URL, never hardcoded, so it
# cannot drift from the hostname we actually serve on) but do NOT restrict
# Origin. That check exists to stop a malicious web page from reaching a server
# bound to localhost; this server is public HTTPS and every call is gated on an
# OAuth bearer token, which a cross-origin page cannot obtain or attach. An
# origin allowlist would therefore add no security while silently breaking every
# browser-based MCP client whose origin we failed to predict.
_issuer_host = urlsplit(settings.mcp_issuer_url).netloc
_ALLOWED_HOSTS = [
    _issuer_host,
    f"{_issuer_host}:*",  # ":*" permits any port on the same host
    "localhost",
    "localhost:*",
    "127.0.0.1",
    "127.0.0.1:*",
]
# The SDK has no wildcard for origins and no way to keep its Host check while
# dropping its Origin check, so its combined check is switched off and the Host
# half is reimplemented in _HostGuard below. (A str subclass with __eq__ always
# True does NOT work here: pydantic revalidates these settings inside FastMCP()
# and coerces the subclass back to a plain str, silently restoring the 403s.)
_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=False,
)


def _host_allowed(host: str | None) -> bool:
    if not host:
        return False
    if host in _ALLOWED_HOSTS:
        return True
    # ":*" entries permit any port on that host.
    return any(
        host.startswith(a[:-2] + ":") for a in _ALLOWED_HOSTS if a.endswith(":*")
    )


class _HostGuard:
    """Reject requests whose Host is not one we serve, with no Origin restriction.

    Pure ASGI rather than BaseHTTPMiddleware: the latter buffers the response and
    would break Streamable HTTP's long-lived SSE responses.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        host = None
        for key, value in scope.get("headers", []):
            if key == b"host":
                host = value.decode("latin-1")
                break
        if not _host_allowed(host):
            from starlette.responses import PlainTextResponse

            await PlainTextResponse("Invalid Host header", status_code=421)(
                scope, receive, send
            )
            return
        await self.app(scope, receive, send)

mcp = FastMCP(
    name="Founder Calendar",
    instructions=(
        "Manage the signed-in user's Founder Calendar workspace: meetings "
        "(with attendees, recurrence and 30-minute reminders), calendar notes, "
        "and OneNote-style boards. Use get_agenda to see what's on a day, and "
        "list_team / list_departments to turn a person's name into an id before "
        "adding them as a meeting attendee."
    ),
    stateless_http=True,
    transport_security=_security,
    auth_server_provider=provider,
    auth=AuthSettings(
        issuer_url=_issuer,
        resource_server_url=_issuer,
        required_scopes=SCOPES,
        client_registration_options=ClientRegistrationOptions(
            enabled=True,
            valid_scopes=SCOPES,
            default_scopes=SCOPES,
        ),
        revocation_options=RevocationOptions(enabled=True),
    ),
)

# Register every tool on the instance.
from .tools import register_tools  # noqa: E402

register_tools(mcp)


def build_app():
    """The ASGI app: the MCP streamable-HTTP + OAuth routes, plus our login page."""
    import contextlib

    app = mcp.streamable_http_app()
    from .login import routes as login_routes

    app.router.routes.extend(login_routes)

    # streamable_http_app() adds no CORS at all, so a browser-based MCP client
    # cannot read our responses or even complete a preflight - it fails before
    # any of our auth runs. Added outermost so OPTIONS preflights short-circuit
    # here instead of being rejected by the auth middleware (which would 401 a
    # request the browser sends without credentials by design).
    #
    # allow_origins=["*"] with allow_credentials=False is the correct pair: MCP
    # carries its bearer token in the Authorization header, never in cookies, so
    # nothing is authorised ambiently by origin. Wildcard + credentials would be
    # both unsafe and rejected by browsers.
    #
    # expose_headers matters: without mcp-session-id a browser client cannot
    # read the session id and every request after initialize fails.
    from starlette.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["mcp-session-id", "mcp-protocol-version", "www-authenticate"],
        max_age=86400,
    )

    # Added last => outermost, so a request for a host we do not serve is
    # rejected before anything else looks at it.
    app.add_middleware(_HostGuard)

    # Create the OAuth tables on startup (idempotent), not at import, so the
    # module imports without a live DB (tests). FastMCP already sets a lifespan
    # (it runs the session manager), which makes Starlette ignore on_startup - so
    # we WRAP that lifespan rather than append a handler that would never fire.
    # The MCP container being self-sufficient means it can boot before the API.
    inner_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(app_):
        from ..schema_init import create_all_locked

        create_all_locked(engine, Base)
        async with inner_lifespan(app_):
            yield

    app.router.lifespan_context = lifespan
    return app
