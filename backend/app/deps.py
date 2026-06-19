from typing import Callable

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Organization, TeamMember, User
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def orgs_for_user(db: Session, user: User) -> list[Organization]:
    """Every organization the user actively belongs to: ones they own plus ones
    where they have an *accepted* (Active) membership. Pending invites are not
    included — those are surfaced separately for accept/decline."""
    result: dict[str, Organization] = {}
    for o in db.query(Organization).filter(Organization.owner_id == user.id).all():
        result[o.id] = o
    # A member keeps access until the owner approves their leave request, so
    # treat anything that isn't a pending invite (Active or LeaveRequested) as
    # belonging to the org.
    member_org_ids = [
        m.organization_id
        for m in db.query(TeamMember)
        .filter(TeamMember.email == user.email, TeamMember.status != "Invited")
        .all()
    ]
    if member_org_ids:
        for o in db.query(Organization).filter(Organization.id.in_(member_org_ids)).all():
            result[o.id] = o
    return sorted(result.values(), key=lambda o: o.created_at)


def find_org_for_user(db: Session, user: User) -> Organization | None:
    """The user's default organization: a one they own (preferred), else their
    first active membership. Returns None when they belong to none."""
    orgs = orgs_for_user(db, user)
    for o in orgs:
        if o.owner_id == user.id:
            return o
    return orgs[0] if orgs else None


def resolve_active_org(
    db: Session, user: User, x_org_id: str | None
) -> Organization | None:
    """The organization the request is scoped to: the one named by the X-Org-Id
    header if the user belongs to it, otherwise their default org."""
    orgs = orgs_for_user(db, user)
    if not orgs:
        return None
    if x_org_id:
        match = next((o for o in orgs if o.id == x_org_id), None)
        if match is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "You don't belong to this organization"
            )
        return match
    return find_org_for_user(db, user)


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
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> Organization:
    """The active organization for this request, chosen by the X-Org-Id header
    (falling back to the user's default org). Every org-scoped endpoint resolves
    through here, so switching orgs is just a different header."""
    org = resolve_active_org(db, user, x_org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No organization for current user")
    return org


def _member_of(db: Session, org: Organization, user: User) -> TeamMember | None:
    return (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.email == user.email)
        .first()
    )


def require_page_edit(page_key: str) -> Callable[..., None]:
    """Build a dependency that allows a write only if the caller can EDIT the
    given page. Owners always pass; members need permissions[page_key] == "edit".
    View-only or no access → 403. Applied to write endpoints so "view" access is
    truly read-only at the API level (not just hidden in the UI)."""

    def _dep(
        user: User = Depends(get_current_user),
        org: Organization = Depends(get_current_org),
        db: Session = Depends(get_db),
    ) -> None:
        # The organization owner has implicit full access.
        if org.owner_id == user.id:
            return
        member = _member_of(db, org, user)
        if member is None or (member.permissions or {}).get(page_key) != "edit":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"You have view-only access to {page_key}.",
            )

    return _dep


def require_owner(
    user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_org),
) -> None:
    """Dependency that allows only the organization owner (for destructive,
    non-delegable actions like deleting the whole organization)."""
    if org.owner_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the organization owner can do this."
        )
