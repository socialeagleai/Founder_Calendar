import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
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

    # A user can own multiple organizations.
    organizations: Mapped[list["Organization"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class PasswordResetToken(Base):
    """A single-use, time-limited token for resetting a forgotten password. Only
    the SHA-256 hash of the token is stored; the raw token lives only in the
    emailed reset link."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Notification(Base):
    """A simple in-app message delivered to a user (shown in the bell). Used for
    cross-user events like a leave request being approved or declined, and for
    the audience-driven feeds (something shared with you, activity on your items,
    mentions)."""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Which org this is about. NULL = not org-scoped (leave requests span orgs by
    # design). The bell filters to "NULL or my active org" so a message about one
    # org can't surface - or deep-link - while the user is looking at another.
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # What produced this: system | shared | activity | mention | digest.
    type: Mapped[str] = mapped_column(String(32), default="system", nullable=False)
    # Where clicking it goes, as a relative path (e.g. "/board/abc123"). Empty
    # means the row isn't clickable.
    link: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    # Idempotency/coalescing handle, e.g. "mention:note:abc:user1". NULL for rows
    # that don't dedupe. Unique PER USER - the same event fans out to many people,
    # so a global unique would let recipient #1 win and reject everyone else.
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        # The bell polls "unread for me, newest first" on an interval - the only
        # query that touches this table at any volume. Postgres scans a btree
        # backwards, so a plain ascending index serves the DESC order fine.
        Index("ix_notifications_user_read_created", "user_id", "read", "created_at"),
        # Backstop only: producers SELECT first rather than rely on this, because
        # a violation would abort the caller's whole transaction (notify() shares
        # the request's session and the router commits it).
        UniqueConstraint("user_id", "dedupe_key", name="uq_notification_user_dedupe"),
    )


class NotificationPreference(Base):
    """Per-user notification settings. A row only exists once the user changes
    something - `prefs_for()` resolves defaults in code for everyone else, so
    there's no write on a read path and no backfill when defaults change."""

    __tablename__ = "notification_preferences"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    # What to notify about.
    shared_with_me: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    activity: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mentions: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    daily_agenda: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Master switches per channel. The bell is always on - it's the app itself.
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Digest send time: local hour (0-23) in the user's IANA timezone.
    digest_hour: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Not unique - a user can own several organizations.
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    owner: Mapped[User] = relationship(back_populates="organizations")
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
    # What teammates type to mention this person: lowercase [a-z0-9_], unique in
    # the org. Derived from their name at invite time (see mentions.py). Names
    # can't serve as mention targets - they contain spaces, collide by prefix,
    # and change.
    handle: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="Member", nullable=False)  # Owner|Admin|Member
    status: Mapped[str] = mapped_column(String(16), default="Invited", nullable=False)  # Active|Invited
    # Per-page access map: { "<page-key>": "view" | "edit" }. Pages absent from
    # the map are not accessible to this member. Owners have implicit full access.
    permissions: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    # Optional department/group the member belongs to (e.g. HR, Operations).
    # Nulled out automatically if the department is deleted.
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    organization: Mapped[Organization] = relationship(back_populates="team")
    department: Mapped["Department | None"] = relationship(lazy="selectin")

    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_team_org_email"),
        # Mentions resolve by exact handle within an org, so two people in the
        # same org sharing one would make "@priya" ambiguous.
        UniqueConstraint("organization_id", "handle", name="uq_team_org_handle"),
    )


class Department(Base):
    """A team grouping inside an organization (e.g. HR, Operations). Members can
    be assigned to one department; owners/admins manage the list on the Team page."""

    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_department_org_name"),)


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
    # Audience control. visibility is one of: "everyone" (whole org), "departments"
    # (only members in visible_departments), "members" (only the TeamMembers in
    # visible_members), or "private" (creator only). The creator always sees their
    # own item regardless. Applied uniformly to notes/boards/meetings.
    visibility: Mapped[str] = mapped_column(String(16), default="everyone", nullable=False)
    visible_departments: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    visible_members: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    organization: Mapped[Organization] = relationship(back_populates="notes")
    creator: Mapped["User | None"] = relationship("User", lazy="selectin")

    @property
    def creator_name(self) -> str | None:
        return self.creator.name if self.creator else None


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
    # Audience control (see Note.visibility).
    visibility: Mapped[str] = mapped_column(String(16), default="everyone", nullable=False)
    visible_departments: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    visible_members: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    boxes: Mapped[list["BoardBox"]] = relationship(
        back_populates="board", cascade="all, delete-orphan"
    )
    creator: Mapped["User | None"] = relationship("User", lazy="selectin")

    @property
    def creator_name(self) -> str | None:
        return self.creator.name if self.creator else None


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
    """A reusable, user-authored template - either for a Board or a Meeting.

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
    # Audience control (see Note.visibility).
    visibility: Mapped[str] = mapped_column(String(16), default="everyone", nullable=False)
    visible_departments: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    visible_members: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    creator: Mapped["User | None"] = relationship("User", lazy="selectin")

    @property
    def creator_name(self) -> str | None:
        return self.creator.name if self.creator else None
