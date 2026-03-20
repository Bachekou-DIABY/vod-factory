/**
 * Script de calibration pour le détecteur de game screens.
 * Extrait les frames exactes aux timings GO!/GAME! connus et mesure les % orange/blanc.
 *
 * Usage: node scripts/calibrate-detector.mjs <chemin_video>
 */

import ffmpeg from 'fluent-ffmpeg';
import Jimp from 'jimp';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CROP_X = 0.15;
const CROP_Y = 0.12;
const CROP_W = 0.70;
const CROP_H = 0.55;

// Timings connus (en secondes)
const GO_TIMESTAMPS   = [41, 260, 600, 931, 1224, 1507, 1801, 2091, 2303];
const GAME_TIMESTAMPS = [229, 503, 891, 1128, 1471, 1755, 2058, 2231, 2539];

function extractFrame(videoPath, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`FFmpeg error at ${timestamp}s: ${err.message}`)))
      .run();
  });
}

async function measureFrame(framePath) {
  const img = await Jimp.read(framePath);
  const fw = img.getWidth();
  const fh = img.getHeight();

  const cx = Math.floor(fw * CROP_X);
  const cy = Math.floor(fh * CROP_Y);
  const cw = Math.floor(fw * CROP_W);
  const ch = Math.floor(fh * CROP_H);

  const crop = img.clone().crop(cx, cy, cw, ch);

  let orange = 0, white = 0, green = 0, total = 0;

  crop.scan(0, 0, crop.getWidth(), crop.getHeight(), (x, y, idx) => {
    const r = crop.bitmap.data[idx];
    const g = crop.bitmap.data[idx + 1];
    const b = crop.bitmap.data[idx + 2];
    total++;
    if (r > 180 && g > 80 && g < 220 && b < 80) orange++;
    if (r > 200 && g > 200 && b > 200) white++;
    // Vert vif (GAME!) : G dominant, R et B faibles
    if (g > 150 && r < 120 && b < 120) green++;
  });

  return {
    orangePct: (orange / total) * 100,
    whitePct:  (white  / total) * 100,
    greenPct:  (green  / total) * 100,
  };
}

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('Usage: node calibrate-detector.mjs <chemin_video>');
    process.exit(1);
  }

  const tmpDir = path.join(os.tmpdir(), `calibrate_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log('=== CALIBRATION DÉTECTEUR ===\n');
  console.log(`Vidéo: ${videoPath}`);
  console.log(`Crop: x=${CROP_X} y=${CROP_Y} w=${CROP_W} h=${CROP_H}\n`);

  const goOranges = [], goGreens = [];
  const gameGreens = [], gameWhites = [];

  console.log('--- GO! frames (meilleure frame sur ±1s) ---');
  for (let i = 0; i < GO_TIMESTAMPS.length; i++) {
    const ts = GO_TIMESTAMPS[i];
    // Tester ts-1, ts, ts+1 pour ne pas rater une frame courte
    let best = { orangePct: 0, greenPct: 0, whitePct: 0 }, bestTs = ts;
    for (const offset of [-1, 0, 1]) {
      const fp = path.join(tmpDir, `go_${i}_scan_${ts + offset}s.jpg`);
      try {
        await extractFrame(videoPath, ts + offset, fp);
        const m = await measureFrame(fp);
        if (m.orangePct > best.orangePct) { best = m; bestTs = ts + offset; }
      } catch {}
    }
    goOranges.push(best.orangePct);
    goGreens.push(best.greenPct);
    console.log(`  Game ${i+1} GO!  @${bestTs}s → orange=${best.orangePct.toFixed(2)}%  green=${best.greenPct.toFixed(2)}%  white=${best.whitePct.toFixed(2)}%`);
  }

  console.log('\n--- GAME! frames (meilleure frame sur ±1s) ---');
  for (let i = 0; i < GAME_TIMESTAMPS.length; i++) {
    const ts = GAME_TIMESTAMPS[i];
    let best = { orangePct: 0, greenPct: 0, whitePct: 0 }, bestTs = ts;
    for (const offset of [-1, 0, 1]) {
      const fp = path.join(tmpDir, `game_${i}_scan_${ts + offset}s.jpg`);
      try {
        await extractFrame(videoPath, ts + offset, fp);
        const m = await measureFrame(fp);
        if (m.greenPct > best.greenPct) { best = m; bestTs = ts + offset; }
      } catch {}
    }
    gameGreens.push(best.greenPct);
    gameWhites.push(best.whitePct);
    console.log(`  Game ${i+1} GAME! @${bestTs}s → green=${best.greenPct.toFixed(2)}%  white=${best.whitePct.toFixed(2)}%  orange=${best.orangePct.toFixed(2)}%`);
  }

  console.log('\n=== RÉSUMÉ ===');
  if (goOranges.length > 0) {
    const minGo = Math.min(...goOranges).toFixed(2);
    const maxGo = Math.max(...goOranges).toFixed(2);
    const avgGo = (goOranges.reduce((a,b) => a+b, 0) / goOranges.length).toFixed(2);
    console.log(`GO!   orange%: min=${minGo}  max=${maxGo}  avg=${avgGo}`);
  }
  if (gameGreens.length > 0) {
    const minGame = Math.min(...gameGreens).toFixed(2);
    const maxGame = Math.max(...gameGreens).toFixed(2);
    const avgGame = (gameGreens.reduce((a,b) => a+b, 0) / gameGreens.length).toFixed(2);
    console.log(`GAME! green%:  min=${minGame}  max=${maxGame}  avg=${avgGame}`);
  }

  console.log('\n=== SEUILS RECOMMANDÉS ===');
  if (goOranges.length > 0) {
    const safeStart = (Math.min(...goOranges) * 0.7).toFixed(1);
    console.log(`startOrangeThreshold = ${safeStart}  (70% du minimum GO! orange)`);
  }
  if (gameGreens.length > 0) {
    const safeEnd = (Math.min(...gameGreens) * 0.7).toFixed(1);
    console.log(`endGreenThreshold    = ${safeEnd}  (70% du minimum GAME! green)`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(console.error);
