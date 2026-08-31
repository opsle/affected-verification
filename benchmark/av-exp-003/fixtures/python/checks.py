import importlib
import subprocess
import sys


def subprocess_check():
    subprocess.run([sys.executable, "-c", "import package"])


def dynamic_check():
    importlib.import_module("package")


def ordinary_check():
    return 1

