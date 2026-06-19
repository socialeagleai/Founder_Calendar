from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Organization, TeamMember, User
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def find_org_for_user(db: Session, user: User) -> Organization | None:
    """The organization a user works in: the one they own, or — for invited
    members — the org their email was invited to. Owners take precedence."""
    org = db.query(Organization).filter(Organization.owner_id == user.id).first()
    if org:
        return org
    member = (
        db.query(TeamMember)
        .filter(TeamMember.email == user.email, TeamMember.role != "Owner")
        .first()
    )
    if member:
        return db.get(Organization, member.organization_id)
    return None


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user_id = decode_access_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user


def get_current_org(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    org = find_org_for_user(db, user)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No organization for current user")
    return org
