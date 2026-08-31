#!/usr/bin/env python3
"""Deterministically classify alternate execution boundaries in one Python check."""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
import sys


CALL_KINDS = {
    "SUBPROCESS": {
        "subprocess.call",
        "subprocess.check_call",
        "subprocess.check_output",
        "subprocess.Popen",
        "subprocess.run",
    },
    "DYNAMIC_IMPORT": {
        "__import__",
        "importlib.import_module",
        "importlib.util.module_from_spec",
    },
    "PLUGIN_OR_ENTRY_POINT_DISCOVERY": {
        "importlib.metadata.entry_points",
        "pkg_resources.iter_entry_points",
    },
    "EXEC_EVAL_OR_CODE_GENERATION": {"compile", "eval", "exec"},
    "RUNTIME_LOADED_MODULE": {"ctypes.CDLL", "ctypes.PyDLL"},
}


def dotted(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return ""


def import_aliases(tree: ast.Module) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for item in node.names:
                aliases[item.asname or item.name.split(".")[0]] = item.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for item in node.names:
                aliases[item.asname or item.name] = f"{node.module}.{item.name}"
    return aliases


def resolve_call(call: ast.Call, aliases: dict[str, str]) -> str:
    rendered = dotted(call.func)
    first, separator, rest = rendered.partition(".")
    resolved = aliases.get(first, first)
    return f"{resolved}.{rest}" if separator else resolved


def child_interpreter(call: ast.Call, resolved: str, aliases: dict[str, str]) -> bool:
    if resolved not in CALL_KINDS["SUBPROCESS"] or not call.args:
        return False
    command = call.args[0]
    values = command.elts if isinstance(command, (ast.List, ast.Tuple)) else [command]
    for value in values:
        name = dotted(value)
        first, separator, rest = name.partition(".")
        expanded = aliases.get(first, first)
        resolved_name = f"{expanded}.{rest}" if separator else expanded
        if resolved_name in {"sys.executable", "sys._base_executable"}:
            return True
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            executable = Path(value.value).name.lower()
            if executable.startswith("python") or executable in {"py", "pypy", "pypy3"}:
                return True
    return False


def function_node(tree: ast.Module, symbol: str) -> ast.AST:
    matches = [
        node for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == symbol
    ]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one function named {symbol}, found {len(matches)}")
    return matches[0]


def load_metadata(path: Path | None) -> dict[str, dict[str, str]]:
    if path is None:
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or set(raw) - {"boundaries"} or not isinstance(raw.get("boundaries"), list):
        raise ValueError("metadata must be an object containing only a boundaries array")
    result: dict[str, dict[str, str]] = {}
    for index, item in enumerate(raw["boundaries"]):
        if not isinstance(item, dict) or set(item) != {"id", "status", "explanation"}:
            raise ValueError(f"metadata boundaries[{index}] has an invalid shape")
        if item["status"] not in {"CLOSED", "IRRELEVANT"}:
            raise ValueError(f"metadata boundaries[{index}].status must be CLOSED or IRRELEVANT")
        if not all(isinstance(item[key], str) and item[key] for key in item):
            raise ValueError(f"metadata boundaries[{index}] fields must be nonempty strings")
        if item["id"] in result:
            raise ValueError(f"metadata duplicates boundary {item['id']}")
        result[item["id"]] = item
    return result


def classify(root: Path, relative: Path, symbol: str, provider: str, metadata_path: Path | None) -> dict:
    source = root / relative
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(relative))
    scope = function_node(tree, symbol)
    aliases = import_aliases(tree)
    found: list[tuple[str, ast.Call, str]] = []
    for node in ast.walk(scope):
        if not isinstance(node, ast.Call):
            continue
        rendered = resolve_call(node, aliases)
        for kind, calls in CALL_KINDS.items():
            if rendered in calls:
                found.append((kind, node, rendered))
        if child_interpreter(node, rendered, aliases):
            found.append(("CHILD_INTERPRETER", node, rendered))

    metadata = load_metadata(metadata_path)
    boundaries = []
    seen = set()
    for kind, node, rendered in sorted(found, key=lambda item: (item[1].lineno, item[0], item[2])):
        boundary_id = f"{relative.as_posix()}:{symbol}:{node.lineno}:{kind}"
        if boundary_id in seen:
            continue
        seen.add(boundary_id)
        override = metadata.pop(boundary_id, None)
        status = override["status"] if override else "OPEN"
        relevant = status != "IRRELEVANT"
        explanation = override["explanation"] if override else (
            f"{rendered} crosses a {kind} boundary not closed by ordinary static import evidence."
        )
        boundaries.append({
            "id": boundary_id,
            "kind": kind,
            "status": status,
            "relevant": relevant,
            "explanation": explanation,
            "evidence_refs": [provider],
            "source": {"path": relative.as_posix(), "line": node.lineno, "construct": rendered},
        })
    if metadata:
        raise ValueError(f"metadata references undetected boundaries: {', '.join(sorted(metadata))}")

    relevant = [item for item in boundaries if item["relevant"]]
    open_boundaries = [item for item in relevant if item["status"] == "OPEN"]
    completeness = "OPAQUE_BOUNDARY" if open_boundaries else (
        "COMPLETE_WITH_DECLARED_BOUNDARIES" if relevant else "COMPLETE_FOR_CHECK"
    )
    mechanism_kinds = {"STATIC_IMPORT", *(item["kind"] for item in boundaries)}
    return {
        "schema": "opsle.affected-verification.python-check-boundaries.v1",
        "check": {"path": relative.as_posix(), "symbol": symbol},
        "assessment": {
            "completeness": completeness,
            "mechanisms": [
                {"kind": kind, "evidence_refs": [provider], "positive": False}
                for kind in sorted(mechanism_kinds)
            ],
            "boundaries": boundaries,
            "explanation": (
                "One or more relevant alternate execution boundaries remain open."
                if open_boundaries
                else "All detected check-local dependency mechanisms are closed or explicitly irrelevant."
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--check-file", type=Path)
    parser.add_argument("--symbol")
    parser.add_argument("--checks-json")
    parser.add_argument("--provider-id", required=True)
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()
    try:
        single = args.check_file is not None or args.symbol is not None
        if single == (args.checks_json is not None):
            raise ValueError("provide either --check-file with --symbol, or --checks-json")
        if single:
            if args.check_file is None or not args.symbol:
                raise ValueError("--check-file and --symbol are required together")
            result = classify(
                args.root.resolve(),
                args.check_file,
                args.symbol,
                args.provider_id,
                args.metadata,
            )
        else:
            raw = sys.stdin.read() if args.checks_json == "-" else Path(args.checks_json).read_text(encoding="utf-8")
            checks = json.loads(raw)
            if not isinstance(checks, list):
                raise ValueError("checks JSON must be an array")
            cache: dict[tuple[str, str], dict] = {}
            assessments = []
            for index, check in enumerate(checks):
                if not isinstance(check, dict) or set(check) != {"check_id", "path", "symbol"}:
                    raise ValueError(f"checks[{index}] has an invalid shape")
                if not all(isinstance(check[key], str) and check[key] for key in check):
                    raise ValueError(f"checks[{index}] fields must be nonempty strings")
                key = (check["path"], check["symbol"])
                if key not in cache:
                    cache[key] = classify(
                        args.root.resolve(),
                        Path(check["path"]),
                        check["symbol"],
                        args.provider_id,
                        None,
                    )["assessment"]
                assessments.append({"check_id": check["check_id"], **cache[key]})
            result = {
                "schema": "opsle.affected-verification.python-check-boundary-catalog.v1",
                "assessments": assessments,
            }
    except (OSError, SyntaxError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({
            "schema": "opsle.affected-verification.python-check-boundaries.error.v1",
            "error": type(exc).__name__,
            "detail": str(exc),
        }, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
