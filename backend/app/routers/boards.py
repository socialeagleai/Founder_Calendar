import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import (
    can_view_item,
    ensure_can_view,
    ensure_owns_or_edit,
    get_current_org,
    get_current_user,
    member_for,
    require_page_access,
)
from ..models import Board, BoardBox, Organization, TeamMember, User
from ..notify_service import EmailMessage, fanout, notify_mentions, notify_owner, send_later
from ..schemas import (
    BoardCopyRequest,
    BoardCreateRequest,
    BoardDetailOut,
    BoardShareOut,
    BoardSummaryOut,
    BoardUpdateRequest,
    BoxCreateRequest,
    BoxOut,
    BoxUpdateRequest,
)

router = APIRouter(prefix="/api", tags=["boards"])

# Board page access. "view" lets a member manage their own boards; "edit" also
# lets them change boards created by other members.
require_board_access = require_page_access("board")


def _board_activity(
    db: Session,
    org: Organization,
    board: Board,
    actor: User,
    verb: str,
    outbox: list[EmailMessage] | None = None,
) -> None:
    """Tell the board's creator someone else touched it.

    Coalesced to one notification per actor, per board, per hour: a working
    session is dozens of edits, and the creator wants "Bob updated Roadmap", not
    forty rows of it. The hour bucket is in the dedupe key, and notify() refreshes
    the existing unread row rather than adding another."""
    hour = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H")
    notify_owner(
        db,
        org,
        board,
        actor=actor,
        category="activity",
        message=f"{actor.name} {verb} your board: {board.title}",
        link=f"/board?id={board.id}",
        dedupe_key=f"activity:board:{board.id}:{actor.id}:{hour}",
        outbox=outbox,
    )


def _get_board(db: Session, org: Organization, board_id: str) -> Board:
    board = (
        db.query(Board)
        .filter(Board.id == board_id, Board.organization_id == org.id)
        .first()
    )
    if not board:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Board not found")
    return board


def _get_box(db: Session, org: Organization, box_id: str) -> BoardBox:
    box = (
        db.query(BoardBox)
        .join(Board, BoardBox.board_id == Board.id)
        .filter(BoardBox.id == box_id, Board.organization_id == org.id)
        .first()
    )
    if not box:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Box not found")
    return box


def _detail(board: Board, user: User) -> Board:
    board.mine = board.user_id == user.id  # type: ignore[attr-defined]
    return board


def _summary(board: Board) -> BoardSummaryOut:
    open_tasks = sum(
        1
        for box in board.boxes
        for task in (box.tasks or [])
        if not task.get("done")
    )
    return BoardSummaryOut(
        id=board.id,
        date=board.date,
        title=board.title,
        creator_name=board.creator_name,
        created_at=board.created_at,
        updated_at=board.updated_at,
        box_count=len(board.boxes),
        open_task_count=open_tasks,
        visibility=board.visibility,
        visible_departments=board.visible_departments or [],
        visible_members=board.visible_members or [],
    )


# ---------- Boards ----------
@router.get("/boards", response_model=list[BoardSummaryOut])
def list_boards(
    scope: Literal["mine", "org"] = Query(default="mine"),
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BoardSummaryOut]:
    """List boards. `scope=mine` (default) returns only the caller's own boards
    for the board list page; `scope=org` returns every member's boards for the
    shared calendar."""
    query = db.query(Board).filter(Board.organization_id == org.id)
    if scope == "mine":
        query = query.filter(Board.user_id == user.id)
        boards = query.order_by(Board.date.desc(), Board.created_at.desc()).all()
    else:
        # Shared calendar feed: drop boards the viewer isn't in the audience for.
        boards = query.order_by(Board.date.desc(), Board.created_at.desc()).all()
        member = member_for(db, org, user)
        boards = [b for b in boards if can_view_item(b, user, member)]
    return [_summary(b) for b in boards]


