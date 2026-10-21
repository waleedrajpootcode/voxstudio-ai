// --- PWA Installation Setup ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.style.display = 'block';
});

function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
            deferredPrompt = null;
            document.getElementById('pwa-install-btn').style.display = 'none';
        });
    }
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW fail', err));
}

// --- Voice Catalogue Engine ---
let globalVoices = [];
const defaultVoices = [
    { name: "ur-PK-UzmaNeural", friendly_name: "Uzma (Urdu 🇵🇰)", gender: "Female", locale: "ur-PK", language: "ur" },
    { name: "ur-PK-AsadNeural", friendly_name: "Asad (Urdu 🇵🇰)", gender: "Male", locale: "ur-PK", language: "ur" },
    { name: "hi-IN-SwaraNeural", friendly_name: "Swara (Hindi 🇮🇳)", gender: "Female", locale: "hi-IN", language: "hi" },
    { name: "hi-IN-MadhurNeural", friendly_name: "Madhur (Hindi 🇮🇳)", gender: "Male", locale: "hi-IN", language: "hi" },
    { name: "en-US-JennyNeural", friendly_name: "Jenny (English 🇺🇸)", gender: "Female", locale: "en-US", language: "en" },
    { name: "en-US-ChristopherNeural", friendly_name: "Christopher (English 🇺🇸)", gender: "Male", locale: "en-US", language: "en" },
    { name: "en-GB-RyanNeural", friendly_name: "Ryan (English 🇬🇧)", gender: "Male", locale: "en-GB", language: "en" },
];

async function loadVoices() {
    try {
        const res = await fetch('/api/voices');
        if (res.ok) {
            globalVoices = await res.json();
        } else {
            globalVoices = defaultVoices;
        }
    } catch {
        globalVoices = defaultVoices;
    }
    filterVoices();
}

