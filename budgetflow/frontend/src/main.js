import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index.js'
import iconsPlugin from './plugins/icons.js'
import './style.css'

createApp(App).use(router).use(iconsPlugin).mount('#app')
