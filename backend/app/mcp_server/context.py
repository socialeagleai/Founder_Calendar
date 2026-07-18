"""Who is calling, and which org they're acting in.

Every tool starts here: the MCP access token (validated by the SDK) tells us the
FC user id and the org they last selected. The concrete org id a tool acts in is
`explicit_org_id` if the caller named one, else the token's active org, else the
user's default org (resolved by the API when X-Org-Id is omitted).
"""

from mcp.server.auth.middleware.auth_context import get_access_token


class NotAuthenticated(Exception):
    pass


def caller() -> tuple[str, str | None, str]:
    """Return (user_id, active_org_id_or_None, raw_access_token) for the request."""
    token = get_access_token()
    if token is None:
        raise NotAuthenticated("No authenticated user on this request")
    claims = token.claims or {}
    return claims.get("user_id") or token.subject, claims.get("active_org"), token.token


def org_for(explicit_org_id: str | None, active_org: str | None) -> str | None:
    """The X-Org-Id to send: an explicit choice wins, else the active org, else
    None (the API falls back to the user's default org)."""
    return explicit_org_id or active_org
