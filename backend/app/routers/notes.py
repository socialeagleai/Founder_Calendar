from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import (
    can_view_item,
    ensure_can_view,
    ensure_owns_or_edit,
    get_current_org,
    get_current_user,
    member_for,
    require_page_access,
)
from ..models import Note, Organization, User
from ..notify_service import fanout, notify_mentions
from ..schemas import NoteCreateRequest, NoteOut, NoteUpdateRequest

router = APIRouter(prefix="/api/notes", tags=["notes"])

# Notes live on the Calendar page. "view" lets a member manage their own notes;
# "edit" also lets them change notes created by other members.
require_calendar_access = require_page_access("calendar")


def _get_note(db: Session, org: Organization, note_id: str) -> Note:
    note = (
        db.query(Note)
        .filter(Note.id == note_id, Note.organization_id == org.id)
        .first()
    )
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return note


def _out(note: Note, user: User, unreachable: list[str] | None = None) -> Note:
    note.mine = note.user_id == user.id  # type: ignore[attr-defined]
    # Handles that name a real teammate who can't see this note. Surfaced so the
    # author learns their @mention went nowhere instead of assuming it landed.
    note.unreachable_mentions = unreachable or []  # type: ignore[attr-defined]
    return note


@router.get("", response_model=list[NoteOut])
def list_notes(
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Note]:
    notes = (
        db.query(Note)
        .filter(Note.organization_id == org.id)
        .order_by(Note.date, Note.created_at)
        .all()
    )
    # Only return notes the viewer is allowed to see (creator, everyone, or
    # targeted to their department/them). Resolve their membership once.
    member = member_for(db, org, user)
    return [_out(n, user) for n in notes if can_view_item(n, user, member)]


@router.post(
    "",
    response_model=NoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_calendar_access)],
)
def create_note(
    body: NoteCreateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    # user_id records the creator; visibility decides who else sees it.
    note = Note(
        organization_id=org.id,
        user_id=user.id,
        date=body.date,
        content=body.content,
        visibility=body.visibility,
        visible_departments=list(body.visible_departments),
        visible_members=list(body.visible_members),
    )
    db.add(note)
    # Flush (don't commit) so the note has an id for the notification links while
    # staying in the same transaction: if the fan-out blows up, the note doesn't
    # get half-saved with nobody told about it.
    db.flush()
    link = f"/calendar?date={note.date}"
    # Mentions first, so the fan-out can skip anyone already pinged by name -
    # otherwise being @mentioned in a note visible to everyone earns you two
    # notifications about the same note.
    mentions = notify_mentions(
        db,
        org,
        note,
        actor=user,
        text=note.content,
        message=f"{user.name} mentioned you in a note on {note.date}",
        link=link,
        item_kind="note",
        item_id=note.id,
    )
    fanout(
        db,
        org,
        note,
        actor=user,
        category="shared",
        message=f"{user.name} added a note on {note.date}",
        link=link,
        dedupe_key=f"shared:note:{note.id}",
        also_exclude=mentions.notified,
    )
    db.commit()
    db.refresh(note)
    return _out(note, user, mentions.unreachable)


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: str,
    body: NoteUpdateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_calendar_access),
    db: Session = Depends(get_db),
) -> Note:
    note = _get_note(db, org, note_id)
    ensure_can_view(db, org, user, note, "note")
    ensure_owns_or_edit(level, note.user_id, user, "notes")
    note.content = body.content
    # Only the creator (or an editor) reaches here; apply audience if the client
    # sent it (omitted -> leave the existing audience untouched).
    if "visibility" in body.model_fields_set:
        note.visibility = body.visibility
        note.visible_departments = list(body.visible_departments)
        note.visible_members = list(body.visible_members)
    db.flush()
    # Mentions are re-scanned on every save because the content is replaced
    # wholesale and we can't tell what's new. The dedupe key carries no time
    # component, so an existing mention resolves to a row that already exists
    # and nobody is pinged twice; only a newly added @handle produces anything.
    mentions = notify_mentions(
        db,
        org,
        note,
        actor=user,
        text=note.content,
        message=f"{user.name} mentioned you in a note on {note.date}",
        link=f"/calendar?date={note.date}",
        item_kind="note",
        item_id=note.id,
    )
    db.commit()
    db.refresh(note)
    return _out(note, user, mentions.unreachable)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: str,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_calendar_access),
    db: Session = Depends(get_db),
) -> None:
    note = _get_note(db, org, note_id)
    ensure_can_view(db, org, user, note, "note")
    ensure_owns_or_edit(level, note.user_id, user, "notes")
    db.delete(note)
    db.commit()
    return None