function filterVoices() {
    const langFilter = document.getElementById('voice-lang-filter').value;
    const voiceSelect = document.getElementById('tts-voice-select');
    voiceSelect.innerHTML = '';

    const filtered = langFilter === 'all' 
        ? globalVoices 
        : globalVoices.filter(v => v.language.toLowerCase().startsWith(langFilter));

    filtered.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${v.friendly_name} [${v.gender}]`;
        voiceSelect.appendChild(opt);
    });

    if(filtered.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = "No voice found for this filter";
        voiceSelect.appendChild(opt);
    }
}

// Sliders live values
const speedSlider = document.getElementById('tts-speed');
const speedLabel = document.getElementById('speed-label');
speedSlider.addEventListener('input', () => speedLabel.textContent = speedSlider.value + '%');

const pitchSlider = document.getElementById('tts-pitch');
const pitchLabel = document.getElementById('pitch-label');
pitchSlider.addEventListener('input', () => pitchLabel.textContent = pitchSlider.value + ' Hz');

// Character Counter & Estimate
const ttsInput = document.getElementById('tts-input');
const charCounter = document.getElementById('char-counter');
const estTime = document.getElementById('est-time');

ttsInput.addEventListener('input', () => {
    const len = ttsInput.value.length;
    charCounter.textContent = `${len} / 5000 characters`;
    // Approx 150 words per minute -> 2.5 words per sec
    const words = ttsInput.value.trim().split(/\s+/).filter(Boolean).length;
    estTime.textContent = `Est. ${Math.round(words / 2.5)} sec audio`;
});

// Quick Prompts
const samples = {
    urdu: "کامیابی کا راز محنت اور مسلسل جدوجہد میں چھپا ہے۔ جو لوگ خواب دیکھتے ہیں اور ان کے لیے قربانی دیتے ہیں، وہی تاریخ رقم کرتے ہیں۔",
    hindi: "सफलता केवल चाहने से नहीं मिलती, इसके लिए लगातार प्रयास और अनुशासन की आवश्यकता होती है।",
    english: "Artificial Intelligence is transforming how we work and communicate. Welcome to VoxStudio AI, the next generation voice suite."
};

function applySample(type) {
    ttsInput.value = samples[type];
    ttsInput.dispatchEvent(new Event('input'));
    if(type === 'urdu') document.getElementById('voice-lang-filter').value = 'ur';
    if(type === 'hindi') document.getElementById('voice-lang-filter').value = 'hi';
    if(type === 'english') document.getElementById('voice-lang-filter').value = 'en';
    filterVoices();
}

// --- Synthesize Speech ---
async function generateSpeech() {
    const text = ttsInput.value.trim();
    const voice = document.getElementById('tts-voice-select').value;
    const speed = speedSlider.value;
    const pitch = pitchSlider.value;

    if (!text) {
        alert("Please enter text to synthesize!");
        return;
    }

    const btn = document.getElementById('generate-cta-btn');
    const btnText = btn.querySelector('.btn-text');
    const spinner = document.getElementById('gen-spinner');
    const playerContainer = document.getElementById('output-player-container');
    const mainAudio = document.getElementById('main-audio');
    const downloadBtn = document.getElementById('download-action-btn');

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'block';

    const formData = new FormData();
    formData.append("text", text);
    formData.append("voice", voice);
    formData.append("speed", speed);
    formData.append("pitch", pitch);

    try {
        const res = await fetch('/api/tts', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error("Generation failed");

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        mainAudio.src = url;
        downloadBtn.href = url;
        playerContainer.style.display = 'block';
        mainAudio.play();
        setupVisualizer(mainAudio);

        saveToHistory(text, voice, url);

    } catch (err) {
        alert("Audio Generation Error: " + err.message);
    } finally {
        btn.disabled = false;
        btnText.style.display = 'block';
        spinner.style.display = 'none';
    }
}

// --- Real Web Audio Visualizer ---
let audioCtx, analyser, sourceNode;

function setupVisualizer(audioEl) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        sourceNode = audioCtx.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
    }

    const canvas = document.getElementById('audio-visualizer');
    const ctx = canvas.getContext('2d');
    analyser.fftSize = 64;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            grad.addColorStop(0, '#06B6D4');
            grad.addColorStop(1, '#8B5CF6');

            ctx.fillStyle = grad;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
        }
    }
    draw();
}

// --- History Management ---
function saveToHistory(text, voice, url) {
    let history = JSON.parse(localStorage.getItem('vox_history') || '[]');
    history.unshift({ text, voice, url, time: new Date().toLocaleTimeString() });
    if(history.length > 20) history.pop();
    localStorage.setItem('vox_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('history-items');
    const count = document.getElementById('history-count');
    const history = JSON.parse(localStorage.getItem('vox_history') || '[]');
    count.textContent = history.length;

    if(history.length === 0) {
        list.innerHTML = '<p class="empty-history">No generations yet.</p>';
        return;
    }

    list.innerHTML = history.map((item, idx) => `
        <div class="history-item">
            <p><strong>${item.voice}</strong>: "${item.text}"</p>
            <div style="margin-top:6px; display:flex; gap:6px;">
                <button class="export-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="playAudio('${item.url}')">▶ Play</button>
            </div>
        </div>
    `).join('');
}

function playAudio(url) {
    const audio = document.getElementById('main-audio');
    audio.src = url;
    document.getElementById('output-player-container').style.display = 'block';
    audio.play();
}

function clearHistory() {
    localStorage.removeItem('vox_history');
    renderHistory();
}

function toggleHistoryDrawer() {
    document.getElementById('history-drawer').classList.toggle('open');
}

// --- STT Pro Transcriber ---
let speechRecognizer;
let isTranscribing = false;

function toggleLiveTranscription() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert("Speech Recognition is supported in Chrome & Edge.");
        return;
    }

    const btn = document.getElementById('mic-main-btn');
    const status = document.getElementById('mic-status-msg');
    const lang = document.getElementById('stt-lang-select').value;
    const output = document.getElementById('stt-result-area');

    if (isTranscribing) {
        speechRecognizer.stop();
        return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognizer = new SpeechRec();
    speechRecognizer.lang = lang;
    speechRecognizer.continuous = true;
    speechRecognizer.interimResults = true;

    speechRecognizer.onstart = () => {
        isTranscribing = true;
        btn.classList.add('active');
        status.textContent = "Listening live... Speak naturally!";
        status.style.color = "#10B981";
    };

    speechRecognizer.onresult = (e) => {
        let transcript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            transcript += e.results[i][0].transcript;
        }
        output.value = transcript;
    };

    speechRecognizer.onerror = () => stopSTT();
    speechRecognizer.onend = () => stopSTT();

    speechRecognizer.start();
}

function stopSTT() {
    isTranscribing = false;
    const btn = document.getElementById('mic-main-btn');
    const status = document.getElementById('mic-status-msg');
    btn.classList.remove('active');
    status.textContent = "Click microphone and speak naturally";
    status.style.color = "var(--text-muted)";
}

function copySTT() {
    const txt = document.getElementById('stt-result-area').value;
    if(!txt) return;
    navigator.clipboard.writeText(txt);
    alert("Copied to clipboard!");
}

function exportSTT(format) {
    const txt = document.getElementById('stt-result-area').value;
    if(!txt) { alert("Nothing to export!"); return; }

    let content = txt;
    let filename = `transcription.${format}`;

    if(format === 'srt') {
        content = `1\n00:00:01,000 --> 00:00:06,000\n${txt}\n`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// Mode Switcher
function switchMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    if(mode === 'tts') {
        document.getElementById('tab-tts').classList.add('active');
        document.getElementById('panel-tts').style.display = 'block';
        document.getElementById('panel-stt').style.display = 'none';
    } else {
        document.getElementById('tab-stt').classList.add('active');
        document.getElementById('panel-tts').style.display = 'none';
        document.getElementById('panel-stt').style.display = 'block';
    }
}

// Init
window.addEventListener('DOMContentLoaded', () => {
    loadVoices();
    renderHistory();
});
// --- Subtab Switching (Mic vs File Upload) ---
function switchSTTMode(mode) {
    document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
    if (mode === 'mic') {
        document.getElementById('subtab-mic').classList.add('active');
        document.getElementById('stt-mic-view').style.display = 'block';
        document.getElementById('stt-upload-view').style.display = 'none';
    } else {
        document.getElementById('subtab-upload').classList.add('active');
        document.getElementById('stt-mic-view').style.display = 'none';
        document.getElementById('stt-upload-view').style.display = 'block';
    }
}

// --- Handle Audio File Upload ---
let uploadedFile = null;

function handleAudioUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    uploadedFile = file;
    const previewContainer = document.getElementById('uploaded-audio-preview');
    const player = document.getElementById('uploaded-player');

    player.src = URL.createObjectURL(file);
    previewContainer.style.display = 'block';
}

// --- Proper Audio File Transcription Engine ---
async function transcribeUploadedFile() {
    if (!uploadedFile) {
        alert("Pehle koi audio file select karein!");
        return;
    }

    const btn = document.getElementById('transcribe-file-btn');
    const btnText = btn.querySelector('.btn-text');
    const spinner = document.getElementById('upload-spinner');
    const output = document.getElementById('stt-result-area');
    const lang = document.getElementById('stt-lang-select').value;

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'block';
    output.value = "Audio ko analyze kiya ja raha hai, thora intezar karein...";

    try {
        // Step 1: File ko AudioContext se read & convert karein WAV format mein
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        // Convert decoded audio to clean WAV Blob
        const wavBlob = audioBufferToWavBlob(decodedBuffer);

        // Step 2: Backend API ko send karein
        const formData = new FormData();
        formData.append("audio", wavBlob, "recording.wav");
        formData.append("lang", lang);

        const res = await fetch('/api/transcribe-file', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || "Transcription fail ho gayi.");
        }

        output.value = data.text;

    } catch (err) {
        output.value = "";
        alert("Transcription Error: " + err.message);
    } finally {
        btn.disabled = false;
        btnText.style.display = 'block';
        spinner.style.display = 'none';
    }
}

// Helper: Convert Any Audio (MP3/OGG/M4A) into Standard WAV for Google Engine
function audioBufferToWavBlob(buffer) {
    const numOfChan = 1; // Mono channel
    const length = buffer.length * numOfChan * 2 + 44;
    const out = new DataView(new ArrayBuffer(length));
    const channelData = buffer.getChannelData(0);

    let pos = 0;
    function writeString(str) {
        for (let i = 0; i < str.length; i++) {
            out.setUint8(pos++, str.charCodeAt(i));
        }
    }

    writeString('RIFF');
    out.setUint32(pos, length - 8, true); pos += 4;
    writeString('WAVE');
    writeString('fmt ');
    out.setUint32(pos, 16, true); pos += 4; // SubChunk1Size
    out.setUint16(pos, 1, true); pos += 2;  // AudioFormat (PCM)
    out.setUint16(pos, numOfChan, true); pos += 2;
    out.setUint32(pos, buffer.sampleRate, true); pos += 4;
    out.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
    out.setUint16(pos, numOfChan * 2, true); pos += 2;
    out.setUint16(pos, 16, true); pos += 2; // BitsPerSample
    writeString('data');
    out.setUint32(pos, length - pos - 4, true); pos += 4;

    for (let i = 0; i < buffer.length; i++) {
        let sample = Math.max(-1, Math.min(1, channelData[i]));
        sample = sample < 0 ? sample * 32768 : sample * 32767;
        out.setInt16(pos, sample, true);
        pos += 2;
    }

    return new Blob([out.buffer], { type: 'audio/wav' });
}