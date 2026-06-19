from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_org
from ..models import Organization, TeamMember
from ..schemas import InviteMemberRequest, TeamMemberOut, UpdateRoleRequest

router = APIRouter(prefix="/api/team", tags=["team"])


def _get_member(db: Session, org: Organization, member_id: str) -> TeamMember:
    member = (
        db.query(TeamMember)
        .filter(TeamMember.id == member_id, TeamMember.organization_id == org.id)
        .first()
    )
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


@router.get("", response_model=list[TeamMemberOut])
def list_team(
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> list[TeamMember]:
    return (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id)
        .order_by(TeamMember.created_at)
        .all()
    )


@router.post("", response_model=TeamMemberOut, status_code=status.HTTP_201_CREATED)
def invite_member(
    body: InviteMemberRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> TeamMember:
    if body.role == "Owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot invite another Owner")
    clash = (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.email == body.email)
        .first()
    )
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "Member with this email already exists")
    member = TeamMember(
        organization_id=org.id,
        name=body.name,
        email=body.email,
        role=body.role,
        status="Invited",
        permissions=dict(body.permissions),
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch("/{member_id}", response_model=TeamMemberOut)
def update_member(
    member_id: str,
    body: UpdateRoleRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> TeamMember:
    member = _get_member(db, org, member_id)
    if member.role == "Owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot change the Owner")
    if body.role is not None:
        if body.role == "Owner":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot promote a member to Owner")
        member.role = body.role
    if body.permissions is not None:
        member.permissions = dict(body.permissions)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    member_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    member = _get_member(db, org, member_id)
    if member.role == "Owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove the Owner")
    db.delete(member)
    db.commit()
    return None
