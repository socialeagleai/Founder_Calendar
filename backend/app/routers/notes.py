from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_org, get_current_user
from ..models import Note, Organization, User
from ..schemas import NoteCreateRequest, NoteOut, NoteUpdateRequest

router = APIRouter(prefix="/api/notes", tags=["notes"])


def _get_note(db: Session, org: Organization, note_id: str) -> Note:
    note = (
        db.query(Note)
        .filter(Note.id == note_id, Note.organization_id == org.id)
        .first()
    )
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return note


@router.get("", response_model=list[NoteOut])
def list_notes(
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> list[Note]:
    return (
        db.query(Note)
        .filter(Note.organization_id == org.id)
        .order_by(Note.date, Note.created_at)
        .all()
    )


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    body: NoteCreateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    # Notes stay org-wide (shared calendar); user_id is recorded for attribution.
    note = Note(organization_id=org.id, user_id=user.id, date=body.date, content=body.content)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: str,
    body: NoteUpdateRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Note:
    note = _get_note(db, org, note_id)
    note.content = body.content
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    note = _get_note(db, org, note_id)
    db.delete(note)
    db.commit()
    return None
