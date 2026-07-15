from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Notification, User
from ..schemas import NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def notify(db: Session, user_id: str, message: str) -> None:
    """Queue an in-app notification for a user. The caller commits."""
    db.add(Notification(user_id=user_id, message=message))


def unread_for(db: Session, user: User) -> list[Notification]:
    """Unread notifications for a user, newest first. Shared with the composite
    /api/bell so the two can't drift apart."""
    return (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.read.is_(False))
        .order_by(Notification.created_at.desc())
        .all()
    )


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Notification]:
    """Unread notifications for the current user (newest first)."""
    return unread_for(db, user)


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
    db.commit()
    return None
