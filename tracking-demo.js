(function () {
  function initTrackingDemo() {
    const canvas = document.getElementById('trackingCanvas');
    const playBtn = document.getElementById('trackingPlay');
    const slider = document.getElementById('contaminationSlider');
    const label = document.getElementById('contaminationValue');

    if (!canvas || !playBtn || !slider || !label) return;

    const ctx = canvas.getContext('2d');

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load ' + src));
        img.src = src;
      });
    }

    
Promise.allSettled([
  loadImage('./dog.svg'),
  loadImage('./paw-dog.svg'),
  loadImage('./paw-cat.svg')
]).then(results => {
  const names = ['dog.svg', 'paw-dog.svg', 'paw-cat.svg'];
  const images = results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    console.error('Failed to load:', names[i], result.reason);
    return null;
  });
  startDemo({dogImg:images[0],pawDogImg:images[1],pawCatImg:images[2]});
});


    function startDemo(assets) {
      let dpr = Math.max(1, window.devicePixelRatio || 1);
      let width = 0;
      let height = 0;
      let playing = false;
      let raf = null;
      let lastTime = null;

      const pathTrailMax = 260;
      const measurementTrailMax = 44;
      const estimateTrailMax = 160;
      const dt = 0.06;
      let simTime = 0;
      let stepAccumulator = 0;

      let contaminationRate = Number(slider.value) / 100;
      label.textContent = Math.round(contaminationRate * 100) + '%';

      let trueTrail = [];
      let estimateTrail = [];
      let measurementPoints = [];
      let lastMeasurementTime = -Infinity;

      let xState;
      let P;
      const F = [
        [1, 0, dt, 0],
        [0, 1, 0, dt],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ];
      const H = [
        [1, 0, 0, 0],
        [0, 1, 0, 0]
      ];
      const q = 10;
      const r = 60;
      const Q = [
        [q * dt * dt * dt / 3, 0, q * dt * dt / 2, 0],
        [0, q * dt * dt * dt / 3, 0, q * dt * dt / 2],
        [q * dt * dt / 2, 0, q * dt, 0],
        [0, q * dt * dt / 2, 0, q * dt]
      ];
      const R = [
        [r, 0],
        [0, r]
      ];

      function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        width = Math.max(320, rect.width);
        height = Math.max(220, rect.height);
        dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
      }

      function resetSimulation() {
        simTime = 0;
        stepAccumulator = 0;
        trueTrail = [];
        estimateTrail = [];
        measurementPoints = [];
        lastMeasurementTime = -Infinity;

        const p0 = truePosition(0);
        const p1 = truePosition(dt);
        xState = [p0.x, p0.y, (p1.x - p0.x) / dt, (p1.y - p0.y) / dt];
        P = [
          [120, 0, 0, 0],
          [0, 120, 0, 0],
          [0, 0, 100, 0],
          [0, 0, 0, 100]
        ];

        trueTrail.push({ x: p0.x, y: p0.y });
        estimateTrail.push({ x: xState[0], y: xState[1] });
        draw();
      }

      function truePosition(t) {
        const cx = width * 0.50;
        const cy = height * 0.50;
        const ax = width * 0.28;
        const ay = height * 0.26;
        const wobble = 0.10;
        const theta = t * 0.88;
        return {
          x: cx + ax * Math.cos(theta) + ax * wobble * Math.cos(2.2 * theta + 0.4),
          y: cy + ay * Math.sin(theta)
        };
      }

      function randn() {
        let u = 0;
        let v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      }

      function generateMeasurement(tp) {
        const isOutlier = Math.random() < contaminationRate;
        if (isOutlier) {
          const radius = 55 + Math.random() * 55;
          const angle = Math.random() * Math.PI * 2;
          return {
            x: tp.x + radius * Math.cos(angle),
            y: tp.y + radius * Math.sin(angle),
            outlier: true
          };
        }
        return {
          x: tp.x + randn() * 8,
          y: tp.y + randn() * 8,
          outlier: false
        };
      }

      function matMul4x4(A, B) {
        const C = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += A[i][k] * B[k][j];
            C[i][j] = sum;
          }
        }
        return C;
      }

      function matMul4x1(A, x) {
        return A.map(row => row[0] * x[0] + row[1] * x[1] + row[2] * x[2] + row[3] * x[3]);
      }

      function matAdd4(A, B) {
        return A.map((row, i) => row.map((v, j) => v + B[i][j]));
      }

      function transpose4(A) {
        return A[0].map((_, j) => A.map(row => row[j]));
      }

      function predict() {
        xState = matMul4x1(F, xState);
        P = matAdd4(matMul4x4(matMul4x4(F, P), transpose4(F)), Q);
      }

      function update(meas) {
        const z = [meas.x, meas.y];
        const y = [z[0] - xState[0], z[1] - xState[1]];
        const s00 = P[0][0] + R[0][0];
        const s01 = P[0][1];
        const s10 = P[1][0];
        const s11 = P[1][1] + R[1][1];
        const detS = s00 * s11 - s01 * s10;
        if (Math.abs(detS) < 1e-9) return;
        const invS = [
          [s11 / detS, -s01 / detS],
          [-s10 / detS, s00 / detS]
        ];

        const K = [
          [P[0][0] * invS[0][0] + P[0][1] * invS[1][0], P[0][0] * invS[0][1] + P[0][1] * invS[1][1]],
          [P[1][0] * invS[0][0] + P[1][1] * invS[1][0], P[1][0] * invS[0][1] + P[1][1] * invS[1][1]],
          [P[2][0] * invS[0][0] + P[2][1] * invS[1][0], P[2][0] * invS[0][1] + P[2][1] * invS[1][1]],
          [P[3][0] * invS[0][0] + P[3][1] * invS[1][0], P[3][0] * invS[0][1] + P[3][1] * invS[1][1]]
        ];

        xState = [
          xState[0] + K[0][0] * y[0] + K[0][1] * y[1],
          xState[1] + K[1][0] * y[0] + K[1][1] * y[1],
          xState[2] + K[2][0] * y[0] + K[2][1] * y[1],
          xState[3] + K[3][0] * y[0] + K[3][1] * y[1]
        ];

        const IminusKH = [
          [1 - K[0][0], -K[0][1], 0, 0],
          [-K[1][0], 1 - K[1][1], 0, 0],
          [-K[2][0], -K[2][1], 1, 0],
          [-K[3][0], -K[3][1], 0, 1]
        ];
        P = matMul4x4(IminusKH, P);
      }

      function pushLimited(arr, item, maxLen) {
        arr.push(item);
        if (arr.length > maxLen) arr.shift();
      }

      function stepSimulation() {
        simTime += dt;
        const tp = truePosition(simTime);
        pushLimited(trueTrail, tp, pathTrailMax);

        predict();

        if (simTime - lastMeasurementTime >= 0.14) {
          const meas = generateMeasurement(tp);
          lastMeasurementTime = simTime;
          pushLimited(measurementPoints, {
            x: meas.x,
            y: meas.y,
            outlier: meas.outlier,
            age: 0
          }, measurementTrailMax);
          update(meas);
        }

        measurementPoints.forEach(p => { p.age += dt; });
        pushLimited(estimateTrail, { x: xState[0], y: xState[1] }, estimateTrailMax);
      }

      function drawBackground() {
        const grad = ctx.createRadialGradient(width * 0.5, height * 0.42, 10, width * 0.5, height * 0.5, width * 0.55);
        grad.addColorStop(0, '#fbfdff');
        grad.addColorStop(1, '#f2f7fb');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.strokeStyle = '#e6edf3';
        ctx.lineWidth = 1;
        for (let x = 0; x <= width; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = 0; y <= height; y += 40) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      function drawPath(points, style) {
        if (points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width;
        if (style.dash) ctx.setLineDash(style.dash);
        if (style.alpha !== undefined) ctx.globalAlpha = style.alpha;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
        ctx.restore();
      }

      function drawMeasurement(point) {
        const size = point.outlier ? 18 : 16;
        const alpha = Math.max(0.35, 1 - point.age / 6);
        ctx.save();
        ctx.globalAlpha = alpha;
        const img = point.outlier ? assets.pawCatImg : assets.pawDogImg;
        if (img) {
          ctx.drawImage(img, point.x - size / 2, point.y - size / 2, size, size);
        } else {
          ctx.fillStyle = point.outlier ? '#d95f5f' : '#6a839a';
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.outlier ? 5 : 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      
     function drawTarget(tp) {
       ctx.save();
       ctx.font = '34px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
       ctx.textAlign = 'center';
       ctx.textBaseline = 'middle';
       ctx.fillText('🐶', tp.x, tp.y);
       ctx.restore();
       }

      function drawEstimateMarker(ep) {
        ctx.save();
        ctx.fillStyle = '#1f7a8c';
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      function drawCornerInfo() {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.86)';
        roundRect(ctx, 10, 10, 164, 54, 10, true, false);
        ctx.fillStyle = '#667085';
        ctx.font = '12px Inter, Arial, sans-serif';
        // ctx.fillText('Moving target on a curved path', 20, 30);
        // ctx.fillText('Standard Kalman filter', 20, 48);

        const rateText = 'Contamination: ' + Math.round(contaminationRate * 100) + '%';
        const tw = ctx.measureText(rateText).width;
        ctx.fillStyle = 'rgba(255,255,255,0.86)';
        roundRect(ctx, width - tw - 28, 10, tw + 18, 30, 10, true, false);
        ctx.fillStyle = '#667085';
        ctx.fillText(rateText, width - tw - 19, 30);
        ctx.restore();
      }

      function roundRect(ctx2, x, y, w, h, r, fill, stroke) {
        ctx2.beginPath();
        ctx2.moveTo(x + r, y);
        ctx2.arcTo(x + w, y, x + w, y + h, r);
        ctx2.arcTo(x + w, y + h, x, y + h, r);
        ctx2.arcTo(x, y + h, x, y, r);
        ctx2.arcTo(x, y, x + w, y, r);
        ctx2.closePath();
        if (fill) ctx2.fill();
        if (stroke) ctx2.stroke();
      }

      function draw() {
        drawBackground();
        drawPath(trueTrail, { color: '#8d9aab', width: 2.6, dash: [7, 5], alpha: 0.95 });
        drawPath(estimateTrail, { color: '#1f7a8c', width: 3.1, dash: null, alpha: 0.96 });
        measurementPoints.forEach(drawMeasurement);
        const tp = trueTrail[trueTrail.length - 1] || truePosition(simTime);
        const ep = estimateTrail[estimateTrail.length - 1] || { x: xState[0], y: xState[1] };
        drawEstimateMarker(ep);
        drawTarget(tp);
        drawCornerInfo();
      }

      function animate(timestamp) {
        if (!playing) return;
        if (lastTime == null) lastTime = timestamp;
        const elapsed = Math.min((timestamp - lastTime) / 1000, 0.05);
        lastTime = timestamp;
        stepAccumulator += elapsed;
        while (stepAccumulator >= dt) {
          stepSimulation();
          stepAccumulator -= dt;
        }
        draw();
        raf = requestAnimationFrame(animate);
      }

      playBtn.addEventListener('click', () => {
        playing = !playing;
        if (playing) {
          playBtn.innerHTML = '&#10074;&#10074; Pause';
          lastTime = null;
          raf = requestAnimationFrame(animate);
        } else {
          playBtn.innerHTML = '&#9654; Play';
          if (raf) cancelAnimationFrame(raf);
        }
      });

      slider.addEventListener('input', () => {
        contaminationRate = Number(slider.value) / 100;
        label.textContent = Math.round(contaminationRate * 100) + '%';
        resetSimulation();
      });

      window.addEventListener('resize', resizeCanvas);
      resizeCanvas();
      resetSimulation();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTrackingDemo);
  } else {
    initTrackingDemo();
  }
})();
