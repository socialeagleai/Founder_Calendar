"""Every MCP tool, registered on the FastMCP instance.

Each tool is a thin wrapper: figure out who's calling and which org, call the
real REST API as them (api_client), and reshape the response into a compact
result. The API enforces access control, validation, recurrence and the
invite/reminder fan-out, so the tools inherit all of it.

Reshaping keeps results small and stable: the raw API payloads carry internal
fields (audience lists, section documents, timestamps) the model rarely needs,
and trimming them saves tokens and avoids leaking incidental structure.
"""

import uuid
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from mcp.server.fastmcp import FastMCP

from . import store
from .api_client import ApiError, call
from .context import caller, org_for


def _new_id() -> str:
    """Ids for agenda sections/points and checklist items are minted here, in the
    same 12-hex-char shape the backend uses. The client must never invent them:
    a guessed id silently overwrites or duplicates a real row."""
    return uuid.uuid4().hex[:12]


def _safe_zone(name: str | None):
    try:
        return ZoneInfo(name) if name else ZoneInfo("UTC")
    except Exception:
        return ZoneInfo("UTC")


async def _org_today(user_id: str, org_id: str | None) -> tuple[str, str]:
    """Return (today_iso, org_id) using the org's own timezone, so 'today' near
    midnight is the org's day, not the server's."""
    org = await call("GET", "/api/organization", user_id=user_id, org_id=org_id)
    if not org:
        raise ApiError(404, "You don't belong to any organization yet.")
    today = datetime.now(_safe_zone(org.get("timezone"))).date().isoformat()
    return today, org["id"]


# ---------- reshapers ----------
def _meeting_brief(m: dict) -> dict:
    out = {
        "id": m["id"],
        "name": m["name"],
        "date": m.get("date"),
        "startTime": m.get("startTime") or None,
        "schedule": m.get("schedule"),
        "duration": m.get("duration") or None,
        "attendees": m.get("attendees") or [],
        "visibility": m.get("visibility"),
    }
    if m.get("occurrences"):
        out["occurrences"] = m["occurrences"]
    return {k: v for k, v in out.items() if v is not None}


def _note_brief(n: dict) -> dict:
    return {
        "id": n["id"],
        "date": n.get("date"),
        "content": n.get("content"),
        "creator": n.get("creatorName"),
        "visibility": n.get("visibility"),
    }


def _board_brief(b: dict) -> dict:
    out = {
        "id": b["id"],
        "date": b.get("date"),
        "title": b.get("title"),
        "visibility": b.get("visibility"),
    }
    if "boxCount" in b:
        out["boxCount"] = b["boxCount"]
        out["openTasks"] = b.get("openTaskCount")
    return out


def _section_brief(s: dict) -> dict:
    out = {
        "id": s.get("id"),
        "title": s.get("title") or None,
        "type": s.get("type"),
        "points": [
            {"id": i.get("id"), "text": i.get("text"), "level": i.get("level", 0)}
            for i in (s.get("items") or [])
        ],
    }
    if s.get("body"):
        out["body"] = s["body"]
    return {k: v for k, v in out.items() if v is not None}


def _box_brief(x: dict) -> dict:
    return {
        "id": x["id"],
        "title": x.get("title") or None,
        "content": x.get("content") or None,
        "tasks": x.get("tasks") or [],
        "color": x.get("color"),
    }


def _member_brief(t: dict) -> dict:
    return {
        "id": t["id"],
        "name": t["name"],
        "email": t.get("email"),
        "handle": t.get("handle"),
        "role": t.get("role"),
        "status": t.get("status"),
        "departmentId": t.get("departmentId"),
        "permissions": t.get("permissions") or {},
    }


def _template_brief(t: dict, include_data: bool = False) -> dict:
    out = {
        "id": t["id"],
        "kind": t.get("kind"),
        "name": t.get("name"),
        "updatedAt": t.get("updatedAt"),
    }
    if include_data:
        out["data"] = t.get("data") or {}
    return out


