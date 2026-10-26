"""Exercise the real Android socket handler with Netty's embedded event loop."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

fixture = Path(__file__).resolve().parent
repository = fixture.parents[3]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else repository / "native/android/src/main/java/jp/rdlabo/workerscapacitor/WorkerSockets.java"
version = re.search(r"io.netty:netty-handler:([^']+)", (repository / "native/android/build.gradle").read_text()).group(1)
gradle = Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle")))
jars = sorted((gradle / "caches/modules-2/files-2.1/io.netty").glob(f"*/{version}/*/*.jar"))
if not jars:
    raise SystemExit(f"Netty {version} jars are missing. Build the Android acceptance consumer first.")
classpath = os.pathsep.join(map(str, jars))
with tempfile.TemporaryDirectory(prefix="cf-native-socket-eof-") as temporary:
    work = Path(temporary)
    shutil.copyfile(source, work / "WorkerSockets.java")
    for java in fixture.glob("*.java"):
        shutil.copyfile(java, work / java.name)
    classes = work / "classes"
    classes.mkdir()
    subprocess.run(["javac", "-cp", classpath, "-d", str(classes), *map(str, work.glob("*.java"))], check=True)
    for mode in ["close", "inactive", "shutdown", "reset"]:
        subprocess.run(["java", "-cp", str(classes) + os.pathsep + classpath, "jp.rdlabo.workerscapacitor.EofHarness", mode], check=True)
