import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Nullable: Google-authenticated users have no local password.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), default="local", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    organization: Mapped["Organization | None"] = relationship(
        back_populates="owner", uselist=False, cascade="all, delete-orphan"
    )


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    owner: Mapped[User] = relationship(back_populates="organization")
    team: Mapped[list["TeamMember"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    notes: Mapped[list["Note"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="Member", nullable=False)  # Owner|Admin|Member
    status: Mapped[str] = mapped_column(String(16), default="Invited", nullable=False)  # Active|Invited
    # Per-page access map: { "<page-key>": "view" | "edit" }. Pages absent from
    # the map are not accessible to this member. Owners have implicit full access.
    permissions: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    organization: Mapped[Organization] = relationship(back_populates="team")

    __table_args__ = (UniqueConstraint("organization_id", "email", name="uq_team_org_email"),)


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The member who created this note. Notes stay org-wide (visible to everyone
    # on the shared calendar); user_id is kept for attribution.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)  # YYYY-MM-DD
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    organization: Mapped[Organization] = relationship(back_populates="notes")


class Board(Base):
    """A OneNote-style board attached to a calendar date, holding free-form boxes."""

    __tablename__ = "boards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The member who owns this board. Boards are private to their creator in the
    # board list, but visible to the whole org on the shared calendar.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)  # YYYY-MM-DD
    title: Mapped[str] = mapped_column(String(255), default="Untitled board", nullable=False)
    share_token: Mapped[str | None] = mapped_column(
        String(40), unique=True, index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    boxes: Mapped[list["BoardBox"]] = relationship(
        back_populates="board", cascade="all, delete-orphan"
    )


class BoardBox(Base):
    """A draggable, resizable text box on a board (like a OneNote note container)."""

    __tablename__ = "board_boxes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    board_id: Mapped[str] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # A checklist on the box: [{ "id": str, "text": str, "done": bool }].
    tasks: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    x: Mapped[int] = mapped_column(Integer, default=40, nullable=False)
    y: Mapped[int] = mapped_column(Integer, default=40, nullable=False)
    width: Mapped[int] = mapped_column(Integer, default=280, nullable=False)
    height: Mapped[int] = mapped_column(Integer, default=200, nullable=False)
    color: Mapped[str] = mapped_column(String(16), default="default", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    board: Mapped[Board] = relationship(back_populates="boxes")


class Template(Base):
    """A reusable, user-authored template — either for a Board or a Meeting.

    `kind` selects the shape of the opaque JSON `data` payload:
      - board:   { "boxes": [{ id, title, content, x, y, width, height, color }] }
      - meeting: { "schedule", "duration", "sections": [<MeetingSection>...] }
    """

    __tablename__ = "templates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The member who authored this template. Templates are private per user.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    kind: Mapped[str] = mapped_column(String(16), index=True, nullable=False)  # board|meeting
    name: Mapped[str] = mapped_column(String(255), default="Untitled template", nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Meeting(Base):
    """A recurring meeting template with a structured, section-based agenda.

    The section/item structure is stored as a JSON document (no per-item rows):
    [{ id, title, type: text|bulleted|numbered, body, items: [{id, text, level}] }]
    """

    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The member who owns this meeting. Private in the meeting list, but visible
    # to the whole org on the shared calendar.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), default="Untitled meeting", nullable=False)
    # The calendar date this meeting is scheduled on (YYYY-MM-DD). Empty for
    # legacy rows created before meetings were date-based.
    date: Mapped[str] = mapped_column(String(10), index=True, default="", nullable=False)
    schedule: Mapped[str] = mapped_column(String(20), default="Weekly", nullable=False)
    duration: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    sections: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