def register_tools(mcp: FastMCP) -> None:
    # ================= context =================
    @mcp.tool()
    async def whoami() -> dict:
        """Who the caller is and which Founder Calendar organizations they belong
        to. Call this first if you're unsure which org to act in."""
        user_id, active_org, _ = caller()
        me = await call("GET", "/api/auth/me", user_id=user_id)
        orgs = await call("GET", "/api/organizations", user_id=user_id) or []
        return {
            "user": {"id": me["id"], "name": me["name"], "email": me["email"]},
            "activeOrg": active_org,
            "organizations": [
                {"id": o["id"], "name": o["name"], "role": o.get("role"),
                 "isOwner": o.get("isOwner")}
                for o in orgs
            ],
        }

    @mcp.tool()
    async def list_organizations() -> list[dict]:
        """List the organizations the user belongs to, with their role in each."""
        user_id, _, _ = caller()
        orgs = await call("GET", "/api/organizations", user_id=user_id) or []
        return [
            {"id": o["id"], "name": o["name"], "role": o.get("role"),
             "isOwner": o.get("isOwner")}
            for o in orgs
        ]

    @mcp.tool()
    async def set_active_org(organization_id: str) -> dict:
        """Choose which organization subsequent tools act in (persists for this
        connection). Use an id from list_organizations."""
        user_id, _, raw_token = caller()
        orgs = await call("GET", "/api/organizations", user_id=user_id) or []
        match = next((o for o in orgs if o["id"] == organization_id), None)
        if not match:
            raise ApiError(403, "You don't belong to that organization.")
        store.set_active_org(raw_token, organization_id)
        return {"activeOrg": organization_id, "name": match["name"]}

    # ================= agenda =================
    @mcp.tool()
    async def get_agenda(
        date: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Everything on the calendar for a day or range: meetings (recurrence
        expanded), notes and boards. With no arguments, uses today in the org's
        timezone. Dates are YYYY-MM-DD."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        today, org_id = await _org_today(user_id, org_id)
        lo = start_date or date or today
        hi = end_date or date or today

        def in_range(d: str | None) -> bool:
            return bool(d) and lo <= d <= hi

        meetings = await call(
            "GET", "/api/meetings", user_id=user_id, org_id=org_id, params={"scope": "org"}
        ) or []
        notes = await call("GET", "/api/notes", user_id=user_id, org_id=org_id) or []
        boards = await call("GET", "/api/boards", user_id=user_id, org_id=org_id) or []

        day_meetings = []
        for m in meetings:
            hits = [d for d in (m.get("occurrences") or [m.get("date")]) if in_range(d)]
            for d in hits:
                day_meetings.append({**_meeting_brief(m), "on": d})
        day_meetings.sort(key=lambda x: (x["on"], x.get("startTime") or "99:99"))

        return {
            "range": {"from": lo, "to": hi},
            "meetings": day_meetings,
            "notes": [_note_brief(n) for n in notes if in_range(n.get("date"))],
            "boards": [_board_brief(b) for b in boards if in_range(b.get("date"))],
        }

    @mcp.tool()
    async def list_upcoming_meetings(
        days: int = 7, organization_id: str | None = None
    ) -> list[dict]:
        """Meetings happening in the next N days (default 7), each with the exact
        date it falls on. Recurrence is expanded."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        today, org_id = await _org_today(user_id, org_id)
        hi = (datetime.fromisoformat(today).date() + timedelta(days=max(0, days))).isoformat()
        meetings = await call(
            "GET", "/api/meetings", user_id=user_id, org_id=org_id, params={"scope": "org"}
        ) or []
        rows = []
        for m in meetings:
            for d in m.get("occurrences") or []:
                if today <= d <= hi:
                    rows.append({"on": d, **_meeting_brief(m)})
        rows.sort(key=lambda x: (x["on"], x.get("startTime") or "99:99"))
        return rows

    # ================= meetings =================
    @mcp.tool()
    async def list_meetings(
        scope: str = "mine", organization_id: str | None = None
    ) -> list[dict]:
        """List meetings. scope='mine' (default) lists the user's own meetings;
        scope='org' lists every meeting they can see across the org."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        ms = await call(
            "GET", "/api/meetings", user_id=user_id, org_id=org_id,
            params={"scope": "org" if scope == "org" else "mine"},
        ) or []
        return [_meeting_brief(m) for m in ms]

    @mcp.tool()
    async def get_meeting(meeting_id: str, organization_id: str | None = None) -> dict:
        """Full details of one meeting, including its agenda sections."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        m = await call(
            "GET", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id
        )
        out = _meeting_brief(m)
        out["sections"] = m.get("sections") or []
        return out

    @mcp.tool()
    async def create_meeting(
        name: str,
        date: str,
        start_time: str = "",
        schedule: str = "Weekly",
        duration: str = "",
        attendees: list[str] | None = None,
        visibility: str = "everyone",
        visible_departments: list[str] | None = None,
        visible_members: list[str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Create a meeting. date is YYYY-MM-DD (the first occurrence / anchor);
        start_time is 'HH:MM' 24h in the org timezone ('' = no set time, so no
        reminder). schedule is one of Daily, Weekly, Biweekly, Monthly, Yearly,
        Once. attendees are TeamMember ids (from list_team) who get an invite now
        and a reminder 30 min before each occurrence; the creator is reminded too.
        An attendee who can't see the meeting is rejected — widen visibility or
        drop them. visibility is everyone|departments|members|private."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body = {
            "name": name,
            "date": date,
            "startTime": start_time,
            "schedule": schedule,
            "duration": duration,
            "attendees": attendees or [],
            "visibility": visibility,
            "visibleDepartments": visible_departments or [],
            "visibleMembers": visible_members or [],
            "sections": [],
        }
        m = await call("POST", "/api/meetings", user_id=user_id, org_id=org_id, json=body)
        return _meeting_brief(m)

    @mcp.tool()
    async def update_meeting(
        meeting_id: str,
        name: str | None = None,
        date: str | None = None,
        start_time: str | None = None,
        schedule: str | None = None,
        duration: str | None = None,
        visibility: str | None = None,
        visible_departments: list[str] | None = None,
        visible_members: list[str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Change fields of a meeting. Only the arguments you pass are updated.
        Changing visibility also requires visible_departments/visible_members when
        the new visibility is 'departments' or 'members'."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if date is not None:
            body["date"] = date
        if start_time is not None:
            body["startTime"] = start_time
        if schedule is not None:
            body["schedule"] = schedule
        if duration is not None:
            body["duration"] = duration
        if visibility is not None:
            body["visibility"] = visibility
            body["visibleDepartments"] = visible_departments or []
            body["visibleMembers"] = visible_members or []
        if not body:
            raise ApiError(400, "Nothing to update — pass at least one field.")
        m = await call(
            "PATCH", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id, json=body
        )
        return _meeting_brief(m)

    @mcp.tool()
    async def add_attendees(
        meeting_id: str, attendee_ids: list[str], organization_id: str | None = None
    ) -> dict:
        """Add people to a meeting (TeamMember ids from list_team). New attendees
        get an invite immediately and a reminder before each occurrence. Anyone
        who can't see the meeting is rejected."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        current = await call(
            "GET", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id
        )
        merged = list(dict.fromkeys((current.get("attendees") or []) + attendee_ids))
        m = await call(
            "PATCH", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id,
            json={"attendees": merged},
        )
        return _meeting_brief(m)

    @mcp.tool()
    async def remove_attendees(
        meeting_id: str, attendee_ids: list[str], organization_id: str | None = None
    ) -> dict:
        """Remove people from a meeting's attendee list (TeamMember ids)."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        current = await call(
            "GET", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id
        )
        drop = set(attendee_ids)
        kept = [a for a in (current.get("attendees") or []) if a not in drop]
        m = await call(
            "PATCH", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id,
            json={"attendees": kept},
        )
        return _meeting_brief(m)

    @mcp.tool()
    async def copy_meeting(
        meeting_id: str,
        date: str,
        name: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Duplicate a meeting onto a new date (YYYY-MM-DD). The copy keeps the
        agenda and audience but starts with no attendees (nobody is silently
        re-invited)."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body = {"date": date}
        if name is not None:
            body["name"] = name
        m = await call(
            "POST", f"/api/meetings/{meeting_id}/copy", user_id=user_id, org_id=org_id, json=body
        )
        return _meeting_brief(m)

    @mcp.tool()
    async def delete_meeting(meeting_id: str, organization_id: str | None = None) -> dict:
        """Delete a meeting permanently."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call("DELETE", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id)
        return {"deleted": meeting_id}

    # ================= agenda (sections + items) =================
    # The agenda is one JSON document on the meeting, so every edit is
    # read-modify-write on the whole `sections` list. These tools exist so a
    # client never has to resend the document itself: sending the whole agenda to
    # change one bullet invites clobbering a teammate's concurrent edit and
    # invents ids that collide with real ones.
    async def _load_sections(user_id, org_id, meeting_id) -> list[dict]:
        m = await call(
            "GET", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id
        )
        return list(m.get("sections") or [])

    async def _save_sections(user_id, org_id, meeting_id, sections) -> dict:
        m = await call(
            "PATCH", f"/api/meetings/{meeting_id}", user_id=user_id, org_id=org_id,
            json={"sections": sections},
        )
        return {"id": m["id"], "name": m["name"],
                "sections": [_section_brief(s) for s in (m.get("sections") or [])]}

    def _find_section(sections: list[dict], section_id: str) -> dict:
        for s in sections:
            if s.get("id") == section_id:
                return s
        raise ApiError(404, f"No agenda section {section_id} on this meeting.")

    @mcp.tool()
    async def get_agenda_document(
        meeting_id: str, organization_id: str | None = None
    ) -> dict:
        """The meeting's full agenda: every section with its id, and every point
        with its id and level. Call this to get the ids the other agenda tools
        need."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        return {"meetingId": meeting_id, "sections": [_section_brief(s) for s in sections]}

    @mcp.tool()
    async def add_agenda_section(
        meeting_id: str,
        title: str,
        type: str = "bulleted",
        body: str = "",
        items: list[str] | None = None,
        position: int | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Add a topic (section) to a meeting's agenda.

        type: "bulleted" (default), "numbered", or "text". Use "text" for prose
        and put it in `body`; the other two hold `items` (the points).
        items: the points to start with, as plain strings.
        position: 0-based index to insert at; omit to append at the end."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        section = {
            "id": _new_id(),
            "title": title,
            "type": type,
            "body": body,
            "items": [
                {"id": _new_id(), "text": t, "level": 0} for t in (items or [])
            ],
        }
        if position is None or position >= len(sections):
            sections.append(section)
        else:
            sections.insert(max(0, position), section)
        return await _save_sections(user_id, org_id, meeting_id, sections)

    @mcp.tool()
    async def update_agenda_section(
        meeting_id: str,
        section_id: str,
        title: str | None = None,
        type: str | None = None,
        body: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Rename an agenda section, change its type, or replace its text body.
        Only the fields you pass change; the section's points are untouched."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        section = _find_section(sections, section_id)
        if title is None and type is None and body is None:
            raise ApiError(400, "Nothing to update — pass title, type and/or body.")
        if title is not None:
            section["title"] = title
        if type is not None:
            section["type"] = type
        if body is not None:
            section["body"] = body
        return await _save_sections(user_id, org_id, meeting_id, sections)

    @mcp.tool()
    async def delete_agenda_section(
        meeting_id: str, section_id: str, organization_id: str | None = None
    ) -> dict:
        """Remove a section from the agenda, along with all of its points."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        _find_section(sections, section_id)  # 404 rather than a silent no-op
        return await _save_sections(
            user_id, org_id, meeting_id,
            [s for s in sections if s.get("id") != section_id],
        )

    @mcp.tool()
    async def reorder_agenda_sections(
        meeting_id: str, section_ids: list[str], organization_id: str | None = None
    ) -> dict:
        """Reorder the agenda. Pass every section id in the order you want. Any
        section you leave out keeps its content and is appended at the end rather
        than deleted."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        by_id = {s.get("id"): s for s in sections}
        unknown = [i for i in section_ids if i not in by_id]
        if unknown:
            raise ApiError(404, f"Not sections of this meeting: {', '.join(unknown)}")
        ordered = [by_id[i] for i in section_ids]
        ordered += [s for s in sections if s.get("id") not in set(section_ids)]
        return await _save_sections(user_id, org_id, meeting_id, ordered)

    @mcp.tool()
    async def add_agenda_points(
        meeting_id: str,
        section_id: str,
        points: list[str],
        level: int = 0,
        position: int | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Add points to an agenda section.

        level: 0 for a normal point, 1 for a sub-point indented under the one
        above it. To build a nested list, call this once per level rather than
        trying to express nesting inside the strings.
        position: 0-based index within the section; omit to append."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        section = _find_section(sections, section_id)
        items = list(section.get("items") or [])
        new = [{"id": _new_id(), "text": t, "level": int(level)} for t in points]
        if position is None or position >= len(items):
            items.extend(new)
        else:
            items[max(0, position):max(0, position)] = new
        section["items"] = items
        return await _save_sections(user_id, org_id, meeting_id, sections)

    @mcp.tool()
    async def update_agenda_point(
        meeting_id: str,
        section_id: str,
        point_id: str,
        text: str | None = None,
        level: int | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Edit one point: change its wording, or indent/outdent it by setting
        level to 1 (sub-point) or 0 (top level)."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        section = _find_section(sections, section_id)
        if text is None and level is None:
            raise ApiError(400, "Nothing to update — pass text and/or level.")
        for item in section.get("items") or []:
            if item.get("id") == point_id:
                if text is not None:
                    item["text"] = text
                if level is not None:
                    item["level"] = int(level)
                return await _save_sections(user_id, org_id, meeting_id, sections)
        raise ApiError(404, f"No point {point_id} in that section.")

    @mcp.tool()
    async def delete_agenda_points(
        meeting_id: str,
        section_id: str,
        point_ids: list[str],
        organization_id: str | None = None,
    ) -> dict:
        """Delete one or more points from an agenda section."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        sections = await _load_sections(user_id, org_id, meeting_id)
        section = _find_section(sections, section_id)
        items = section.get("items") or []
        wanted = set(point_ids)
        missing = wanted - {i.get("id") for i in items}
        if missing:
            raise ApiError(404, f"Not points in that section: {', '.join(sorted(missing))}")
        section["items"] = [i for i in items if i.get("id") not in wanted]
        return await _save_sections(user_id, org_id, meeting_id, sections)

    # ================= notes =================
    @mcp.tool()
    async def list_notes(
        date: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        organization_id: str | None = None,
    ) -> list[dict]:
        """Calendar notes the user can see, optionally filtered to a day or range
        (YYYY-MM-DD)."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        notes = await call("GET", "/api/notes", user_id=user_id, org_id=org_id) or []
        lo = start_date or date
        hi = end_date or date
        if lo or hi:
            lo = lo or "0000-00-00"
            hi = hi or "9999-99-99"
            notes = [n for n in notes if n.get("date") and lo <= n["date"] <= hi]
        return [_note_brief(n) for n in notes]

    @mcp.tool()
    async def create_note(
        date: str,
        content: str,
        visibility: str = "everyone",
        visible_departments: list[str] | None = None,
        visible_members: list[str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Add a note to a calendar date (YYYY-MM-DD). visibility is
        everyone|departments|members|private."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body = {
            "date": date,
            "content": content,
            "visibility": visibility,
            "visibleDepartments": visible_departments or [],
            "visibleMembers": visible_members or [],
        }
        n = await call("POST", "/api/notes", user_id=user_id, org_id=org_id, json=body)
        return _note_brief(n)

    @mcp.tool()
    async def update_note(
        note_id: str,
        content: str,
        visibility: str | None = None,
        visible_departments: list[str] | None = None,
        visible_members: list[str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Replace a note's content. content is required.

        The audience is left exactly as it was unless you pass `visibility` —
        editing the wording of a private note must never widen who can read it."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {"content": content}
        # The API only reassigns the audience when `visibility` is present in the
        # payload (it checks model_fields_set), so omitting these keys preserves
        # it. Sending a default here would silently republish a private note to
        # the whole org on a pure text edit.
        if visibility is not None:
            body["visibility"] = visibility
            body["visibleDepartments"] = visible_departments or []
            body["visibleMembers"] = visible_members or []
        n = await call("PUT", f"/api/notes/{note_id}", user_id=user_id, org_id=org_id, json=body)
        return _note_brief(n)

    @mcp.tool()
    async def delete_note(note_id: str, organization_id: str | None = None) -> dict:
        """Delete a calendar note."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call("DELETE", f"/api/notes/{note_id}", user_id=user_id, org_id=org_id)
        return {"deleted": note_id}

    # ================= boards =================
    @mcp.tool()
    async def list_boards(organization_id: str | None = None) -> list[dict]:
        """List the user's boards (OneNote-style date boards)."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        boards = await call("GET", "/api/boards", user_id=user_id, org_id=org_id) or []
        return [_board_brief(b) for b in boards]

    @mcp.tool()
    async def get_board(board_id: str, organization_id: str | None = None) -> dict:
        """A board with all its boxes (each box has a title, content and tasks)."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        b = await call("GET", f"/api/boards/{board_id}", user_id=user_id, org_id=org_id)
        out = _board_brief(b)
        out["boxes"] = [_box_brief(x) for x in (b.get("boxes") or [])]
        return out

    @mcp.tool()
    async def create_board(
        date: str,
        title: str | None = None,
        visibility: str = "everyone",
        visible_departments: list[str] | None = None,
        visible_members: list[str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Create a board on a calendar date (YYYY-MM-DD)."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {
            "date": date,
            "visibility": visibility,
            "visibleDepartments": visible_departments or [],
            "visibleMembers": visible_members or [],
        }
        if title is not None:
            body["title"] = title
        b = await call("POST", "/api/boards", user_id=user_id, org_id=org_id, json=body)
        return _board_brief(b)

    @mcp.tool()
    async def add_box(
        board_id: str,
        title: str = "",
        content: str = "",
        tasks: list[dict] | None = None,
        color: str = "default",
        organization_id: str | None = None,
    ) -> dict:
        """Add a box to a board. tasks is a list of {text, done} checklist items."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        norm_tasks = [
            {"id": t.get("id") or _new_id(), "text": t.get("text", ""),
             "done": bool(t.get("done"))}
            for t in (tasks or [])
        ]
        body = {"title": title, "content": content, "tasks": norm_tasks, "color": color}
        x = await call(
            "POST", f"/api/boards/{board_id}/boxes", user_id=user_id, org_id=org_id, json=body
        )
        return _box_brief(x)

    @mcp.tool()
    async def update_box(
        box_id: str,
        title: str | None = None,
        content: str | None = None,
        tasks: list[dict] | None = None,
        color: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Update a box's title, content, checklist or color. Only fields you pass
        change."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if content is not None:
            body["content"] = content
        if tasks is not None:
            body["tasks"] = [
                {"id": t.get("id") or _new_id(), "text": t.get("text", ""),
                 "done": bool(t.get("done"))}
                for t in tasks
            ]
        if color is not None:
            body["color"] = color
        if not body:
            raise ApiError(400, "Nothing to update — pass at least one field.")
        x = await call("PATCH", f"/api/boxes/{box_id}", user_id=user_id, org_id=org_id, json=body)
        return _box_brief(x)

    # ---- box checklists ----
    # A box's tasks are one JSON list, so these are read-modify-write like the
    # agenda. Reading a single box needs no GET endpoint: PATCH with an empty
    # body uses exclude_unset, so nothing is written and no activity notification
    # fires - it returns the box as-is.
    async def _load_box(user_id, org_id, box_id) -> dict:
        return await call(
            "PATCH", f"/api/boxes/{box_id}", user_id=user_id, org_id=org_id, json={}
        )

    async def _save_tasks(user_id, org_id, box_id, tasks) -> dict:
        x = await call(
            "PATCH", f"/api/boxes/{box_id}", user_id=user_id, org_id=org_id,
            json={"tasks": tasks},
        )
        return _box_brief(x)

    @mcp.tool()
    async def add_box_tasks(
        box_id: str,
        texts: list[str],
        position: int | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Add checklist items to a box, keeping the ones already there.
        position is a 0-based index; omit to append at the end."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        tasks = list((await _load_box(user_id, org_id, box_id)).get("tasks") or [])
        new = [{"id": _new_id(), "text": t, "done": False} for t in texts]
        if position is None or position >= len(tasks):
            tasks.extend(new)
        else:
            tasks[max(0, position):max(0, position)] = new
        return await _save_tasks(user_id, org_id, box_id, tasks)

    @mcp.tool()
    async def update_box_task(
        box_id: str,
        task_id: str,
        text: str | None = None,
        done: bool | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Reword a checklist item or tick/untick it, leaving the rest alone."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        tasks = list((await _load_box(user_id, org_id, box_id)).get("tasks") or [])
        if text is None and done is None:
            raise ApiError(400, "Nothing to update — pass text and/or done.")
        for t in tasks:
            if t.get("id") == task_id:
                if text is not None:
                    t["text"] = text
                if done is not None:
                    t["done"] = bool(done)
                return await _save_tasks(user_id, org_id, box_id, tasks)
        raise ApiError(404, f"No checklist item {task_id} in that box.")

    @mcp.tool()
    async def delete_box_tasks(
        box_id: str, task_ids: list[str], organization_id: str | None = None
    ) -> dict:
        """Delete checklist items from a box."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        tasks = list((await _load_box(user_id, org_id, box_id)).get("tasks") or [])
        wanted = set(task_ids)
        missing = wanted - {t.get("id") for t in tasks}
        if missing:
            raise ApiError(404, f"Not items in that box: {', '.join(sorted(missing))}")
        return await _save_tasks(
            user_id, org_id, box_id, [t for t in tasks if t.get("id") not in wanted]
        )

    @mcp.tool()
    async def delete_box(box_id: str, organization_id: str | None = None) -> dict:
        """Delete a box from its board."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call("DELETE", f"/api/boxes/{box_id}", user_id=user_id, org_id=org_id)
        return {"deleted": box_id}

    @mcp.tool()
    async def update_board(
        board_id: str,
        title: str | None = None,
        visibility: str | None = None,
        visible_departments: list[str] | None = None,
        visible_members: list[str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Rename a board or change who can see it. Only what you pass changes —
        the audience is untouched unless you pass `visibility`."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if visibility is not None:
            body["visibility"] = visibility
            body["visibleDepartments"] = visible_departments or []
            body["visibleMembers"] = visible_members or []
        if not body:
            raise ApiError(400, "Nothing to update — pass title and/or visibility.")
        b = await call(
            "PATCH", f"/api/boards/{board_id}", user_id=user_id, org_id=org_id, json=body
        )
        return _board_brief(b)

    @mcp.tool()
    async def copy_board(
        board_id: str,
        date: str,
        title: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Copy a board (with all its boxes and checklists) onto another date.
        The copy belongs to you and starts with the same audience as the source."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {"date": date}
        if title is not None:
            body["title"] = title
        b = await call(
            "POST", f"/api/boards/{board_id}/copy", user_id=user_id, org_id=org_id, json=body
        )
        return _board_brief(b)

    @mcp.tool()
    async def share_board(board_id: str, organization_id: str | None = None) -> dict:
        """Create (or fetch) a PUBLIC read-only link to a board.

        Anyone with the link can read the board without signing in — it is not
        limited to the organization. Only do this when the user has clearly asked
        to share a board publicly. Reuses the existing link if one exists."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        res = await call(
            "POST", f"/api/boards/{board_id}/share", user_id=user_id, org_id=org_id
        )
        return {"boardId": board_id, "shareToken": res["token"],
                "note": "Anyone with this token can read the board without signing in."}

    @mcp.tool()
    async def delete_board(board_id: str, organization_id: str | None = None) -> dict:
        """Delete a board and all its boxes."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call("DELETE", f"/api/boards/{board_id}", user_id=user_id, org_id=org_id)
        return {"deleted": board_id}

    # ================= team =================
    @mcp.tool()
    async def list_team(organization_id: str | None = None) -> list[dict]:
        """List team members in the org, with their ids — use these ids as meeting
        attendees."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        team = await call("GET", "/api/team", user_id=user_id, org_id=org_id) or []
        return [_member_brief(t) for t in team]

    @mcp.tool()
    async def invite_team_member(
        name: str,
        email: str,
        role: str = "Member",
        department_id: str | None = None,
        permissions: dict[str, str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Invite someone to the organization. They are created with status
        "Invited" until they sign up with this email.

        role: "Member" or "Admin" (an Owner cannot be invited or created).
        permissions: per-page access, e.g. {"calendar": "edit", "team": "view"}.
        The only levels are "view" and "edit" — to deny a page, leave it out
        rather than passing "none". Use list_departments for department_id."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {"name": name, "email": email, "role": role}
        if department_id is not None:
            body["departmentId"] = department_id
        if permissions is not None:
            body["permissions"] = permissions
        member = await call(
            "POST", "/api/team", user_id=user_id, org_id=org_id, json=body
        )
        return _member_brief(member)

    @mcp.tool()
    async def update_team_member(
        member_id: str,
        role: str | None = None,
        permissions: dict[str, str] | None = None,
        department_id: str | None = None,
        unassign_department: bool = False,
        organization_id: str | None = None,
    ) -> dict:
        """Change a team member's role, per-page permissions or department.

        Only the fields you pass are changed. The Owner cannot be edited, and no
        one can be promoted to Owner. To clear someone's department pass
        unassign_department=True (passing department_id=None leaves it alone,
        since omitting a field means "no change")."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {}
        if role is not None:
            body["role"] = role
        if permissions is not None:
            body["permissions"] = permissions
        if unassign_department:
            body["departmentId"] = None
        elif department_id is not None:
            body["departmentId"] = department_id
        if not body:
            raise ApiError(400, "Nothing to update - pass at least one field.")
        member = await call(
            "PATCH", f"/api/team/{member_id}", user_id=user_id, org_id=org_id, json=body
        )
        return _member_brief(member)

    @mcp.tool()
    async def remove_team_member(
        member_id: str, organization_id: str | None = None
    ) -> dict:
        """Remove someone from the organization. The Owner cannot be removed.
        Their pending notifications are cleared; they can be re-invited later."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call("DELETE", f"/api/team/{member_id}", user_id=user_id, org_id=org_id)
        return {"removed": member_id}

    # ================= departments =================
    @mcp.tool()
    async def list_departments(organization_id: str | None = None) -> list[dict]:
        """List departments in the org, with their ids — use these for
        department-scoped visibility and for assigning team members."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        depts = await call("GET", "/api/departments", user_id=user_id, org_id=org_id) or []
        return [{"id": d["id"], "name": d["name"]} for d in depts]

    @mcp.tool()
    async def create_department(
        name: str, organization_id: str | None = None
    ) -> dict:
        """Create a department. Names must be unique within the organization."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        dept = await call(
            "POST", "/api/departments", user_id=user_id, org_id=org_id,
            json={"name": name},
        )
        return {"id": dept["id"], "name": dept["name"]}

    @mcp.tool()
    async def delete_department(
        department_id: str, organization_id: str | None = None
    ) -> dict:
        """Delete a department. Anyone in it is unassigned rather than removed
        from the organization."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call(
            "DELETE", f"/api/departments/{department_id}", user_id=user_id, org_id=org_id
        )
        return {"deleted": department_id}

    # ================= templates =================
    @mcp.tool()
    async def list_templates(
        kind: str | None = None,
        include_data: bool = False,
        organization_id: str | None = None,
    ) -> list[dict]:
        """List the caller's saved templates. kind is "board" or "meeting"; omit
        for both. Templates are per-user, not shared across the org.

        The full body is omitted by default because it can be large — pass
        include_data=True when you actually need to read or copy it."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        params = {"kind": kind} if kind else None
        rows = await call(
            "GET", "/api/templates", user_id=user_id, org_id=org_id, params=params
        ) or []
        return [_template_brief(t, include_data=include_data) for t in rows]

    @mcp.tool()
    async def create_template(
        kind: str,
        name: str,
        data: dict | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Save a template. kind is "board" or "meeting".

        `data` is the template body and its shape depends on kind — a meeting
        template holds its agenda sections, a board template its boxes. Read an
        existing one with list_templates(include_data=True) to copy the shape
        rather than inventing it."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        tpl = await call(
            "POST", "/api/templates", user_id=user_id, org_id=org_id,
            json={"kind": kind, "name": name, "data": data or {}},
        )
        return _template_brief(tpl, include_data=True)

    @mcp.tool()
    async def update_template(
        template_id: str,
        name: str | None = None,
        data: dict | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Rename a template or replace its body. `data` REPLACES the whole body
        rather than merging, so read the current one first if you mean to edit
        part of it."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if data is not None:
            body["data"] = data
        if not body:
            raise ApiError(400, "Nothing to update - pass name and/or data.")
        tpl = await call(
            "PATCH", f"/api/templates/{template_id}", user_id=user_id, org_id=org_id,
            json=body,
        )
        return _template_brief(tpl, include_data=True)

    @mcp.tool()
    async def delete_template(
        template_id: str, organization_id: str | None = None
    ) -> dict:
        """Delete one of the caller's templates."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call(
            "DELETE", f"/api/templates/{template_id}", user_id=user_id, org_id=org_id
        )
        return {"deleted": template_id}

    # ================= organization =================
    @mcp.tool()
    async def get_organization(organization_id: str | None = None) -> dict:
        """The active organization's details, including the timezone that meeting
        times and reminders are interpreted in."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        org = await call("GET", "/api/organization", user_id=user_id, org_id=org_id)
        if not org:
            raise ApiError(404, "You don't belong to any organization yet.")
        return {
            "id": org["id"],
            "name": org["name"],
            "description": org.get("description") or None,
            "timezone": org.get("timezone"),
            "ownerId": org.get("ownerId"),
        }

    @mcp.tool()
    async def create_organization(name: str, description: str = "") -> dict:
        """Create a new organization. The caller becomes its Owner. A user may own
        several. Use set_active_org afterwards to work in it."""
        user_id, _, _ = caller()
        org = await call(
            "POST", "/api/organization", user_id=user_id,
            json={"name": name, "description": description},
        )
        return {"id": org["id"], "name": org["name"], "timezone": org.get("timezone")}

    @mcp.tool()
    async def update_organization(
        name: str | None = None,
        description: str | None = None,
        timezone: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        """Rename the organization, change its description, or set its timezone.

        timezone is an IANA name like "Asia/Kolkata" and is org-wide: it decides
        what a meeting's start time means and when the 30-minute reminders fire,
        for everyone.

        Only the fields you pass change. (The underlying API requires name and
        description together, so the current values are read and merged first —
        setting just the timezone must not blank the name.)"""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        current = await call("GET", "/api/organization", user_id=user_id, org_id=org_id)
        if not current:
            raise ApiError(404, "You don't belong to any organization yet.")
        body: dict[str, Any] = {
            "name": name if name is not None else current["name"],
            "description": (
                description if description is not None
                else (current.get("description") or "")
            ),
        }
        if timezone is not None:
            body["timezone"] = timezone
        org = await call(
            "PATCH", "/api/organization", user_id=user_id, org_id=org_id, json=body
        )
        return {
            "id": org["id"],
            "name": org["name"],
            "description": org.get("description") or None,
            "timezone": org.get("timezone"),
        }

    @mcp.tool()
    async def leave_organization(organization_id: str | None = None) -> dict:
        """Request to leave the organization. This does not remove you outright —
        it flags the membership and the owner approves it. An owner cannot leave
        their own organization."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        res = await call(
            "POST", "/api/organization/leave", user_id=user_id, org_id=org_id
        )
        return {"detail": (res or {}).get("detail", "Leave request sent.")}

    # ================= invitations & leave requests =================
    @mcp.tool()
    async def list_invitations() -> list[dict]:
        """Organizations that have invited the caller and are awaiting a reply."""
        user_id, _, _ = caller()
        rows = await call("GET", "/api/invitations", user_id=user_id) or []
        return [
            {"id": r["id"], "organizationId": r.get("organizationId"),
             "organizationName": r.get("organizationName"), "role": r.get("role")}
            for r in rows
        ]

    @mcp.tool()
    async def accept_invitation(invitation_id: str) -> dict:
        """Join an organization the caller was invited to."""
        user_id, _, _ = caller()
        r = await call("POST", f"/api/invitations/{invitation_id}/accept", user_id=user_id)
        return {"joined": (r or {}).get("organizationName"),
                "organizationId": (r or {}).get("organizationId")}

    @mcp.tool()
    async def decline_invitation(invitation_id: str) -> dict:
        """Decline an invitation to join an organization."""
        user_id, _, _ = caller()
        await call("POST", f"/api/invitations/{invitation_id}/decline", user_id=user_id)
        return {"declined": invitation_id}

    @mcp.tool()
    async def list_leave_requests() -> list[dict]:
        """Members asking to leave an organization the caller owns, awaiting
        approval. `id` is the team member id."""
        user_id, _, _ = caller()
        rows = await call("GET", "/api/leave-requests", user_id=user_id) or []
        return [
            {"id": r["id"], "organizationId": r.get("organizationId"),
             "organizationName": r.get("organizationName"),
             "memberName": r.get("memberName"), "memberEmail": r.get("memberEmail")}
            for r in rows
        ]

    @mcp.tool()
    async def accept_leave_request(member_id: str) -> dict:
        """Approve a member's request to leave — this REMOVES them from the
        organization."""
        user_id, _, _ = caller()
        await call("POST", f"/api/leave-requests/{member_id}/accept", user_id=user_id)
        return {"removed": member_id}

    @mcp.tool()
    async def decline_leave_request(member_id: str) -> dict:
        """Decline a member's request to leave; they stay in the organization."""
        user_id, _, _ = caller()
        r = await call("POST", f"/api/leave-requests/{member_id}/decline", user_id=user_id)
        return {"detail": (r or {}).get("detail", "Leave request declined.")}

    # ================= notifications & profile =================
    @mcp.tool()
    async def list_notifications(organization_id: str | None = None) -> list[dict]:
        """The caller's unread in-app notifications, newest first."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        rows = await call(
            "GET", "/api/notifications", user_id=user_id, org_id=org_id
        ) or []
        return [
            {"id": r["id"], "message": r.get("message"), "type": r.get("type"),
             "link": r.get("link") or None, "createdAt": r.get("createdAt")}
            for r in rows
        ]

    @mcp.tool()
    async def dismiss_notification(
        notification_id: str, organization_id: str | None = None
    ) -> dict:
        """Mark one notification as read."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        await call(
            "POST", f"/api/notifications/{notification_id}/dismiss",
            user_id=user_id, org_id=org_id,
        )
        return {"dismissed": notification_id}

    @mcp.tool()
    async def get_notification_preferences() -> dict:
        """The caller's notification settings: which categories are on, whether
        email/push are enabled, and when the daily digest is sent."""
        user_id, _, _ = caller()
        return await call("GET", "/api/notifications/preferences", user_id=user_id)

    @mcp.tool()
    async def update_notification_preferences(
        shared_with_me: bool | None = None,
        activity: bool | None = None,
        mentions: bool | None = None,
        daily_agenda: bool | None = None,
        meeting_invites: bool | None = None,
        meeting_reminders: bool | None = None,
        email_enabled: bool | None = None,
        push_enabled: bool | None = None,
        digest_hour: int | None = None,
        timezone: str | None = None,
    ) -> dict:
        """Change notification settings. Only what you pass changes.

        digest_hour is 0-23 and timezone is an IANA name — both are personal and
        control the daily agenda email only, unlike the org-wide timezone that
        decides meeting times."""
        user_id, _, _ = caller()
        body = {
            k: v
            for k, v in {
                "sharedWithMe": shared_with_me,
                "activity": activity,
                "mentions": mentions,
                "dailyAgenda": daily_agenda,
                "meetingInvites": meeting_invites,
                "meetingReminders": meeting_reminders,
                "emailEnabled": email_enabled,
                "pushEnabled": push_enabled,
                "digestHour": digest_hour,
                "timezone": timezone,
            }.items()
            if v is not None
        }
        if not body:
            raise ApiError(400, "Nothing to update — pass at least one setting.")
        return await call(
            "PATCH", "/api/notifications/preferences", user_id=user_id, json=body
        )

    @mcp.tool()
    async def get_my_access(organization_id: str | None = None) -> dict:
        """What the caller is allowed to do in the active org: their role, whether
        they own it, and their per-page permissions. Useful before attempting an
        edit that might be refused."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        return await call("GET", "/api/auth/access", user_id=user_id, org_id=org_id)

    @mcp.tool()
    async def update_profile(
        name: str | None = None, email: str | None = None
    ) -> dict:
        """Change the caller's own display name or sign-in email.

        Password changes are deliberately not available here: an AI client
        already acts as the user, so setting a password gains nothing, while a
        misread instruction would lock them out of their own account. Direct them
        to Settings → Profile in the app instead."""
        user_id, _, _ = caller()
        me = await call("GET", "/api/auth/me", user_id=user_id)
        if name is None and email is None:
            raise ApiError(400, "Nothing to update — pass name and/or email.")
        # PATCH /profile requires both fields; send the current value for the one
        # not being changed rather than blanking it.
        body = {
            "name": name if name is not None else me["name"],
            "email": email if email is not None else me["email"],
        }
        u = await call("PATCH", "/api/auth/profile", user_id=user_id, json=body)
        return {"id": u["id"], "name": u["name"], "email": u["email"]}

    @mcp.tool()
    async def delete_organization(
        confirm_name: str, organization_id: str | None = None
    ) -> dict:
        """PERMANENTLY delete an organization and everything in it — every
        meeting, note, board, template and team member. This cannot be undone and
        affects every member, not just you. Owner only.

        To prevent an ambiguous instruction from destroying a workspace,
        confirm_name must exactly match the organization's current name. Confirm
        with the user before calling this; never infer it from a vague request."""
        user_id, active_org, _ = caller()
        org_id = org_for(organization_id, active_org)
        org = await call("GET", "/api/organization", user_id=user_id, org_id=org_id)
        if not org:
            raise ApiError(404, "You don't belong to any organization yet.")
        if confirm_name.strip() != org["name"]:
            raise ApiError(
                400,
                f'confirm_name does not match. To delete this organization pass '
                f'its exact name: "{org["name"]}".',
            )
        await call("DELETE", "/api/organization", user_id=user_id, org_id=org_id)
        return {"deleted": org["id"], "name": org["name"]}
