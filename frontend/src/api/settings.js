import api from './index.js'

export const getSettings = () => api.get('/settings')
export const updateSettings = (data) => api.put('/settings', data)
export const getOnboarding = () => api.get('/settings/onboarding')
export const completeOnboarding = () => api.post('/settings/onboarding/complete')
export const completeTour = () => api.post('/settings/onboarding/tour-complete')
