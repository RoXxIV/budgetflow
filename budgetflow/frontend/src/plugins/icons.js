// Registre des icônes Phosphor utilisées dans l'app (https://phosphoricons.com pour le catalogue).
// Pour en ajouter une : l'importer ici et la poser dans `icons` — elle devient dispo
// en composant global (ex. <PhCheck />, enregistré par install()).
import {
  PhPlus,
  PhCaretDown,
  PhGearSix,
  PhCheck,
  PhEye,
  PhEyeSlash,
} from '@phosphor-icons/vue'

export const icons = {
  PhPlus,
  PhCaretDown,
  PhGearSix,
  PhCheck,
  PhEye,
  PhEyeSlash,
}

// Plugin Vue : enregistre chaque icône du registre comme composant global
export default {
  install(app) {
    for (const [name, component] of Object.entries(icons)) {
      app.component(name, component)
    }
  },
}
