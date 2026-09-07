import api from './index.js'

// Réglages de l'application, et état du parcours de première utilisation
// (guide de configuration puis visite des onglets).

export const getSettings = () => api.get('/settings')
export const updateSettings = (data) => api.put('/settings', data)
export const getOnboarding = () => api.get('/settings/onboarding')
// Guide terminé : il ne crée aucun mois, rien d'autre ne signerait sa fin
export const completeOnboarding = () => api.post('/settings/onboarding/complete')
export const completeTour = () => api.post('/settings/onboarding/tour-complete')
