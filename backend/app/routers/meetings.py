from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import (
    ensure_owns_or_edit,
    get_current_org,
    get_current_user,
    require_page_access,
)
from ..models import Meeting, Organization, User
from ..schemas import (
    MeetingCreateRequest,
    MeetingDetailOut,
    MeetingSummaryOut,
    MeetingUpdateRequest,
)

router = APIRouter(prefix="/api/meetings", tags=["meetings"])

# "view" lets a member manage their own meetings; "edit" also lets them change
# meetings created by other members.
require_meeting_access = require_page_access("meeting")


def _get_meeting(db: Session, org: Organization, meeting_id: str) -> Meeting:
    meeting = (
        db.query(Meeting)
        .filter(Meeting.id == meeting_id, Meeting.organization_id == org.id)
        .first()
    )
    if not meeting:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return meeting


def _detail(m: Meeting, user: User) -> Meeting:
    m.mine = m.user_id == user.id  # type: ignore[attr-defined]
    return m


def _summary(m: Meeting) -> MeetingSummaryOut:
    return MeetingSummaryOut(
        id=m.id,
        name=m.name,
        date=m.date,
        schedule=m.schedule,
        duration=m.duration,
        creator_name=m.creator_name,
        section_count=len(m.sections or []),
        sections=m.sections or [],
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.get("", response_model=list[MeetingSummaryOut])
def list_meetings(
    scope: Literal["mine", "org"] = Query(default="mine"),
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MeetingSummaryOut]:
    """List meetings. `scope=mine` (default) returns only the caller's meetings
    for the meeting list page; `scope=org` returns every member's meetings for
    the shared calendar."""
    query = db.query(Meeting).filter(Meeting.organization_id == org.id)
    if scope == "mine":
        query = query.filter(Meeting.user_id == user.id)
    meetings = query.order_by(Meeting.created_at.desc()).all()
    return [_summary(m) for m in meetings]


@router.post(
    "",
    response_model=MeetingDetailOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_meeting_access)],
)
def create_meeting(
    body: MeetingCreateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Meeting:
    meeting = Meeting(
        organization_id=org.id,
        user_id=user.id,
        name=body.name.strip() or "Untitled meeting",
        date=body.date,
        schedule=body.schedule,
        duration=body.duration,
        sections=[s.model_dump() for s in body.sections],
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return _detail(meeting, user)


@router.get("/{meeting_id}", response_model=MeetingDetailOut)
def get_meeting(
    meeting_id: str,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Meeting:
    return _detail(_get_meeting(db, org, meeting_id), user)


@router.patch("/{meeting_id}", response_model=MeetingDetailOut)
def update_meeting(
    meeting_id: str,
    body: MeetingUpdateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_meeting_access),
    db: Session = Depends(get_db),
) -> Meeting:
    meeting = _get_meeting(db, org, meeting_id)
    ensure_owns_or_edit(level, meeting.user_id, user, "meetings")
    if body.name is not None:
        meeting.name = body.name.strip() or "Untitled meeting"
    if body.date is not None:
        meeting.date = body.date
    if body.schedule is not None:
        meeting.schedule = body.schedule
    if body.duration is not None:
        meeting.duration = body.duration
    if body.sections is not None:
        meeting.sections = [s.model_dump() for s in body.sections]
    db.commit()
    db.refresh(meeting)
    return _detail(meeting, user)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(
    meeting_id: str,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_meeting_access),
    db: Session = Depends(get_db),
) -> None:
    meeting = _get_meeting(db, org, meeting_id)
    ensure_owns_or_edit(level, meeting.user_id, user, "meetings")
    db.delete(meeting)
    db.commit()
    return None