@router.post(
    "/boards",
    response_model=BoardDetailOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_board_access)],
)
def create_board(
    body: BoardCreateRequest,
    background: BackgroundTasks,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Board:
    board = Board(
        organization_id=org.id,
        user_id=user.id,
        date=body.date,
        title=(body.title or "Untitled board").strip() or "Untitled board",
        visibility=body.visibility,
        visible_departments=list(body.visible_departments),
        visible_members=list(body.visible_members),
    )
    db.add(board)
    db.flush()  # need the id for the link, same transaction as the fan-out
    outbox: list[EmailMessage] = []
    fanout(
        db,
        org,
        board,
        actor=user,
        category="shared",
        message=f"{user.name} added a board: {board.title}",
        link=f"/board?id={board.id}",
        dedupe_key=f"shared:board:{board.id}",
        outbox=outbox,
    )
    db.commit()
    send_later(background, outbox)
    db.refresh(board)
    return _detail(board, user)


@router.get("/boards/{board_id}", response_model=BoardDetailOut)
def get_board(
    board_id: str,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Board:
    board = _get_board(db, org, board_id)
    ensure_can_view(db, org, user, board, "board")
    return _detail(board, user)


@router.patch("/boards/{board_id}", response_model=BoardSummaryOut)
def rename_board(
    board_id: str,
    body: BoardUpdateRequest,
    background: BackgroundTasks,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_board_access),
    db: Session = Depends(get_db),
) -> BoardSummaryOut:
    board = _get_board(db, org, board_id)
    ensure_can_view(db, org, user, board, "board")
    ensure_owns_or_edit(level, board.user_id, user, "boards")
    if body.title is not None:
        board.title = body.title.strip()
    if "visibility" in body.model_fields_set:
        board.visibility = body.visibility
        board.visible_departments = list(body.visible_departments)
        board.visible_members = list(body.visible_members)
    # Only a title change is worth telling the creator about. An audience change
    # is the creator's own business, and this endpoint is also how the editor
    # saves visibility - which the creator is usually the one doing.
    outbox: list[EmailMessage] = []
    if body.title is not None:
        _board_activity(db, org, board, user, "renamed", outbox)
    db.commit()
    send_later(background, outbox)
    db.refresh(board)
    return _summary(board)


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(
    board_id: str,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_board_access),
    db: Session = Depends(get_db),
) -> None:
    board = _get_board(db, org, board_id)
    ensure_can_view(db, org, user, board, "board")
    ensure_owns_or_edit(level, board.user_id, user, "boards")
    db.delete(board)
    db.commit()
    return None


@router.post("/boards/{board_id}/share", response_model=BoardShareOut)
def share_board(
    board_id: str,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_board_access),
    db: Session = Depends(get_db),
) -> BoardShareOut:
    board = _get_board(db, org, board_id)
    ensure_can_view(db, org, user, board, "board")
    ensure_owns_or_edit(level, board.user_id, user, "boards")
    if not board.share_token:
        board.share_token = uuid.uuid4().hex
        db.commit()
        db.refresh(board)
    return BoardShareOut(token=board.share_token)


