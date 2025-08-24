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

// Buffer to hold audio data between processing frames
let audioDataQueue = [];
let animationFrameId;

// Function to handle drawing the audio data to the canvas
function drawAudioColumns() {
    // Process all data in the queue
    while (audioDataQueue.length > 0) {
        const buffer = audioDataQueue.shift();
        
        // We need 4 audio samples to create one RGBA pixel.
        // Each column is CANVAS_HEIGHT pixels tall.
        const samplesPerColumn = CANVAS_HEIGHT * 4;

        if (buffer.length >= samplesPerColumn) {
            const pixelData = new Uint8ClampedArray(samplesPerColumn);

            for (let i = 0; i < samplesPerColumn; i++) {
                // Map audio sample from [-1, 1] to a color component [0, 255]
                pixelData[i] = (buffer[i] + 1) * 127.5;
            }

            // Create an ImageData object for the single column
            const columnImageData = new ImageData(pixelData, 1, CANVAS_HEIGHT);

            // Draw this column onto the canvas at the current X position
            ctx.putImageData(columnImageData, currentX, 0);

            // Move to the next column
            currentX++;

            // If we reach the end of the canvas, expand it
            if (currentX >= canvas.width) {
                const newWidth = canvas.width + INITIAL_CANVAS_WIDTH;
                // Create a temporary canvas to hold the current content
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvas.width;
                tempCanvas.height = canvas.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(canvas, 0, 0);
                // Resize the main canvas and draw the old content back
                canvas.width = newWidth;
                ctx.drawImage(tempCanvas, 0, 0);
            }
            
            // Auto-scroll to the latest drawing position
            canvasContainer.scrollLeft = currentX;
        }
    }
    // Continue the drawing loop
    animationFrameId = requestAnimationFrame(drawAudioColumns);
}

async function start() {
    try {
        statusEl.textContent = 'Requesting microphone access...';
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Resume context if it's in a suspended state (for browser autoplay policies)
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Using ScriptProcessorNode for simplicity.
        // A buffer size of 2048 gives us a decent chunk of data to process.
        const bufferSize = 2048; 
        
        source = audioContext.createMediaStreamSource(stream);
        scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

        scriptNode.onaudioprocess = (audioProcessingEvent) => {
            const inputBuffer = audioProcessingEvent.inputBuffer;
            const inputData = inputBuffer.getChannelData(0); // Get data from the first channel
            
            // The getChannelData returns a Float32Array, which is what we want.
            // We push the whole buffer to our queue.
            // A copy is needed because the underlying buffer is reused.
            audioDataQueue.push(new Float32Array(inputData));
        };

        source.connect(scriptNode);
        scriptNode.connect(audioContext.destination);

        isRecording = true;
        startButton.textContent = 'Stop Listening';
        startButton.classList.add('recording');
        statusEl.textContent = 'Listening... Your voice is being drawn on the canvas.';

        // Start the drawing loop
        drawAudioColumns();

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
        // Use a Promise-based close to handle it correctly.
        audioContext.close().then(() => {
            audioContext = null;
        });
    }

    // Stop the drawing loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Clear any remaining data
    audioDataQueue = [];

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