"""Check that parser proofs detect two deliberately broken implementations, outside checkout."""
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
for label, old, new, failures in [
    ("trim-whitespace", "  if (!text.length", "  text = text.trim();\n  if (!text.length", 2),
    ("weaken-wait-bound", "wait > 5000", "wait > 6000", 1),
]:
    with tempfile.TemporaryDirectory(prefix="macro-mutant-") as directory:
        path = pathlib.Path(directory)
        (path / "src").mkdir()
        (path / "tests").mkdir()
        source = (root / "src/macro.ts").read_text()
        assert old in source, "Mutation no longer matches; update checker"
        (path / "src/macro.ts").write_text(source.replace(old, new, 1))
        (path / "tests/macro.test.ts").write_text((root / "tests/macro.test.ts").read_text())
        result = subprocess.run(
            [str(root / "node_modules/.bin/tsx"), "--test", str(path / "tests/macro.test.ts")],
            capture_output=True, text=True, cwd=root,
        )
        # A loader/tool failure is not a detected behavioral mutation.
        if result.returncode == 0 or f"fail {failures}\n" not in result.stdout or "AssertionError" not in result.stdout:
            print(result.stdout, result.stderr)
            raise SystemExit(f"Mutant {label}: not detected by expected behavioral tests")
        print(f"Mutant {label}: DETECTED")
