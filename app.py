"""
Tiny Flask server for the radio mixer project.
"""

import os
from pathlib import Path
from flask import Flask, render_template

# ------------------- configuration -------------------
STATION_COUNT = 4  # number of “radio” channels

# Create the Flask app
app = Flask(__name__, static_folder="static", template_folder="templates")

# Build AUDIO_FILES list automatically from /static/audio
AUDIO_DIR = Path(app.static_folder) / "audio"
AUDIO_FILES = sorted([f.name for f in AUDIO_DIR.glob("*.mp3")])
# If you prefer manual order, just replace the line above with an explicit list:
# AUDIO_FILES = ["song1.mp3", "song2.mp3", "song3.mp3", "song4.mp3"]
# -----------------------------------------------------


@app.route("/")
def index():
    return render_template(
        "index.html",
        station_count=STATION_COUNT,
        audio_files=AUDIO_FILES,
    )


if __name__ == "__main__":
    # On Render the PORT env var is set. Locally default to 5000.
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)