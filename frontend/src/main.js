import "bootstrap/dist/css/bootstrap.css";
import "bootstrap-vue/dist/bootstrap-vue.css";

import { ModalPlugin, VBTogglePlugin, ToastPlugin } from "bootstrap-vue";

import Vue from "vue";
import JSConfetti from "js-confetti";

import App from "./App.vue";

Vue.config.productionTip = false;
Vue.use(ModalPlugin);
Vue.use(VBTogglePlugin);
Vue.use(ToastPlugin);
Vue.prototype.$confetti = new JSConfetti();

var vm = new Vue({ render: (h) => h(App) });
vm.$mount("#app");
