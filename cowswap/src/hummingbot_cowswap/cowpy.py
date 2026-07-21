"""Helpers for safely importing cowdao-cowpy submodules."""

from __future__ import annotations

import importlib
import importlib.machinery
import importlib.metadata
import sys
import types

from hummingbot_cowswap import cowpy_transport


def ensure_cowpy_submodule_imports() -> None:
    """Register cowpy safely and bind its HTTP calls to the connector transport."""
    if "cowdao_cowpy" not in sys.modules:
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

    api_base = importlib.import_module("cowdao_cowpy.common.api.api_base")
    decorators = importlib.import_module("cowdao_cowpy.common.api.decorators")
    api_base.httpx = cowpy_transport
    decorators.httpx = cowpy_transport
