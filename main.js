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

    // Get frequency data from the analyser
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Create pixel data for one column (height = 42 pixels)
    const imageData = ctx.createImageData(1, CANVAS_HEIGHT);
    const pixels = imageData.data;

    // Map the first 42 frequency values to pixels (or repeat if we have fewer)
    for (let y = 0; y < CANVAS_HEIGHT; y++) {
        const audioIndex = Math.floor((y / CANVAS_HEIGHT) * bufferLength);
        const audioValue = dataArray[audioIndex] || 0;
        
        const pixelIndex = y * 4; // Each pixel is 4 bytes (RGBA)
        
        // Convert audio value (0-255) to color
        // Use the audio value for different color channels
        pixels[pixelIndex] = audioValue;     // Red
        pixels[pixelIndex + 1] = audioValue * 0.7; // Green (slightly less)
        pixels[pixelIndex + 2] = audioValue * 0.4; // Blue (even less)
        pixels[pixelIndex + 3] = 255; // Alpha (fully opaque)
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

        // Duration: each column represents ~20ms of audio (50fps)
        const duration = currentX * 0.02;
        const sampleRate = audioContext.sampleRate;
        const frameCount = duration * sampleRate;
        
        // Create audio buffer
        const audioBuffer = audioContext.createBuffer(1, frameCount, sampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Convert pixels back to audio
        for (let x = 0; x < currentX; x++) {
            // Calculate time position for this column
            const timeStart = (x / currentX) * duration;
            const sampleStart = Math.floor(timeStart * sampleRate);
            const sampleEnd = Math.floor(((x + 1) / currentX) * duration * sampleRate);

            // Extract frequency data from this column
            const frequencies = [];
            for (let y = 0; y < CANVAS_HEIGHT; y++) {
                const pixelIndex = (y * currentX + x) * 4;
                const red = pixels[pixelIndex];
                // Convert back from our encoding (we used red channel primarily)
                frequencies.push(red);
            }

            // Generate audio samples for this time slice using frequency data
            for (let sample = sampleStart; sample < sampleEnd && sample < frameCount; sample++) {
                let amplitude = 0;
                const time = sample / sampleRate;
                
                // Create audio by combining sine waves based on frequency data
                for (let freqBin = 0; freqBin < frequencies.length; freqBin++) {
                    const frequency = (freqBin / frequencies.length) * 1000 + 100; // 100-1100 Hz range
                    const magnitude = frequencies[freqBin] / 255 * 0.1; // Scale down volume
                    amplitude += Math.sin(2 * Math.PI * frequency * time) * magnitude;
                }
                
                channelData[sample] = amplitude * 0.3; // Overall volume control
            }
        }

        // Create buffer source and play
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Add some filtering to make it sound less harsh
        const filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, audioContext.currentTime);
        
        source.connect(filter);
        filter.connect(audioContext.destination);
        
        source.start();
        
        statusEl.textContent = `Playing decoded audio (${duration.toFixed(1)}s)...`;
        
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
        
        // Create analyser for frequency data
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 128; // Small FFT size for responsiveness
        analyser.smoothingTimeConstant = 0.3;
        
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