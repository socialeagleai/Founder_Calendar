"""The internal HTTP proxy every tool goes through.

A tool has already been told *which FC user* is calling (from the MCP access
token). To act as them, we mint a short-lived internal FC JWT - the same token
the web app uses - and call the real REST API. That means the production routers
enforce access control, validation and notifications; the MCP layer never
reimplements any of it.

The MCP process holds JWT_SECRET so it can mint that token. Acceptable: it is a
first-party backend service and only ever mints a token for the user who just
completed the OAuth login (first-party token exchange).
"""

from typing import Any

import httpx

from ..config import settings
from ..security import create_access_token


class ApiError(Exception):
    """A non-2xx from the REST API, carried to the tool as a clean message.

    `detail` is the API's own error text (e.g. the 422 that names an attendee who
    can't see a meeting), so the model relays a real reason, not "request failed".
    """

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"{status_code}: {detail}")


def _extract_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text or resp.reason_phrase
    if isinstance(body, dict):
        detail = body.get("detail")
        if isinstance(detail, str):
            return detail
        # FastAPI validation errors are a list of {loc, msg, ...}.
        if isinstance(detail, list):
            msgs = []
            for item in detail:
                if isinstance(item, dict) and item.get("msg"):
                    loc = item.get("loc") or []
                    field = ".".join(str(p) for p in loc if p not in ("body",))
                    msgs.append(f"{field}: {item['msg']}" if field else str(item["msg"]))
            if msgs:
                return "; ".join(msgs)
        if detail is not None:
            return str(detail)
    return resp.text or resp.reason_phrase


async def call(
    method: str,
    path: str,
    *,
    user_id: str,
    org_id: str | None = None,
    json: Any | None = None,
    params: dict[str, Any] | None = None,
) -> Any:
    """Call the REST API as `user_id`. Returns parsed JSON (or None for 204).

    Raises ApiError on any non-2xx so tools can `try/except` and surface the
    reason. `org_id` becomes the X-Org-Id header the way the web app sets it.
    """
    token = create_access_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    if org_id:
        headers["X-Org-Id"] = org_id
    base = settings.mcp_backend_url.rstrip("/")
    async with httpx.AsyncClient(base_url=base, timeout=30) as client:
        resp = await client.request(
            method, path, headers=headers, json=json, params=params
        )
    if resp.status_code >= 400:
        raise ApiError(resp.status_code, _extract_detail(resp))
    if resp.status_code == 204 or not resp.content:
        return None
    return resp.json()
