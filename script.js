import { PitchDetector } from "https://cdn.jsdelivr.net/npm/pitchy@4.0.3/dist/pitchy.esm.js";

const startBtn = document.getElementById("startBtn");
const noteDisplay = document.getElementById("note");
const freqDisplay = document.getElementById("freq");

startBtn.addEventListener("click", startListening);

async function startListening() {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const buffer = new Float32Array(analyser.fftSize);

    function update() {
        analyser.getFloatTimeDomainData(buffer);
        const [pitch, clarity] = detector.findPitch(buffer, audioContext.sampleRate);

        if (clarity > 0.9) {
            freqDisplay.textContent = pitch.toFixed(1) + " Hz";
            noteDisplay.textContent = freqToSolfege(pitch);
        }

        requestAnimationFrame(update);
    }

    update();
}

function freqToSolfege(freq) {
    const notes = ["Do", "Do♯", "Ré", "Ré♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
    const midi = Math.round(12 * Math.log2(freq / 440)) + 69;
    return notes[midi % 12];
}
