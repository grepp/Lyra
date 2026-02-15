"""add service enable flags to environments

Revision ID: 9b6fcefbc2e1
Revises: da94cb80a42a
Create Date: 2026-02-15 14:52:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9b6fcefbc2e1"
down_revision: Union[str, None] = "da94cb80a42a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("environments"):
        return

    columns = {col["name"] for col in inspector.get_columns("environments")}
    if "enable_jupyter" not in columns:
        op.add_column(
            "environments",
            sa.Column("enable_jupyter", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )
    if "enable_code_server" not in columns:
        op.add_column(
            "environments",
            sa.Column("enable_code_server", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("environments"):
        return

    columns = {col["name"] for col in inspector.get_columns("environments")}
    if "enable_code_server" in columns:
        op.drop_column("environments", "enable_code_server")
    if "enable_jupyter" in columns:
        op.drop_column("environments", "enable_jupyter")
