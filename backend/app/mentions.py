"""Parsing @handle mentions out of free text.

Handles, not names. Matching bare names (`@Priya Nair`) cannot be made to work:
`@Sam` prefix-matches Samantha, a name containing a space makes the grammar
ambiguous (where does `@Priya went home` end?), `user@sam` and email addresses in
prose fire falsely, and renaming someone silently orphans every mention of them.

So each TeamMember gets a handle: lowercase, no spaces, unique within the org.
That makes the grammar unambiguous and the match exact. The regex deliberately
over-captures - `@9am`, `@here`, `@gmail` all match it - and the roster lookup is
what filters: anything that doesn't resolve to a real handle simply isn't a
mention. Collisions are impossible by construction rather than by heuristic.
"""

import re
import unicodedata

# @handle, where the @ must start the string or follow whitespace/open-punctuation.
# That leading boundary is what stops `user@sam` and `bob@gmail.com` from firing.
MENTION_RE = re.compile(r"(?:(?<=^)|(?<=[\s(\[{,;:>]))@([a-z0-9_]{2,32})\b", re.IGNORECASE)

# Reserved so they can become "@everyone"-style broadcasts later without someone
# having squatted the handle in the meantime.
RESERVED_HANDLES = {"all", "here", "everyone", "channel", "team", "admin", "owner"}

# One save shouldn't be able to notify the whole company via a wall of @s.
MAX_MENTIONS_PER_SAVE = 10

HANDLE_RE = re.compile(r"^[a-z0-9_]{2,32}$")


def extract_handles(text: str) -> list[str]:
    """The distinct handles mentioned in `text`, lowercased, in first-seen order.

    Over-captures on purpose - resolve against the org roster to find the real
    mentions."""
    if not text:
        return []
    out: list[str] = []
    for m in MENTION_RE.finditer(text):
        h = m.group(1).lower()
        if h not in out:
            out.append(h)
        if len(out) >= MAX_MENTIONS_PER_SAVE:
            break
    return out


def slugify_handle(name: str) -> str:
    """A base handle from a display name: "Priya Nair" -> "priya_nair".

    Strips accents rather than dropping them, so "José" gives "jose" instead of
    "jos"."""
    decomposed = unicodedata.normalize("NFKD", name or "")
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_only.lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)[:32].strip("_")
    # Fall back for names that leave nothing usable (e.g. entirely non-latin).
    if len(slug) < 2 or not HANDLE_RE.match(slug):
        return "member"
    return slug


def unique_handle(base: str, taken: set[str]) -> str:
    """`base`, or base2/base3/... until it's free within the org. Reserved words
    are treated as taken."""
    blocked = {t.lower() for t in taken} | RESERVED_HANDLES
    if base not in blocked:
        return base
    for n in range(2, 1000):
        suffix = str(n)
        # Keep inside the 32-char column even after the suffix.
        candidate = f"{base[: 32 - len(suffix)]}{suffix}"
        if candidate not in blocked:
            return candidate
    raise ValueError("Could not allocate a unique handle")
