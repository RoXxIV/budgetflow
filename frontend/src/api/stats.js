import api from './index.js'

// Statistiques : une seule route, qui renvoie toutes les séries mensuelles
// (dépenses, épargne, patrimoine, par catégorie et par thème) en un appel.

export const getStats = () => api.get('/stats')
