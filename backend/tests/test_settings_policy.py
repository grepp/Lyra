import asyncio

import pytest
from fastapi import HTTPException

from app.models import Setting
from app.routers.settings import get_setting, get_settings, update_setting
from app.schemas import SettingUpdate


class _ScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items

    def first(self):
        return self._items[0] if self._items else None


class _ExecuteResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _ScalarResult(self._items)


class _FakeDb:
    def __init__(self, items=None):
        self._items = items or []
        self.execute_called = False

    async def execute(self, *_args, **_kwargs):
        self.execute_called = True
        return _ExecuteResult(self._items)

    async def commit(self):
        return None

    async def refresh(self, _setting):
        return None

    def add(self, setting):
        self._items.append(setting)


def test_get_settings_filters_internal_keys():
    settings = [
        Setting(key="app_name", value="Lyra"),
        Setting(key="jupyter_token:abc", value="secret"),
        Setting(key="custom_ports:xyz", value="[]"),
        Setting(key="ssh_username", value="root"),
        Setting(key="unknown_key", value="x"),
    ]
    db = _FakeDb(settings)

    result = asyncio.run(get_settings(db=db))

    keys = [item.key for item in result]
    assert keys == ["app_name", "ssh_username"]


def test_get_setting_blocks_internal_key_access():
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_setting("jupyter_token:abc", db=db))

    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "protected_setting_key"
    assert db.execute_called is False


def test_get_setting_rejects_unsupported_key():
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_setting("unknown_key", db=db))

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "unsupported_setting_key"
    assert db.execute_called is False


def test_update_setting_rejects_unsupported_key():
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(update_setting("unknown_key", SettingUpdate(value="x"), db=db))

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "unsupported_setting_key"
    assert db.execute_called is False


def test_update_setting_rejects_invalid_key():
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(update_setting("  ", SettingUpdate(value="x"), db=db))

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_setting_key"
    assert db.execute_called is False
