"""Serialise schema creation across processes.

The API and the MCP server share one database and either may start first. Two
`create_all()` calls hitting an *empty* database at the same moment race on
Postgres's internal type creation and one fails with a duplicate-key error on
`pg_type`. A session-level advisory lock makes them take turns: the first creates
the tables, the second finds them already there (create_all is checkfirst) and
does nothing. On a non-empty database create_all issues no DDL, so this only ever
matters on the very first boot - but that's exactly when both containers race.
"""

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase

# Arbitrary but fixed 64-bit key; shared by every process that creates schema.
_LOCK_KEY = 0x0F0C_CA1E_DA7A_0001 - (1 << 63)


def create_all_locked(engine: Engine, base: type[DeclarativeBase]) -> None:
    """Run metadata.create_all under a cross-process advisory lock (Postgres);
    on other backends, just create_all."""
    if engine.dialect.name != "postgresql":
        base.metadata.create_all(bind=engine)
        return
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
        base.metadata.create_all(bind=conn)
