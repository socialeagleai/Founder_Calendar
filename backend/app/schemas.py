from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

Role = Literal["Owner", "Admin", "Member"]
MemberStatus = Literal["Active", "Invited", "LeaveRequested"]


def _check_timezone(v: str) -> str:
    """Reject an unusable IANA zone at the API boundary rather than storing it.

    Background threads resolve these on a tick - the digest walks every user's
    zone, the reminder loop every org's - so one unparseable value would raise
    where nobody would ever see it.

    Tested by actually constructing the zone rather than checking membership of
    available_timezones(): that set is empty when tzdata is missing, which would
    reject every timezone on earth instead of just the bad ones."""
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
        raise ValueError("Unknown timezone") from exc
    return v


class CamelModel(BaseModel):
    """Base model that serialises to camelCase to match the frontend TS types."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ---------- Audience / visibility (shared by notes, boards, meetings) ----------
# everyone = whole org; departments = members in visible_departments; members =
# the TeamMembers in visible_members; private = creator only.
Visibility = Literal["everyone", "departments", "members", "private"]


class AudienceRequest(BaseModel):
    """Audience fields carried by note/board/meeting create + update requests.
    Plain BaseModel with the camelCase alias so the frontend can send
    visibleDepartments / visibleMembers."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    visibility: Visibility = "everyone"
    visible_departments: list[str] = []
    visible_members: list[str] = []

    @model_validator(mode="after")
    def _require_targets(self) -> "AudienceRequest":
        # "Departments"/"Specific people" are meaningless without at least one
        # target - reject so an item can't be saved visible to no one.
        if self.visibility == "departments" and not self.visible_departments:
            raise ValueError("Select at least one department")
        if self.visibility == "members" and not self.visible_members:
            raise ValueError("Select at least one person")
        return self


class AudienceOut(CamelModel):
    """Audience fields echoed back on every note/board/meeting payload."""

    visibility: Visibility = "everyone"
    visible_departments: list[str] = []
    visible_members: list[str] = []


# ---------- Auth ----------
class SignupRequest(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleLoginRequest(BaseModel):
    # A Google ID token (from Google Identity Services). Optional: when omitted
    # the backend falls back to a demo Google user, mirroring the frontend stub.
    credential: str | None = None


class UserOut(CamelModel):
    id: str
    name: str
    email: EmailStr


class AuthResponse(CamelModel):
    token: str
    user: UserOut


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str | None = Field(default=None, min_length=6)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1)
    password: str = Field(min_length=6)


class MessageResponse(CamelModel):
    detail: str


# ---------- Organization ----------
class OrgCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class OrgUpdateRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""
    # Optional so an older client PATCHing name/description can't silently reset
    # the org's timezone to a default.
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, v: str | None) -> str | None:
        return v if v is None else _check_timezone(v)


class OrganizationOut(CamelModel):
    id: str
    name: str
    description: str
    timezone: str
    created_at: datetime
    owner_id: str


class OrgMembershipOut(CamelModel):
    """An organization the user belongs to, with their role in it - powers the
    navbar org switcher."""

    id: str
    name: str
    description: str
    created_at: datetime
    owner_id: str
    role: Role
    is_owner: bool


class InvitationOut(CamelModel):
    """A pending invitation for the current user (shown in the notification bell)."""

    id: str
    organization_id: str
    organization_name: str
    role: Role
    created_at: datetime


class LeaveRequestOut(CamelModel):
    """A member's request to leave one of the owner's organizations - shown to
    the owner in the notification bell. `id` is the TeamMember id."""

    id: str
    organization_id: str
    organization_name: str
    member_name: str
    member_email: str


class NotificationOut(CamelModel):
    """An in-app message for the current user (shown in the bell)."""

    id: str
    message: str
    # What produced it, and where clicking it goes (relative path; "" = not
    # clickable). The frontend routes on `link` alone - `type` is for styling.
    type: str
    link: str
    read: bool
    created_at: datetime


class NotificationPrefsOut(CamelModel):
    """A user's notification settings."""

    shared_with_me: bool
    activity: bool
    mentions: bool
    daily_agenda: bool
    meeting_invites: bool
    meeting_reminders: bool
    email_enabled: bool
    push_enabled: bool
    digest_hour: int
    timezone: str


