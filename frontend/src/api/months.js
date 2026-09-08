import api from './index.js'

// Feuilles de mois : le cœur de l'app. Un mois naît en recopiant le Template,
// puis vit sa vie — lignes, entrées, soldes de départ, clôture.

export const getMonths = () => api.get('/months')
// Valeurs proposées pour le formulaire de création : période suivante et soldes
// de fin du mois précédent, que l'utilisateur corrige avant de valider
export const getMonthPrefill = () => api.get('/months/prefill')
export const getCurrentMonth = () => api.get('/months/current')
export const createMonth = (data) => api.post('/months', data)
export const getMonthSummary = (id) => api.get(`/months/${id}/summary`)
export const getMonthEnvelopeContributions = (id) => api.get(`/months/${id}/envelope-contributions`)
export const setMonthClosed = (id, isClosed) => api.put(`/months/${id}`, { isClosed })
export const setMonthNotes = (id, notes) => api.put(`/months/${id}/notes`, { notes })
// « Annuler ce mois-ci » : sauter une mensualité ou un DCA sans rien casser, réversible
export const addMonthSkip = (id, kind, targetId) => api.post(`/months/${id}/skips`, { kind, targetId })
export const removeMonthSkip = (id, kind, targetId) => api.delete(`/months/${id}/skips/${kind}/${targetId}`)

export const getMonthLines = (id) => api.get(`/months/${id}/lines`)
export const createMonthLine = (id, data) => api.post(`/months/${id}/lines`, data)
export const updateMonthLine = (id, lineId, data) => api.put(`/months/${id}/lines/${lineId}`, data)
export const deleteMonthLine = (id, lineId, force = false) => api.delete(`/months/${id}/lines/${lineId}${force ? '?force=1' : ''}`)
// Remonte une ligne saisie dans le mois vers le Template, pour les mois suivants
export const applyLineToTemplate = (id, lineId) => api.post(`/months/${id}/lines/${lineId}/apply-to-template`)

// Pointage d'une ligne : crée l'entrée correspondante au montant prévu
export const payLine = (id, lineId, data = {}) => api.post(`/months/${id}/lines/${lineId}/pay`, data)

export const getMonthSnapshots = (id) => api.get(`/months/${id}/snapshots`)
// Soldes de départ du mois : le point de repère de tous les calculs de disponible
export const upsertMonthSnapshots = (id, snapshots) => api.put(`/months/${id}/snapshots`, { snapshots })

export const getMonthEntries = (id) => api.get(`/months/${id}/entries`)
export const createEntry = (id, data) => api.post(`/months/${id}/entries`, data)
export const updateEntry = (id, entryId, data) => api.put(`/months/${id}/entries/${entryId}`, data)
export const deleteEntry = (id, entryId) => api.delete(`/months/${id}/entries/${entryId}`)
