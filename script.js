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

// ---------- Historique des notes ----------
// Chaque entrée : { pitch: "C" | "D#" | ..., type: "quarter" | "eighth" | ... }
let notesHistory = [];

// ---------- Patch anti-freeze ----------
let lastRenderTime = 0; // OSMD ne rerend pas plus de 2 fois/sec

// ---------- Temps de la dernière note ----------
let lastNoteTime = 0;

// ---------- Solfège ↔ Anglo-saxon ----------
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
    return notes[(midi % 12 + 12) % 12];
}

// ---------- Durée → type de note ----------
function durationToType(ms) {
    if (ms < 150) return "32nd";     // triple-croche
    if (ms < 300) return "16th";     // double-croche
    if (ms < 600) return "eighth";   // croche
    if (ms < 1200) return "quarter"; // noire
    if (ms < 2400) return "half";    // blanche
    return "whole";                  // ronde
}

// ---------- Type → durée en ms (pour lecture) ----------
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

// ---------- Note → fréquence (pour lecture) ----------
function letterToFreq(letter) {
    const map = {
        "C": 261.63,
        "C#": 277.18,
        "D": 293.66,
        "D#": 311.13,
        "E": 329.63,
        "F": 349.23,
        "F#": 369.99,
        "G": 392.00,
        "G#": 415.30,
        "A": 440.00,
        "A#": 466.16,
        "B": 493.88
    };
    return map[letter] || 440;
}

// ---------- Génération MusicXML ----------
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
                <time><beats>4</beats><beat-type>4</beat-type></time>
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

// ---------- Affichage de la partition ----------
async function displayHistory() {
    const xml = generateMusicXML(notesHistory);
    await osmd.load(xml);
    osmd.render();
}

// ---------- Synthé simple pour lecture ----------
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

    const t0 = startTime;
    const t1 = t0 + durationMs / 1000;

    gain.gain.setValueAtTime(0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.start(t0);
    osc.stop(t1);
}

function playScore() {
    if (notesHistory.length === 0) {
        statusMsg.textContent = "Aucune note à rejouer pour l’instant.";
        return;
    }

    ensureAudioContext();
    const start = audioCtx.currentTime;
    let offset = 0;

    for (const note of notesHistory) {
        const freq = letterToFreq(note.pitch);
        const durMs = typeToMs(note.type);
        playNote(freq, durMs, start + offset / 1000);
        offset += durMs;
    }

    statusMsg.textContent = "Lecture de la partition en cours…";
    setTimeout(() => {
        if (statusMsg.textContent.startsWith("Lecture")) {
            statusMsg.textContent = "";
        }
    }, offset + 500);
}

// ---------- Boucle de détection ----------
function updatePitch(analyser, audioContext) {
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const buffer = new Float32Array(analyser.fftSize);

    async function loop() {
        analyser.getFloatTimeDomainData(buffer);
        const [pitch, clarity] = detector.findPitch(buffer, audioContext.sampleRate);

        if (clarity > 0.9 && pitch > 50 && pitch < 2000) {
            const solf = freqToSolfege(pitch);
            const letter = solfegeToLetter[solf];

            if (letter) {
                freqDisplay.textContent = pitch.toFixed(1) + " Hz";
                noteDisplay.textContent = solf;
                statusMsg.textContent = ""; // on efface un éventuel message d’erreur

                const now = performance.now();
                const delta = lastNoteTime ? now - lastNoteTime : 600;
                lastNoteTime = now;

                const type = durationToType(delta);
                durationDisplay.textContent = type;

                notesHistory.push({
                    pitch: letter,
                    type: type
                });

                const t = performance.now();
                if (t - lastRenderTime > 500) {
                    lastRenderTime = t;
                    await displayHistory();
                }
            }
        }

        requestAnimationFrame(loop);
    }

    loop();
}

// ---------- Micro ----------
async function startListening() {
    notesHistory = [];
    lastNoteTime = 0;
    statusMsg.textContent = "Écoute du micro en cours…";
    await displayHistory();

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    updatePitch(analyser, audioContext);
}

// ---------- Fichier audio ----------
async function handleFile(event) {
    notesHistory = [];
    lastNoteTime = 0;
    await displayHistory();
    statusMsg.textContent = "Analyse du fichier en cours…";

    const file = event.target.files[0];
    if (!file) {
        statusMsg.textContent = "Aucun fichier sélectionné.";
        return;
    }

    if (!file.type.startsWith("audio/")) {
        statusMsg.textContent = "Ce fichier n’est pas un fichier audio.";
        return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    source.start();

    // Si après X secondes aucune note n’a été détectée → impossible à transcrire
    notesHistory = [];
    lastNoteTime = 0;
    updatePitch(analyser, audioContext);

    setTimeout(() => {
        if (notesHistory.length === 0) {
            statusMsg.textContent = "Impossible à transcrire : trop de polyphonie, bruit ou signal non exploitable.";
        } else {
            statusMsg.textContent = "";
        }
    }, 7000); // 7 secondes d’analyse
}

// ---------- Events ----------
startBtn.addEventListener("click", startListening);
audioFile.addEventListener("change", handleFile);
playBtn.addEventListener("click", playScore);

// Partition vide au chargement
displayHistory();
