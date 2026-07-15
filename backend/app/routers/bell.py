"""The notification bell's single read endpoint.

The bell polls on an interval from every open tab. It used to do that with four
separate requests (invitations, leave requests, notifications, orgs), each one
independently decoding the JWT, loading the user, and re-resolving the active
org - roughly 15 queries per tick for data that is almost always unchanged.

This composes the same per-feed builders the individual endpoints use, so the
two can never drift apart, and pays the auth cost once.
"""

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, resolve_active_org
from ..models import User
from ..schemas import BellOut, NotificationOut
from .invitations import invitations_for
from .leave_requests import leave_requests_for
from .notifications import unread_for
from .organization import memberships_for

router = APIRouter(prefix="/api/bell", tags=["bell"])


@router.get("", response_model=BellOut)
def get_bell(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> BellOut:
    """Everything the bell renders, in one round trip."""
    # Not get_current_org: that 404s when the user belongs to no org, and the
    # bell must still work during onboarding (it's how they see their invites).
    org = resolve_active_org(db, user, x_org_id)
    return BellOut(
        invitations=invitations_for(db, user),
        leave_requests=leave_requests_for(db, user),
        # The other three builders already return schema objects; this one returns
        # ORM rows, so convert explicitly rather than lean on nested coercion.
        notifications=[
            NotificationOut.model_validate(n)
            for n in unread_for(db, user, org.id if org else None)
        ],
        orgs=memberships_for(db, user),
    )
