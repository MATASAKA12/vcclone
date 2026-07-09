from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from pyngrok import ngrok
import base64, io, os
from PIL import Image
import numpy as np
import cv2

app = Flask(__name__)
# Enable CORS globally (development only)
CORS(app, resources={r"/*": {"origins": "*"}})

# Create a simple reference face image
REF_W, REF_H = 400, 400
def make_reference_face():
    from PIL import ImageDraw
    img = Image.new('RGBA', (REF_W, REF_H), (242,210,201,255))
    draw = ImageDraw.Draw(img)
    draw.ellipse((110,140,150,180), fill=(59,59,59))
    draw.ellipse((250,140,290,180), fill=(59,59,59))
    draw.ellipse((128,152,136,160), fill=(255,255,255))
    draw.ellipse((268,152,276,160), fill=(255,255,255))
    draw.arc((140,230,260,290), start=0, end=180, fill=(59,59,59), width=8)
    return img.convert('RGB')

reference_img = np.array(make_reference_face())

# Haar cascade face detector
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

def decode_base64_image(data_url):
    header, encoded = data_url.split(',', 1) if ',' in data_url else (None, data_url)
    data = base64.b64decode(encoded)
    img = Image.open(io.BytesIO(data)).convert('RGB')
    return np.array(img)

def encode_image_to_base64(img_np):
    pil = Image.fromarray(img_np)
    buf = io.BytesIO()
    pil.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

# Ensure CORS headers are present for all responses (explicit)
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    return response

@app.route('/infer', methods=['POST', 'OPTIONS'])
def infer():
    # Handle preflight
    if request.method == 'OPTIONS':
        return make_response('', 200)

    data = request.get_json(force=True)
    if not data or 'image' not in data:
        return jsonify({'error': 'no image'}), 400
    try:
        frame = decode_base64_image(data['image'])
        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60,60))
        if len(faces) == 0:
            out = cv2.resize(reference_img, (w, h))
            return jsonify({'image': encode_image_to_base64(out)})
        faces = sorted(faces, key=lambda r: r[2]*r[3], reverse=True)
        x,y,fw,fh = faces[0]
        left_eye = (int(x + fw*0.28), int(y + fh*0.35))
        right_eye = (int(x + fw*0.72), int(y + fh*0.35))
        nose = (int(x + fw*0.5), int(y + fh*0.55))
        dst = np.array([left_eye, right_eye, nose], dtype=np.float32)
        src = np.array([[130,160],[270,160],[200,190]], dtype=np.float32)
        M = cv2.getAffineTransform(src, dst)
        warped = cv2.warpAffine(reference_img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        return jsonify({'image': encode_image_to_base64(warped)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def run_server():
    public_url = ngrok.connect(5000, bind_tls=True).public_url
    print(' * ngrok url:', public_url)
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False, threaded=True)

if __name__ == '__main__':
    run_server()
