"""Emit the minimum Python import evidence needed by AV-EXP-002."""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path


def module_for(path: Path) -> str:
    parts = list(path.with_suffix("").parts)
    if parts[0] == "src":
        parts = parts[1:]
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def resolve_relative(current: str, level: int, name: str | None) -> str:
    base = current.split(".")[:-1]
    if level:
        base = base[: max(0, len(base) - level + 1)]
    if name:
        base.extend(name.split("."))
    return ".".join(base)


def parse_file(root: Path, path: Path, exports: dict[str, str]) -> dict:
    rel = path.relative_to(root)
    module = module_for(rel)
    result = {
        "path": rel.as_posix(),
        "module": module,
        "imports": [],
        "dynamic_hazards": [],
        "parse_error": None,
    }
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(rel))
    except (OSError, SyntaxError) as exc:
        result["parse_error"] = type(exc).__name__
        return result

    imported_click_aliases: set[str] = set()
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "click":
                    imported_click_aliases.add(alias.asname or "click")
                else:
                    imports.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            name = resolve_relative(module, node.level, node.module)
            if name:
                imports.add(name)
            if name == "click":
                for alias in node.names:
                    target = exports.get(alias.name)
                    if target:
                        imports.add(target)
        elif isinstance(node, ast.Call):
            rendered = ast.unparse(node.func)
            if "importlib" in rendered or rendered == "__import__":
                result["dynamic_hazards"].append(f"dynamic-import:{rendered}")
            if "entry_points" in rendered or "packages_distributions" in rendered:
                result["dynamic_hazards"].append(f"plugin-discovery:{rendered}")
            if "monkeypatch" in rendered:
                result["dynamic_hazards"].append(f"monkeypatch:{rendered}")
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in imported_click_aliases:
                target = exports.get(node.attr)
                if target:
                    imports.add(target)
                elif node.attr in {
                    "core", "decorators", "exceptions", "formatting", "parser",
                    "shell_completion", "termui", "testing", "types", "utils"
                }:
                    imports.add(f"click.{node.attr}")

    if rel.as_posix() == "tests/conftest.py":
        result["dynamic_hazards"].append("shared-pytest-fixture")
    result["imports"] = sorted(i for i in imports if i.startswith("click"))
    result["dynamic_hazards"] = sorted(set(result["dynamic_hazards"]))
    return result


def load_exports(root: Path) -> dict[str, str]:
    init_path = root / "src/click/__init__.py"
    tree = ast.parse(init_path.read_text(encoding="utf-8"))
    exports: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.ImportFrom) or not node.module:
            continue
        module = f"click.{node.module.lstrip('.')}"
        for alias in node.names:
            exports[alias.asname or alias.name] = module
    return exports


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python_graph.py TARGET")
    root = Path(sys.argv[1]).resolve()
    exports = load_exports(root)
    paths = sorted((root / "src").rglob("*.py")) + sorted((root / "tests").rglob("*.py"))
    payload = {
        "schema": "opsle.av-exp-002.python-import-evidence.v1",
        "files": [parse_file(root, path, exports) for path in paths],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
