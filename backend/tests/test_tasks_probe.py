from app import tasks


class _FakeContainers:
    def __init__(self):
        self.last_kwargs = None
        self.last_args = None

    def run(self, *args, **kwargs):
        self.last_args = args
        self.last_kwargs = kwargs
        return b"ok"


class _FakeClient:
    def __init__(self):
        self.containers = _FakeContainers()


def test_run_image_probe_passes_probe_as_single_command_arg():
    client = _FakeClient()

    ok, detail = tasks._run_image_probe(client, "img:test", "if true; then :; fi")

    assert ok is True
    assert detail == ""
    assert client.containers.last_args[0] == "img:test"
    assert client.containers.last_args[1] == ["if true; then :; fi"]
    assert client.containers.last_kwargs["entrypoint"] == ["sh", "-lc"]
