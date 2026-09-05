import api from './index.js'

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
export const dcaAsset = (monthId, assetId) => api.post(`/months/${monthId}/assets/${assetId}/dca`)
export const undcaAsset = (monthId, assetId) => api.delete(`/months/${monthId}/assets/${assetId}/dca`)
