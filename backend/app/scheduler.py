"""The background thread that sends daily digests.

A plain daemon thread rather than APScheduler. The requirement is "wake up every
so often and do some work": we compute whose local hour it is ourselves, and we
already own idempotency through the dedupe key, so a scheduler library's cron
parsing, job stores and misfire policies would all be dead weight. A bare thread
also cannot overlap itself, whereas APScheduler's default max_instances would
silently skip a tick and log a warning nobody reads.

Safe here because the backend runs one uvicorn process with no --workers. If that
ever changes, every replica would run this loop - the per-user dedupe key
("digest:<local date>") is what stops that becoming duplicate emails, but it
would still be N times the work.
"""

import logging
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .database import SessionLocal
from .deps import orgs_for_user
from .digest import build_org_digest, render_digest
from .email import send_bulk
from .models import Notification, User
from .prefs import prefs_for
from .routers.notifications import notify

logger = logging.getLogger("uvicorn.error")

TICK_SECONDS = 15 * 60
# Read notifications are kept for a while so the bell isn't the only record, then
# dropped. Mention rows are exempt: their dedupe key is what makes a mention fire
# once and only once, and deleting the row would let a re-save ping again.
READ_RETENTION_DAYS = 30

_stop = threading.Event()
_thread: threading.Thread | None = None


def _digest_for_user(db: Session, user: User, now_utc: datetime) -> tuple | None:
    """One user's digest email, or None if they shouldn't get one right now.

    Returns (to, subject, html, text) ready for send_bulk."""
    prefs = prefs_for(db, user.id)
    if not prefs.daily_agenda or not prefs.email_enabled:
        return None

    local = now_utc.astimezone(prefs.tzinfo())
    if local.hour < prefs.digest_hour:
        return None  # their morning hasn't arrived yet

    local_date = local.date().isoformat()
    dedupe = f"digest:{local_date}"
    # ">= digest_hour AND not sent today" rather than "== digest_hour": if the
    # container was restarting at 08:00 the digest still goes out at 08:15 rather
    # than being silently skipped for the day.
    already = (
        db.query(Notification.id)
        .filter(Notification.user_id == user.id, Notification.dedupe_key == dedupe)
        .first()
    )
    if already:
        return None

    digests = [
        d
        for d in (
            build_org_digest(db, org, user, local_date) for org in orgs_for_user(db, user)
        )
        if not d.empty
    ]
    # Claim the day even when there's nothing to say, so we don't rebuild this
    # every tick until midnight. The row is marked read immediately: it's a
    # record that today is handled, not something anyone should see in the bell.
    result = notify(
        db, user.id, f"Daily agenda for {local_date}", type="digest", dedupe_key=dedupe
    )
    if result.row is not None:
        result.row.read = True

    # Nobody wants "you have nothing today" at 8am every morning forever - that
    # one decision is the difference between a digest people keep and a digest
    # people filter.
    if not digests:
        return None

    subject, html, text = render_digest(user.name, digests, local_date, prefs)
    return (user.email, subject, html, text)


def _prune_read(db: Session, now_utc: datetime) -> int:
    """Drop old read notifications. Fan-out multiplies this table by team size and
    nothing else ever deletes from it."""
    cutoff = now_utc - timedelta(days=READ_RETENTION_DAYS)
    return (
        db.query(Notification)
        .filter(
            Notification.read.is_(True),
            Notification.created_at < cutoff,
            Notification.type != "mention",
        )
        .delete(synchronize_session=False)
    )


def run_once() -> int:
    """One tick: send any digests that are due, prune old rows. Returns how many
    digests were sent. Exposed separately so it can be tested without threads."""
    # A fresh session per tick, never one long-lived one: a long-lived session
    # pins a pooled connection for hours and serves stale identity-map data.
    db = SessionLocal()
    try:
        now_utc = datetime.now(timezone.utc)
        messages = []
        for user in db.query(User).all():
            try:
                msg = _digest_for_user(db, user, now_utc)
                if msg:
                    messages.append(msg)
            except Exception:  # noqa: BLE001
                # One user's bad data must not stop everyone else's digest.
                logger.exception("Digest failed for user %s", user.id)
        pruned = _prune_read(db, now_utc)
        db.commit()
        if messages:
            # One SMTP connection for the whole run.
            sent = send_bulk(messages)
            logger.info("Digest: sent %d/%d", sent, len(messages))
        if pruned:
            logger.info("Digest: pruned %d read notifications", pruned)
        return len(messages)
    except Exception:  # noqa: BLE001
        logger.exception("Digest tick failed")
        db.rollback()
        return 0
    finally:
        db.close()


def _loop() -> None:
    # Wait first: startup is the worst moment to do work, and a container that
    # crash-loops shouldn't re-run this on every boot.
    while not _stop.wait(TICK_SECONDS):
        run_once()


def start() -> None:
    """Start the digest thread. Idempotent."""
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="digest", daemon=True)
    _thread.start()
    logger.info("Digest scheduler started (tick %ds)", TICK_SECONDS)


def stop() -> None:
    """Ask the thread to finish. Called from the lifespan shutdown."""
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
