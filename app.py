"""
Tiny Flask server.
Run:  pip install -r requirements.txt
      python app.py
Then browse to http://127.0.0.1:5000
"""

from flask import Flask, render_template

# ------------------- configuration variables -------------------
STATION_COUNT = 4                  # number of “radio” channels
AUDIO_FILES = [
    "audio/song1.mp3",
    "audio/song2.mp3",
    "audio/song3.mp3",
    "audio/song4.mp3",
]
# ---------------------------------------------------------------

app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index():
    return render_template(
        "index.html",
        station_count=STATION_COUNT,
        audio_files=AUDIO_FILES,
    )


if __name__ == "__main__":
    import os
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
