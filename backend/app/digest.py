"""Building the daily agenda digest.

What this can honestly say is bounded by the schema, and the boundary matters:

  - There is no time of day anywhere. Note.date, Board.date and Meeting.date are
    all VARCHAR(10) "YYYY-MM-DD". So the digest lists what is *on* today; it
    cannot say when, and it cannot sort by when.
  - Meeting.schedule ("Weekly") is a decorative label. Nothing expands it into
    occurrences - a meeting is one row on one date. So a "Weekly" standup created
    once appears in exactly one digest, ever. We do NOT expand it here: inventing
    meetings that don't exist in the database would be worse than omitting them.
  - BoardBox.tasks is a JSON blob of {id, text, done} with no assignee, so
    "your tasks today" is not expressible. Open-task counts per board are.

Content is counts and titles only - never note bodies. See email.notification_email.
"""

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session, selectinload

from .config import settings
from .deps import can_view_item, member_for
from .email import esc
from .models import Board, Meeting, Note, Organization, User
from .prefs import Prefs


@dataclass
class OrgDigest:
    """What's on one org's plate today, for one person."""

    org_name: str
    meetings: list[tuple[str, str]] = field(default_factory=list)  # (name, duration)
    note_count: int = 0
    boards: list[tuple[str, int]] = field(default_factory=list)  # (title, open tasks)

    @property
    def empty(self) -> bool:
        return not self.meetings and not self.note_count and not self.boards

    @property
    def open_tasks(self) -> int:
        return sum(n for _, n in self.boards)


def _open_tasks(board: Board) -> int:
    """Unticked tasks across a board's boxes. Has to be counted in Python: tasks
    live inside a JSON column, not as rows."""
    total = 0
    for box in board.boxes:
        for task in box.tasks or []:
            if isinstance(task, dict) and not task.get("done"):
                total += 1
    return total


def build_org_digest(
    db: Session, org: Organization, user: User, local_date: str
) -> OrgDigest:
    """Everything `user` can see in `org` dated `local_date`.

    Visibility is filtered with the same can_view_item the read path uses, so a
    digest can never mention something its recipient couldn't open."""
    member = member_for(db, org, user)
    d = OrgDigest(org_name=org.name)

    meetings = (
        db.query(Meeting)
        .filter(Meeting.organization_id == org.id, Meeting.date == local_date)
        .order_by(Meeting.created_at)  # no time-of-day exists to sort by
        .all()
    )
    d.meetings = [
        (m.name, m.duration or "") for m in meetings if can_view_item(m, user, member)
    ]

    notes = (
        db.query(Note)
        .filter(Note.organization_id == org.id, Note.date == local_date)
        .all()
    )
    d.note_count = sum(1 for n in notes if can_view_item(n, user, member))

    boards = (
        db.query(Board)
        .options(selectinload(Board.boxes))  # else one query per board for tasks
        .filter(Board.organization_id == org.id, Board.date == local_date)
        .order_by(Board.created_at)
        .all()
    )
    d.boards = [
        (b.title, _open_tasks(b)) for b in boards if can_view_item(b, user, member)
    ]
    return d


def render_digest(
    name: str, digests: list[OrgDigest], local_date: str, prefs: Prefs
) -> tuple[str, str, str]:
    """(subject, html, text) for a day's agenda across one or more orgs.

    Prefs are per user but content is per (user, org), so someone in two orgs
    gets ONE email with a section each rather than two emails."""
    # "%-d" is glibc-only and "%#d" is Windows-only, so zero-strip by hand and
    # keep this working in both the container and a dev machine.
    pretty = (
        datetime.strptime(local_date, "%Y-%m-%d").strftime("%A, %d %B").replace(" 0", " ", 1)
    )
    total_meetings = sum(len(d.meetings) for d in digests)
    total_boards = sum(len(d.boards) for d in digests)
    total_tasks = sum(d.open_tasks for d in digests)

    bits: list[str] = []
    if total_meetings:
        bits.append(f"{total_meetings} meeting{'s' if total_meetings != 1 else ''}")
    if total_boards:
        bits.append(f"{total_boards} board{'s' if total_boards != 1 else ''}")
    if total_tasks:
        bits.append(f"{total_tasks} open task{'s' if total_tasks != 1 else ''}")
    subject = f"Today: {', '.join(bits)}" if bits else f"Today, {pretty}"

    url = settings.app_base_url.rstrip("/") + "/dashboard"
    multi = len(digests) > 1

    html_parts = [
        f'<p>Hi {esc(name)},</p>',
        f'<p style="color:#666;margin:0 0 18px">{esc(pretty)}</p>',
    ]
    text_parts = [f"Hi {name},", "", pretty, ""]

    for d in digests:
        if multi:
            html_parts.append(
                f'<h3 style="margin:20px 0 8px;font-size:14px;color:#C4162A">{esc(d.org_name)}</h3>'
            )
            text_parts.append(f"[{d.org_name}]")
        if d.meetings:
            html_parts.append(
                f'<p style="margin:12px 0 4px"><strong>{len(d.meetings)} '
                f"meeting{'s' if len(d.meetings) != 1 else ''}</strong></p><ul style=\"margin:4px 0;padding-left:20px\">"
            )
            for mname, duration in d.meetings:
                suffix = f' <span style="color:#888">- {esc(duration)}</span>' if duration else ""
                html_parts.append(f"<li>{esc(mname)}{suffix}</li>")
                text_parts.append(f"  - {mname}{f' ({duration})' if duration else ''}")
            html_parts.append("</ul>")
        if d.note_count:
            line = f"{d.note_count} note{'s' if d.note_count != 1 else ''}"
            html_parts.append(f'<p style="margin:12px 0 4px"><strong>{line}</strong></p>')
            text_parts.append(f"  {line}")
        if d.boards:
            html_parts.append(
                f'<p style="margin:12px 0 4px"><strong>{len(d.boards)} '
                f"board{'s' if len(d.boards) != 1 else ''}</strong></p><ul style=\"margin:4px 0;padding-left:20px\">"
            )
            for title, tasks in d.boards:
                suffix = (
                    f' <span style="color:#888">- {tasks} open task{"s" if tasks != 1 else ""}</span>'
                    if tasks
                    else ""
                )
                html_parts.append(f"<li>{esc(title)}{suffix}</li>")
                text_parts.append(
                    f"  - {title}{f' ({tasks} open)' if tasks else ''}"
                )
            html_parts.append("</ul>")

    html = (
        '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">'
        + '<h2 style="color:#C4162A;margin:0 0 4px">Today</h2>'
        + "".join(html_parts)
        + f'<p style="margin:24px 0"><a href="{esc(url)}" style="background:#C4162A;color:#fff;'
        'text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;'
        'display:inline-block">Open Founder Calendar</a></p>'
        + '<p style="color:#999;font-size:12px;margin-top:28px;border-top:1px solid #eee;'
        "padding-top:12px\">You're getting this because Daily agenda is on. Change the time "
        'or turn it off under Settings &rarr; Preferences.</p></div>'
    )
    text_parts += ["", url, "", "Turn this off in Settings > Preferences."]
    return subject, html, "\n".join(text_parts)
