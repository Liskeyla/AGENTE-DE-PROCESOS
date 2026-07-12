"""Datos iniciales opcionales para entornos de demostración."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.user import Organization, User, UserRole


async def ensure_demo_user(session: AsyncSession) -> None:
    email = "demo@empresa.com"
    result = await session.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        return

    org = Organization(name="Empresa Demo")
    session.add(org)
    await session.flush()

    user = User(
        organization_id=org.id,
        email=email,
        password_hash=hash_password("demo1234"),
        full_name="Usuario Demo",
        role=UserRole.ADMIN,
    )
    session.add(user)
    await session.commit()
