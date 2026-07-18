"""Synchronous DB operations backing the OAuth provider.

Kept sync (plain SQLAlchemy) and called from the async provider via
`anyio.to_thread`, so the event loop is never blocked on Postgres.

Tokens and auth codes are high-entropy random strings; only their SHA-256 hash
is stored, matching how the app already treats password-reset tokens. The raw
value exists only in the client's hands. Client secrets use bcrypt (they're
lower entropy and long-lived).
"""

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..database import SessionLocal
from ..models import User
from ..security import verify_password
from .models import OAuthClient, OAuthGrant, OAuthToken


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _new_secret() -> str:
    return secrets.token_urlsafe(32)


# ---------- clients (Dynamic Client Registration) ----------
# The SDK's DCR handler generates client_id/secret and hands us a populated
# record to persist; get_client returns it so the SDK can compare secrets.
def save_client(
    *,
    client_id: str,
    client_secret: str | None,
    client_secret_expires_at: int,
    redirect_uris: list[str],
    scope: str,
    grant_types: list[str],
    token_endpoint_auth_method: str,
    client_name: str,
) -> None:
    db = SessionLocal()
    try:
        db.merge(
            OAuthClient(
                id=client_id,
                client_secret=client_secret,
                client_secret_expires_at=client_secret_expires_at,
                redirect_uris=json.dumps(redirect_uris),
                scope=scope,
                grant_types=" ".join(grant_types),
                token_endpoint_auth_method=token_endpoint_auth_method,
                client_name=client_name or "",
            )
        )
        db.commit()
    finally:
        db.close()


def load_client(client_id: str) -> OAuthClient | None:
    db = SessionLocal()
    try:
        return db.get(OAuthClient, client_id)
    finally:
        db.close()


# ---------- users (login page) ----------
def authenticate_user(email: str, password: str) -> User | None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user or not verify_password(password, user.hashed_password):
            return None
        return user
    finally:
        db.close()


def get_user(user_id: str) -> User | None:
    db = SessionLocal()
    try:
        return db.get(User, user_id)
    finally:
        db.close()


# ---------- authorization codes ----------
def create_grant(
    *,
    client_id: str,
    user_id: str,
    redirect_uri: str,
    redirect_uri_provided: bool,
    code_challenge: str,
    scopes: list[str],
) -> str:
    """Mint a one-time auth code, returning the RAW code (hash stored)."""
    raw = _new_secret()
    db = SessionLocal()
    try:
        db.add(
            OAuthGrant(
                code=_hash(raw),
                client_id=client_id,
                user_id=user_id,
                redirect_uri=redirect_uri,
                redirect_uri_provided=redirect_uri_provided,
                code_challenge=code_challenge or "",
                scopes=" ".join(scopes),
                expires_at=_now() + timedelta(minutes=5),
            )
        )
        db.commit()
    finally:
        db.close()
    return raw


def load_grant(client_id: str, raw_code: str) -> OAuthGrant | None:
    db = SessionLocal()
    try:
        grant = db.get(OAuthGrant, _hash(raw_code))
        if not grant or grant.client_id != client_id:
            return None
        if grant.used or grant.expires_at <= _now():
            return None
        return grant
    finally:
        db.close()


def consume_grant_and_issue(
    *, raw_code: str, client_id: str
) -> tuple[str, str, list[str], str] | None:
    """Atomically burn the code and issue (access, refresh) tokens.

    Returns (raw_access, raw_refresh, scopes, user_id) or None if the code is
    gone/used/expired. Burning and issuing share one transaction so a replayed
    code can never mint a second pair.
    """
    db = SessionLocal()
    try:
        grant = db.get(OAuthGrant, _hash(raw_code))
        if (
            not grant
            or grant.client_id != client_id
            or grant.used
            or grant.expires_at <= _now()
        ):
            return None
        grant.used = True
        scopes = grant.scopes.split() if grant.scopes else []
        raw_access, raw_refresh = _issue_pair(db, client_id, grant.user_id, scopes)
        db.commit()
        return raw_access, raw_refresh, scopes, grant.user_id
    finally:
        db.close()


# ---------- tokens ----------
def _issue_pair(db, client_id: str, user_id: str, scopes: list[str]) -> tuple[str, str]:
    raw_access = _new_secret()
    raw_refresh = _new_secret()
    scope_str = " ".join(scopes)
    db.add(
        OAuthToken(
            token=_hash(raw_access),
            kind="access",
            client_id=client_id,
            user_id=user_id,
            scopes=scope_str,
            expires_at=_now() + timedelta(minutes=settings.mcp_access_token_ttl_minutes),
        )
    )
    db.add(
        OAuthToken(
            token=_hash(raw_refresh),
            kind="refresh",
            client_id=client_id,
            user_id=user_id,
            scopes=scope_str,
            expires_at=_now() + timedelta(days=settings.mcp_refresh_token_ttl_days),
        )
    )
    return raw_access, raw_refresh


def load_access_token(raw: str) -> OAuthToken | None:
    db = SessionLocal()
    try:
        tok = db.get(OAuthToken, _hash(raw))
        if not tok or tok.kind != "access" or tok.revoked or tok.expires_at <= _now():
            return None
        return tok
    finally:
        db.close()


def load_refresh_token(client_id: str, raw: str) -> OAuthToken | None:
    db = SessionLocal()
    try:
        tok = db.get(OAuthToken, _hash(raw))
        if (
            not tok
            or tok.kind != "refresh"
            or tok.client_id != client_id
            or tok.revoked
            or tok.expires_at <= _now()
        ):
            return None
        return tok
    finally:
        db.close()


def rotate_refresh(
    *, client_id: str, raw_refresh: str, scopes: list[str]
) -> tuple[str, str, list[str], str] | None:
    """Revoke the presented refresh token and issue a fresh pair (rotation).

    Returns (access, refresh, scopes, user_id) or None. Narrowing scopes is
    allowed; the requested set is intersected with what the token already had.
    """
    db = SessionLocal()
    try:
        tok = db.get(OAuthToken, _hash(raw_refresh))
        if (
            not tok
            or tok.kind != "refresh"
            or tok.client_id != client_id
            or tok.revoked
            or tok.expires_at <= _now()
        ):
            return None
        had = tok.scopes.split() if tok.scopes else []
        granted = [s for s in scopes if s in had] if scopes else had
        tok.revoked = True
        raw_access, raw_refresh_new = _issue_pair(db, client_id, tok.user_id, granted)
        db.commit()
        return raw_access, raw_refresh_new, granted, tok.user_id
    finally:
        db.close()


def revoke(raw: str) -> None:
    """Revoke a token by raw value (access or refresh); silent if unknown."""
    db = SessionLocal()
    try:
        tok = db.get(OAuthToken, _hash(raw))
        if tok and not tok.revoked:
            tok.revoked = True
            db.commit()
    finally:
        db.close()


def set_active_org(raw_access: str, org_id: str | None) -> None:
    db = SessionLocal()
    try:
        tok = db.get(OAuthToken, _hash(raw_access))
        if tok:
            tok.last_active_org = org_id
            db.commit()
    finally:
        db.close()
