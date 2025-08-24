const canvas = document.getElementById('audioCanvas');
const canvasContainer = document.getElementById('canvas-container');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const statusEl = document.getElementById('status');
const playButton = document.getElementById('playButton');

const CANVAS_HEIGHT = 42;
const INITIAL_CANVAS_WIDTH = 1000;
canvas.height = CANVAS_HEIGHT;
canvas.width = INITIAL_CANVAS_WIDTH;

let audioContext;
let stream;
let analyser;
let source;
let isRecording = false;
let animationFrameId;

// We will write data sequentially like a file stream.
// This tracks the current byte position in our "pixel file".
let byteIndex = 0;
const HEADER_SIZE_BYTES = 16; // 4 pixels for metadata

function getPixelCoordinates(byteIdx) {
    const pixelNum = Math.floor(byteIdx / 4);
    const x = pixelNum % canvas.width;
    const y = Math.floor(pixelNum / canvas.width);
    return { x, y };
}

function expandCanvas() {
    const newWidth = canvas.width * 2;
    console.log(`Expanding canvas to ${newWidth}x${CANVAS_HEIGHT}`);
    
    // Create a temporary canvas to hold the current image data
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);

    // Resize the main canvas and draw the old data back
    canvas.width = newWidth;
    ctx.drawImage(tempCanvas, 0, 0);
}

// Writes the metadata header to the first few pixels.
function writeHeader(sampleRate, bufferLength) {
    const headerData = new Uint8ClampedArray(HEADER_SIZE_BYTES);
    const headerView = new DataView(headerData.buffer);

    // Magic number "ABV1" (Audio Bits Version 1) to identify our data
    headerView.setUint8(0, 'A'.charCodeAt(0));
    headerView.setUint8(1, 'B'.charCodeAt(0));
    headerView.setUint8(2, 'V'.charCodeAt(0));
    headerView.setUint8(3, '1'.charCodeAt(0));

    // Store sampleRate (as Uint32)
    headerView.setUint32(4, sampleRate, true); // little-endian

    // Store bufferLength/fftSize (as Uint32)
    headerView.setUint32(8, bufferLength, true);

    // Reserved for future use (e.g., total sample count)
    headerView.setUint32(12, 0, true);

    const imageData = ctx.createImageData(4, 1);
    imageData.data.set(headerData);
    ctx.putImageData(imageData, 0, 0);

    byteIndex = HEADER_SIZE_BYTES; // Start writing audio data after the header
}

// Function to draw audio data as pixels
function drawAudioData() {
    if (!isRecording || !analyser) return;

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // dataArray contains raw audio samples (0-255).
    // We write these bytes directly to the RGBA channels of pixels.
    for (let i = 0; i < dataArray.length; i += 4) {
        const { x, y } = getPixelCoordinates(byteIndex);

        // Expand canvas if we're about to write off the edge
        if (x >= canvas.width) {
            expandCanvas();
            // Re-calculate coordinates with new width
            const newCoords = getPixelCoordinates(byteIndex);
            x = newCoords.x;
            y = newCoords.y;
        }

        // We can't write past the canvas height. Stop if we run out of room.
        if (y >= CANVAS_HEIGHT) {
            console.warn("Canvas height limit reached. Stopping recording.");
            stop();
            statusEl.textContent = "Stopped: Ran out of vertical canvas space.";
            return;
        }
        
        // We write 4 bytes at a time (one pixel)
        const r = dataArray[i];
        const g = dataArray[i + 1] !== undefined ? dataArray[i + 1] : 128;
        const b = dataArray[i + 2] !== undefined ? dataArray[i + 2] : 128;
        const a = dataArray[i + 3] !== undefined ? dataArray[i + 3] : 255; // Alpha full on

        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(x, y, 1, 1);

        byteIndex += 4;
    }

    // Auto-scroll to show the latest data
    const currentPos = getPixelCoordinates(byteIndex);
    canvasContainer.scrollLeft = Math.max(0, currentPos.x - canvasContainer.clientWidth + 50);

    animationFrameId = requestAnimationFrame(drawAudioData);
}

