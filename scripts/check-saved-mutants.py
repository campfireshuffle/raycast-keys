"""Calibrate kept dummy-storage concurrency proofs, without real saved values."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
for mutant in ("uncoordinated-library", "no-native-lock"):
    with tempfile.TemporaryDirectory(prefix="saved-mutant-") as directory:
        work = Path(directory)
        for name in ("src", "tests", "assets"):
            shutil.copytree(root / name, work / name)
        (work / "node_modules").symlink_to(root / "node_modules", target_is_directory=True)
        if mutant == "uncoordinated-library":
            source = work / "src/saved.ts"
            text = source.read_text()
            assert text.count("return this.mutate(") == 2
            source.write_text(text.replace("return this.mutate(", "return ((operation) => operation())("))
            test = "tests/saved.test.ts"
        else:
            source = work / "NoLock.swift"
            source.write_text("import Darwin\nexit(0)\n")
            subprocess.run(["swiftc", str(source), "-o", str(work / "assets/mutation-lock")], check=True)
            test = "tests/mutation-lock.test.ts"
        result = subprocess.run([str(root / "node_modules/.bin/tsx"), "--test", test], cwd=work, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 or "AssertionError" not in result.stdout + result.stderr:
            raise SystemExit(f"Mutant escaped or probe broke: {mutant}\n{result.stdout}\n{result.stderr}")
        print(f"PASS detected saved persistence mutant: {mutant}")
