// Copie le sidecar backend dans target/debug/ pour que Tauri dev le trouve.
// En dev, tauri-plugin-shell résout "binaries/backend" → backend.exe (sans target triple).
import { copyFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src  = join(root, 'src-tauri', 'binaries', 'backend-x86_64-pc-windows-msvc.exe')
const dst  = join(root, 'src-tauri', 'target', 'debug')

mkdirSync(dst, { recursive: true })
copyFileSync(src, join(dst, 'backend.exe'))
console.log('✅ Sidecar copié dans target/debug/backend.exe')
