"""Helpers for safely importing cowdao-cowpy submodules."""

from __future__ import annotations

import importlib.machinery
import importlib.metadata
import sys
import types


def ensure_cowpy_submodule_imports() -> None:
    """Register the cowdao-cowpy package without executing its side-effectful __init__."""
    if "cowdao_cowpy" in sys.modules:
        return

    # cowdao-cowpy 1.0.1 performs network app-data work from package import time.
    distribution = importlib.metadata.distribution("cowdao-cowpy")
    package_path = distribution.locate_file("cowdao_cowpy")
    package = types.ModuleType("cowdao_cowpy")
    package.__path__ = [str(package_path)]  # type: ignore[attr-defined]
    package.__package__ = "cowdao_cowpy"
    package.__spec__ = importlib.machinery.ModuleSpec(
        "cowdao_cowpy",
        loader=None,
        is_package=True,
    )
    sys.modules["cowdao_cowpy"] = package