class NotificationPrefsUpdate(CamelModel):
    """Partial update of notification settings - only the fields sent change."""

    shared_with_me: bool | None = None
    activity: bool | None = None
    mentions: bool | None = None
    daily_agenda: bool | None = None
    meeting_invites: bool | None = None
    meeting_reminders: bool | None = None
    email_enabled: bool | None = None
    push_enabled: bool | None = None
    digest_hour: int | None = Field(default=None, ge=0, le=23)
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, v: str | None) -> str | None:
        return v if v is None else _check_timezone(v)


class PushConfigOut(CamelModel):
    """Whether push is available, and the VAPID public key to subscribe with."""

    enabled: bool
    public_key: str


class PushSubscribeRequest(CamelModel):
    """A browser's PushSubscription, flattened from the shape the Push API gives
    JavaScript ({endpoint, keys: {p256dh, auth}})."""

    endpoint: str = Field(min_length=1, max_length=512)
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushUnsubscribeRequest(CamelModel):
    """Only the endpoint - unsubscribing needs no keys, and asking for them would
    force the caller to invent values it doesn't have."""

    endpoint: str = Field(min_length=1, max_length=512)


class BellOut(CamelModel):
    """Everything the notification bell renders, in one response. The bell polls
    on an interval, and fetching these separately meant re-decoding the JWT and
    re-resolving the active org once per feed, several times a minute, per tab."""

    invitations: list[InvitationOut]
    leave_requests: list[LeaveRequestOut]
    notifications: list[NotificationOut]
    orgs: list[OrgMembershipOut]


# ---------- Team ----------
PageAccess = Literal["view", "edit"]
# Per-page access map: { "<page-key>": "view" | "edit" }.
Permissions = dict[str, PageAccess]


class InviteMemberRequest(BaseModel):
    # Accept camelCase keys (e.g. departmentId) from the frontend while still
    # allowing the snake_case field names.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(min_length=1)
    email: EmailStr
    role: Role = "Member"
    permissions: Permissions = {}
    department_id: str | None = None


class UpdateRoleRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    role: Role | None = None
    permissions: Permissions | None = None
    department_id: str | None = None


class TeamMemberOut(CamelModel):
    id: str
    name: str
    email: EmailStr
    # What teammates type to mention this person (without the leading "@").
    handle: str = ""
    role: Role
    status: MemberStatus
    permissions: Permissions
    department_id: str | None = None


# ---------- Departments ----------
class CreateDepartmentRequest(BaseModel):
    name: str = Field(min_length=1)


class DepartmentOut(CamelModel):
    id: str
    name: str
    created_at: datetime


class AccessOut(CamelModel):
    """The current user's effective access within their active organization."""

    is_owner: bool
    role: Role
    permissions: Permissions


# ---------- Notes ----------
class NoteCreateRequest(AudienceRequest):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    content: str = Field(min_length=1)


class NoteUpdateRequest(AudienceRequest):
    content: str = Field(min_length=1)


class NoteOut(AudienceOut):
    id: str
    date: str
    content: str
    creator_name: str | None = None
    mine: bool = False  # created by the current user
    # @handles in the content that name a real teammate who can't see this note.
    # Returned on write so the author is told the mention went nowhere, rather
    # than it failing silently. Empty on reads.
    unreachable_mentions: list[str] = []
    created_at: datetime
    updated_at: datetime


# ---------- Boards ----------
class BoardCreateRequest(AudienceRequest):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str | None = None


class BoardUpdateRequest(AudienceRequest):
    # Optional so the editor can patch audience without resending the title.
    title: str | None = Field(default=None, min_length=1)


class BoxTaskModel(CamelModel):
    id: str
    text: str = ""
    done: bool = False


class BoxOut(CamelModel):
    id: str
    title: str
    content: str
    tasks: list[BoxTaskModel] = []
    x: int
    y: int
    width: int
    height: int
    color: str


class BoxCreateRequest(BaseModel):
    title: str = ""
    content: str = ""
    tasks: list[BoxTaskModel] = []
    x: int = 40
    y: int = 40
    width: int = 280
    height: int = 200
    color: str = "default"


