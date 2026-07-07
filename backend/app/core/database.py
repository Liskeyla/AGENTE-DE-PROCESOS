import asyncio

from sqlalchemy import event, pool
from sqlalchemy.exc import OperationalError, PendingRollbackError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

_engine_kwargs: dict = {"echo": settings.DEBUG}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    _engine_kwargs["poolclass"] = pool.NullPool
else:
    _engine_kwargs["pool_pre_ping"] = True

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

if _is_sqlite:

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _is_locked_error(exc: BaseException) -> bool:
    return "locked" in str(exc).lower()


async def safe_rollback(session: AsyncSession) -> None:
    try:
        await session.rollback()
    except Exception:
        pass


async def commit_checkpoint(session: AsyncSession, retries: int = 5) -> None:
    """Confirma cambios y libera el lock de SQLite entre pasos largos (LLM, etc.)."""
    for attempt in range(retries):
        try:
            await session.commit()
            return
        except (OperationalError, PendingRollbackError) as exc:
            await safe_rollback(session)
            if attempt < retries - 1 and _is_locked_error(exc):
                await asyncio.sleep(0.4 * (attempt + 1))
                continue
            raise


async def flush_with_retry(session: AsyncSession, retries: int = 5) -> None:
    for attempt in range(retries):
        try:
            await session.flush()
            return
        except (OperationalError, PendingRollbackError) as exc:
            await safe_rollback(session)
            if attempt < retries - 1 and _is_locked_error(exc):
                await asyncio.sleep(0.4 * (attempt + 1))
                continue
            raise


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await commit_checkpoint(session)
        except Exception:
            await safe_rollback(session)
            raise
        finally:
            await session.close()
