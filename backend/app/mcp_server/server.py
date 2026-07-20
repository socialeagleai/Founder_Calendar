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

# DNS-rebinding protection defaults to allowing NOTHING, so every request
# arriving with our real public Host was rejected 421 Misdirected Request -
# after a fully successful OAuth handshake, which made it look like a login
# failure. The host must be derived from MCP_ISSUER_URL rather than hardcoded,
# so it cannot drift from the hostname we actually serve on.
_issuer_host = urlsplit(settings.mcp_issuer_url).netloc
_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    # ":*" permits any port on the same host (local runs bind :9000/:9002).
    allowed_hosts=[_issuer_host, f"{_issuer_host}:*", "localhost", "localhost:*",
                   "127.0.0.1", "127.0.0.1:*"],
    # Origin is absent on server-to-server calls (which is what Claude makes) and
    # absence passes. Listed here for browser-based clients; a client calling from
    # another web origin needs adding, so the failure mode is a clear 421, not a
    # silent bypass. Real access control is the OAuth bearer token, not this.
    allowed_origins=[settings.mcp_issuer_url.rstrip("/"), "https://claude.ai"],
)

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
