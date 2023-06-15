<template>
  <div>
    <div class="statusBar">
      <div
        class="indicator rounded-pill text-center"
        v-bind:class="{
          synced: !syncState.syncing,
          syncing: syncState.syncing,
          danger: !connected,
        }"
        @click="$emit('disconnect')"
      >
        <template v-if="!connected">
          <b-icon-exclamation-octagon />
        </template>
        <template v-else>
          <b-icon-reception4 />
        </template>
        {{ status }}
        <div
          v-if="syncState.syncing"
          class="spinner-border spinner-border-sm"
          role="status"
        >
          <span class="sr-only"></span>
        </div>
      </div>
    </div>
    <div v-if="syncState.syncing" class="text-center">
      Block {{ syncState.currentBlock }}
      <template v-if="syncState.highestBlock !== 0">
        out of {{ syncState.highestBlock }}
      </template>
    </div>
    <div v-if="syncState.wrongTime" class="alert alert-danger text-center">
      Node's clock is set incorrectly!
    </div>
  </div>
</template>

<script>
import { BIconReception4, BIconExclamationOctagon } from "bootstrap-vue";

export default {
  name: "SignalIndicator",
  props: {
    syncState: Object,
    connected: Boolean,
  },
  components: {
    BIconReception4,
    BIconExclamationOctagon,
  },
  computed: {
    status: function () {
      if (!this.connected) {
        return "Connection error";
      } else if (this.syncState.syncing) {
        return "Synchronizing";
      } else if (!this.syncState.syncing) {
        return "Synchronized";
      } else {
        return "Bad state";
      }
    },
  },
};
</script>

<style scoped>
.statusBar button {
  height: 2rem;
  line-height: 1rem;
  margin-left: 1rem;
}

.statusBar button svg {
  height: 100%;
}

.statusBar {
  display: flex;
  line-height: 2rem;
}

.indicator {
  margin-bottom: 0.5rem;
  width: 100%;
  cursor: pointer;
}

.synced {
  color: rgb(39, 217, 128);
  background-color: rgba(39, 217, 128, 0.2);
}

.syncing {
  color: rgb(255, 125, 39);
  background-color: rgba(255, 163, 102, 0.2);
}

.danger {
  color: rgb(255, 69, 69);
  background-color: rgba(255, 102, 102, 0.2);
}
</style>
