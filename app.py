import os
from pathlib import Path
from flask import Flask, render_template

STATION_COUNT = 4

app = Flask(__name__, static_folder="static", template_folder="templates")


def get_audio_files():
    audio_dir = Path(app.static_folder) / "audio"
    return sorted([p.name for p in audio_dir.glob("*.mp3")])


AUDIO_FILES = get_audio_files()


@app.route("/")
def index():
    return render_template(
        "index.html",
        station_count=STATION_COUNT,
        audio_files=AUDIO_FILES,
    )


@app.route("/favicon.ico")
def favicon():
    # avoid 404
    return ("", 204)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)