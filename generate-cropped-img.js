const path = require('path');
const fs = require('fs');

// Stratégie d'importation robuste pour Jimp
let Jimp;
try {
  const jimpModule = require('jimp');
  // On teste les différents patterns d'export selon la version/contexte
  Jimp = jimpModule.Jimp || jimpModule.default || jimpModule;
  
  if (typeof Jimp.read !== 'function') {
    throw new Error('Jimp.read is not a function');
  }
} catch (e) {
  console.error("❌ Erreur critique d'importation Jimp :", e.message);
  console.log("Essayez : npm install jimp --prefix apps/backend (si vous êtes à la racine)");
  process.exit(1);
}

const TEMPLATES_DIR = path.resolve(process.cwd(), 'storage', 'templates');
const OUTPUT_DIR = path.resolve(TEMPLATES_DIR, 'cropped');

async function ensureOutputDir() {
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
}

function processImage(image) {
  // Détection des dimensions (compatible v0.x et v1.x)
  const width = image.bitmap ? image.bitmap.width : image.width;
  const height = image.bitmap ? image.bitmap.height : image.height;

  // Zone centrale pour Smash (GO / GAME / FINI / PARTEZ)
  const x = Math.round(width * 0.1); 
  const y = Math.round(height * 0.15); 
  const w = Math.round(width * 0.75);
  const h = Math.round(height * 0.45);

  // On clone, on crop et on passe en niveaux de gris pour l'OCR
  return image.clone()
    .crop(x, y, w, h)
    .greyscale(); 
}

async function run() {
  await ensureOutputDir();

  const files = await fs.promises.readdir(TEMPLATES_DIR);
  
  const pngs = files.filter((f) => {
    const isPng = f.toLowerCase().endsWith('.png');
    const isAlreadyCropped = f.toLowerCase().includes('.cropped');
    const fullPath = path.join(TEMPLATES_DIR, f);
    return isPng && !isAlreadyCropped && !fs.lstatSync(fullPath).isDirectory();
  });

  if (pngs.length === 0) {
    console.log('ℹ️ Aucun PNG original trouvé dans', TEMPLATES_DIR);
    return;
  }
  
  console.log(`🚀 Traitement de ${pngs.length} fichiers...`);

  for (const filename of pngs) {
    try {
      const inputPath = path.join(TEMPLATES_DIR, filename);
      const outputPath = path.join(OUTPUT_DIR, filename.replace(/\.png$/i, '.cropped.png'));

      console.log(`📸 Lecture : ${filename}`);

      // Utilisation de la méthode de lecture validée
      const image = await Jimp.read(inputPath);
      
      const processed = processImage(image);

      // Écriture (support writeAsync si présent, sinon write)
      if (processed.writeAsync) {
        await processed.writeAsync(outputPath);
      } else {
        await new Promise((resolve, reject) => {
          processed.write(outputPath, (err) => err ? reject(err) : resolve());
        });
      }
      
      console.log(`✅ Succès : ${filename} -> cropped/`);
    } catch (err) {
      console.error(`❌ Erreur sur ${filename} :`, err.message);
    }
  }

  console.log('\n✨ Opération terminée.');
}

run().catch((err) => {
  console.error('💥 Erreur fatale :', err);
  process.exit(1);
});