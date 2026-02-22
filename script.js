import { PitchDetector } from "https://esm.sh/pitchy@4";

// ---------- OSMD ----------
const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd", {
    autoResize: true,
    drawTitle: false,
});

// ---------- DOM ----------
const startBtn = document.getElementById("startBtn");
const audioFile = document.getElementById("audioFile");
const noteDisplay = document.getElementById("note");
const freqDisplay = document.getElementById("freq");
const durationDisplay = document.getElementById("duration");
const playBtn = document.getElementById("playBtn");
const statusMsg = document.getElementById("statusMsg");

const tempoInput = document.getElementById("tempo");
const signatureInput = document.getElementById("signature");

// ---------- File d’attente ----------
let rawNotes = []; // notes brutes (pitch + time)

// ---------- Notes finales ----------
let notesHistory = []; // notes analysées (pitch + type)

// ---------- Analyse toutes les 2 mesures ----------
let lastBatchTime = performance.now();

// ---------- Solfège ↔ Anglo-saxon ----------
const solfegeToLetter = {
    "Do": "C", "Do♯": "C#",
    "Ré": "D", "Ré♯": "D#",
    "Mi": "E",
    "Fa": "F", "Fa♯": "F#",
    "Sol": "G", "Sol♯": "G#",
    "La": "A", "La♯": "A#",
    "Si": "B"
};

