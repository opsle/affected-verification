"""Pytest adapter for the frozen AV-EXP-002 catalog.

The target excludes ``stress`` tests with ``-m 'not stress'``. pytest-testmon
documents that ``-m`` disables selection, so this hook performs the identical
catalog exclusion without passing a pytest selector. It does not add tests or
checks to the TESTMON arm.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

_OUTCOMES = {}


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(config, items):
    keep = []
    deselected = []
    for item in items:
        if item.get_closest_marker("stress") is None:
            keep.append(item)
        else:
            deselected.append(item)
    if deselected:
        config.hook.pytest_deselected(items=deselected)
    items[:] = keep


def pytest_sessionstart(session):
    _OUTCOMES.clear()


def pytest_runtest_logreport(report):
    if report.when == "call" or report.failed:
        _OUTCOMES[report.nodeid] = {
            "outcome": report.outcome,
            "phase": report.when,
        }


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session, exitstatus):
    report_path = os.environ.get("AV2_PYTEST_REPORT")
    if not report_path:
        return
    payload = {
        "exit_status": int(exitstatus),
        "selected_nodeids": sorted(item.nodeid for item in session.items),
        "outcomes": {key: _OUTCOMES[key] for key in sorted(_OUTCOMES)},
    }
    Path(report_path).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
