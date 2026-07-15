"""Web Push delivery.

Push is the least specific channel on purpose. A push notification renders on a
locked screen, to whoever is holding the device - so it says that something
happened and who did it, and the specifics live behind the click. The bell and
the email carry the detail; this carries the nudge.

Blocking (pywebpush uses requests underneath), so callers hand it to a background
task exactly like SMTP.
"""

import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal
from .models import PushSubscription

logger = logging.getLogger("uvicorn.error")

# (endpoint, p256dh, auth, title, body, url) - plain strings, because these cross
# into a background task that runs after the request's session is closed.
PushMessage = tuple[str, str, str, str, str, str]


def configured() -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key)


def subscriptions_for(db: Session, user_id: str) -> list[PushSubscription]:
    return (
        db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    )


def build_messages(
    db: Session, user_id: str, title: str, body: str, link: str
) -> list[PushMessage]:
    """A push message per browser this user has subscribed. Empty when push isn't
    configured or they have no subscriptions."""
    if not configured():
        return []
    url = f"{settings.app_base_url.rstrip('/')}{link}" if link else settings.app_base_url
    return [
        (s.endpoint, s.p256dh, s.auth, title, body, url)
        for s in subscriptions_for(db, user_id)
    ]


def send_push(messages: list[PushMessage]) -> int:
    """Deliver push messages, pruning subscriptions the browser has abandoned.

    Opens its own session: this runs in a background task, long after the
    request's session is gone. Returns how many were delivered."""
    if not messages or not configured():
        return 0

    sent = 0
    dead: list[str] = []
    for endpoint, p256dh, auth, title, body, url in messages:
        try:
            webpush(
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {"p256dh": p256dh, "auth": auth},
                },
                data=json.dumps({"title": title, "body": body, "url": url}),
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
                timeout=10,
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                # The browser is gone for good - unsubscribed, or the profile was
                # wiped. This is the only signal we ever get, so act on it.
                dead.append(endpoint)
            elif status == 413:
                logger.error("Push payload too large for %s", endpoint[:60])
            elif status == 429:
                # Rate limited. Keep the subscription; the next event retries.
                logger.warning("Push rate limited by %s", endpoint[:60])
            else:
                logger.error("Push failed (%s): %s", status, exc)
        except Exception:  # noqa: BLE001 - never let push kill a background task
            logger.exception("Push failed for %s", endpoint[:60])

    if dead:
        db = SessionLocal()
        try:
            n = (
                db.query(PushSubscription)
                .filter(PushSubscription.endpoint.in_(dead))
                .delete(synchronize_session=False)
            )
            db.commit()
            logger.info("Pruned %d dead push subscriptions", n)
        except Exception:  # noqa: BLE001
            logger.exception("Could not prune push subscriptions")
            db.rollback()
        finally:
            db.close()
    return sent
