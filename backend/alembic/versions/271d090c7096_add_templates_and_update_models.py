"""Add templates and update models

Revision ID: 271d090c7096
Revises:
Create Date: 2026-02-01 11:37:20.070066

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '271d090c7096'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # This revision is the base revision in this project. On fresh databases,
    # templates may not exist yet, so DROP must be conditional.
    if inspector.has_table("templates"):
        op.drop_table("templates")

    op.create_table(
        "templates",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("templates"):
        return

    op.add_column("templates", sa.Column("content", sa.TEXT(), autoincrement=False, nullable=False))
    op.create_index(op.f("ix_templates_id"), "templates", ["id"], unique=False)
    op.alter_column(
        "templates",
        "id",
        existing_type=sa.UUID(),
        type_=sa.INTEGER(),
        existing_nullable=False,
    )
    op.drop_column("templates", "created_at")
    op.drop_column("templates", "config")
    op.drop_column("templates", "description")
