from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Organization, TeamMember, User
from ..schemas import InvitationOut

router = APIRouter(prefix="/api/invitations", tags=["invitations"])


def _pending_invites(db: Session, user: User) -> list[TeamMember]:
    return (
        db.query(TeamMember)
        .filter(TeamMember.email == user.email, TeamMember.status == "Invited")
        .order_by(TeamMember.created_at.desc())
        .all()
    )


def _my_invite(db: Session, user: User, invite_id: str) -> TeamMember:
    member = (
        db.query(TeamMember)
        .filter(
            TeamMember.id == invite_id,
            TeamMember.email == user.email,
            TeamMember.status == "Invited",
        )
        .first()
    )
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    return member


def invitations_for(db: Session, user: User) -> list[InvitationOut]:
    """Pending invitations for a user. Shared with the composite /api/bell so the
    two can't drift apart."""
    out: list[InvitationOut] = []
    for m in _pending_invites(db, user):
        org = db.get(Organization, m.organization_id)
        if org is None:
            continue
        out.append(
            InvitationOut(
                id=m.id,
                organization_id=org.id,
                organization_name=org.name,
                role=m.role,
                created_at=m.created_at,
            )
        )
    return out


@router.get("", response_model=list[InvitationOut])
def list_invitations(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[InvitationOut]:
    """Pending invitations for the current user - shown in the notification bell."""
    return invitations_for(db, user)


@router.post("/{invite_id}/accept", response_model=InvitationOut)
def accept_invitation(
    invite_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InvitationOut:
    member = _my_invite(db, user, invite_id)
    member.status = "Active"
    db.commit()
    db.refresh(member)
    org = db.get(Organization, member.organization_id)
    return InvitationOut(
        id=member.id,
        organization_id=member.organization_id,
        organization_name=org.name if org else "",
        role=member.role,
        created_at=member.created_at,
    )


@router.post("/{invite_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invitation(
    invite_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    member = _my_invite(db, user, invite_id)
    db.delete(member)
    db.commit()
    return None
