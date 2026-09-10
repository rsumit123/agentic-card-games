"""Let a seated player sit out without giving up the seat.

Revision ID: 0004_add_seat_sitting_out
Revises: 0003_add_hand_outcomes
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_add_seat_sitting_out"
down_revision = "0003_add_hand_outcomes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0001 builds the schema straight from the models, so on a fresh database
    # this column already exists by the time we get here. Same guard 0002 uses.
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("seats")}
    if "sitting_out" not in columns:
        op.add_column("seats", sa.Column("sitting_out", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("seats")}
    if "sitting_out" in columns:
        op.drop_column("seats", "sitting_out")
