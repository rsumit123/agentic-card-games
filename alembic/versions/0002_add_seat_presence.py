"""add seat presence for lifecycle departures"""

from alembic import op
import sqlalchemy as sa


revision = "0002_add_seat_presence"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("seats")}
    if "present" not in columns:
        op.add_column("seats", sa.Column("present", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("seats")}
    if "present" in columns:
        op.drop_column("seats", "present")
