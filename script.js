import { PitchDetector } from "https://esm.sh/pitchy@4";

const VF = Vex.Flow;

const startBtn = document.getElementById("startBtn");
const audioFile = document.getElementById("audioFile");
const noteDisplay = document.getElementById("note");
const freqDisplay = document.getElementById("freq");

let renderer, context, stave;

// ----------------------
// Solfège → Anglo-saxon
// ----------------------
const solfegeToLetter = {
    "Do": "C",
    "Do♯": "C#",
    "Ré": "D",
    "Ré♯": "D#",
    "Mi": "E",
    "Fa": "F",
    "Fa♯": "F#",
    "Sol": "G",
    "Sol♯": "G#",
    "La": "A",
    "La♯": "A#",
    "Si": "B"
};

function freqToSolfege(freq) {
    const notes = ["Do", "Do♯", "Ré", "Ré♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
    const midi = Math.round(12 * Math.log2(freq / 440)) + 69;
    return notes[midi % 12];
}

// ----------------------
// Initialisation VexFlow
// ----------------------
function initStaff() {
    const div = document.getElementById("staff");
    div.innerHTML = ""; // reset

    renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
    renderer.resize(500, 200);

    context = renderer.getContext();
    context.setFont("Arial", 10);

    stave = new VF.Stave(10, 40, 480);
    stave.addClef("treble");
    stave.setContext(context).draw();
}

// ----------------------
// Dessiner une note
// ----------------------
function drawNote(letter) {
    initStaff();

    const note = new VF.StaveNote({
        clef: "treble",
        keys: [`${letter.toLowerCase()}/4`],
        duration: "q"
    });

    const voice = new VF.Voice({ num_beats: 1, beat_value: 4 });
    voice.addTickables([note]);

    new VF.Formatter().joinVoices([voice]).format([voice], 300);
    voice.draw(context, stave);
}

// ----------------------
// Pitch detection loop
// ----------------------
function updatePitch(analyser, audioContext) {
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const buffer = new Float32Array(analyser.fftSize);

    function loop() {
        analyser.getFloatTimeDomainData(buffer);
        const [pitch, clarity] = detector.findPitch(buffer, audioContext.sampleRate);

        if (clarity > 0.9) {
            const solf = freqToSolfege(pitch);
            const letter = solfegeToLetter[solf];

            freqDisplay.textContent = pitch.toFixed(1) + " Hz";
            noteDisplay.textContent = solf;

            drawNote(letter);
        }

        requestAnimationFrame(loop);
    }

    loop();
}

// 🎤 Micro
async function startListening() {
    initStaff();

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    updatePitch(analyser, audioContext);
}

// 📁 Fichier audio
async function handleFile(event) {
    initStaff();

    const file = event.target.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    source.start();

    updatePitch(analyser, audioContext);
}
