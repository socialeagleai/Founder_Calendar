from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import (
    get_current_org,
    get_current_user,
    orgs_for_user,
    require_owner,
    require_page_edit,
    resolve_active_org,
)
from ..models import Organization, TeamMember, User
from ..schemas import (
    MessageResponse,
    OrganizationOut,
    OrgCreateRequest,
    OrgMembershipOut,
    OrgUpdateRequest,
)
from fastapi import Header

router = APIRouter(prefix="/api/organization", tags=["organization"])

require_org_edit = require_page_edit("organization")


@router.get("", response_model=OrganizationOut | None)
def get_organization(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> Organization | None:
    # Returns null (not 404) when the user belongs to none, so the frontend can
    # route to onboarding. Otherwise returns the active org (per X-Org-Id).
    return resolve_active_org(db, user, x_org_id)


@router.get("s", response_model=list[OrgMembershipOut])
def list_my_organizations(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OrgMembershipOut]:
    """Every org the user belongs to (owned + accepted memberships) - powers the
    navbar org switcher. Served at /api/organizations."""
    out: list[OrgMembershipOut] = []
    for org in orgs_for_user(db, user):
        is_owner = org.owner_id == user.id
        if is_owner:
            role = "Owner"
        else:
            member = (
                db.query(TeamMember)
                .filter(
                    TeamMember.organization_id == org.id,
                    TeamMember.email == user.email,
                )
                .first()
            )
            role = member.role if member else "Member"
        out.append(
            OrgMembershipOut(
                id=org.id,
                name=org.name,
                description=org.description,
                created_at=org.created_at,
                owner_id=org.owner_id,
                role=role,
                is_owner=is_owner,
            )
        )
    return out


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(
    body: OrgCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    # A user may own multiple organizations - no one-org limit.
    org = Organization(name=body.name, description=body.description, owner_id=user.id)
    db.add(org)
    db.flush()  # assign org.id before creating the owner member
    owner_member = TeamMember(
        organization_id=org.id,
        name=user.name,
        email=user.email,
        role="Owner",
        status="Active",
    )
    db.add(owner_member)
    db.commit()
    db.refresh(org)
    return org


@router.patch("", response_model=OrganizationOut, dependencies=[Depends(require_org_edit)])
def update_organization(
    body: OrgUpdateRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Organization:
    org.name = body.name
    org.description = body.description
    db.commit()
    db.refresh(org)
    return org


@router.post("/leave", response_model=MessageResponse)
def leave_organization(
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """A member requests to leave the active organization. This flags their
    membership as LeaveRequested; the owner approves the removal from their
    notification bell."""
    if org.owner_id == user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The owner can't leave their own organization - delete it instead.",
        )
    member = (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.email == user.email)
        .first()
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You're not a member of this organization")
    member.status = "LeaveRequested"
    db.commit()
    return MessageResponse(detail="Your request to leave has been sent to the owner.")


@router.delete(
    "", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_owner)]
)
def delete_organization(
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    # Cascade removes team members and notes (configured on the relationships).
    db.delete(org)
    db.commit()
    return None
