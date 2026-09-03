// Registre des icônes Phosphor utilisées dans l'app (https://phosphoricons.com pour le catalogue).
// Pour en ajouter une : l'importer ici et la poser dans `icons` — elle devient dispo
// via <AppIcon name="PhHeart" /> et en composant global <PhHeart /> (enregistré par install()).
import {
  PhHorse,
  PhHeart,
  PhCube,
  PhPiggyBank,
  PhChartLineUp,
  PhPlus,
  PhCaretDown,
  PhGearSix,
  PhCheck,
} from '@phosphor-icons/vue'

export const icons = {
  PhHorse,
  PhHeart,
  PhCube,
  PhPiggyBank,
  PhChartLineUp,
  PhPlus,
  PhCaretDown,
  PhGearSix,
  PhCheck,
}

// Plugin Vue : enregistre chaque icône du registre comme composant global
export default {
  install(app) {
    for (const [name, component] of Object.entries(icons)) {
      app.component(name, component)
    }
  },
}
