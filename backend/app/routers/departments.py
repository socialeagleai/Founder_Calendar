from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_org, require_page_edit
from ..models import Department, Organization, TeamMember
from ..schemas import CreateDepartmentRequest, DepartmentOut

router = APIRouter(prefix="/api/departments", tags=["departments"])

# Managing departments is part of running the team, so reuse the team-edit gate.
require_team_edit = require_page_edit("team")


@router.get("", response_model=list[DepartmentOut])
def list_departments(
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> list[Department]:
    return (
        db.query(Department)
        .filter(Department.organization_id == org.id)
        .order_by(Department.created_at)
        .all()
    )


@router.post(
    "",
    response_model=DepartmentOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_team_edit)],
)
def create_department(
    body: CreateDepartmentRequest,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Department:
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Department name is required")
    clash = (
        db.query(Department)
        .filter(Department.organization_id == org.id, Department.name == name)
        .first()
    )
    if clash:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A department with this name already exists"
        )
    dept = Department(organization_id=org.id, name=name)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.delete(
    "/{dept_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_team_edit)],
)
def delete_department(
    dept_id: str,
    org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> None:
    dept = (
        db.query(Department)
        .filter(Department.id == dept_id, Department.organization_id == org.id)
        .first()
    )
    if not dept:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    # Unassign anyone in this department first (the ALTER-added column has no FK
    # constraint on existing tables, so do it explicitly rather than rely on
    # ON DELETE SET NULL).
    db.query(TeamMember).filter(
        TeamMember.organization_id == org.id, TeamMember.department_id == dept_id
    ).update({TeamMember.department_id: None})
    db.delete(dept)
    db.commit()
    return None
