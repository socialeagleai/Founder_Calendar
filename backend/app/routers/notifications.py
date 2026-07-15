from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, resolve_active_org
from ..models import Notification, User
from ..prefs import prefs_for, save_prefs
from ..schemas import NotificationOut, NotificationPrefsOut, NotificationPrefsUpdate


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Two kinds of dedupe key live in this column, and they mean opposite things:
#
#   identity keys ("mention:note:abc:<user>") mean "fire once for this thing,
#     ever" - re-saving a note must not re-ping the people already mentioned in
#     it, so the key has to survive being dismissed.
#   coalescing keys ("activity:board:abc:<actor>:<hour>") mean "collapse this
#     burst into one row" - they exist to stop forty edits becoming forty rows.
#
# Dismissing a coalesced row therefore has to release its key, or the hour bucket
# keeps matching a row that's already read and the user is silently muted for the
# rest of the hour. Dismissing an identity row must NOT release it.
COALESCING_TYPES = {"activity"}

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def notify(
    db: Session,
    user_id: str,
    message: str,
    *,
    type: str = "system",
    link: str = "",
    organization_id: str | None = None,
    dedupe_key: str | None = None,
) -> Notification | None:
    """Queue an in-app notification for a user. The caller commits.

    When `dedupe_key` is given the write is idempotent per user: an existing
    UNREAD row with the same key is coalesced (message refreshed, bumped to the
    top) rather than duplicated, and an already-READ one is left alone so
    dismissing something can't make it pop straight back.

    Dedupe is a SELECT, not a caught IntegrityError, on purpose: notify() shares
    the request's session and the router commits it, so a constraint violation
    would abort the caller's entire transaction - the note they were saving would
    roll back because we tried to tell someone about it.
    """
    if dedupe_key is not None:
        existing = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.dedupe_key == dedupe_key)
            .first()
        )
        if existing is not None:
            if existing.read:
                return None
            existing.message = message
            existing.link = link
            existing.created_at = _now()
            return existing

    row = Notification(
        user_id=user_id,
        message=message,
        type=type,
        link=link,
        organization_id=organization_id,
        dedupe_key=dedupe_key,
    )
    db.add(row)
    return row


def unread_for(db: Session, user: User, org_id: str | None = None) -> list[Notification]:
    """Unread notifications for a user, newest first. Shared with the composite
    /api/bell so the two can't drift apart.

    Scoped to the active org plus org-agnostic rows: a message about one org must
    not surface (or deep-link) while the user is looking at another."""
    q = db.query(Notification).filter(
        Notification.user_id == user.id, Notification.read.is_(False)
    )
    if org_id is not None:
        q = q.filter(
            or_(
                Notification.organization_id.is_(None),
                Notification.organization_id == org_id,
            )
        )
    return q.order_by(Notification.created_at.desc()).all()


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> list[Notification]:
    """Unread notifications for the current user (newest first)."""
    org = resolve_active_org(db, user, x_org_id)
    return unread_for(db, user, org.id if org else None)


@router.get("/preferences", response_model=NotificationPrefsOut)
def get_preferences(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationPrefsOut:
    """The caller's notification settings (defaults if they've never saved any).

    No page-access dependency on purpose: Settings is always editable by every
    member (see page_access_level), and these are the caller's own preferences -
    there is nothing to authorize beyond being signed in."""
    return NotificationPrefsOut(**vars(prefs_for(db, user.id)))


@router.patch("/preferences", response_model=NotificationPrefsOut)
def update_preferences(
    body: NotificationPrefsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationPrefsOut:
    """Partial update - only the fields actually sent are changed."""
    patch = body.model_dump(exclude_unset=True)
    merged = save_prefs(db, user.id, patch)
    db.commit()
    return NotificationPrefsOut(**vars(merged))


@router.post("/{notification_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_notification(
    notification_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    note = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user.id)
        .first()
    )
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    note.read = True
    # Release a coalescing key so the next event in the same time bucket starts a
    # fresh row. Without this, dismissing "Bob updated your board" would mute Bob
    # on that board until the hour rolled over. Identity keys (mentions) keep
    # theirs - that's what makes them fire once and only once.
    if note.type in COALESCING_TYPES:
        note.dedupe_key = None
    db.commit()
    return None
