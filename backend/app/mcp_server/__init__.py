"""Remote MCP server for Founder Calendar.

An OAuth 2.1 authorization server + Streamable-HTTP MCP server that lets any MCP
client (Claude, etc.) act on a user's calendar through natural language. It is a
thin, OAuth-gated proxy in front of the existing REST API: a tool resolves the
signed-in user from its access token, mints a short-lived internal FC JWT for
that user, and calls the real backend over HTTP. The production routers stay the
single source of truth for access control, validation and notifications.
"""
