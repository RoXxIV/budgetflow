import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index.js'
import iconsPlugin from './plugins/icons.js'
import { initTheme } from './lib/theme.js'
import './style.css'

initTheme()
createApp(App).use(router).use(iconsPlugin).mount('#app')
