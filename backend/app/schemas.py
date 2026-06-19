from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel

Role = Literal["Owner", "Admin", "Member"]
MemberStatus = Literal["Active", "Invited", "LeaveRequested"]


class CamelModel(BaseModel):
    """Base model that serialises to camelCase to match the frontend TS types."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


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


class OrganizationOut(CamelModel):
    id: str
    name: str
    description: str
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
    read: bool
    created_at: datetime


# ---------- Team ----------
PageAccess = Literal["view", "edit"]
# Per-page access map: { "<page-key>": "view" | "edit" }.
Permissions = dict[str, PageAccess]


class InviteMemberRequest(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    role: Role = "Member"
    permissions: Permissions = {}


class UpdateRoleRequest(BaseModel):
    role: Role | None = None
    permissions: Permissions | None = None


class TeamMemberOut(CamelModel):
    id: str
    name: str
    email: EmailStr
    role: Role
    status: MemberStatus
    permissions: Permissions


class AccessOut(CamelModel):
    """The current user's effective access within their active organization."""

    is_owner: bool
    role: Role
    permissions: Permissions


# ---------- Notes ----------
class NoteCreateRequest(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    content: str = Field(min_length=1)


class NoteUpdateRequest(BaseModel):
    content: str = Field(min_length=1)


class NoteOut(CamelModel):
    id: str
    date: str
    content: str
    creator_name: str | None = None
    mine: bool = False  # created by the current user
    created_at: datetime
    updated_at: datetime


# ---------- Boards ----------
class BoardCreateRequest(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str | None = None


class BoardUpdateRequest(BaseModel):
    title: str = Field(min_length=1)


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


class BoardSummaryOut(CamelModel):
    id: str
    date: str
    title: str
    creator_name: str | None = None
    created_at: datetime
    updated_at: datetime
    box_count: int
    open_task_count: int  # tasks not yet marked done, across all boxes


class BoardDetailOut(CamelModel):
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
Schedule = Literal["Daily", "Weekly", "Biweekly", "Monthly", "Yearly"]
SectionType = Literal["text", "bulleted", "numbered"]


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


class MeetingCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    schedule: Schedule = "Weekly"
    duration: str = ""
    sections: list[MeetingSectionModel] = []


class MeetingUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    schedule: Schedule | None = None
    duration: str | None = None
    sections: list[MeetingSectionModel] | None = None


class MeetingSummaryOut(CamelModel):
    id: str
    name: str
    date: str
    schedule: Schedule
    duration: str
    creator_name: str | None = None
    section_count: int
    sections: list[MeetingSectionModel]
    created_at: datetime
    updated_at: datetime


class MeetingDetailOut(CamelModel):
    id: str
    name: str
    date: str
    schedule: Schedule
    duration: str
    mine: bool = False  # created by the current user
    sections: list[MeetingSectionModel]
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
