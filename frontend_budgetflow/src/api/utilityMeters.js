import api from './index.js'

export const getUtilityMeters = () => api.get('/utility-meters')
export const createUtilityMeter = (data) => api.post('/utility-meters', data)
export const updateUtilityMeter = (id, data) => api.put(`/utility-meters/${id}`, data)
export const deleteUtilityMeter = (id) => api.delete(`/utility-meters/${id}`)
