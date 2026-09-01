import api from './index.js'

export const getMonths = () => api.get('/months')
export const getMonthPrefill = () => api.get('/months/prefill')
export const createMonth = (data) => api.post('/months', data)
export const getMonth = (id) => api.get(`/months/${id}`)
export const getMonthSummary = (id) => api.get(`/months/${id}/summary`)
export const getMonthEnvelopeContributions = (id) => api.get(`/months/${id}/envelope-contributions`)
export const applySharing = (id) => api.post(`/months/${id}/sharing/apply`)
export const setMonthClosed = (id, isClosed) => api.put(`/months/${id}`, { isClosed })
export const deleteMonth = (id) => api.delete(`/months/${id}`)

export const getMonthLines = (id) => api.get(`/months/${id}/lines`)
export const createMonthLine = (id, data) => api.post(`/months/${id}/lines`, data)
export const updateMonthLine = (id, lineId, data) => api.put(`/months/${id}/lines/${lineId}`, data)
export const deleteMonthLine = (id, lineId, force = false) => api.delete(`/months/${id}/lines/${lineId}${force ? '?force=1' : ''}`)
export const applyLineToTemplate = (id, lineId) => api.post(`/months/${id}/lines/${lineId}/apply-to-template`)

export const payLine = (id, lineId) => api.post(`/months/${id}/lines/${lineId}/pay`)
export const unpayLine = (id, lineId) => api.delete(`/months/${id}/lines/${lineId}/pay`)

export const getMonthSnapshots = (id) => api.get(`/months/${id}/snapshots`)
export const upsertMonthSnapshots = (id, snapshots) => api.put(`/months/${id}/snapshots`, { snapshots })

export const getMonthEntries = (id) => api.get(`/months/${id}/entries`)
export const createEntry = (id, data) => api.post(`/months/${id}/entries`, data)
export const updateEntry = (id, entryId, data) => api.put(`/months/${id}/entries/${entryId}`, data)
export const deleteEntry = (id, entryId) => api.delete(`/months/${id}/entries/${entryId}`)
