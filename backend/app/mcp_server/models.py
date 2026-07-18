"""OAuth 2.1 persistence for the MCP server.

Three tables, all on the shared Base so they live in the same Postgres as the
rest of the app:

- OAuthClient  - Dynamic Client Registration (RFC 7591). One row per MCP client
  that has registered itself (Claude registers automatically on first connect).
- OAuthGrant   - a single-use authorization code (PKCE). Short-lived, burned on
  exchange.
- OAuthToken   - access and refresh tokens. Opaque random strings (NOT JWTs) so
  revocation and refresh rotation are a one-row update and load is one indexed
  lookup. The internal FC token used to call the API is a separate JWT minted per
  request; this is the token the *client* holds.

The MCP access token authorises calls; the user it belongs to is `user_id`. The
client's chosen "active org" rides on the token row (`last_active_org`) so a
conversational "switch to Acme" persists across stateless tool calls.
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..models import _uuid


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OAuthClient(Base):
    """An MCP client registered via Dynamic Client Registration."""

    __tablename__ = "oauth_clients"

    # The client_id the SDK's DCR handler generated (also the primary key).
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=_uuid)
    # The client secret, or NULL for a public (PKCE-only, auth method "none")
    # client. Stored as issued because the MCP SDK compares the presented secret
    # against this value directly - it is a per-client registration credential,
    # not a user password, and every real client (Claude) uses PKCE regardless.
    client_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_secret_expires_at: Mapped[int] = mapped_column(default=0, nullable=False)
    # JSON-encoded list of allowed redirect URIs. An exact match is required at
    # /authorize and /token, so this is the anti-open-redirect gate.
    redirect_uris: Mapped[str] = mapped_column(Text, nullable=False)
    # Space-separated scopes granted to this client, and space-separated grant
    # types (authorization_code refresh_token).
    scope: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    grant_types: Mapped[str] = mapped_column(
        String(255), default="authorization_code refresh_token", nullable=False
    )
    token_endpoint_auth_method: Mapped[str] = mapped_column(
        String(48), default="client_secret_post", nullable=False
    )
    client_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class OAuthGrant(Base):
    """A single-use authorization code bound to a user, client and PKCE challenge."""

    __tablename__ = "oauth_grants"

    # The authorization code itself (opaque, primary key).
    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    # Whether the client sent redirect_uri explicitly at /authorize - the token
    # exchange must be told the same thing to reconstruct the match.
    redirect_uri_provided: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # PKCE S256 challenge; the verifier is checked against this at /token.
    code_challenge: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    scopes: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Burned on first exchange so a code can never be replayed.
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class OAuthToken(Base):
    """An opaque access or refresh token."""

    __tablename__ = "oauth_tokens"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    # "access" or "refresh".
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    client_id: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    scopes: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # The org the client is currently acting in, chosen via set_active_org. NULL
    # falls back to the user's default org. Lives on the access token so it
    # survives across stateless tool calls without server-side session state.
    last_active_org: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        Index("ix_oauth_tokens_user_kind", "user_id", "kind"),
    )
