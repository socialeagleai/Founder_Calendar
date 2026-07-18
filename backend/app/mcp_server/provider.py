"""The OAuth 2.1 authorization-server provider the MCP SDK drives.

The SDK auto-mounts the metadata, DCR, /authorize, /token and /revoke routes and
calls into these nine methods. We back them with `store` (sync DB, run off the
event loop) and, for the interactive step, redirect the browser to our own
/login page (see login.py). Tokens are opaque and revocable; PKCE is enforced by
the SDK's token handler against the `code_challenge` we persist on the grant.
"""

import json
import time
from urllib.parse import urlencode

import anyio
from jose import jwt
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl

from ..config import settings
from . import store

# The login request handed to /login is a short-lived signed token so we hold no
# server-side pending-authorization state: the browser carries it, we verify it.
_LOGIN_REQ_TTL = 600


def sign_login_request(client_id: str, params: AuthorizationParams) -> str:
    payload = {
        "client_id": client_id,
        "redirect_uri": str(params.redirect_uri),
        "redirect_uri_provided": params.redirect_uri_provided_explicitly,
        "code_challenge": params.code_challenge or "",
        "scopes": params.scopes or [],
        "state": params.state,
        "exp": int(time.time()) + _LOGIN_REQ_TTL,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_login_request(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except Exception:
        return None


def _to_client_info(row) -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        client_id=row.id,
        client_secret=row.client_secret,
        client_secret_expires_at=row.client_secret_expires_at or None,
        redirect_uris=[AnyUrl(u) for u in json.loads(row.redirect_uris)],
        scope=row.scope or None,
        grant_types=row.grant_types.split() if row.grant_types else [],
        token_endpoint_auth_method=row.token_endpoint_auth_method,
        client_name=row.client_name or None,
    )


class CalendarOAuthProvider(
    OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken, AccessToken]
):
    # ---- clients (DCR) ----
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        row = await anyio.to_thread.run_sync(store.load_client, client_id)
        return _to_client_info(row) if row else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        await anyio.to_thread.run_sync(
            lambda: store.save_client(
                client_id=client_info.client_id,
                client_secret=client_info.client_secret,
                client_secret_expires_at=client_info.client_secret_expires_at or 0,
                redirect_uris=[str(u) for u in client_info.redirect_uris],
                scope=client_info.scope or "",
                grant_types=list(client_info.grant_types or []),
                token_endpoint_auth_method=client_info.token_endpoint_auth_method
                or "client_secret_post",
                client_name=client_info.client_name or "",
            )
        )

    # ---- authorize: hand the browser to our login page ----
    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        req = sign_login_request(client.client_id, params)
        return f"{settings.mcp_issuer_url.rstrip('/')}/login?{urlencode({'req': req})}"

    # ---- authorization codes ----
    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        grant = await anyio.to_thread.run_sync(
            store.load_grant, client.client_id, authorization_code
        )
        if not grant:
            return None
        return AuthorizationCode(
            code=authorization_code,
            scopes=grant.scopes.split() if grant.scopes else [],
            expires_at=grant.expires_at.timestamp(),
            client_id=grant.client_id,
            code_challenge=grant.code_challenge,
            redirect_uri=AnyUrl(grant.redirect_uri),
            redirect_uri_provided_explicitly=grant.redirect_uri_provided,
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        result = await anyio.to_thread.run_sync(
            lambda: store.consume_grant_and_issue(
                raw_code=authorization_code.code, client_id=client.client_id
            )
        )
        if result is None:
            from mcp.server.auth.provider import TokenError

            raise TokenError("invalid_grant", "Authorization code is invalid or expired")
        raw_access, raw_refresh, scopes, _user_id = result
        return OAuthToken(
            access_token=raw_access,
            token_type="Bearer",
            expires_in=settings.mcp_access_token_ttl_minutes * 60,
            scope=" ".join(scopes) or None,
            refresh_token=raw_refresh,
        )

    # ---- refresh ----
    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        tok = await anyio.to_thread.run_sync(
            store.load_refresh_token, client.client_id, refresh_token
        )
        if not tok:
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=tok.client_id,
            scopes=tok.scopes.split() if tok.scopes else [],
            expires_at=int(tok.expires_at.timestamp()),
        )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        result = await anyio.to_thread.run_sync(
            lambda: store.rotate_refresh(
                client_id=client.client_id,
                raw_refresh=refresh_token.token,
                scopes=scopes,
            )
        )
        if result is None:
            from mcp.server.auth.provider import TokenError

            raise TokenError("invalid_grant", "Refresh token is invalid or expired")
        raw_access, raw_refresh, granted, _user_id = result
        return OAuthToken(
            access_token=raw_access,
            token_type="Bearer",
            expires_in=settings.mcp_access_token_ttl_minutes * 60,
            scope=" ".join(granted) or None,
            refresh_token=raw_refresh,
        )

    # ---- access tokens (this is also the resource-server verifier) ----
    async def load_access_token(self, token: str) -> AccessToken | None:
        tok = await anyio.to_thread.run_sync(store.load_access_token, token)
        if not tok:
            return None
        return AccessToken(
            token=token,
            client_id=tok.client_id,
            scopes=tok.scopes.split() if tok.scopes else [],
            expires_at=int(tok.expires_at.timestamp()),
            subject=tok.user_id,
            claims={"user_id": tok.user_id, "active_org": tok.last_active_org},
        )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        await anyio.to_thread.run_sync(store.revoke, token.token)


provider = CalendarOAuthProvider()
