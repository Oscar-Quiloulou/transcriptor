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
let rawNotes = [];
let notesHistory = [];
let lastBatchTime = performance.now();

// ---------- CPU AUTO-DETECTION ----------
async function detectCpuPower() {
    const cores = navigator.hardwareConcurrency || 2;

    // micro benchmark
    const start = performance.now();
    let x = 0;
    for (let i = 0; i < 2_000_000; i++) x += i;
    const duration = performance.now() - start;

    const score = cores * (2000 / duration);

    if (score > 200) return 512;   // CPU rapide
    if (score > 100) return 1024;  // CPU moyen
    return 2048;                   // CPU faible
}

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

// ---------- Type → durée ms ----------
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

// ------------------------------------------------------------
//  ANALYSEUR DE QUALITÉ (commit 3)
// ------------------------------------------------------------
async function analyzeAudioQuality(analyser, audioContext) {
    return new Promise(resolve => {
        const detector = PitchDetector.forFloat32Array(analyser.fftSize);
        const buffer = new Float32Array(analyser.fftSize);

        let claritySum = 0;
        let clarityCount = 0;
        let pitchChanges = 0;
        let lastPitch = null;
        let noiseLevelSum = 0;

        const start = performance.now();

        function loop() {
            analyser.getFloatTimeDomainData(buffer);

            let noise = 0;
            for (let i = 0; i < buffer.length; i++) noise += Math.abs(buffer[i]);
            noise /= buffer.length;
            noiseLevelSum += noise;

            const [pitch, clarity] = detector.findPitch(buffer, audioContext.sampleRate);

            if (clarity > 0.5 && pitch > 50 && pitch < 2000) {
                claritySum += clarity;
                clarityCount++;

                if (lastPitch && Math.abs(pitch - lastPitch) > 5) pitchChanges++;
                lastPitch = pitch;
            }

            if (performance.now() - start < 2000) {
                requestAnimationFrame(loop);
            } else {
                const clarityAvg = clarityCount > 0 ? claritySum / clarityCount : 0;
                const noiseAvg = noiseLevelSum / (performance.now() - start);

                let score =
                      clarityAvg * 40
                    + (pitchChanges < 5 ? 20 : 5)
                    + (noiseAvg < 0.05 ? 20 : 5)
                    + (clarityCount > 20 ? 20 : 5);

                score = Math.min(100, Math.max(0, score));
                resolve(score);
            }
        }

        loop();
    });
}

// ------------------------------------------------------------
//  ANALYSE DES NOTES BRUTES
// ------------------------------------------------------------
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

    const lastDuration = rawNotes[rawNotes.length - 1].time - start;
    result.push({ pitch: current, type: durationToType(lastDuration) });

    notesHistory.push(...result);
    rawNotes = [];

    displayHistory();
}

// ---------- Durée d’un bloc de 2 mesures ----------
function getBatchDurationMs() {
    const tempo = parseInt(tempoInput.value);
    const beats = parseInt(signatureInput.value);

    const quarterMs = 60000 / tempo;
    const measureMs = beats * quarterMs;

    return measureMs * 2;
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

// ------------------------------------------------------------
//  LECTURE AUDIO (ADSR)
// ------------------------------------------------------------
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

    const A = 0.01;
    const D = 0.05;
    const S = 0.3;
    const R = 0.1;

    const t0 = startTime;
    const t1 = t0 + durationMs / 1000;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.4, t0 + A);
    gain.gain.linearRampToValueAtTime(S, t0 + A + D);
    gain.gain.setValueAtTime(S, t1 - R);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.start(t0);
    osc.stop(t1 + 0.05);
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

        const adjustedDur = durMs * 0.95;

        playNote(freq, adjustedDur, start + offset / 1000);
        offset += durMs;
    }

    statusMsg.textContent = "Lecture en cours…";
    setTimeout(() => statusMsg.textContent = "", offset + 500);
}

// ------------------------------------------------------------
//  DÉTECTION AVEC AUTO-FFT (commit 4)
// ------------------------------------------------------------
async function updatePitch(analyser, audioContext) {
    const fftSize = await detectCpuPower();
    analyser.fftSize = fftSize;

    console.log("FFT auto‑sélectionnée :", fftSize);

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

            if (lastPitch !== letter) {
                rawNotes.push({ pitch: letter, time: now });
                lastPitch = letter;
            }
        }

        if (now - lastBatchTime >= batchDuration) {
            analyzeBatch();
            lastBatchTime = now;
        }

        requestAnimationFrame(loop);
    }

    loop();
}

// ------------------------------------------------------------
//  MICRO
// ------------------------------------------------------------
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

    statusMsg.textContent = "Analyse de la qualité audio…";

    const score = await analyzeAudioQuality(analyser, audioContext);

    if (score < 30) {
        statusMsg.textContent = `Qualité trop faible (${score.toFixed(0)}%) : transcription impossible.`;
        return;
    }

    if (score < 60) {
        statusMsg.textContent = `Qualité moyenne (${score.toFixed(0)}%) : transcription partielle possible.`;
    } else {
        statusMsg.textContent = `Bonne qualité (${score.toFixed(0)}%) : transcription fiable.`;
    }

    updatePitch(analyser, audioContext);
}

// ------------------------------------------------------------
//  FICHIER AUDIO
// ------------------------------------------------------------
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

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    source.start();

    statusMsg.textContent = "Analyse de la qualité audio…";

    const score = await analyzeAudioQuality(analyser, audioContext);

    if (score < 30) {
        statusMsg.textContent = `Qualité trop faible (${score.toFixed(0)}%) : transcription impossible.`;
        return;
    }

    if (score < 60) {
        statusMsg.textContent = `Qualité moyenne (${score.toFixed(0)}%) : transcription partielle possible.`;
    } else {
        statusMsg.textContent = `Bonne qualité (${score.toFixed(0)}%) : transcription fiable.`;
    }

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
