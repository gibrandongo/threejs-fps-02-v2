// BREAKLINE — make.fun threejs-fps-02 entry program.
//
// Copies game/ and screenshots/ from this repository to the output
// directory and writes /output/dossier.json with buildDossier.
//
// Grader-safe output handling (proven fix): the grader runs this program
// as uid 65534 with /output as a root-owned mount that the program cannot
// delete. This program NEVER deletes the output directory itself. It only
// creates it (mkdirSync recursive), deletes its CONTENTS one child at a
// time, then copies the game in and writes dossier.json. The dossier is
// built BEFORE the output directory is touched, so a dossier failure
// surfaces before any output is mutated.
import { buildDossier } from './vendor/makefun-threejs.ts';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const dossier = await buildDossier(repoRoot, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

mkdirSync(outDir, { recursive: true });
for (const child of readdirSync(outDir)) {
  rmSync(join(outDir, child), { recursive: true, force: true });
}
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
writeFileSync(join(outDir, 'dossier.json'), dossier);
