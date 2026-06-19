from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Organization, TeamMember, User
from ..schemas import LeaveRequestOut, MessageResponse
from .notifications import notify

router = APIRouter(prefix="/api/leave-requests", tags=["leave-requests"])


def _notify_member(db: Session, member: TeamMember, message: str) -> None:
    """Send an in-app notification to the member (if they have an account)."""
    member_user = db.query(User).filter(User.email == member.email).first()
    if member_user is not None:
        notify(db, member_user.id, message)


def _owned_org_ids(db: Session, user: User) -> list[str]:
    return [o.id for o in db.query(Organization).filter(Organization.owner_id == user.id).all()]


def _get_request(db: Session, user: User, member_id: str) -> TeamMember:
    org_ids = _owned_org_ids(db, user)
    member = (
        db.query(TeamMember)
        .filter(
            TeamMember.id == member_id,
            TeamMember.organization_id.in_(org_ids),
            TeamMember.status == "LeaveRequested",
        )
        .first()
        if org_ids
        else None
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Leave request not found")
    return member


@router.get("", response_model=list[LeaveRequestOut])
def list_leave_requests(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LeaveRequestOut]:
    """Pending leave requests across all organizations the current user owns."""
    org_ids = _owned_org_ids(db, user)
    if not org_ids:
        return []
    members = (
        db.query(TeamMember)
        .filter(
            TeamMember.organization_id.in_(org_ids),
            TeamMember.status == "LeaveRequested",
        )
        .order_by(TeamMember.created_at)
        .all()
    )
    out: list[LeaveRequestOut] = []
    for m in members:
        org = db.get(Organization, m.organization_id)
        out.append(
            LeaveRequestOut(
                id=m.id,
                organization_id=m.organization_id,
                organization_name=org.name if org else "",
                member_name=m.name,
                member_email=m.email,
            )
        )
    return out


@router.post("/{member_id}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_leave_request(
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Owner approves the request — the member is removed from the organization."""
    member = _get_request(db, user, member_id)
    org = db.get(Organization, member.organization_id)
    org_name = org.name if org else "the organization"
    _notify_member(
        db,
        member,
        f"Your request to leave {org_name} was approved — you've been removed.",
    )
    db.delete(member)
    db.commit()
    return None


@router.post("/{member_id}/decline", response_model=MessageResponse)
def decline_leave_request(
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """Owner declines — the member stays and is restored to Active."""
    member = _get_request(db, user, member_id)
    member.status = "Active"
    org = db.get(Organization, member.organization_id)
    org_name = org.name if org else "the organization"
    _notify_member(
        db,
        member,
        f"Your request to leave {org_name} was declined — you're still a member.",
    )
    db.commit()
    return MessageResponse(detail="Leave request declined.")
