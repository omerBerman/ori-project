"""
Flask server for the radio mixer project.
"""

import os
from pathlib import Path
from flask import Flask, render_template

STATION_COUNT = 4  # number of channels

app = Flask(__name__, static_folder="static", template_folder="templates")


def get_audio_files():
    """
    Return only file names (no 'audio/' prefix) from static/audio.
    """
    audio_dir = Path(app.static_folder) / "audio"
    return sorted([f.name for f in audio_dir.glob("*.mp3")])


AUDIO_FILES = get_audio_files()


@app.route("/")
def index():
    return render_template(
        "index.html",
        station_count=STATION_COUNT,
        audio_files=AUDIO_FILES,
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)