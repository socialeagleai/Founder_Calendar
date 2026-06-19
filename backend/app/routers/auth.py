from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import find_org_for_user, get_current_user
from ..models import TeamMember, User
from ..schemas import (
    AccessOut,
    AuthResponse,
    GoogleLoginRequest,
    LoginRequest,
    SignupRequest,
    UpdateProfileRequest,
    UserOut,
)
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _auth_response(user: User) -> AuthResponse:
    return AuthResponse(token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, db: Session = Depends(get_db)) -> AuthResponse:
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        name=body.name,
        email=body.email,
        hashed_password=hash_password(body.password),
        provider="local",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return _auth_response(user)


@router.post("/google", response_model=AuthResponse)
def google_login(body: GoogleLoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """Sign in with Google.

    - If a `credential` (Google ID token) is supplied and GOOGLE_CLIENT_ID is
      configured, the token is verified with Google and the real account is used.
    - Otherwise falls back to a demo Google user (founder@google.demo), matching
      the current frontend stub so the flow works with zero OAuth configuration.
    """
    email = "founder@google.demo"
    name = "Google Founder"

    if body.credential and settings.google_client_id:
        try:
            info = google_id_token.verify_oauth2_token(
                body.credential, google_requests.Request(), settings.google_client_id
            )
        except ValueError as exc:
            # Malformed token, wrong audience, or expired.
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Google token") from exc
        except GoogleAuthError as exc:
            # Could not reach Google to fetch signing certs, etc.
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Could not verify Google token — try again",
            ) from exc
        email = info.get("email")
        name = info.get("name") or (email.split("@")[0] if email else "Google User")
        if not email:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google token missing email")
    elif body.credential and not settings.google_client_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "GOOGLE_CLIENT_ID is not configured on the server",
        )

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(name=name, email=email, hashed_password=None, provider="google")
        db.add(user)
        db.commit()
        db.refresh(user)
    return _auth_response(user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/access", response_model=AccessOut)
def access(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AccessOut:
    """The current user's effective access in their active organization.

    Owners (and users with no org yet) get full access; invited members get the
    per-page permissions they were granted. Logging in also marks the member Active.
    """
    org = find_org_for_user(db, user)
    if org is None or org.owner_id == user.id:
        return AccessOut(is_owner=True, role="Owner", permissions={})

    member = (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.email == user.email)
        .first()
    )
    if member is None:
        return AccessOut(is_owner=True, role="Owner", permissions={})
    if member.status != "Active":
        member.status = "Active"
        db.commit()
        db.refresh(member)
    return AccessOut(is_owner=False, role=member.role, permissions=member.permissions or {})


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout() -> None:
    # Stateless JWT: the client simply discards the token. Endpoint provided
    # for symmetry with the frontend store's logout().
    return None


@router.patch("/profile", response_model=UserOut)
def update_profile(
    body: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    if body.email != user.email:
        clash = db.query(User).filter(User.email == body.email, User.id != user.id).first()
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already in use")
    user.name = body.name
    user.email = body.email
    if body.password:
        user.hashed_password = hash_password(body.password)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)
