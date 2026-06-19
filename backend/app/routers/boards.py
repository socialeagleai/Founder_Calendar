import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_org, get_current_user, require_page_edit
from ..models import Board, BoardBox, Organization, TeamMember, User
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

# Boards (and their boxes) are edited from the Board page.
require_board_edit = require_page_edit("board")


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
        created_at=board.created_at,
        updated_at=board.updated_at,
        box_count=len(board.boxes),
        open_task_count=open_tasks,
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
    return [_summary(b) for b in boards]


@router.post(
    "/boards",
    response_model=BoardDetailOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_board_edit)],
)
def create_board(
    body: BoardCreateRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Board:
    board = Board(
        organization_id=org.id,
        user_id=user.id,
        date=body.date,
        title=(body.title or "Untitled board").strip() or "Untitled board",
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


@router.get("/boards/{board_id}", response_model=BoardDetailOut)
def get_board(
    board_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Board:
    return _get_board(db, org, board_id)


@router.patch(
    "/boards/{board_id}",
    response_model=BoardSummaryOut,
    dependencies=[Depends(require_board_edit)],
)
def rename_board(
    board_id: str,
    body: BoardUpdateRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> BoardSummaryOut:
    board = _get_board(db, org, board_id)
    board.title = body.title.strip()
    db.commit()
    db.refresh(board)
    return _summary(board)


@router.delete(
    "/boards/{board_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_board_edit)],
)
def delete_board(
    board_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    board = _get_board(db, org, board_id)
    db.delete(board)
    db.commit()
    return None


@router.post(
    "/boards/{board_id}/share",
    response_model=BoardShareOut,
    dependencies=[Depends(require_board_edit)],
)
def share_board(
    board_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> BoardShareOut:
    board = _get_board(db, org, board_id)
    if not board.share_token:
        board.share_token = uuid.uuid4().hex
        db.commit()
        db.refresh(board)
    return BoardShareOut(token=board.share_token)


@router.post(
    "/boards/{board_id}/copy",
    response_model=BoardSummaryOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_board_edit)],
)
def copy_board(
    board_id: str,
    body: BoardCopyRequest,
    org: Organization = Depends(get_current_org),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BoardSummaryOut:
    source = _get_board(db, org, board_id)
    title = (body.title or source.title).strip() or source.title
    # The copy belongs to whoever made it, not the source board's owner.
    clone = Board(organization_id=org.id, user_id=user.id, date=body.date, title=title)
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
    """View a board shared by link — only allowed if the viewer is the owner or a
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
    return board


# ---------- Boxes ----------
@router.post(
    "/boards/{board_id}/boxes",
    response_model=BoxOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_board_edit)],
)
def add_box(
    board_id: str,
    body: BoxCreateRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> BoardBox:
    board = _get_board(db, org, board_id)
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
    db.commit()
    db.refresh(box)
    return box


@router.patch("/boxes/{box_id}", response_model=BoxOut, dependencies=[Depends(require_board_edit)])
def update_box(
    box_id: str,
    body: BoxUpdateRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> BoardBox:
    box = _get_box(db, org, box_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(box, field, value)
    db.commit()
    db.refresh(box)
    return box


@router.delete(
    "/boxes/{box_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_board_edit)],
)
def delete_box(
    box_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    box = _get_box(db, org, box_id)
    db.delete(box)
    db.commit()
    return None
