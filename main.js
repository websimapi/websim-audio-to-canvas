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

// We draw pixels column by column from left to right.
let currentX = 0;

// Animation frame for continuous drawing
let animationFrameId;

// Function to draw audio data as pixels
function drawAudioData() {
    if (!isRecording || !analyser) {
        return;
    }

    // Get time domain data (actual waveform) instead of frequency data
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // Create pixel data for one column (height = 42 pixels)
    const imageData = ctx.createImageData(1, CANVAS_HEIGHT);
    const pixels = imageData.data;

    // Store audio samples in pixels - we can store multiple samples per column
    // Each pixel can hold 4 audio samples (one per RGBA channel)
    const samplesPerColumn = CANVAS_HEIGHT * 4; // 42 * 4 = 168 samples per column
    
    for (let y = 0; y < CANVAS_HEIGHT; y++) {
        const pixelIndex = y * 4; // Each pixel is 4 bytes (RGBA)
        
        // Store 4 audio samples in this pixel
        for (let channel = 0; channel < 4; channel++) {
            const sampleIndex = (y * 4 + channel) % bufferLength;
            const audioValue = dataArray[sampleIndex];
            pixels[pixelIndex + channel] = audioValue;
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
    if (currentX === 0) {
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

        // Get pixel data from canvas
        const imageData = ctx.getImageData(0, 0, currentX, CANVAS_HEIGHT);
        const pixels = imageData.data;

        // Calculate how many audio samples we have stored
        const samplesPerColumn = CANVAS_HEIGHT * 4; // 168 samples per column
        const totalSamples = currentX * samplesPerColumn;
        
        // Create a much longer audio buffer to accommodate all samples
        // Use a sample rate that matches our capture rate
        const sampleRate = audioContext.sampleRate;
        const playbackDuration = totalSamples / (sampleRate * 0.1); // Adjust timing factor
        const frameCount = Math.floor(playbackDuration * sampleRate);
        
        // Create audio buffer
        const audioBuffer = audioContext.createBuffer(1, frameCount, sampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Extract audio samples directly from pixels
        let audioSamples = [];
        
        for (let x = 0; x < currentX; x++) {
            for (let y = 0; y < CANVAS_HEIGHT; y++) {
                const pixelIndex = (y * currentX + x) * 4;
                
                // Extract 4 samples from each pixel (RGBA channels)
                for (let channel = 0; channel < 4; channel++) {
                    const pixelValue = pixels[pixelIndex + channel];
                    // Convert from 0-255 back to -1 to 1 range
                    const audioValue = (pixelValue - 128) / 128;
                    audioSamples.push(audioValue);
                }
            }
        }

        // Fill the audio buffer with our reconstructed samples
        // Stretch or compress to fit the playback duration
        for (let i = 0; i < frameCount; i++) {
            const sampleIndex = Math.floor((i / frameCount) * audioSamples.length);
            if (sampleIndex < audioSamples.length) {
                channelData[i] = audioSamples[sampleIndex] * 0.5; // Volume control
            }
        }

        // Create buffer source and play
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Add minimal filtering to reduce artifacts
        const filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(8000, audioContext.currentTime); // Higher cutoff
        filter.Q.setValueAtTime(0.5, audioContext.currentTime);
        
        source.connect(filter);
        filter.connect(audioContext.destination);
        
        source.start();
        
        statusEl.textContent = `Playing decoded audio (${playbackDuration.toFixed(1)}s, ${audioSamples.length} samples)...`;
        
        // Update status when playback ends
        source.onended = () => {
            statusEl.textContent = 'Playback finished.';
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
                autoGainControl: false
            }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Create analyser for time domain data
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512; // Larger FFT for more time domain samples
        analyser.smoothingTimeConstant = 0.1; // Less smoothing for better fidelity
        
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