function freqToSolfege(freq) {
    const notes = ["Do", "Do♯", "Ré", "Ré♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
    const midi = Math.round(12 * Math.log2(freq / 440)) + 69;
    return notes[(midi % 12 + 12) % 12];
}

// ---------- Durée → type ----------
function durationToType(ms) {
    if (ms < 150) return "32nd";
    if (ms < 300) return "16th";
    if (ms < 600) return "eighth";
    if (ms < 1200) return "quarter";
    if (ms < 2400) return "half";
    return "whole";
}

// ---------- Type → durée ms (lecture) ----------
function typeToMs(type) {
    switch (type) {
        case "32nd": return 125;
        case "16th": return 250;
        case "eighth": return 500;
        case "quarter": return 1000;
        case "half": return 2000;
        case "whole": return 4000;
        default: return 1000;
    }
}

// ---------- Note → fréquence ----------
function letterToFreq(letter) {
    const map = {
        "C": 261.63, "C#": 277.18,
        "D": 293.66, "D#": 311.13,
        "E": 329.63,
        "F": 349.23, "F#": 369.99,
        "G": 392.00, "G#": 415.30,
        "A": 440.00, "A#": 466.16,
        "B": 493.88
    };
    return map[letter] || 440;
}

// ---------- Analyse des notes brutes ----------
function analyzeBatch() {
    if (rawNotes.length < 2) return;

    let result = [];
    let current = rawNotes[0].pitch;
    let start = rawNotes[0].time;

    for (let i = 1; i < rawNotes.length; i++) {
        if (rawNotes[i].pitch !== current) {
            const duration = rawNotes[i].time - start;
            result.push({ pitch: current, type: durationToType(duration) });

            current = rawNotes[i].pitch;
            start = rawNotes[i].time;
        }
    }

    // dernière note
    const lastDuration = rawNotes[rawNotes.length - 1].time - start;
    result.push({ pitch: current, type: durationToType(lastDuration) });

    // Ajout au score final
    notesHistory.push(...result);

    // Nettoyage
    rawNotes = [];

    displayHistory();
}

// ---------- Durée d’un bloc de 2 mesures ----------
function getBatchDurationMs() {
    const tempo = parseInt(tempoInput.value);
    const beats = parseInt(signatureInput.value);

    const quarterMs = 60000 / tempo;
    const measureMs = beats * quarterMs;

    return measureMs * 2; // 2 mesures
}

// ---------- Partition ----------
async function displayHistory() {
    const xml = generateMusicXML(notesHistory);
    await osmd.load(xml);
    osmd.render();
}

// ---------- MusicXML ----------
function generateMusicXML(history) {
    if (history.length === 0) {
        return `
        <?xml version="1.0" encoding="UTF-8"?>
        <score-partwise version="3.1">
          <part-list>
            <score-part id="P1"><part-name>Music</part-name></score-part>
          </part-list>
          <part id="P1">
            <measure number="1">
              <attributes>
                <divisions>1</divisions>
                <key><fifths>0</fifths></key>
                <time><beats>4</beats><beat-type>4</beat-type></time>
                <clef><sign>G</sign><line>2</line></clef>
              </attributes>
            </measure>
          </part>
        </score-partwise>`;
    }

    let measuresXML = "";
    const notesPerMeasure = 4;
    let measureNumber = 1;

    for (let i = 0; i < history.length; i += notesPerMeasure) {
        const slice = history.slice(i, i + notesPerMeasure);

        let notesXML = "";
        for (const note of slice) {
            const step = note.pitch[0];
            const alter = note.pitch[1] === "#" ? "<alter>1</alter>" : "";
            const type = note.type;

            notesXML += `
            <note>
              <pitch>
                <step>${step}</step>
                ${alter}
                <octave>4</octave>
              </pitch>
              <duration>1</duration>
              <type>${type}</type>
            </note>`;
        }

        if (measureNumber === 1) {
            measuresXML += `
            <measure number="${measureNumber}">
              <attributes>
                <divisions>1</divisions>
                <key><fifths>0</fifths></key>
                <time><beats>${signatureInput.value}</beats><beat-type>4</beat-type></time>
                <clef><sign>G</sign><line>2</line></clef>
              </attributes>
              ${notesXML}
            </measure>`;
        } else {
            measuresXML += `
            <measure number="${measureNumber}">
              ${notesXML}
            </measure>`;
        }

        measureNumber++;
    }

    return `
    <?xml version="1.0" encoding="UTF-8"?>
    <score-partwise version="3.1">
      <part-list>
        <score-part id="P1"><part-name>Music</part-name></score-part>
      </part-list>
      <part id="P1">
        ${measuresXML}
      </part>
    </score-partwise>`;
}

// ---------- Lecture audio améliorée (ADSR + transitions) ----------
let audioCtx = null;

function ensureAudioContext() {
    if (!audioCtx || audioCtx.state === "closed") {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playNote(freq, durationMs, startTime) {
    ensureAudioContext();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.frequency.value = freq;
    osc.type = "sine";

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    // ADSR (piano-like)
    const A = 0.01;  // Attack
    const D = 0.05;  // Decay
    const S = 0.3;   // Sustain level
    const R = 0.1;   // Release

    const t0 = startTime;
    const t1 = t0 + durationMs / 1000;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.4, t0 + A);
    gain.gain.linearRampToValueAtTime(S, t0 + A + D);
    gain.gain.setValueAtTime(S, t1 - R);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.start(t0);
    osc.stop(t1 + 0.05); // petit fade-out
}

function playScore() {
    if (notesHistory.length === 0) {
        statusMsg.textContent = "Aucune note à rejouer.";
        return;
    }

    ensureAudioContext();
    const start = audioCtx.currentTime;
    let offset = 0;

    for (const note of notesHistory) {
        const freq = letterToFreq(note.pitch);
        const durMs = typeToMs(note.type);

        // micro-silence entre les notes rapides
        const adjustedDur = durMs * 0.95;

        playNote(freq, adjustedDur, start + offset / 1000);
        offset += durMs;
    }

    statusMsg.textContent = "Lecture en cours…";
    setTimeout(() => statusMsg.textContent = "", offset + 500);
}

// ---------- Détection améliorée (commit 2) ----------
function updatePitch(analyser, audioContext) {
    // FFT plus petite = meilleure réactivité
    analyser.fftSize = 1024;

    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const buffer = new Float32Array(analyser.fftSize);

    let lastPitch = null;

    async function loop() {
        analyser.getFloatTimeDomainData(buffer);
        const [pitch, clarity] = detector.findPitch(buffer, audioContext.sampleRate);

        const now = performance.now();
        const batchDuration = getBatchDurationMs();

        if (clarity > 0.85 && pitch > 50 && pitch < 2000) {
            const solf = freqToSolfege(pitch);
            const letter = solfegeToLetter[solf];

            noteDisplay.textContent = solf;
            freqDisplay.textContent = pitch.toFixed(1) + " Hz";

            // ---------- NOUVEAU : détection des transitions rapides ----------
            if (lastPitch !== letter) {
                rawNotes.push({ pitch: letter, time: now });
                lastPitch = letter;
            }
        }

        // Analyse toutes les 2 mesures
        if (now - lastBatchTime >= batchDuration) {
            analyzeBatch();
            lastBatchTime = now;
        }

        requestAnimationFrame(loop);
    }

    loop();
}

// ---------- Micro ----------
async function startListening() {
    rawNotes = [];
    notesHistory = [];
    lastBatchTime = performance.now();

    await displayHistory();

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    updatePitch(analyser, audioContext);
}

// ---------- Fichier audio ----------
async function handleFile(event) {
    rawNotes = [];
    notesHistory = [];
    lastBatchTime = performance.now();

    await displayHistory();

    const file = event.target.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    source.start();

    updatePitch(analyser, audioContext);

    setTimeout(() => {
        if (notesHistory.length === 0) {
            statusMsg.textContent = "Impossible à transcrire : signal trop complexe.";
        }
    }, getBatchDurationMs() * 2);
}

// ---------- Events ----------
startBtn.addEventListener("click", startListening);
audioFile.addEventListener("change", handleFile);
playBtn.addEventListener("click", playScore);

// Partition vide au chargement
displayHistory();
