"""Web Push subscription management."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import PushSubscription, User
from ..push import configured
from ..schemas import PushConfigOut, PushSubscribeRequest, PushUnsubscribeRequest

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public-key", response_model=PushConfigOut)
def vapid_public_key() -> PushConfigOut:
    """The public key the browser needs to subscribe, and whether push is on.

    Served rather than baked into the bundle: VITE_* vars are inlined at build
    time, so shipping the key that way would mean rebuilding and redeploying the
    frontend to rotate it - and getting it wrong would leave the browser with an
    empty key and push silently doing nothing. No auth: it's a public key, and
    the login page has no token yet anyway."""
    return PushConfigOut(
        enabled=configured(), public_key=settings.vapid_public_key
    )


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(
    body: PushSubscribeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Register this browser for push, or hand an existing registration to
    whoever is signed in now.

    The endpoint is unique across all users, not per user: on a shared machine,
    signing in as someone else reuses the same browser endpoint, and it must
    follow the new account rather than keep pushing the old one's notifications
    to a screen they no longer own."""
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == body.endpoint)
        .first()
    )
    if existing is not None:
        existing.user_id = user.id
        existing.p256dh = body.p256dh
        existing.auth = body.auth
    else:
        db.add(
            PushSubscription(
                user_id=user.id,
                endpoint=body.endpoint,
                p256dh=body.p256dh,
                auth=body.auth,
            )
        )
    db.commit()
    return None


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    body: PushUnsubscribeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Drop this browser's subscription. Idempotent - unsubscribing something
    already gone is a success, not a 404."""
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return None
