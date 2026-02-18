"""drop worker is_active column

Revision ID: b7d4a1e9c2f3
Revises: f1a3b7c2d9e4
Create Date: 2026-02-18 10:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7d4a1e9c2f3"
down_revision: Union[str, None] = "f1a3b7c2d9e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("worker_servers"):
        return

    columns = {col["name"] for col in inspector.get_columns("worker_servers")}
    if "is_active" in columns:
        op.drop_column("worker_servers", "is_active")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("worker_servers"):
        return

    columns = {col["name"] for col in inspector.get_columns("worker_servers")}
    if "is_active" not in columns:
        op.add_column(
            "worker_servers",
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )
