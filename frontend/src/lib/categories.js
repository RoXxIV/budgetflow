// Catégories proposées au démarrage — partagées par les Paramètres (liste vide)
// et par le flux de première utilisation, pour qu'un seul endroit fasse foi.
// Couleurs prises dans la palette fermée (--cat-1..12).
export const CATEGORY_PRESETS = [
  { name: 'Factures', type: 'depense', color: '#3B6EA5' },
  { name: 'Abonnements', type: 'depense', color: '#7C6BB0' },
  { name: 'Courses & quotidien', type: 'depense', color: '#4B8A6E' },
  { name: 'Loisirs', type: 'depense', color: '#C97B2C' },
  { name: 'Revenus', type: 'revenu', color: '#5A7D3F' },
  { name: 'Épargne', type: 'epargne', color: '#2F8C8C' },
  { name: 'Virements', type: 'transfert', color: '#6E7A88' },
]

// Les 12 seules couleurs possibles (mêmes valeurs que --cat-1..12)
export const CATEGORY_PALETTE = [
  '#3B6EA5', '#4B8A6E', '#C97B2C', '#A05270',
  '#6E7A88', '#B04A3F', '#7C6BB0', '#2F8C8C',
  '#8C7A3F', '#5A7D3F', '#96566B', '#55606B',
]

export const CATEGORY_TYPES = [
  { value: 'depense', label: 'Dépense' },
  { value: 'revenu', label: 'Revenu' },
  { value: 'epargne', label: 'Épargne' },
  { value: 'transfert', label: 'Transfert' },
]
