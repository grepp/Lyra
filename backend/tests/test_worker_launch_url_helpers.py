from app.routers import environments as env_router


def test_build_worker_service_url_keeps_base_path_and_overrides_port():
    url = env_router._build_worker_service_url(
        "https://worker.example.com/gateway/worker",
        31111,
        "/?token=abc",
    )
    assert url == "https://worker.example.com:31111/gateway/worker/?token=abc"


def test_build_worker_service_url_brackets_ipv6_hostname():
    url = env_router._build_worker_service_url(
        "http://[2001:db8::10]:8000/prefix",
        32000,
        "/code",
    )
    assert url == "http://[2001:db8::10]:32000/prefix/code"


def test_build_worker_service_url_preserves_query_and_fragment():
    url = env_router._build_worker_service_url(
        "https://worker.example.com/base",
        30000,
        "/lab/tree?token=abc#section-1",
    )
    assert url == "https://worker.example.com:30000/base/lab/tree?token=abc#section-1"


def test_parse_worker_service_port_accepts_int_and_numeric_string():
    assert env_router._parse_worker_service_port(8888) == 8888
    assert env_router._parse_worker_service_port("8888") == 8888
    assert env_router._parse_worker_service_port("  8888  ") == 8888


def test_parse_worker_service_port_rejects_invalid_values():
    assert env_router._parse_worker_service_port(0) is None
    assert env_router._parse_worker_service_port(-1) is None
    assert env_router._parse_worker_service_port("0") is None
    assert env_router._parse_worker_service_port("abc") is None
    assert env_router._parse_worker_service_port(None) is None
