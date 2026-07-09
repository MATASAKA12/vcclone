// Simple signaling via Socket.io client
import io from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

// Warp helpers
import { warpFace } from './warp.js';

// === INFER_URL: Colab/ngrok URL ===
const INFER_URL = 'https://finless-multitude-contort.ngrok-free.dev';

const e = React.createElement;

function App() {
  const [room, setRoom] = React.useState('room1');
  const localVideoRef = React.useRef(null);
  const remoteVideoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const refImage = React.useRef(null);
  const pcRef = React.useRef(null);
  const socketRef = React.useRef(null);
  const faceMeshRef = React.useRef(null);
  const cameraLoopRef = React.useRef(null);

  React.useEffect(() => {
    // no-op on mount
  }, []);

  // Throttled send to inference server
  async function sendFrameToServer(source) {
    if (!INFER_URL || INFER_URL.includes('<PASTE')) return;
    try {
      const off = document.createElement('canvas');
      const W = 256, H = 192;
      off.width = W; off.height = H;
      const ctx = off.getContext('2d');
      ctx.drawImage(source, 0, 0, W, H);
      const dataUrl = off.toDataURL('image/jpeg', 0.6);
      const res = await fetch(INFER_URL + '/infer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      });
      const j = await res.json();
      if (j.image) {
        const img = new Image();
        img.onload = () => {
          const mainCanvas = canvasRef.current;
          const cctx = mainCanvas.getContext('2d');
          cctx.clearRect(0,0,mainCanvas.width, mainCanvas.height);
          cctx.drawImage(img, 0, 0, mainCanvas.width, mainCanvas.height);
        };
        img.src = j.image;
      }
    } catch (err) {
      console.warn('infer error', err);
    }
  }

  async function joinRoom() {
    // guard duplicate joins to avoid attaching listeners multiple times
    if (socketRef.current) {
      console.log('Already joined room — ignoring duplicate join');
      return;
    }

    socketRef.current = io();

    socketRef.current.on('connect', () => console.log('socket connected', socketRef.current.id));

    socketRef.current.on('signal', async ({ from, data }) => {
      if (!pcRef.current) return;
      try {
        if (data.type === 'offer') {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data));
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          socketRef.current.emit('signal', { to: from, data: pcRef.current.localDescription });
        } else if (data.type === 'answer') {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data));
        } else if (data.candidate) {
          try { await pcRef.current.addIceCandidate(data); } catch(e){console.warn('ICE add failed', e)}
        }
      } catch (err) {
        console.error('Error handling signal', err);
      }
    });

    socketRef.current.emit('join', room);

    // get camera
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      console.error('getUserMedia failed', err);
      alert('Camera/microphone access is required. Check permissions.');
      return;
    }

    localVideoRef.current.srcObject = stream;
    localVideoRef.current.muted = true;
    await localVideoRef.current.play().catch(()=>{});
    console.log('got user media stream', stream);

    // dynamically load MediaPipe FaceMesh (robust to different module layouts)
    let FaceMeshConstructor = null;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js');
      FaceMeshConstructor = mod.FaceMesh || mod.default || window.FaceMesh;
    } catch (err) {
      console.warn('Dynamic import of face_mesh failed:', err);
      FaceMeshConstructor = window.FaceMesh || null;
    }

    if (FaceMeshConstructor) {
      faceMeshRef.current = new FaceMeshConstructor({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      faceMeshRef.current.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      faceMeshRef.current.onResults(onFaceResults);

      // Start a simple requestAnimationFrame loop to feed frames to FaceMesh
      function startFaceMeshLoop() {
        let running = true;
        async function frameLoop() {
          try {
            if (localVideoRef.current && faceMeshRef.current) {
              await faceMeshRef.current.send({ image: localVideoRef.current });
            }
          } catch (err) {
            // ignore transient frame errors
          }
          if (running) cameraLoopRef.current = requestAnimationFrame(frameLoop);
        }
        cameraLoopRef.current = requestAnimationFrame(frameLoop);
        return () => { running = false; if (cameraLoopRef.current) cancelAnimationFrame(cameraLoopRef.current); };
      }
      startFaceMeshLoop();
      console.log('FaceMesh available and loop started');
    } else {
      console.warn('FaceMesh not available; using server inference/local fallback only.');
    }

    // prepare reference image (SVG included in repo)
    refImage.current = new Image();
    refImage.current.src = '/reference.svg';
    await new Promise((res) => { refImage.current.onload = res; });
    console.log('reference image loaded', refImage.current && refImage.current.src);

    // setup PeerConnection
    pcRef.current = new RTCPeerConnection({
      iceServers: [ { urls: 'stun:stun.l.google.com:19302' } ]
    });

    pcRef.current.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit('signal', { to: null, data: e.candidate });
      }
    };

    pcRef.current.ontrack = (e) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    // capture animated canvas as a stream and add to peer connection
    const canvas = canvasRef.current;
    const cs = canvas.captureStream(25);
    cs.getTracks().forEach(t => pcRef.current.addTrack(t, cs));

    // also add original microphone audio
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach(t => pcRef.current.addTrack(t, stream));

    // create offer and send to room peers
    try {
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socketRef.current.emit('signal', { to: null, data: pcRef.current.localDescription });
    } catch (err) {
      console.error('Failed to create/send offer', err);
    }

    // disable join button to prevent duplicate joins
    const joinBtn = document.querySelector('button');
    if (joinBtn) joinBtn.disabled = true;

    socketRef.current.on('peer-joined', async (id) => {
      console.log('peer joined', id);
      if (!pcRef.current) return;
      try {
        const newOffer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(newOffer);
        socketRef.current.emit('signal', { to: id, data: pcRef.current.localDescription });
      } catch (err) { console.error('offer to new peer failed', err); }
    });

    socketRef.current.on('peer-left', (id) => {
      console.log('peer left', id);
    });
  }

  function onFaceResults(results) {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = 640;
    const h = canvas.height = 480;

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#222';
    ctx.fillRect(0,0,w,h);

    // If the client is using the Colab infer server, throttle sends and draw server result when returned.
    if (INFER_URL && !INFER_URL.includes('<PASTE')) {
      // throttle: don't send more often than ~10-12 fps
      if (!window._lastInfer || (performance.now() - window._lastInfer) > 80) {
        window._lastInfer = performance.now();
        // send the raw video element to the server for a server-rendered response
        sendFrameToServer(localVideoRef.current);
      }
      return;
    }

    // Local rendering path (FaceMesh results based)
    if (results && results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0].map(p => ({ x: p.x * w, y: p.y * h }));
      warpFace(ctx, refImage.current, landmarks, w, h);
    } else {
      const img = refImage.current;
      const sx = (w - img.width) / 2;
      const sy = (h - img.height) / 2;
      ctx.drawImage(img, sx, sy);
    }
  }

  return e('div', { className: 'container' }, [
    e('h1', null, 'VCClone — Face-driven video call (prototype)'),
    e('div', { className: 'panels' }, [
      e('div', { key: 'left', className: 'panel' }, [
        e('video', { key: 'localVideo', ref: localVideoRef, autoPlay: true, playsInline: true, className: 'video' }),
        e('div', { key: 'controls', className: 'controls' }, [
          e('input', { key: 'room', value: room, onChange: (ev) => setRoom(ev.target.value) }),
          e('button', { key: 'join', onClick: joinRoom }, 'Join room')
        ])
      ]),
      e('div', { key: 'right', className: 'panel' }, [
        e('canvas', { key: 'canvas', ref: canvasRef, width: 640, height: 480 }),
        e('video', { key: 'remoteVideo', ref: remoteVideoRef, autoPlay: true, playsInline: true, className: 'video' })
      ])
    ])
  ]);
}

ReactDOM.render(React.createElement(App), document.getElementById('app'));
