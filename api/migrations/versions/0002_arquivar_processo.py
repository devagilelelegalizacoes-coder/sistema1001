"""arquivar processo

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-14 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('processo', sa.Column('arquivado_em', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_processo_arquivado_em', 'processo', ['arquivado_em'])


def downgrade() -> None:
    op.drop_index('ix_processo_arquivado_em', table_name='processo')
    op.drop_column('processo', 'arquivado_em')
