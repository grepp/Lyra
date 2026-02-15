from app.routers.environments import _resolve_environment_status


def test_running_container_promotes_to_running():
    assert (
        _resolve_environment_status(
            current_status="building",
            container_status="running",
            state_status="running",
            exit_code=None,
            oom_killed=False,
            error_msg="",
        )
        == "running"
    )


def test_starting_container_keeps_starting_when_state_is_transitional():
    assert (
        _resolve_environment_status(
            current_status="starting",
            container_status="created",
            state_status="starting",
            exit_code=None,
            oom_killed=False,
            error_msg="",
        )
        == "starting"
    )


def test_exit_137_with_error_is_error():
    assert (
        _resolve_environment_status(
            current_status="running",
            container_status="exited",
            state_status="exited",
            exit_code=137,
            oom_killed=True,
            error_msg="OOMKilled",
        )
        == "error"
    )


def test_exit_143_is_stopped():
    assert (
        _resolve_environment_status(
            current_status="running",
            container_status="exited",
            state_status="exited",
            exit_code=143,
            oom_killed=False,
            error_msg="",
        )
        == "stopped"
    )