class BoxUpdateRequest(BaseModel):
    title: str | None = None
    content: str | None = None
    tasks: list[BoxTaskModel] | None = None
    x: int | None = None
    y: int | None = None
    width: int | None = Field(default=None, ge=160)
    height: int | None = Field(default=None, ge=120)
    color: str | None = None


class BoardSummaryOut(AudienceOut):
    id: str
    date: str
    title: str
    creator_name: str | None = None
    created_at: datetime
    updated_at: datetime
    box_count: int
    open_task_count: int  # tasks not yet marked done, across all boxes


class BoardDetailOut(AudienceOut):
    id: str
    date: str
    title: str
    mine: bool = False  # created by the current user
    created_at: datetime
    updated_at: datetime
    boxes: list[BoxOut]


class BoardShareOut(CamelModel):
    token: str


class BoardCopyRequest(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str | None = None


# ---------- Meetings ----------
# "Once" is last so it reads as the exception: everything else repeats from
# Meeting.date forever (see recurrence.py).
Schedule = Literal["Daily", "Weekly", "Biweekly", "Monthly", "Yearly", "Once"]
SectionType = Literal["text", "bulleted", "numbered"]

# "HH:MM" 24-hour, or "" for a meeting with no set time. Interpreted in the
# ORG's timezone (Organization.timezone), never the viewer's.
START_TIME_PATTERN = r"^$|^([01]\d|2[0-3]):[0-5]\d$"

# A meeting is a room full of people, not a mailing list. Bounds the invite and
# reminder fan-out for one meeting.
MAX_ATTENDEES = 50


class MeetingItemModel(CamelModel):
    id: str
    text: str = ""
    level: int = 0  # 0 = top-level, 1 = sub-item


class MeetingSectionModel(CamelModel):
    id: str
    title: str = ""
    type: SectionType = "bulleted"
    body: str = ""  # used when type == "text"
    items: list[MeetingItemModel] = []


class MeetingCreateRequest(AudienceRequest):
    name: str = Field(min_length=1)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start_time: str = Field(default="", pattern=START_TIME_PATTERN)
    schedule: Schedule = "Weekly"
    duration: str = ""
    sections: list[MeetingSectionModel] = []
    # TeamMember ids. Capped so one request can't fan out unboundedly.
    attendees: list[str] = Field(default=[], max_length=MAX_ATTENDEES)


class MeetingUpdateRequest(AudienceRequest):
    name: str | None = Field(default=None, min_length=1)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    start_time: str | None = Field(default=None, pattern=START_TIME_PATTERN)
    schedule: Schedule | None = None
    duration: str | None = None
    sections: list[MeetingSectionModel] | None = None
    attendees: list[str] | None = Field(default=None, max_length=MAX_ATTENDEES)


class MeetingCopyRequest(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str | None = None


class MeetingSummaryOut(AudienceOut):
    id: str
    name: str
    date: str
    start_time: str
    schedule: Schedule
    duration: str
    creator_name: str | None = None
    section_count: int
    sections: list[MeetingSectionModel]
    attendees: list[str] = []
    # Every date this meeting falls on inside the feed's window, expanded from
    # (date, schedule). `date` is only the FIRST one. Empty on the "mine" scope,
    # which lists meeting definitions rather than calendar days.
    occurrences: list[str] = []
    created_at: datetime
    updated_at: datetime


class MeetingDetailOut(AudienceOut):
    id: str
    name: str
    date: str
    start_time: str
    schedule: Schedule
    duration: str
    mine: bool = False  # created by the current user
    sections: list[MeetingSectionModel]
    attendees: list[str] = []
    created_at: datetime
    updated_at: datetime


# ---------- Templates ----------
TemplateKind = Literal["board", "meeting"]


class TemplateCreateRequest(BaseModel):
    kind: TemplateKind
    name: str = Field(min_length=1)
    # Opaque payload - shape depends on `kind` (see models.Template).
    data: dict = {}


class TemplateUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    data: dict | None = None


class TemplateOut(CamelModel):
    id: str
    kind: TemplateKind
    name: str
    data: dict
    created_at: datetime
    updated_at: datetime
