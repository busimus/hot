<template>
  <div v-if="connected" class="">
    <div class="statusBar">
      <SignalIndicator
        :connected="connected"
        :sync-state="conn.syncState"
        @disconnect="disconnect"
      />
    </div>
  </div>
  <div v-else-if="!connected" class="text-center">
    <form id="connect-form" onsubmit="event.preventDefault();">
      Select RPC provider:
      <b-form-select
        class="form-group"
        v-model="selectedRpc"
        :options="rpcSelectOptions"
      >
      </b-form-select>
      <div v-if="selectedRpc == 'Custom'" id="custom-input">
        <div class="form-group">
          <label for="rpcAddr">Node address</label>
          <input
            v-model="rpcAddr"
            id="rpcAddr"
            placeholder="127.0.0.1:9009"
            class="form-control"
            type="text"
          />
        </div>
        <div class="form-group">
          <label for="apiKey">Node API key</label>
          <input
            v-model="apiKey"
            id="apiKey"
            type="password"
            class="form-control"
            :class="{ 'is-invalid': wrongKey }"
            aria-describedby="apiKeyFeedback"
          />
        </div>
      </div>
      <div v-if="wrongKey" id="apiKeyFeedback" class="invalid-feedback">
        API key is incorrect
      </div>

      <div v-if="connError" class="alert alert-danger" role="alert">
        Unable to connect:
        <br />
        "{{ conn.errorMessage }}"
      </div>
      <button
        @click="connect"
        class="conn-btn btn btn-lg btn-block"
        :class="{
          'btn-outline-primary': connecting,
          'btn-primary': !connecting,
        }"
      >
        <div
          v-if="connecting"
          class="load-spinner spinner-border spinner-border-sm"
          role="status"
        >
          <span class="sr-only">Loading...</span>
        </div>
        <div v-else-if="!connected">Connect</div>
      </button>
      <div id="disclaimer">
        By connecting you agree to the
        <a href="#" @click="showTermsModal">terms and conditions</a>
      </div>
      <b-modal
        ref="terms-modal"
        title="Terms and Conditions"
        ok-only
        ok-title="Agree"
        ok-variant="primary"
        size="lg"
        centered
      >
        <b-form-textarea
          id="terms-textarea"
          v-model="terms"
          readonly
          rows="20"
          wrap="soft"
        />
      </b-modal>
    </form>
  </div>
</template>

<script>
import SignalIndicator from "./SignalIndicator.vue";
import { ConnState } from "../connection.js";
import { RPCS } from "../config.js";

const TERMS = `1. Everything on this site is provided "as is", without warranty of any kind.
2. You can only use this site if online gambling is legal for you in your jurisdiction.
3. This site uses an immutable automated smart contract, it may have unfixable bugs. Read through its source code before proceeding.
4. All transactions are final and irreversible, no refunds.
5. Bet payout is not guaranteed, it depends on the contract's balance and current bets. Check them before betting.
6. Never bet more than what you can afford to lose.
`;

import { BFormSelect, BModal, BFormTextarea } from "bootstrap-vue";

export default {
  name: "Connection",
  components: {
    SignalIndicator,
    BFormSelect,
    BModal,
    BFormTextarea,
  },
  props: {
    conn: Object,
    testMode: Boolean,
  },
  data: () => {
    return {
      rpcAddr: null,
      apiKey: null,
      selectedRpc: "Custom",
      terms: TERMS,
      ConnState,
    };
  },
  methods: {
    showTermsModal() {
      this.$refs["terms-modal"].show();
    },
    connect: async function () {
      if (this.conn.state === ConnState.Connected) {
        return;
      }
      console.log("connecting");
      if (!this.testMode) {
        if (this.selectedRpc != null) {
          if (this.selectedRpc === "Custom") {
            this.conn.setRpc(this.rpcAddr, this.apiKey);
          } else {
            console.log(
              "setting rpc to",
              this.selectedRpc,
              RPCS[this.selectedRpc]
            );
            this.conn.setRpc(
              RPCS[this.selectedRpc].url,
              RPCS[this.selectedRpc].key
            );
          }
        }
      }
      try {
        await this.conn.start();
        this.saveRpc();
        this.conn.setNewBlockCallback((block) => {
          this.$emit("newBlock", block);
        });
      } catch (e) {
        console.log(e);
      }
    },
    saveRpc: function () {
      const rpc = {
        selectedRpc: this.selectedRpc,
        rpcAddr: this.rpcAddr,
        apiKey: this.apiKey,
      };
      window.localStorage.setItem("rpc", JSON.stringify(rpc));
    },
    loadRpc: function () {
      let rpc = null;
      try {
        rpc = JSON.parse(window.localStorage.getItem("rpc"));
      } catch (e) {
        console.log(e);
        return false;
      }
      if (rpc != null) {
        this.selectedRpc = rpc.selectedRpc;
        this.rpcAddr = rpc.rpcAddr;
        this.apiKey = rpc.apiKey;
        return true;
      } else {
        return false;
      }
    },
    disconnect: function () {
      if (this.conn === null) {
        return;
      }
      console.log("disconnecting");
      this.conn.stop();
    },
  },
  computed: {
    connecting: function () {
      return this.conn.state === ConnState.Connecting;
    },
    connected: function () {
      return this.conn.state === ConnState.Connected;
    },
    wrongKey: function () {
      return this.conn.state === ConnState.WrongKey;
    },
    connError: function () {
      return this.conn.state === ConnState.Error;
    },
    rpcSelectOptions() {
      return Object.keys(RPCS).map((name) => {
        return {
          value: name,
          text: name,
        };
      });
    },
  },
  created: function () {
    const loaded = this.loadRpc();
    if (loaded) this.connect();
  },
};
</script>

<style scoped>
.conn-btn {
  height: 3rem;
}

.load-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: auto;
}

#disclaimer {
  margin-top: 0.5rem;
  font-size: 0.7rem;
  color: #666;
}
</style>
