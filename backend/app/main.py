from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from .config import settings
from .database import Base, engine
from .routers import auth, boards, meetings, notes, organization, team, templates


def _run_lightweight_migrations() -> None:
    """create_all() never ALTERs existing tables, so add columns introduced
    after a table first shipped. Idempotent — safe to run on every startup.
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
    if "board_boxes" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("board_boxes")}
        if "tasks" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE board_boxes ADD COLUMN tasks JSON NOT NULL DEFAULT '[]'")
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
    yield


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
