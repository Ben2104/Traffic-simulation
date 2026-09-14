# SUMO is installed as a Python dependency (eclipse-sumo, traci, sumolib in
# requirements.txt) rather than via apt. The wheel ships prebuilt sumo /
# netconvert binaries and installs console-script wrappers into the same
# directory as `pip`/`python`, which for a system-wide (non-venv) install in
# this base image is /usr/local/bin -- already on PATH. So plain
# `pip install -r requirements.txt` is enough for Settings.sumo_binary's
# bare "sumo" default to resolve; no apt-get sumo package needed.
FROM python:3.12-slim

WORKDIR /app

# The prebuilt `sumo` binary shipped inside the eclipse-sumo wheel is
# dynamically linked against X11/GL libraries (confirmed via `ldd`: missing
# libX11.so.6, libXext.so.6, libXrender.so.1, libGL.so.1, libatomic.so.1,
# libexpat.so.1) even though it runs headless here -- python:3.12-slim has
# none of them. This is NOT the forbidden `apt-get install sumo sumo-tools`;
# it supplies only the missing shared-library runtime deps the pip-installed
# binary itself needs to dynamically link and run at all.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libx11-6 libxext6 libxrender1 libgl1 libatomic1 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# Points at the installed sumo package's data/tools directory, matching the
# local dev layout (<site-packages>/sumo). python:3.12-slim installs
# non-venv packages to /usr/local/lib/python3.12/site-packages. Not proven
# strictly necessary for the plain `sumo` binary invocation this app makes,
# but set for parity with local dev and in case SUMO looks up data files.
ENV SUMO_HOME=/usr/local/lib/python3.12/site-packages/sumo

COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/app ./app

# Only the two files SimulationRunner actually opens (net + route). The
# source .osm (8.6M) is not needed at runtime and is excluded via
# api.Dockerfile.dockerignore so it never enters the build context.
# Settings.sumo_net_file / sumo_route_file default to the RELATIVE paths
# "networks/soma/soma.net.xml" / "networks/soma/soma.rou.xml", resolved
# against the process's cwd (which Docker sets to the last WORKDIR, i.e.
# /app). Copying the network here -- instead of overriding the settings via
# SIM_SUMO_NET_FILE/SIM_SUMO_ROUTE_FILE env vars -- means app/config.py's
# defaults keep working unmodified.
COPY networks/soma/soma.net.xml networks/soma/soma.rou.xml ./networks/soma/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
