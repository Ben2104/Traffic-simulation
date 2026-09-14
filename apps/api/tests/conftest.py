import os
import sys

# `Settings.sumo_binary` defaults to the bare name "sumo", and pip installs
# the SUMO console script into the virtualenv's bin directory. Running the
# suite as `.venv/bin/pytest` (i.e. without activating the venv) leaves that
# directory off PATH, so every test that starts SUMO errors out. Prepending
# the directory of the *running interpreter* makes the suite work identically
# activated or not, which is also what any CI runner will do.
#
# This deliberately does not change `app/config.py`'s default: production
# still resolves "sumo" from the image's PATH.
_INTERPRETER_BIN_DIR = os.path.dirname(sys.executable)
if _INTERPRETER_BIN_DIR:
    _path = os.environ.get("PATH", "")
    if _INTERPRETER_BIN_DIR not in _path.split(os.pathsep):
        os.environ["PATH"] = (
            _INTERPRETER_BIN_DIR + os.pathsep + _path if _path else _INTERPRETER_BIN_DIR
        )
