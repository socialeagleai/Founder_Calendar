"""ASGI entrypoint for the remote MCP server.

    uvicorn app.mcp_main:app --host 0.0.0.0 --port 9000

Runs as its own container (founder_cal_mcp) from the same image as the API. It
talks to the same Postgres and reaches the REST API over the compose network
(MCP_BACKEND_URL). MCP_ISSUER_URL must be the public URL clients reach.
"""

from .mcp_server.server import build_app

app = build_app()
