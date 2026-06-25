import api from './index.js'

export const getSheets = () => api.get('/sheets')
export const getSheet = (id) => api.get(`/sheets/${id}`)
export const createSheet = (data) => api.post('/sheets', data)
export const updateSheet = (id, data) => api.put(`/sheets/${id}`, data)
export const deleteSheet = (id) => api.delete(`/sheets/${id}`)

export const getSheetLines = (id) => api.get(`/sheets/${id}/lines`)
export const createSheetLine = (id, data) => api.post(`/sheets/${id}/lines`, data)
export const updateSheetLine = (sheetId, lineId, data) => api.put(`/sheets/${sheetId}/lines/${lineId}`, data)
export const deleteSheetLine = (sheetId, lineId) => api.delete(`/sheets/${sheetId}/lines/${lineId}`)
export const getSheetSnapshots = (id) => api.get(`/sheets/${id}/snapshots`)
export const upsertSnapshot = (id, data) => api.put(`/sheets/${id}/snapshots`, data)
export const getSheetReadings = (id) => api.get(`/sheets/${id}/readings`)
export const updateReading = (sheetId, readingId, data) => api.put(`/sheets/${sheetId}/readings/${readingId}`, data)
export const getSheetTransactions = (id) => api.get(`/sheets/${id}/transactions`)

export const getSheetContributions = (id) => api.get(`/sheets/${id}/contributions`)
export const addSheetContribution = (id, data) => api.post(`/sheets/${id}/contributions`, data)
export const removeSheetContribution = (sheetId, contribId) => api.delete(`/sheets/${sheetId}/contributions/${contribId}`)

export const getSheetInvestmentTransactions = (id) => api.get(`/sheets/${id}/investment-transactions`)
export const addSheetInvestmentTransaction = (id, data) => api.post(`/sheets/${id}/investment-transactions`, data)
export const removeSheetInvestmentTransaction = (sheetId, txId) => api.delete(`/sheets/${sheetId}/investment-transactions/${txId}`)
