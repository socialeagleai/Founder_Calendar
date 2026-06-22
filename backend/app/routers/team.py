from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_org, get_current_user, require_page_edit
from ..models import Department, Organization, TeamMember, User
from ..schemas import InviteMemberRequest, TeamMemberOut, UpdateRoleRequest

router = APIRouter(prefix="/api/team", tags=["team"])

require_team_edit = require_page_edit("team")


def _get_member(db: Session, org: Organization, member_id: str) -> TeamMember:
    member = (
        db.query(TeamMember)
        .filter(TeamMember.id == member_id, TeamMember.organization_id == org.id)
        .first()
    )
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


def _validate_department(db: Session, org: Organization, dept_id: str) -> None:
    """Ensure a department id belongs to this org before assigning a member to it."""
    exists = (
        db.query(Department)
        .filter(Department.id == dept_id, Department.organization_id == org.id)
        .first()
    )
    if not exists:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown department")


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


@router.post(
    "",
    response_model=TeamMemberOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_team_edit)],
)
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
    if body.department_id is not None:
        _validate_department(db, org, body.department_id)
    member = TeamMember(
        organization_id=org.id,
        name=body.name,
        email=body.email,
        role=body.role,
        status="Invited",
        permissions=dict(body.permissions),
        department_id=body.department_id,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch(
    "/{member_id}", response_model=TeamMemberOut, dependencies=[Depends(require_team_edit)]
)
def update_member(
    member_id: str,
    body: UpdateRoleRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamMember:
    member = _get_member(db, org, member_id)
    if member.role == "Owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot change the Owner")
    # Anti-escalation: a non-owner team manager cannot edit their own role or
    # permissions (only the owner can change a team manager's access).
    if org.owner_id != user.id and member.email == user.email:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You cannot change your own access."
        )
    if body.role is not None:
        if body.role == "Owner":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot promote a member to Owner")
        member.role = body.role
    if body.permissions is not None:
        member.permissions = dict(body.permissions)
    # Use fields_set so an explicit null means "unassign", while an omitted field
    # leaves the current department untouched.
    if "department_id" in body.model_fields_set:
        if body.department_id is not None:
            _validate_department(db, org, body.department_id)
        member.department_id = body.department_id
    db.commit()
    db.refresh(member)
    return member


@router.delete(
    "/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_team_edit)],
)
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
