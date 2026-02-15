"""add encrypted root password

Revision ID: 8f2a1e4a9d3b
Revises: c3b5c9f8a2d1
Create Date: 2026-02-15 16:17:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from cryptography.fernet import Fernet
import os


# revision identifiers, used by Alembic.
revision: str = "8f2a1e4a9d3b"
down_revision: Union[str, None] = "c3b5c9f8a2d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _get_fernet() -> Fernet:
    key = os.getenv("APP_SECRET_KEY", "").strip()
    if not key:
        raise RuntimeError("APP_SECRET_KEY is required for root password migration")
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as error:
        raise RuntimeError("APP_SECRET_KEY is invalid for Fernet") from error


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("environments"):
        return

    columns = {col["name"] for col in inspector.get_columns("environments")}
    if "root_password_encrypted" not in columns:
        op.add_column("environments", sa.Column("root_password_encrypted", sa.Text(), nullable=True))

    fernet = _get_fernet()
    rows = bind.execute(
        sa.text(
            """
            SELECT id, root_password
            FROM environments
            WHERE root_password_encrypted IS NULL
            """
        )
    ).fetchall()

    for row in rows:
        root_password = row.root_password or ""
        encrypted = fernet.encrypt(root_password.encode("utf-8")).decode("utf-8")
        bind.execute(
            sa.text(
                """
                UPDATE environments
                SET root_password_encrypted = :encrypted,
                    root_password = :redacted
                WHERE id = :id
                """
            ),
            {"encrypted": encrypted, "redacted": "__redacted__", "id": row.id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("environments"):
        return

    columns = {col["name"] for col in inspector.get_columns("environments")}
    if "root_password_encrypted" in columns:
        op.drop_column("environments", "root_password_encrypted")
