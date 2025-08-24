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
let startTime = 0; // Add timing reference

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

    // Convert and store audio samples with full precision
    const audioSamples = [];
    for (let i = 0; i < bufferLength; i++) {
        // Store original values directly for maximum fidelity
        audioSamples.push(dataArray[i]);
    }
    capturedAudioData.push(...audioSamples);

    // Create pixel data for one column
    const imageData = ctx.createImageData(1, CANVAS_HEIGHT);
    const pixels = imageData.data;

    // Store metadata in the first column
    if (currentX === 0) {
        // Store sample rate in first 4 pixels (16 bytes total)
        const sampleRateBytes = new Uint32Array([originalSampleRate]);
        const sampleRateU8 = new Uint8Array(sampleRateBytes.buffer);
        
        // First pixel: sample rate (4 bytes in RGBA)
        pixels[0] = sampleRateU8[0]; // R
        pixels[1] = sampleRateU8[1]; // G  
        pixels[2] = sampleRateU8[2]; // B
        pixels[3] = sampleRateU8[3]; // A
        
        // Second pixel: buffer length info
        const bufferLengthBytes = new Uint32Array([bufferLength]);
        const bufferLengthU8 = new Uint8Array(bufferLengthBytes.buffer);
        pixels[4] = bufferLengthU8[0]; // R
        pixels[5] = bufferLengthU8[1]; // G
        pixels[6] = bufferLengthU8[2]; // B
        pixels[7] = bufferLengthU8[3]; // A
        
        // Third pixel: timestamp info
        startTime = audioContext.currentTime;
        const timeBytes = new Float32Array([startTime]);
        const timeU8 = new Uint8Array(timeBytes.buffer);
        pixels[8] = timeU8[0];   // R
        pixels[9] = timeU8[1];   // G
        pixels[10] = timeU8[2];  // B
        pixels[11] = timeU8[3];  // A
        
        // Fill remaining pixels with audio data starting from pixel 3 (index 12)
        for (let y = 3; y < CANVAS_HEIGHT; y++) {
            const pixelIndex = y * 4;
            const audioIndex = (y - 3) * 4;
            
            // Store 4 audio samples in RGBA channels with full 0-255 range
            for (let channel = 0; channel < 4; channel++) {
                if (audioIndex + channel < bufferLength) {
                    pixels[pixelIndex + channel] = dataArray[audioIndex + channel];
                } else {
                    pixels[pixelIndex + channel] = 128; // Neutral value
                }
            }
        }
    } else {
        // For subsequent columns, store only audio data using full RGBA
        for (let y = 0; y < CANVAS_HEIGHT; y++) {
            const pixelIndex = y * 4;
            const audioBaseIndex = (currentX - 1) * (CANVAS_HEIGHT * 4) + (CANVAS_HEIGHT - 3) * 4 + y * 4;
            
            // Store 4 audio samples in RGBA channels
            for (let channel = 0; channel < 4; channel++) {
                const sampleIndex = audioBaseIndex + channel;
                if (sampleIndex < capturedAudioData.length) {
                    pixels[pixelIndex + channel] = capturedAudioData[sampleIndex];
                } else {
                    // Fill with new data if available
                    const newSampleIndex = (y * 4 + channel) % bufferLength;
                    pixels[pixelIndex + channel] = dataArray[newSampleIndex];
                }
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

        // Extract all data from canvas pixels
        const imageData = ctx.getImageData(0, 0, currentX, CANVAS_HEIGHT);
        const pixels = imageData.data;
        
        // Extract metadata from first column
        const sampleRateU8 = new Uint8Array(4);
        sampleRateU8[0] = pixels[0];  // R
        sampleRateU8[1] = pixels[1];  // G
        sampleRateU8[2] = pixels[2];  // B
        sampleRateU8[3] = pixels[3];  // A
        const decodedSampleRate = new Uint32Array(sampleRateU8.buffer)[0];
        
        const bufferLengthU8 = new Uint8Array(4);
        bufferLengthU8[0] = pixels[4];  // R
        bufferLengthU8[1] = pixels[5];  // G
        bufferLengthU8[2] = pixels[6];  // B
        bufferLengthU8[3] = pixels[7];  // A
        const decodedBufferLength = new Uint32Array(bufferLengthU8.buffer)[0];

        // Extract all audio samples from pixels
        let allSamples = [];
        
        // First column: extract from pixel 3 onwards (skip metadata pixels)
        for (let y = 3; y < CANVAS_HEIGHT; y++) {
            const pixelIndex = y * 4;
            // Extract 4 samples from RGBA
            for (let channel = 0; channel < 4; channel++) {
                const pixelValue = pixels[pixelIndex + channel];
                // Convert from 0-255 to -1 to 1 range for audio
                const audioValue = (pixelValue - 128) / 128;
                allSamples.push(audioValue);
            }
        }
        
        // Remaining columns: extract all pixels as audio data
        for (let x = 1; x < currentX; x++) {
            for (let y = 0; y < CANVAS_HEIGHT; y++) {
                const pixelIndex = (y * currentX + x) * 4;
                
                // Extract 4 samples from RGBA channels
                for (let channel = 0; channel < 4; channel++) {
                    const pixelValue = pixels[pixelIndex + channel];
                    // Convert from 0-255 to -1 to 1 range for audio
                    const audioValue = (pixelValue - 128) / 128;
                    allSamples.push(audioValue);
                }
            }
        }

        const totalSamples = allSamples.length;
        const duration = totalSamples / decodedSampleRate;
        
        // Create audio buffer with decoded parameters
        const audioBuffer = audioContext.createBuffer(1, totalSamples, decodedSampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Copy decoded samples to audio buffer
        for (let i = 0; i < totalSamples; i++) {
            channelData[i] = allSamples[i] * 0.8; // Volume adjustment
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
        
        statusEl.textContent = `Playing decoded audio (${duration.toFixed(2)}s, ${totalSamples} samples @ ${decodedSampleRate}Hz from pixels)`;
        
        // Update status when playback ends
        source.onended = () => {
            statusEl.textContent = `Playback finished. Decoded from pixels: ${totalSamples} samples @ ${decodedSampleRate}Hz`;
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