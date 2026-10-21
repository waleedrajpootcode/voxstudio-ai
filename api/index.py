import asyncio
import io
import edge_tts
from flask import Flask, jsonify, request, send_file
import speech_recognition as sr

app = Flask(__name__)

VOICES = {
    "ur-uzma": "ur-PK-UzmaNeural",
    "ur-asad": "ur-PK-AsadNeural",
    "hi-swara": "hi-IN-SwaraNeural",
    "hi-madhur": "hi-IN-MadhurNeural",
    "en-jenny": "en-US-JennyNeural",
    "en-christopher": "en-US-ChristopherNeural",
    "en-guy": "en-US-GuyNeural",
    "en-sonia": "en-GB-SoniaNeural",
    "en-ryan": "en-GB-RyanNeural",
}


async def generate_speech_bytes(text, voice, rate_str, pitch_str):
    communicate = edge_tts.Communicate(
        text=text, voice=voice, rate=rate_str, pitch=pitch_str
    )
    audio_buffer = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_buffer.extend(chunk["data"])
    return bytes(audio_buffer)


# Dono routes handle karein taake path mismatch ka chance na rahe
@app.route("/api/tts", methods=["POST"])
@app.route("/tts", methods=["POST"])
def tts():
    try:
        text = request.form.get("text", "").strip()
        voice_key = request.form.get("voice", "ur-uzma")
        speed = request.form.get("speed", "0")
        pitch = request.form.get("pitch", "0")

        if not text:
            return jsonify({"error": "Text is empty"}), 400

        selected_voice = VOICES.get(voice_key, "ur-PK-UzmaNeural")

        speed_val = int(speed)
        rate_str = f"+{speed_val}%" if speed_val >= 0 else f"{speed_val}%"

        pitch_val = int(pitch)
        pitch_str = f"+{pitch_val}Hz" if pitch_val >= 0 else f"{pitch_val}Hz"

        audio_bytes = asyncio.run(
            generate_speech_bytes(text, selected_voice, rate_str, pitch_str)
        )

        return send_file(
            io.BytesIO(audio_bytes),
            mimetype="audio/mpeg",
            as_attachment=True,
            download_name="voxstudio_audio.mp3",
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transcribe-file", methods=["POST"])
@app.route("/transcribe-file", methods=["POST"])
def transcribe():
    try:
        if "audio" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        audio_file = request.files["audio"]
        lang = request.form.get("lang", "ur-PK")

        recognizer = sr.Recognizer()
        with sr.AudioFile(audio_file) as source:
            audio_data = recognizer.record(source)
            text = recognizer.recognize_google(audio_data, language=lang)
            return jsonify({"text": text})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True)