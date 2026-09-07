import api from './index.js'

// Investissements : ce qui est investi (mouvements) d'un côté, ce que ça vaut
// (valorisations) de l'autre. L'écart entre les deux est la plus ou moins-value.

export const getAssets = () => api.get('/assets')
export const createAsset = (data) => api.post('/assets', data)
export const updateAsset = (id, data) => api.put(`/assets/${id}`, data)
export const deleteAsset = (id) => api.delete(`/assets/${id}`)

export const getAssetMovements = (id) => api.get(`/assets/${id}/movements`)
export const addAssetMovement = (id, data) => api.post(`/assets/${id}/movements`, data)
export const removeAssetMovement = (id, movementId) => api.delete(`/assets/${id}/movements/${movementId}`)

export const getAssetValuations = (id) => api.get(`/assets/${id}/valuations`)
export const addAssetValuation = (id, data) => api.post(`/assets/${id}/valuations`, data)
export const removeAssetValuation = (id, valuationId) => api.delete(`/assets/${id}/valuations/${valuationId}`)

export const getMonthAssetMovements = (monthId) => api.get(`/months/${monthId}/asset-movements`)
// DCA du mois : enregistre le versement récurrent prévu sur cet actif
export const dcaAsset = (monthId, assetId) => api.post(`/months/${monthId}/assets/${assetId}/dca`)
export const undcaAsset = (monthId, assetId) => api.delete(`/months/${monthId}/assets/${assetId}/dca`)
