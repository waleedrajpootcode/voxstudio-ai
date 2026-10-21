import asyncio
import io
import edge_tts
from flask import Flask, jsonify, render_template, request, send_file

app = Flask(__name__)

# Cache for dynamic voices
CACHED_VOICES = []


async def fetch_all_voices():
    global CACHED_VOICES
    if not CACHED_VOICES:
        voices = await edge_tts.list_voices()
        CACHED_VOICES = [
            {
                "name": v["ShortName"],
                "friendly_name": v["FriendlyName"],
                "gender": v["Gender"],
                "locale": v["Locale"],
                "language": v["Locale"].split("-")[0],
            }
            for v in voices
        ]
    return CACHED_VOICES


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_file("manifest.json", mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    return send_file("sw.js", mimetype="application/javascript")


@app.route("/api/voices", methods=["GET"])
def get_voices():
    voices = asyncio.run(fetch_all_voices())
    return jsonify(voices)


async def synthesize_audio(text, voice, rate_str, pitch_str):
    communicate = edge_tts.Communicate(
        text=text, voice=voice, rate=rate_str, pitch=pitch_str
    )
    buffer = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buffer.extend(chunk["data"])
    return bytes(buffer)


@app.route("/api/tts", methods=["POST"])
def tts():
    try:
        text = request.form.get("text", "").strip()
        voice = request.form.get("voice", "ur-PK-UzmaNeural")
        speed = request.form.get("speed", "0")
        pitch = request.form.get("pitch", "0")

        if not text:
            return jsonify({"error": "Text cannot be empty"}), 400

        speed_val = int(speed)
        rate_str = f"+{speed_val}%" if speed_val >= 0 else f"{speed_val}%"

        pitch_val = int(pitch)
        pitch_str = f"+{pitch_val}Hz" if pitch_val >= 0 else f"{pitch_val}Hz"

        audio_bytes = asyncio.run(
            synthesize_audio(text, voice, rate_str, pitch_str)
        )

        return send_file(
            io.BytesIO(audio_bytes),
            mimetype="audio/mpeg",
            as_attachment=False,
            download_name="voxstudio_audio.mp3",
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

import speech_recognition as sr


@app.route("/api/transcribe-file", methods=["POST"])
def transcribe_file():
    try:
        if "audio" not in request.files:
            return jsonify({"error": "No audio file provided"}), 400

        audio_file = request.files["audio"]
        lang = request.form.get("lang", "ur-PK")

        recognizer = sr.Recognizer()

        # Audio file ko memory se read karein
        with sr.AudioFile(audio_file) as source:
            audio_data = recognizer.record(source)
            # Google Speech API se accurate text nikaalein (Free)
            text = recognizer.recognize_google(audio_data, language=lang)
            return jsonify({"text": text})

    except sr.UnknownValueError:
        return (
            jsonify(
                {
                    "error": "Aawaz saaf samajh nahi aayi. Please clear voice wali file upload karein."
                }
            ),
            400,
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print("🚀 VoxStudio SaaS running at: http://127.0.0.1:5000")
    app.run(debug=True, port=5000)