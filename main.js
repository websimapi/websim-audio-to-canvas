const canvas = document.getElementById('audioCanvas');
const canvasContainer = document.getElementById('canvas-container');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const statusEl = document.getElementById('status');

const CANVAS_HEIGHT = 42;
const INITIAL_CANVAS_WIDTH = 1000;
canvas.height = CANVAS_HEIGHT;
canvas.width = INITIAL_CANVAS_WIDTH;

let audioContext;
let stream;
let scriptNode;
let source;
let isRecording = false;

// We draw pixels column by column from left to right.
let currentX = 0;

// Function to handle drawing the audio data to the canvas
function drawAudioData(buffer) {
    // A single audio sample is a float from -1.0 to 1.0.
    // An RGBA pixel has four 8-bit components (0-255).
    // We will group 4 audio samples to create one RGBA pixel.
    const pixelData = new Uint8ClampedArray(CANVAS_HEIGHT * 4);

    for (let y = 0; y < CANVAS_HEIGHT; y++) {
        // Calculate the starting index in the audio buffer for this pixel
        const bufferIndex = y * 4;

        if (bufferIndex + 3 < buffer.length) {
            // Map 4 audio samples from [-1, 1] to RGBA values [0, 255]
            const r = (buffer[bufferIndex] + 1) * 127.5;
            const g = (buffer[bufferIndex + 1] + 1) * 127.5;
            const b = (buffer[bufferIndex + 2] + 1) * 127.5;
            // For Alpha, we can use the 4th sample or keep it opaque.
            // Let's use the 4th sample for more interesting patterns.
            const a = (buffer[bufferIndex + 3] + 1) * 127.5;

            const pixelDataIndex = y * 4;
            pixelData[pixelDataIndex] = r;
            pixelData[pixelDataIndex + 1] = g;
            pixelData[pixelDataIndex + 2] = b;
            pixelData[pixelDataIndex + 3] = a;
        } else {
            // If we don't have enough audio data, fill with black
            const pixelDataIndex = y * 4;
            pixelData[pixelDataIndex] = 0;
            pixelData[pixelDataIndex + 1] = 0;
            pixelData[pixelDataIndex + 2] = 0;
            pixelData[pixelDataIndex + 3] = 255;
        }
    }

    // Create an ImageData object for the single column
    const columnImageData = new ImageData(pixelData, 1, CANVAS_HEIGHT);

    // Draw this column onto the canvas at the current X position
    ctx.putImageData(columnImageData, currentX, 0);

    // Move to the next column
    currentX++;

    // If we reach the end of the canvas, expand it
    if (currentX >= canvas.width) {
        canvas.width += INITIAL_CANVAS_WIDTH;
    }
    
    // Auto-scroll to the latest drawing position
    canvasContainer.scrollLeft = currentX;
}

async function start() {
    try {
        statusEl.textContent = 'Requesting microphone access...';
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Using ScriptProcessorNode for simplicity, though it's deprecated.
        // For production, AudioWorklet would be better.
        // We need a small buffer size to get data quickly enough to draw pixel by pixel.
        // Buffer size needs to be a power of 2.
        // 256 samples is enough for 256 / 4 = 64 pixels, more than our height of 42.
        const bufferSize = 256; 
        
        source = audioContext.createMediaStreamSource(stream);
        scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

        scriptNode.onaudioprocess = (audioProcessingEvent) => {
            const inputBuffer = audioProcessingEvent.inputBuffer;
            const inputData = inputBuffer.getChannelData(0); // Get data from the first channel
            drawAudioData(inputData);
        };

        source.connect(scriptNode);
        scriptNode.connect(audioContext.destination);

        isRecording = true;
        startButton.textContent = 'Stop Listening';
        startButton.classList.add('recording');
        statusEl.textContent = 'Listening... Your voice is being drawn on the canvas.';

    } catch (err) {
        console.error('Error accessing microphone:', err);
        statusEl.textContent = `Error: ${err.message}. Please allow microphone access.`;
    }
}

function stop() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (source) {
        source.disconnect();
    }
    if (scriptNode) {
        scriptNode.disconnect();
        scriptNode.onaudioprocess = null;
    }
    if (audioContext) {
        audioContext.close();
    }

    isRecording = false;
    startButton.textContent = 'Start Listening';
    startButton.classList.remove('recording');
    statusEl.textContent = 'Stopped. Click "Start Listening" to begin again.';
}

startButton.addEventListener('click', () => {
    if (!isRecording) {
        start();
    } else {
        stop();
    }
});

