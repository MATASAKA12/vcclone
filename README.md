/*
README: A simple React (CDN) frontend served by Express + Socket.io signaling server.
This is a prototype that captures the user's webcam, runs MediaPipe FaceMesh to get landmarks,
warps a reference SVG using landmark-based triangulation, captures the animated canvas as a MediaStream,
and sends that stream to the remote peer over WebRTC.

Run:
  npm install
  npm start

Open two browser windows and join the same room ID to connect (e.g., "room1").

TURN:
For NAT traversal in real networks, add a TURN server to the peer connection. You can use a public TURN service or deploy coturn. To add TURN servers, edit the RTCPeerConnection creation in public/client.js to include:
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' }
    ]
  });

Notes:
- This is a prototype. Realistic reenactment may need server-side models and GPU.
- Performance depends on device; reduce canvas size or capture FPS for better performance.
*/
