import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_org, get_current_user, require_page_access
from ..models import Organization, Template, User
from ..schemas import TemplateCreateRequest, TemplateKind, TemplateOut, TemplateUpdateRequest

router = APIRouter(prefix="/api/templates", tags=["templates"])

# Templates are private to each member, so any access (view or edit) lets them
# manage their own; there are no "other people's templates" to gate.
require_templates_access = require_page_access("templates")


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _section(title: str, type_: str, *, body: str = "", items: list[tuple[str, int]] | None = None) -> dict:
    return {
        "id": _uid(),
        "title": title,
        "type": type_,
        "body": body,
        "items": [{"id": _uid(), "text": text, "level": level} for text, level in (items or [])],
    }


def _default_meeting_templates() -> list[dict]:
    """The starter meeting templates every organization gets - editable afterwards."""
    return [
        {
            "name": "Leadership Meeting",
            "data": {
                "schedule": "Weekly",
                "duration": "60–90 mins",
                "sections": [
                    _section("Attendees", "text", body="Department Heads"),
                    _section(
                        "Agenda",
                        "numbered",
                        items=[
                            ("Scorecard", 0),
                            ("Revenue", 1),
                            ("Leads", 1),
                            ("Profit", 1),
                            ("Cash", 1),
                            ("Wins", 0),
                            ("Challenges", 0),
                            ("Decisions Needed", 0),
                            ("Action Items", 0),
                        ],
                    ),
                ],
            },
        },
        {
            "name": "All Hands Meeting",
            "data": {
                "schedule": "Monthly",
                "duration": "60 mins",
                "sections": [
                    _section("Purpose", "text", body="Alignment and Culture"),
                    _section(
                        "Agenda",
                        "bulleted",
                        items=[
                            ("Company Updates", 0),
                            ("Wins", 0),
                            ("Customer Stories", 0),
                            ("New Joiners", 0),
                            ("Recognition", 0),
                            ("Next Month Priorities", 0),
                        ],
                    ),
                ],
            },
        },
        {
            "name": "1:1 Meeting",
            "data": {
                "schedule": "Biweekly",
                "duration": "30 min",
                "sections": [
                    _section(
                        "Questions",
                        "bulleted",
                        items=[
                            ("Employee", 0),
                            ("What is going well?", 1),
                            ("What is difficult?", 1),
                            ("What support do you need?", 1),
                            ("Manager", 0),
                            ("Feedback", 1),
                            ("Development", 1),
                            ("Career Growth", 1),
                        ],
                    ),
                ],
            },
        },
    ]


def _seed_defaults_if_empty(db: Session, org: Organization, user: User) -> None:
    """Give each member their own starter meeting templates the first time they
    open My Templates - templates are private per user."""
    exists = (
        db.query(Template.id)
        .filter(Template.organization_id == org.id, Template.user_id == user.id)
        .first()
    )
    if exists:
        return
    for tpl in _default_meeting_templates():
        db.add(
            Template(
                organization_id=org.id,
                user_id=user.id,
                kind="meeting",
                name=tpl["name"],
                data=tpl["data"],
            )
        )
    db.commit()


def _get_template(db: Session, org: Organization, user: User, template_id: str) -> Template:
    template = (
        db.query(Template)
        .filter(
            Template.id == template_id,
            Template.organization_id == org.id,
            Template.user_id == user.id,
        )
        .first()
    )
    if not template:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    return template


@router.get("", response_model=list[TemplateOut])
def list_templates(
    kind: TemplateKind | None = Query(default=None),
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Template]:
    _seed_defaults_if_empty(db, org, user)
    query = db.query(Template).filter(
        Template.organization_id == org.id, Template.user_id == user.id
    )
    if kind is not None:
        query = query.filter(Template.kind == kind)
    return query.order_by(Template.created_at.desc()).all()


@router.post(
    "",
    response_model=TemplateOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_templates_access)],
)
def create_template(
    body: TemplateCreateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Template:
    template = Template(
        organization_id=org.id,
        user_id=user.id,
        kind=body.kind,
        name=body.name.strip() or "Untitled template",
        data=body.data,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.patch(
    "/{template_id}",
    response_model=TemplateOut,
    dependencies=[Depends(require_templates_access)],
)
def update_template(
    template_id: str,
    body: TemplateUpdateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Template:
    template = _get_template(db, org, user, template_id)
    if body.name is not None:
        template.name = body.name.strip() or "Untitled template"
    if body.data is not None:
        template.data = body.data
    db.commit()
    db.refresh(template)
    return template


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_templates_access)],
)
def delete_template(
    template_id: str,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    template = _get_template(db, org, user, template_id)
    db.delete(template)
    db.commit()
    return None
