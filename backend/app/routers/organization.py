from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import find_org_for_user, get_current_org, get_current_user
from ..models import Organization, TeamMember, User
from ..schemas import OrganizationOut, OrgCreateRequest, OrgUpdateRequest

router = APIRouter(prefix="/api/organization", tags=["organization"])


@router.get("", response_model=OrganizationOut | None)
def get_organization(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Organization | None:
    # Returns null (not 404) when none exists, so the frontend can route to
    # onboarding. Invited members resolve to the org they were invited to.
    return find_org_for_user(db, user)


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(
    body: OrgCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    existing = db.query(Organization).filter(Organization.owner_id == user.id).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Organization already exists")
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


@router.patch("", response_model=OrganizationOut)
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


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    # Cascade removes team members and notes (configured on the relationships).
    db.delete(org)
    db.commit()
    return None
