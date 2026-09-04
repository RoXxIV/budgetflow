// Mode discret : floute tous les chiffres (classe .num, portée par chaque montant du
// registre). L'état vit sur <html data-privacy> + localStorage — il survit au
// rechargement, ce qui est le sens même d'un mode « écran partagé / transport ».
const KEY = 'budgetflow.privacy'

export function getPrivacy() {
  return localStorage.getItem(KEY) === 'on'
}

export function setPrivacy(on) {
  localStorage.setItem(KEY, on ? 'on' : 'off')
  document.documentElement.dataset.privacy = on ? 'on' : 'off'
}

export function initPrivacy() {
  document.documentElement.dataset.privacy = getPrivacy() ? 'on' : 'off'
}
