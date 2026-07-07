import { FaceMesh } from 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
import { Camera } from 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';

// Simple signaling via Socket.io client
import io from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

// Warp helpers
import { warpFace } from './warp.js';

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
  const cameraRef = React.useRef(null);

  React.useEffect(() => {
    // create UI elements after mount
    const root = document.getElementById('app');
    // no-op: handled by React render
  }, []);

  async function joinRoom() {
    socketRef.current = io();

    socketRef.current.on('connect', () => console.log('socket connected', socketRef.current.id));

    socketRef.current.on('signal', async ({ from, data }) => {
      if (!pcRef.current) return;
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
    });

    socketRef.current.emit('join', room);

    // get camera
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideoRef.current.srcObject = stream;
    localVideoRef.current.muted = true;
    await localVideoRef.current.play().catch(()=>{});

    // prepare FaceMesh
    faceMeshRef.current = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
    faceMeshRef.current.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMeshRef.current.onResults(onFaceResults);

    cameraRef.current = new Camera(localVideoRef.current, {
      onFrame: async () => {
        await faceMeshRef.current.send({ image: localVideoRef.current });
      },
      width: 640,
      height: 480
    });

    cameraRef.current.start();

    // prepare reference image (SVG included in repo)
    refImage.current = new Image();
    refImage.current.src = '/reference.svg';
    await new Promise((res) => { refImage.current.onload = res; });

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
    // add each track
    cs.getTracks().forEach(t => pcRef.current.addTrack(t, cs));

    // also add original microphone audio
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach(t => pcRef.current.addTrack(t, stream));

    // create offer and send to room peers
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    // broadcast offer to room: server will forward to other sockets; for simplicity we send to room via signaling events
    // we don't have the target IDs here; the server will deliver offers to others who joined the room
    socketRef.current.emit('signal', { to: null, data: pcRef.current.localDescription });

    socketRef.current.on('peer-joined', async (id) => {
      console.log('peer joined', id);
      // when a new peer joins, create an offer for them
      if (!pcRef.current) return;
      const newOffer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(newOffer);
      socketRef.current.emit('signal', { to: id, data: pcRef.current.localDescription });
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

    // draw background
    ctx.fillStyle = '#222';
    ctx.fillRect(0,0,w,h);

    // draw the animated (warped) reference image using landmarks
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0].map(p => ({ x: p.x * w, y: p.y * h }));
      // warpFace will draw the reference image onto the canvas matching landmarks
      warpFace(ctx, refImage.current, landmarks, w, h);
    } else {
      // no face: draw the static reference centered
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
