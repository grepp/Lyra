"""drop root_password default

Revision ID: da94cb80a42a
Revises: 271d090c7096
Create Date: 2026-02-14 03:51:27.543028

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'da94cb80a42a'
down_revision: Union[str, None] = '271d090c7096'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("environments"):
        return

    columns = {col["name"] for col in inspector.get_columns("environments")}
    if "root_password" not in columns:
        return

    op.alter_column("environments", "root_password", existing_type=sa.VARCHAR(length=50), nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("environments"):
        return

    columns = {col["name"] for col in inspector.get_columns("environments")}
    if "root_password" not in columns:
        return

    op.alter_column("environments", "root_password", existing_type=sa.VARCHAR(length=50), nullable=True)
