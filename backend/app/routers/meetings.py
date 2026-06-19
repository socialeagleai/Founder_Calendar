from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_org, get_current_user
from ..models import Meeting, Organization, User
from ..schemas import (
    MeetingCreateRequest,
    MeetingDetailOut,
    MeetingSummaryOut,
    MeetingUpdateRequest,
)

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _get_meeting(db: Session, org: Organization, meeting_id: str) -> Meeting:
    meeting = (
        db.query(Meeting)
        .filter(Meeting.id == meeting_id, Meeting.organization_id == org.id)
        .first()
    )
    if not meeting:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return meeting


def _summary(m: Meeting) -> MeetingSummaryOut:
    return MeetingSummaryOut(
        id=m.id,
        name=m.name,
        date=m.date,
        schedule=m.schedule,
        duration=m.duration,
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


@router.post("", response_model=MeetingDetailOut, status_code=status.HTTP_201_CREATED)
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
    return meeting


@router.get("/{meeting_id}", response_model=MeetingDetailOut)
def get_meeting(
    meeting_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Meeting:
    return _get_meeting(db, org, meeting_id)


@router.patch("/{meeting_id}", response_model=MeetingDetailOut)
def update_meeting(
    meeting_id: str,
    body: MeetingUpdateRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Meeting:
    meeting = _get_meeting(db, org, meeting_id)
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
    return meeting


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(
    meeting_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    meeting = _get_meeting(db, org, meeting_id)
    db.delete(meeting)
    db.commit()
    return None