async function decodeAndPlayAudio() {
    if (byteIndex <= HEADER_SIZE_BYTES) {
        statusEl.textContent = 'No audio data to decode!';
        return;
    }

    try {
        statusEl.textContent = 'Decoding pixels to audio...';
        
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        const maxPixelsToRead = Math.ceil(byteIndex / 4);
        const maxX = maxPixelsToRead % canvas.width;
        const maxY = Math.floor(maxPixelsToRead / canvas.width);
        const lastRowWidth = maxY + 1 > CANVAS_HEIGHT ? 0 : (maxY === Math.floor((maxPixelsToRead-1)/canvas.width)) ? maxX : canvas.width;
        const totalRows = Math.min(CANVAS_HEIGHT, maxY + 1);

        // Read pixel data
        const imageData = ctx.getImageData(0, 0, canvas.width, totalRows).data;

        // Read Header
        const headerView = new DataView(imageData.buffer, 0, HEADER_SIZE_BYTES);
        const magic = String.fromCharCode(headerView.getUint8(0), headerView.getUint8(1), headerView.getUint8(2), headerView.getUint8(3));

        if (magic !== 'ABV1') {
            throw new Error('Invalid data format. Magic number mismatch.');
        }

        const decodedSampleRate = headerView.getUint32(4, true);

        // Extract all audio bytes
        const audioBytes = [];
        const totalBytesToRead = byteIndex;

        for (let i = HEADER_SIZE_BYTES; i < totalBytesToRead; i++) {
             audioBytes.push(imageData[i]);
        }
        
        const totalSamples = audioBytes.length;
        if(totalSamples === 0) {
            statusEl.textContent = 'No audio samples decoded.';
            return;
        }

        const audioBuffer = audioCtx.createBuffer(1, totalSamples, decodedSampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Convert from Uint8 (0-255) to Float32 (-1.0 to 1.0)
        for (let i = 0; i < totalSamples; i++) {
            channelData[i] = (audioBytes[i] / 127.5) - 1.0;
        }

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start();

        const duration = audioBuffer.duration;
        statusEl.textContent = `Playing decoded audio (${duration.toFixed(2)}s @ ${decodedSampleRate}Hz)`;

        source.onended = () => {
            statusEl.textContent = `Playback finished. Decoded ${totalSamples} samples.`;
            audioCtx.close();
        };

    } catch (err) {
        console.error('Error decoding audio:', err);
        statusEl.textContent = `Error playing audio: ${err.message}`;
    }
}

async function start() {
    try {
        statusEl.textContent = 'Requesting microphone access...';
        
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') await audioContext.resume();
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048; // A common, good-quality buffer size
        analyser.smoothingTimeConstant = 0.0;
        
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        isRecording = true;
        startButton.textContent = 'Stop Listening';
        startButton.classList.add('recording');
        statusEl.textContent = 'Listening... Speak to generate audio pixels.';

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        byteIndex = 0;
        
        writeHeader(audioContext.sampleRate, analyser.fftSize);

        drawAudioData();

    } catch (err) {
        console.error('Error accessing microphone:', err);
        statusEl.textContent = `Error: ${err.message}. Please allow microphone access.`;
    }
}

function stop() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (source) source.disconnect();
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().then(() => audioContext = null);
    }

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    isRecording = false;
    startButton.textContent = 'Start Listening';
    startButton.classList.remove('recording');
    statusEl.textContent = 'Stopped. Ready to record again or play back.';
    
    if (byteIndex > HEADER_SIZE_BYTES) {
        playButton.disabled = false;
    }
}

playButton.addEventListener('click', decodeAndPlayAudio);

startButton.addEventListener('click', () => {
    if (!isRecording) {
        playButton.disabled = true;
        start();
    } else {
        stop();
    }
});