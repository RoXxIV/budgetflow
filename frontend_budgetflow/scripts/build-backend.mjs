/**
 * Build le backend Node.js en un .exe standalone pour le sidecar Tauri.
 * Pipeline : esbuild (ESM→CJS, tout inline) → @yao-pkg/pkg (exe Windows x64)
 * Les valeurs du .env sont lues et injectées à la compilation (pas besoin du fichier au runtime).
 */

import { execSync } from 'child_process'
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendDir = join(__dirname, '..')
const backendDir = join(frontendDir, '..', 'backend_budgetflow')
const binariesDir = join(frontendDir, 'src-tauri', 'binaries')
const bundleOut = join(backendDir, 'dist', 'server.cjs')
const exeOut = join(binariesDir, 'backend-x86_64-pc-windows-msvc.exe')

// ── 1. Lire le .env backend ──────────────────────────────────
const envContent = readFileSync(join(backendDir, '.env'), 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=][^=]*)=(.*)$/)
  if (match) env[match[1].trim()] = match[2].trim()
}
const PORT = env.PORT || '3000'
const MONGO_URI = env.MONGO_URI || 'mongodb://127.0.0.1:27017/budget_app'

console.log(`📋 Config : PORT=${PORT}  MONGO_URI=${MONGO_URI}`)

// ── 2. Créer les dossiers si besoin ─────────────────────────
mkdirSync(join(backendDir, 'dist'), { recursive: true })
if (!existsSync(binariesDir)) mkdirSync(binariesDir, { recursive: true })

// ── 3. Bundle avec esbuild (ESM → CJS, tout inline) ─────────
console.log('\n📦 Bundling avec esbuild...')
execSync(
  [
    'npx esbuild',
    `"${join(backendDir, 'server.js')}"`,
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=cjs',
    '--keep-names',
    `--outfile="${bundleOut}"`,
    `--define:process.env.PORT='"${PORT}"'`,
    `--define:process.env.MONGO_URI='"${MONGO_URI}"'`,
  ].join(' '),
  { stdio: 'inherit', cwd: frontendDir }
)

// ── 4. Créer le .exe avec pkg ────────────────────────────────
console.log('\n🔧 Création du .exe avec @yao-pkg/pkg...')
execSync(
  [
    'npx @yao-pkg/pkg',
    `"${bundleOut}"`,
    '--target node20-win-x64',
    `--output "${exeOut}"`,
  ].join(' '),
  { stdio: 'inherit', cwd: frontendDir }
)

console.log(`\n✅ Binary prêt : ${exeOut}`)