@router.post(
    "/boards/{board_id}/copy",
    response_model=BoardSummaryOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_board_access)],
)
def copy_board(
    board_id: str,
    body: BoardCopyRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BoardSummaryOut:
    source = _get_board(db, org, board_id)
    ensure_can_view(db, org, user, source, "board")
    title = (body.title or source.title).strip() or source.title
    # The copy belongs to whoever made it, not the source board's owner, and
    # keeps the source's audience so it starts out visible to the same people.
    clone = Board(
        organization_id=org.id,
        user_id=user.id,
        date=body.date,
        title=title,
        visibility=source.visibility,
        visible_departments=list(source.visible_departments or []),
        visible_members=list(source.visible_members or []),
    )
    db.add(clone)
    db.flush()
    for b in source.boxes:
        db.add(
            BoardBox(
                board_id=clone.id,
                title=b.title,
                content=b.content,
                tasks=list(b.tasks or []),
                x=b.x,
                y=b.y,
                width=b.width,
                height=b.height,
                color=b.color,
            )
        )
    db.commit()
    db.refresh(clone)
    return _summary(clone)


@router.get("/shared/boards/{token}", response_model=BoardDetailOut)
def get_shared_board(
    token: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Board:
    """View a board shared by link - only allowed if the viewer is the owner or a
    member of the board's organization (by email)."""
    board = db.query(Board).filter(Board.share_token == token).first()
    if not board:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shared board not found")
    org = db.get(Organization, board.organization_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shared board not found")
    is_owner = org.owner_id == user.id
    is_member = (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.email == user.email)
        .first()
        is not None
    )
    if not (is_owner or is_member):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You don't have access to this board. Ask the owner to add you to their organization.",
        )
    return _detail(board, user)


# ---------- Boxes ----------
@router.post(
    "/boards/{board_id}/boxes",
    response_model=BoxOut,
    status_code=status.HTTP_201_CREATED,
)
def add_box(
    board_id: str,
    body: BoxCreateRequest,
    background: BackgroundTasks,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_board_access),
    db: Session = Depends(get_db),
) -> BoardBox:
    board = _get_board(db, org, board_id)
    ensure_can_view(db, org, user, board, "board")
    ensure_owns_or_edit(level, board.user_id, user, "boards")
    box = BoardBox(
        board_id=board.id,
        title=body.title,
        content=body.content,
        tasks=[t.model_dump() for t in body.tasks],
        x=body.x,
        y=body.y,
        width=body.width,
        height=body.height,
        color=body.color,
    )
    db.add(box)
    db.flush()
    outbox: list[EmailMessage] = []
    _board_activity(db, org, board, user, "added a box to", outbox)
    notify_mentions(
        db,
        org,
        board,
        actor=user,
        text=f"{box.title or ''}\n{box.content or ''}",
        message=f"{user.name} mentioned you on {board.title}",
        link=f"/board?id={board.id}",
        item_kind="box",
        item_id=box.id,
        outbox=outbox,
    )
    db.commit()
    send_later(background, outbox)
    db.refresh(box)
    return box


# Changing any of these is something a person did to the board's content. Moving
# or resizing a box is not - and the editor PATCHes on every drag frame.
CONTENT_FIELDS = {"title", "content", "tasks", "color"}


@router.patch("/boxes/{box_id}", response_model=BoxOut)
def update_box(
    box_id: str,
    body: BoxUpdateRequest,
    background: BackgroundTasks,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_board_access),
    db: Session = Depends(get_db),
) -> BoardBox:
    box = _get_box(db, org, box_id)
    ensure_can_view(db, org, user, box.board, "board")
    ensure_owns_or_edit(level, box.board.user_id, user, "boards")
    changed = body.model_dump(exclude_unset=True)
    for field, value in changed.items():
        setattr(box, field, value)

    # The board editor persists on every drag, resize and blur, so this endpoint
    # is extremely hot. Notifying on geometry would spam the owner and run a full
    # audience fan-out per mouse-move; skipping it costs nothing anyone wants.
    outbox: list[EmailMessage] = []
    if CONTENT_FIELDS & set(changed):
        db.flush()
        _board_activity(db, org, box.board, user, "updated", outbox)
        notify_mentions(
            db,
            org,
            box.board,
            actor=user,
            text=f"{box.title or ''}\n{box.content or ''}",
            message=f"{user.name} mentioned you on {box.board.title}",
            link=f"/board?id={box.board.id}",
            item_kind="box",
            item_id=box.id,
            outbox=outbox,
        )
    db.commit()
    send_later(background, outbox)
    db.refresh(box)
    return box


@router.delete("/boxes/{box_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box(
    box_id: str,
    background: BackgroundTasks,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    level: str = Depends(require_board_access),
    db: Session = Depends(get_db),
) -> None:
    box = _get_box(db, org, box_id)
    ensure_can_view(db, org, user, box.board, "board")
    ensure_owns_or_edit(level, box.board.user_id, user, "boards")
    outbox: list[EmailMessage] = []
    _board_activity(db, org, box.board, user, "removed a box from", outbox)
    db.delete(box)
    db.commit()
    send_later(background, outbox)
    return None
