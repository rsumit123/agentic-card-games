"""Record how each seat finished each hand.

Revision ID: 0003_add_hand_outcomes
Revises: 0002_add_seat_presence
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_add_hand_outcomes"
down_revision = "0002_add_seat_presence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0001 builds the schema straight from the models, so on a fresh database
    # this table already exists by the time we get here. Same guard 0002 uses.
    bind = op.get_bind()
    if sa.inspect(bind).has_table("hand_outcomes"):
        return
    op.create_table(
        "hand_outcomes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hand_id", sa.Integer(), sa.ForeignKey("hands.id"), nullable=False, index=True),
        sa.Column("table_id", sa.Integer(), sa.ForeignKey("tables.id"), nullable=False, index=True),
        sa.Column("seat_number", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("actor_type", sa.String(length=16), nullable=False, server_default="human"),
        sa.Column("ai_tier", sa.String(length=16), nullable=True),
        sa.Column("opponent_tiers", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("net_chips", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("won", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("went_to_showdown", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("hand_outcomes"):
        op.drop_table("hand_outcomes")
