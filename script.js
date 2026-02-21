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

// ---------- Historique des notes ----------

let notesHistory = []; // ex: ["C", "D", "E", "F", "G#"]

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

// ---------- Génération MusicXML avec mesures automatiques ----------

function generateMusicXML(history) {
    if (history.length === 0) {
        // partition vide minimale
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
        for (const letter of slice) {
            const step = letter[0];
            const alter = letter[1] === "#" ? "<alter>1</alter>" : "";

            notesXML += `
            <note>
              <pitch>
                <step>${step}</step>
                ${alter}
                <octave>4</octave>
              </pitch>
              <duration>1</duration>
              <type>quarter</type>
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

// ---------- Affichage de la partition complète ----------

async function displayHistory() {
    const xml = generateMusicXML(notesHistory);
    await osmd.load(xml);
    osmd.render();
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

                // Ajoute la note à l'historique
                notesHistory.push(letter);

                // Réaffiche toute la partition (qui s’allonge proprement)
                await displayHistory();
            }
        }

        requestAnimationFrame(loop);
    }

    loop();
}

// ---------- Micro ----------

async function startListening() {
    notesHistory = []; // reset historique
    await displayHistory(); // partition vide propre

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    updatePitch(analyser, audioContext);
}

// ---------- Fichier audio ----------

async function handleFile(event) {
    notesHistory = []; // reset historique
    await displayHistory();

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

// ---------- Events ----------

startBtn.addEventListener("click", startListening);
audioFile.addEventListener("change", handleFile);

// Partition vide au chargement
displayHistory();
