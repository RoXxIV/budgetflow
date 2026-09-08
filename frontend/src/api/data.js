import api from './index.js'

// Sauvegarde, import et remise à zéro des données.
//
// Le fichier voyage en binaire brut dans les deux sens : c'est une base SQLite, il n'y
// a rien à sérialiser, et ça évite un encodage multipart des deux côtés.

// Ce que contient la base — sert à annoncer ce qui va disparaître avant d'effacer
export const getDataStats = () => api.get('/data')
// La réponse est le fichier lui-même, pas du JSON : d'où responseType blob
export const exportData = () => api.get('/data/export', { responseType: 'blob' })
export const importData = (file) => api.post('/data/import', file, { headers: { 'Content-Type': 'application/octet-stream' } })
export const resetData = () => api.post('/data/reset')
