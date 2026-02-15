import asyncio

from app.routers.environments import _collect_used_gpu_indices


class _ScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _ExecuteResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _ScalarResult(self._items)


class _FakeEnv:
    def __init__(self, status: str, gpu_indices):
        self.status = status
        self.gpu_indices = gpu_indices


class _FakeDb:
    def __init__(self, envs):
        self._envs = envs

    async def execute(self, *_args, **_kwargs):
        return _ExecuteResult(self._envs)


def test_collect_used_gpu_indices_includes_creating_and_excludes_stopped():
    db = _FakeDb(
        [
            _FakeEnv("creating", [0]),
            _FakeEnv("building", [1]),
            _FakeEnv("running", [2]),
            _FakeEnv("starting", [3]),
            _FakeEnv("stopped", [4]),
            _FakeEnv("error", [5]),
        ]
    )

    used = asyncio.run(_collect_used_gpu_indices(db))

    assert used == {0, 1, 2, 3}
