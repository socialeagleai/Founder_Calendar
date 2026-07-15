from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from . import scheduler
from .config import settings
from .database import Base, engine
from .routers import (
    auth,
    bell,
    boards,
    departments,
    invitations,
    leave_requests,
    meetings,
    notes,
    notifications,
    organization,
    push,
    team,
    templates,
)


def _backfill_handles() -> None:
    """Give every member without an @handle one derived from their name, unique
    within their org. Needs real Python (slugify + collision suffixing), so it
    can't be the usual one-line UPDATE. Idempotent: only touches empty handles."""
    from .database import SessionLocal
    from .mentions import slugify_handle, unique_handle
    from .models import TeamMember

    db = SessionLocal()
    try:
        missing = db.query(TeamMember).filter(TeamMember.handle == "").all()
        if not missing:
            return
        taken: dict[str, set[str]] = {}
        for m in db.query(TeamMember).filter(TeamMember.handle != "").all():
            taken.setdefault(m.organization_id, set()).add(m.handle)
        for m in missing:
            org_taken = taken.setdefault(m.organization_id, set())
            handle = unique_handle(slugify_handle(m.name), org_taken)
            m.handle = handle
            org_taken.add(handle)
        db.commit()
    finally:
        db.close()


def _run_lightweight_migrations() -> None:
    """create_all() never ALTERs existing tables, so add columns introduced
    after a table first shipped. Idempotent - safe to run on every startup.
    (For a real deployment, swap this for Alembic.)"""
    inspector = inspect(engine)
    if "meetings" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("meetings")}
        if "date" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE meetings ADD COLUMN date VARCHAR(10) NOT NULL DEFAULT ''")
                )
    if "team_members" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("team_members")}
        if "permissions" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE team_members ADD COLUMN permissions JSON NOT NULL DEFAULT '{}'")
                )
        if "department_id" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE team_members ADD COLUMN department_id VARCHAR(32)")
                )
    if "board_boxes" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("board_boxes")}
        if "tasks" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE board_boxes ADD COLUMN tasks JSON NOT NULL DEFAULT '[]'")
                )

    # Allow a user to own multiple organizations: drop the old UNIQUE on
    # organizations.owner_id and replace it with a plain index. Idempotent.
    if "organizations" in inspector.get_table_names():
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE organizations "
                    "DROP CONSTRAINT IF EXISTS organizations_owner_id_key"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_organizations_owner_id "
                    "ON organizations (owner_id)"
                )
            )

    # Audience/visibility controls on notes, boards and meetings. Existing rows
    # default to "everyone" (their current behaviour) with empty target lists.
    for table in ("notes", "boards", "meetings"):
        if table not in inspector.get_table_names():
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        with engine.begin() as conn:
            if "visibility" not in cols:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN visibility "
                        "VARCHAR(16) NOT NULL DEFAULT 'everyone'"
                    )
                )
            if "visible_departments" not in cols:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN visible_departments "
                        "JSON NOT NULL DEFAULT '[]'"
                    )
                )
            if "visible_members" not in cols:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN visible_members "
                        "JSON NOT NULL DEFAULT '[]'"
                    )
                )

    # Notification routing/idempotency columns, plus the bell's poll index.
    # create_all() only touches tables it creates, so existing databases need
    # both the ADD COLUMNs and the indexes explicitly.
    if "notifications" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("notifications")}
        with engine.begin() as conn:
            if "organization_id" not in cols:
                conn.execute(
                    text("ALTER TABLE notifications ADD COLUMN organization_id VARCHAR(32)")
                )
            if "type" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE notifications ADD COLUMN type "
                        "VARCHAR(32) NOT NULL DEFAULT 'system'"
                    )
                )
            if "link" not in cols:
                conn.execute(
                    text("ALTER TABLE notifications ADD COLUMN link VARCHAR(255) NOT NULL DEFAULT ''")
                )
            if "dedupe_key" not in cols:
                conn.execute(text("ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(255)"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_notifications_user_read_created "
                    "ON notifications (user_id, read, created_at)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_notifications_organization_id "
                    "ON notifications (organization_id)"
                )
            )
            # Per-user, not global: one event fans out to many recipients, and a
            # global unique on dedupe_key would reject everyone after the first.
            # Postgres treats NULLs as distinct, so undeduped rows are unaffected.
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_user_dedupe "
                    "ON notifications (user_id, dedupe_key)"
                )
            )

    # @handles for mentions. Existing members get one derived from their name.
    # Order matters: every row defaults to '' and the index is unique per org, so
    # the backfill has to finish before the index is created or the second member
    # of any org collides with the first.
    if "team_members" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("team_members")}
        if "handle" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE team_members ADD COLUMN handle VARCHAR(64) NOT NULL DEFAULT ''")
                )
        _backfill_handles()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_team_org_handle "
                    "ON team_members (organization_id, handle)"
                )
            )

    # Per-user ownership of boards/meetings/templates/notes. Backfill existing
    # rows to the organization owner so pre-existing data keeps a creator.
    for table in ("boards", "meetings", "templates", "notes"):
        if table not in inspector.get_table_names():
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if "user_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id VARCHAR(32)"))
                conn.execute(
                    text(
                        f"UPDATE {table} SET user_id = ("
                        "  SELECT owner_id FROM organizations"
                        f"  WHERE organizations.id = {table}.organization_id"
                        ") WHERE user_id IS NULL"
                    )
                )


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Create tables on startup, then apply additive column migrations.
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()
    # In-process digest thread. Safe because we run a single uvicorn worker; see
    # scheduler.py. Can be turned off with DIGEST_ENABLED=false.
    if settings.digest_enabled:
        scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(
    title="Founder Calendar API",
    description="Backend for the Founder Calendar planning workspace.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(organization.router)
app.include_router(team.router)
app.include_router(departments.router)
app.include_router(invitations.router)
app.include_router(leave_requests.router)
app.include_router(notifications.router)
app.include_router(bell.router)
app.include_router(push.router)
app.include_router(notes.router)
app.include_router(boards.router)
app.include_router(meetings.router)
app.include_router(templates.router)


@app.get("/", tags=["health"])
def root() -> dict[str, str]:
    return {"status": "ok", "service": "founder-calendar-api"}


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "healthy"}
