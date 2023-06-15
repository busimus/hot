<template>
  <div class="">
    <div v-if="!signedIn" class="identity">
      <div class="avatar-wrapper">
        <img src="../assets/signedOut.png" class="avatar rounded" />
      </div>
      <div class="address-input">
        <b-form-input
          v-model="inputAddress"
          placeholder="0x1234..."
          :state="addressValid"
        ></b-form-input>
        <button
          style="width: 100%"
          class="btn btn-primary"
          @click="$emit('signIn', inputAddress)"
          :disabled="addressValid == false || inputAddress.length == 0"
        >
          Sign in
        </button>
      </div>
    </div>
    <div v-else class="identity">
      <div class="avatar-wrapper">
        <img :src="'https://robohash.org/' + address" class="avatar rounded" />
      </div>
      <div class="text-truncate">
        <div>
          {{ Math.floor(balance) }} iDNA
          <div class="address text-truncate">
            {{ address }}
          </div>
        </div>
      </div>
      <button class="btn btn-outline-danger" @click.stop="$emit('signOut')">
        <b-icon-x />
      </button>
    </div>
  </div>
</template>

<script>
import { BIconX, BFormInput } from "bootstrap-vue";
import { isValidAddress } from "../utils.js";

export default {
  name: "Identity",
  components: {
    BFormInput,
    BIconX,
  },
  props: {
    address: String,
    balance: Number,
  },
  data: () => {
    return {
      inputAddress: "",
    };
  },
  methods: {},
  computed: {
    signedIn() {
      return this.address != null && this.address != "";
    },
    addressValid() {
      if (this.inputAddress.length == 0 || this.inputAddress == null) {
        return null;
      }
      if (this.inputAddress.length != 42) {
        return false;
      }
      return isValidAddress(this.inputAddress);
    },
  },
};
</script>

<style scoped>
.identity {
  height: 5rem;
  display: flex;
  align-items: center;
  margin-top: 0.5rem;
}

.avatar-wrapper {
  height: 75px;
  width: 75px;
  margin-right: 1rem;
}

.avatar {
  height: 100%;
  width: 5rem;
  background-color: #eee;
}

.address {
  color: grey;
  margin-right: 0.2rem;
}
</style>
