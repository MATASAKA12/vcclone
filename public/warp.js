// warp.js
// Provides a simple Delaunay-based triangular warp to map reference image to face landmarks.
// This is a very simple prototype and not production quality.

export function warpFace(ctx, img, landmarks, w, h) {
  try {
    // Choose a small set of points from MediaPipe landmarks to drive the warp
    // We'll use a coarse subset: jaw, nose, eyes, mouth
    const idx = [33, 263, 61, 291, 199, 1, 10, 152, 234, 454, 78, 308];
    const points = idx.map(i => [landmarks[i].x, landmarks[i].y]);

    // Add corners so the triangulation covers full image
    points.push([0,0]); points.push([w,0]); points.push([w,h]); points.push([0,h]);

    // Delaunator expects a flat array of coordinates
    const coords = points.flat();
    const dela = Delaunator.from(points);

    // Prepare source points from the reference image placed at center
    // We'll assume the reference image fits inside the canvas centered
    const scale = Math.min(w / img.width, h / img.height) * 0.8;
    const iw = img.width * scale;
    const ih = img.height * scale;
    const ix = (w - iw) / 2;
    const iy = (h - ih) / 2;

    // create source grid roughly matching the points layout
    // for simplicity, map the points to normalized positions across the image
    const srcPoints = points.map(([x,y], i) => {
      // Map facial points to roughly corresponding positions on the reference image.
      // This mapping is heuristic: map face-center landmarks around the image center.
      const nx = ix + iw * (0.5 + (x - w/2) / w);
      const ny = iy + ih * (0.5 + (y - h/2) / h);
      return [nx, ny];
    });

    // Draw warped triangles
    for (let t = 0; t < dela.triangles.length; t += 3) {
      const p0 = dela.triangles[t];
      const p1 = dela.triangles[t+1];
      const p2 = dela.triangles[t+2];

      const dst0 = points[p0];
      const dst1 = points[p1];
      const dst2 = points[p2];

      const src0 = srcPoints[p0];
      const src1 = srcPoints[p1];
      const src2 = srcPoints[p2];

      drawTriangleTextured(ctx, img, src0, src1, src2, dst0, dst1, dst2);
    }
  } catch (e) {
    console.error('warpFace error', e);
    // fallback: draw image
    ctx.drawImage(img, (w-img.width)/2, (h-img.height)/2);
  }
}

function drawTriangleTextured(ctx, img, s0, s1, s2, d0, d1, d2) {
  // compute affine transform from source triangle to destination triangle
  // Using ctx.setTransform requires decomposition; instead we'll use clipping and transform via pattern.

  // Create clipping path at destination triangle
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();

  // Compute affine matrix that maps source triangle to destination
  const mat = computeAffine(srcToVec(s0), srcToVec(s1), srcToVec(s2), srcToVec(d0), srcToVec(d1), srcToVec(d2));

  ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function srcToVec(p) { return { x: p[0], y: p[1] }; }

function computeAffine(s0, s1, s2, d0, d1, d2) {
  // Solve linear system for affine transform matrix that maps source to dest
  // [a c e]
  // [b d f]
  // We solve for a..f in: a*sx + c*sy + e = dx ; b*sx + d*sy + f = dy
  const A = [
    [s0.x, s0.y, 1, 0, 0, 0],
    [0,0,0, s0.x, s0.y,1],
    [s1.x, s1.y, 1, 0, 0, 0],
    [0,0,0, s1.x, s1.y,1],
    [s2.x, s2.y, 1, 0, 0, 0],
    [0,0,0, s2.x, s2.y,1]
  ];
  const B = [d0.x, d0.y, d1.x, d1.y, d2.x, d2.y];

  // Solve A x = B via simple Gaussian elimination / Cramer's rule is overkill; use numeric approach
  const x = solve6(A, B);
  return { a: x[0], c: x[1], e: x[2], b: x[3], d: x[4], f: x[5] };
}

function solve6(A, B) {
  // A is 6x6, B is 6x1
  // Convert to augmented matrix
  const M = A.map((row,i) => row.concat([B[i]]));
  const n = 6;
  for (let i = 0; i < n; i++) {
    // pivot
    let maxr = i;
    for (let r = i+1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[maxr][i])) maxr = r;
    const tmp = M[i]; M[i] = M[maxr]; M[maxr] = tmp;
    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-9) continue;
    for (let j = i; j <= n; j++) M[i][j] /= pivot;
    for (let r = 0; r < n; r++) if (r !== i) {
      const f = M[r][i];
      for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j];
    }
  }
  return M.map(row => row[n]);
}
