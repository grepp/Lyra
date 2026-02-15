"""add unique constraint on environment name

Revision ID: c3b5c9f8a2d1
Revises: 9b6fcefbc2e1
Create Date: 2026-02-15 15:36:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c3b5c9f8a2d1"
down_revision: Union[str, None] = "9b6fcefbc2e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if not inspector.has_table("environments"):
        return

    unique_constraints = inspector.get_unique_constraints("environments")
    unique_names = {uc.get("name") for uc in unique_constraints if uc.get("name")}
    if "uq_environments_name" in unique_names:
        return

    conn.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id, name, row_number() OVER (PARTITION BY name ORDER BY created_at, id) AS rn
                FROM environments
            )
            UPDATE environments e
            SET name = CONCAT(LEFT(e.name, 246), '-', LEFT(CAST(e.id AS text), 8))
            FROM ranked r
            WHERE e.id = r.id AND r.rn > 1
            """
        )
    )
    op.create_unique_constraint("uq_environments_name", "environments", ["name"])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if not inspector.has_table("environments"):
        return

    unique_constraints = inspector.get_unique_constraints("environments")
    unique_names = {uc.get("name") for uc in unique_constraints if uc.get("name")}
    if "uq_environments_name" not in unique_names:
        return

    op.drop_constraint("uq_environments_name", "environments", type_="unique")
