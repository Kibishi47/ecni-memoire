#!/usr/bin/env bash
set -e
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python --no-cache-dir
pip install -r requirements.txt
