"""The engine Install chip must target the interpreter the backend runs under.

#529/#527: the desktop spawns `<venv>/bin/python -m uvicorn` WITHOUT exporting
VIRTUAL_ENV, so bare `uv pip install` finds no venv and 500s with "No virtual
environment found". run_pip must pass `--python sys.executable`.
"""
import asyncio
import sys
import subprocess
from unittest.mock import AsyncMock, Mock

import pytest

from services import translation_engines as te


class _FakeProc:
    returncode = 0

    async def communicate(self):
        return (b"ok", b"")


def _run_capturing(monkeypatch, args):
    """Force the uv branch + capture the spawned argv; return (rc, argv)."""
    captured = {}
    monkeypatch.setattr(te.shutil, "which", lambda name: "/usr/bin/uv" if name == "uv" else None)

    async def fake_exec(*argv, **kwargs):
        captured["argv"] = list(argv)
        return _FakeProc()

    monkeypatch.setattr(te.asyncio, "create_subprocess_exec", fake_exec)
    rc, _out = asyncio.run(te.run_pip(args))
    return rc, captured.get("argv", [])


def test_run_pip_pins_uv_install_to_sys_executable(monkeypatch):
    rc, argv = _run_capturing(monkeypatch, ["install", "deep_translator"])
    assert rc == 0
    assert argv[:3] == ["uv", "pip", "install"], argv
    assert "--python" in argv, argv
    assert argv[argv.index("--python") + 1] == sys.executable


def test_run_pip_pins_uv_uninstall_to_sys_executable(monkeypatch):
    _rc, argv = _run_capturing(monkeypatch, ["uninstall", "deep_translator"])
    assert "--python" in argv, argv
    assert argv[argv.index("--python") + 1] == sys.executable


@pytest.mark.parametrize("flag", ["-y", "--yes"])
def test_uv_uninstall_omits_pip_only_confirmation_flag(monkeypatch, flag):
    args = ["uninstall", flag, "deep_translator"]
    rc, argv = _run_capturing(monkeypatch, args)
    assert rc == 0
    assert flag not in argv
    assert args == ["uninstall", flag, "deep_translator"]


def test_pip_fallback_keeps_confirmation_flag(monkeypatch):
    monkeypatch.setattr(te.shutil, "which", lambda _: None)
    spawn = AsyncMock(return_value=_FakeProc())
    monkeypatch.setattr(te.asyncio, "create_subprocess_exec", spawn)
    assert asyncio.run(te.run_pip(["uninstall", "-y", "deep_translator"])) == (0, "ok")
    assert spawn.call_args.args == (
        sys.executable, "-m", "pip", "uninstall", "-y", "deep_translator",
    )


@pytest.mark.parametrize("already_exited", [False, True])
def test_async_timeout_reaps_the_installer(monkeypatch, already_exited):
    proc = Mock()
    proc.communicate = AsyncMock(side_effect=[asyncio.TimeoutError, (b"stopped", None)])
    if already_exited:
        proc.kill.side_effect = ProcessLookupError
    monkeypatch.setattr(te.asyncio, "create_subprocess_exec", AsyncMock(return_value=proc))

    assert asyncio.run(te.run_pip(["install", "deep_translator"], timeout=1)) == (
        1, "pip timed out after 1s",
    )
    proc.kill.assert_called_once_with()
    assert proc.communicate.await_count == 2


def test_thread_fallback_reports_a_missing_installer(monkeypatch):
    monkeypatch.setattr(te.asyncio, "create_subprocess_exec", AsyncMock(side_effect=NotImplementedError))
    monkeypatch.setattr(te.subprocess, "Popen", Mock(side_effect=FileNotFoundError("installer missing")))

    rc, output = asyncio.run(te.run_pip(["install", "deep_translator"]))
    assert rc == 1
    assert "installer not found" in output


def test_thread_timeout_reaps_the_installer(monkeypatch):
    proc = Mock()
    proc.communicate.side_effect = [subprocess.TimeoutExpired("installer", 1), (b"stopped", None)]
    monkeypatch.setattr(te.asyncio, "create_subprocess_exec", AsyncMock(side_effect=NotImplementedError))
    monkeypatch.setattr(te.subprocess, "Popen", Mock(return_value=proc))

    assert asyncio.run(te.run_pip(["install", "deep_translator"], timeout=1)) == (
        1, "pip timed out after 1s",
    )
    proc.kill.assert_called_once_with()
    assert proc.communicate.call_count == 2


@pytest.mark.parametrize("thread_fallback", [False, True])
def test_timeout_stops_a_real_child_without_running_an_installer(monkeypatch, thread_fallback):
    children = []
    if thread_fallback:
        original = te.subprocess.Popen

        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            return child

        monkeypatch.setattr(te.subprocess, "Popen", spawn)
        monkeypatch.setattr(te.asyncio, "create_subprocess_exec", AsyncMock(side_effect=NotImplementedError))
    else:
        original = te.asyncio.create_subprocess_exec

        async def spawn(*args, **kwargs):
            child = await original(*args, **kwargs)
            children.append(child)
            return child

        monkeypatch.setattr(te.asyncio, "create_subprocess_exec", spawn)

    # Run a harmless owned sleeper, never pip or uv and never a package install.
    monkeypatch.setattr(te, "_installer_cmd", lambda: [sys.executable, "-c", "import time; time.sleep(60)"])
    rc, output = asyncio.run(te.run_pip([], timeout=0.1))
    assert rc == 1
    assert "timed out" in output
    assert len(children) == 1
    assert children[0].returncode is not None
