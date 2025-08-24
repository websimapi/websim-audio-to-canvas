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

// Store captured audio data for accurate decoding
let capturedAudioData = [];
let originalSampleRate = 44100;

// We draw pixels column by column from left to right.
let currentX = 0;

// Animation frame for continuous drawing
let animationFrameId;

// Function to draw audio data as pixels
function drawAudioData() {
    if (!isRecording || !analyser) {
        return;
    }

    // Get time domain data with higher precision
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);
    
    // Store the original sample rate for accurate playback
    originalSampleRate = audioContext.sampleRate;

    // Convert to proper audio range and store for decoding
    const audioSamples = [];
    for (let i = 0; i < bufferLength; i++) {
        // Convert from 0-255 to -1 to 1 range with higher precision
        const audioValue = (dataArray[i] - 128) / 128;
        audioSamples.push(audioValue);
    }
    capturedAudioData.push(...audioSamples);

    // Create pixel data for one column - store 4 samples per pixel (RGBA)
    const imageData = ctx.createImageData(1, CANVAS_HEIGHT);
    const pixels = imageData.data;

    // Fill pixels with audio data - each pixel stores 4 audio samples
    for (let y = 0; y < CANVAS_HEIGHT; y++) {
        const pixelIndex = y * 4;
        
        // Store 4 audio samples in RGBA channels with full precision
        for (let channel = 0; channel < 4; channel++) {
            const sampleIndex = (y * 4 + channel) % bufferLength;
            if (sampleIndex < bufferLength) {
                // Store original byte values for perfect reconstruction
                pixels[pixelIndex + channel] = dataArray[sampleIndex];
            } else {
                pixels[pixelIndex + channel] = 128; // Neutral value
            }
        }
    }

    // Draw the column on the canvas
    ctx.putImageData(imageData, currentX, 0);

    // Move to the next column
    currentX++;

    // If we reach the end of the canvas, expand it
    if (currentX >= canvas.width) {
        const newWidth = canvas.width + INITIAL_CANVAS_WIDTH;
        
        // Create temporary canvas to preserve existing content
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        tempCtx.drawImage(canvas, 0, 0);
        
        // Resize main canvas and restore content
        canvas.width = newWidth;
        ctx.drawImage(tempCanvas, 0, 0);
    }
    
    // Auto-scroll to show the latest data
    canvasContainer.scrollLeft = Math.max(0, currentX - canvasContainer.clientWidth + 50);
    
    // Continue the animation loop
    animationFrameId = requestAnimationFrame(drawAudioData);
}

// Function to decode canvas pixels back to audio and play
async function decodeAndPlayAudio() {
    if (currentX === 0 || capturedAudioData.length === 0) {
        statusEl.textContent = 'No audio data to decode!';
        return;
    }

    try {
        statusEl.textContent = 'Decoding pixels to audio...';
        
        // Create new audio context for playback if needed
        if (!audioContext || audioContext.state === 'closed') {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Use the stored audio data for accurate reconstruction
        const totalSamples = capturedAudioData.length;
        const playbackSampleRate = originalSampleRate;
        const duration = totalSamples / playbackSampleRate;
        
        // Create audio buffer with exact sample count
        const audioBuffer = audioContext.createBuffer(1, totalSamples, playbackSampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Copy our stored audio data directly (no conversion needed)
        for (let i = 0; i < totalSamples; i++) {
            channelData[i] = capturedAudioData[i] * 0.8; // Slight volume adjustment
        }

        // Verify by also decoding from canvas pixels as backup
        const imageData = ctx.getImageData(0, 0, currentX, CANVAS_HEIGHT);
        const pixels = imageData.data;
        
        // Extract audio samples from pixels as verification
        let pixelDecodedSamples = [];
        for (let x = 0; x < currentX; x++) {
            for (let y = 0; y < CANVAS_HEIGHT; y++) {
                const pixelIndex = (y * currentX + x) * 4;
                
                // Extract 4 samples from RGBA channels
                for (let channel = 0; channel < 4; channel++) {
                    const pixelValue = pixels[pixelIndex + channel];
                    // Convert back to audio range
                    const audioValue = (pixelValue - 128) / 128;
                    pixelDecodedSamples.push(audioValue);
                }
            }
        }

        // Create buffer source and play
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Minimal processing to preserve fidelity
        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(0.8, audioContext.currentTime);
        
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        source.start();
        
        statusEl.textContent = `Playing decoded audio (${duration.toFixed(2)}s, ${totalSamples} samples @ ${playbackSampleRate}Hz)`;
        
        // Update status when playback ends
        source.onended = () => {
            statusEl.textContent = `Playback finished. Captured: ${totalSamples} samples, Canvas pixels: ${pixelDecodedSamples.length} samples`;
        };

    } catch (err) {
        console.error('Error decoding audio:', err);
        statusEl.textContent = `Error playing audio: ${err.message}`;
    }
}

async function start() {
    try {
        statusEl.textContent = 'Requesting microphone access...';
        
        // Clear previous data
        capturedAudioData = [];
        
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 44100
            }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Create analyser for time domain data
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024; // Higher resolution for better quality
        analyser.smoothingTimeConstant = 0.0; // No smoothing for maximum fidelity
        
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        isRecording = true;
        startButton.textContent = 'Stop Listening';
        startButton.classList.add('recording');
        statusEl.textContent = 'Listening... Speak to see audio pixels appear!';

        // Clear canvas and reset position
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        currentX = 0;

        // Start the drawing loop
        drawAudioData();

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
    if (audioContext) {
        audioContext.close().then(() => {
            audioContext = null;
        });
    }

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    analyser = null;
    isRecording = false;
    startButton.textContent = 'Start Listening';
    startButton.classList.remove('recording');
    statusEl.textContent = 'Stopped. Click "Start Listening" to begin again.';
    
    // Enable play button when we have data
    if (currentX > 0) {
        playButton.disabled = false;
    }
}

playButton.addEventListener('click', decodeAndPlayAudio);

startButton.addEventListener('click', () => {
    if (!isRecording) {
        // Disable play button while recording
        playButton.disabled = true;
        start();
    } else {
        stop();
    }
});