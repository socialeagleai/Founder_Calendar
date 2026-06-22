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
    included - those are surfaced separately for accept/decline."""
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


# Public alias - routers resolve the viewer's membership once per request and
# reuse it across many can_view_item() checks when filtering a feed.
def member_for(db: Session, org: Organization, user: User) -> TeamMember | None:
    return _member_of(db, org, user)


def can_view_item(item, user: User, member: TeamMember | None) -> bool:
    """Whether `user` may see a note/board/meeting given its audience settings.
    `member` is the viewer's TeamMember row in the item's org (or None). The
    creator always sees their own item; otherwise visibility decides:
      - everyone:    anyone in the org
      - private:     creator only
      - departments: the viewer's department is in item.visible_departments
      - members:     the viewer's TeamMember id is in item.visible_members
    There is no owner/admin override - "private" is absolute."""
    if item.user_id is not None and item.user_id == user.id:
        return True
    vis = getattr(item, "visibility", "everyone") or "everyone"
    if vis == "everyone":
        return True
    if vis == "private":
        return False
    if member is None:
        return False
    if vis == "departments":
        return bool(member.department_id) and member.department_id in (
            item.visible_departments or []
        )
    if vis == "members":
        return member.id in (item.visible_members or [])
    return False


def ensure_can_view(
    db: Session, org: Organization, user: User, item, what: str
) -> None:
    """Raise 403 unless the caller may see this item. Used to gate mutations so a
    member can never change (or even reach) a note/board/meeting that its audience
    hides from them - viewing is a prerequisite for editing."""
    if not can_view_item(item, user, member_for(db, org, user)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"You don't have access to this {what}."
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


def page_access_level(db: Session, org: Organization, user: User, page_key: str) -> str:
    """The caller's access level for a page: "edit", "view", or "none". Mirrors
    the frontend levelFor: owners get edit; Settings is always edit and
    Organization always view; otherwise the member's granted permission."""
    if org.owner_id == user.id:
        return "edit"
    member = _member_of(db, org, user)
    if member is None:
        return "edit"
    if page_key == "settings":
        return "edit"
    if page_key == "organization":
        return "view"
    return (member.permissions or {}).get(page_key) or "none"


def require_page_access(page_key: str) -> Callable[..., str]:
    """Build a dependency that requires at least VIEW access to a page and returns
    the level ("view" | "edit"). In this model "view" lets a member manage their
    OWN items, while "edit" also lets them change items owned by other people.
    Endpoints combine the returned level with item ownership (see
    `ensure_owns_or_edit`)."""

    def _dep(
        user: User = Depends(get_current_user),
        org: Organization = Depends(get_current_org),
        db: Session = Depends(get_db),
    ) -> str:
        level = page_access_level(db, org, user, page_key)
        if level == "none":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"You don't have access to {page_key}."
            )
        return level

    return _dep


def ensure_owns_or_edit(level: str, item_user_id: str | None, user: User, what: str) -> None:
    """Block changing someone else's item unless the caller has edit access. With
    only view access a member may change their own items but not others'."""
    if item_user_id != user.id and level != "edit":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"You can only change your own {what}. Edit access is needed to change others'.",
        )


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
