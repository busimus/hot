<template>
  <div id="wrapper">
    <div
      id="main-ui-wrapper"
      style="padding-top: 0.5em; padding-bottom: 0.5em"
      class="container-fluid"
    >
      <div id="main-ui" class="main-panel border shadow-sm rounded">
        <img id="logo" alt="HOT" src="./assets/HOT_logo.png" />
        <hr style="margin-bottom: 0.5em" />

        <a
          href="#collapseIndicatorChevronDark"
          v-b-toggle.collapse-about
          @click.prevent
          class="text-center"
          style="display: block"
          data-bs-toggle="collapse"
          aria-expanded="false"
          aria-controls="collapseIndicatorChevronDark"
        >
          About
          <b-icon-chevron-down class="when-closed" />
          <b-icon-chevron-up class="when-open" />
        </a>
        <b-collapse id="collapse-about">
          <p>
            This is a Heads or Tails smart contract. Bet on the side of the coin
            and double your money if your guess is correct.
          </p>
          <p>
            You can download the source code by following the link at the bottom
            of the page. README file will explain the contract's design.
          </p>
        </b-collapse>

        <Connection :conn="conn" @newBlock="refreshEverything" />
        <div v-if="conn.state === ConnState.Connected">
          <Identity
            :address="address"
            :balance="addressBalance"
            @signIn="signIn"
            @signOut="signOut"
          />
          <div></div>
          <hr />
          <BetPlacer
            :address="address"
            :addressBalance="addressBalance"
            :contractState="contractState"
            @placeBet="sendPlaceBetTx"
          />
          <div v-if="txError != null">
            <hr />
            <div class="text-center text-danger">
              Transaction error: <br />
              {{ txError }}
            </div>
          </div>
          <div v-if="waitingForReceipt != null">
            <hr />
            <div class="text-center animated-underline">
              Waiting for
              <a :href="waitingForReceiptLink" target="_blank">{{
                waitingForReceiptShortHash
              }}</a>
            </div>
          </div>
        </div>
      </div>

      <div
        id="history-panel"
        v-if="conn.state == ConnState.Connected"
        class="main-panel border shadow-sm rounded"
      >
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
          "
        >
          <button id="header-dropdown" style="flex: 1; visibility: hidden">
            <b-icon-arrow-clockwise />
          </button>
          <h4 style="flex: 60; text-align: center">
            <a
              style="color: inherit"
              :href="
                'https://scan.idena.io/contract/' + HOT_CONTRACT.toString()
              "
              >Recent bets</a
            >
          </h4>
          <button
            id="i-header-dropdown"
            class="btn btn-light"
            style="flex: 1; margin-bottom: 0.5rem; border: 0px"
            @click="fetchRecentBets(10, true)"
          >
            <b-icon-arrow-clockwise :class="{ 'icon-spin': refreshing > 0 }" />
          </button>
        </div>
        <hr style="margin-top: 0" />
        <div
          v-if="betHistory.length == 0"
          class="refresh-spinner spinner-border spinner-border"
        ></div>
        <table v-else>
          <thead>
            <tr>
              <th style="padding-left: 0.2rem">ID</th>
              <th scope="col">Side</th>
              <th scope="col">Size</th>
              <th scope="col">
                State
                <b-icon-question-circle id="stateQuestion" />
                <b-tooltip target="stateQuestion" triggers="hover">
                  Pending bets get resolved in ~20 seconds
                </b-tooltip>
              </th>
            </tr>
          </thead>
          <tr
            v-for="betID in recentBetIDs"
            v-bind:key="betID"
            :class="{ 'table-info': isBetMine(betHistory[betID]) }"
          >
            <td style="padding-left: 0.2rem">{{ betID }}</td>
            <td>
              <span v-if="betHistory[betID].coinSide == 0">⚪</span>
              <span v-else>⚫</span>
            </td>
            <td>{{ humanBetSize(betHistory[betID].size) }} iDNA</td>
            <td>
              <a
                v-if="isPayOutable(betHistory[betID])"
                @click="sendPayOutTx(betHistory[betID])"
                href="#"
              >
                Pay out
              </a>
              <span v-else>
                {{ humanBetState(betHistory[betID]) }}
              </span>
            </td>
            <td style="width: 0.2rem; text-align: right">
              <b-dropdown
                id="b-header-dropdown"
                variant="link"
                toggle-class="text-decoration-none"
                block
                size="sm"
                no-caret
                right
              >
                <template #button-content>
                  <b-icon-three-dots-vertical />
                </template>
                <b-dropdown-item @click="seeBettor(betHistory[betID])"
                  >Open bettor's address</b-dropdown-item
                >

                <b-dropdown-item
                  v-if="isPayOutable(betHistory[betID])"
                  @click="sendPayOutTx(betHistory[betID])"
                  >Pay out</b-dropdown-item
                >
                <b-dropdown-item
                  v-else-if="betHistory[betID].state == BetState.Pending"
                  :disabled="isRefundable(betHistory[betID]) == false"
                  @click="sendRefundTx(betHistory[betID])"
                  >Refund {{ betRefundableIn(betHistory[betID]) }}
                </b-dropdown-item>
              </b-dropdown>
            </td>
          </tr>
        </table>
        <button
          v-if="oldestBetID != '1'"
          class="btn btn-light"
          style="width: 100%; margin-top: 1rem"
          @click="fetchOlderBets()"
        >
          Load more
        </button>
      </div>
      <div id="footer" class="text-center">
        <div class="source">
          <a :href="'https://scan.idena.io/contract/' + HOT_CONTRACT.toString()"
            >Source code</a
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Identity from "./components/Identity.vue";
import Connection from "./components/Connection.vue";
import BetPlacer from "./components/BetPlacer.vue";
import { Conn, ConnState } from "./connection.js";
import { BN } from "bn.js";
import {
  argsToSlice,
  bufferToHex,
  toBuffer,
  isValidAddress,
  betProfit,
} from "./utils.js";
import {
  BCollapse,
  BDropdown,
  BDropdownItem,
  BTooltip,
  BIconChevronDown,
  BIconChevronUp,
  BIconArrowClockwise,
  BIconThreeDotsVertical,
  BIconQuestionCircle,
} from "bootstrap-vue";
import { HOT_CONTRACT } from "./config.js";
import { Buffer } from "buffer";

import * as proto from "./proto/models_pb.js";

const BetState = Object.freeze({
  Invalid: 0,
  Pending: 1,
  Won: 2,
  WonPaid: 3,
  Lost: 4,
  Refunded: 5,
});

const BetStateHuman = {
  0: "Invalid",
  1: "Pending",
  2: "Won (unpaid)",
  3: "Won",
  4: "Lost",
  5: "Refunded",
};

export default {
  name: "App",
  components: {
    Identity,
    Connection,
    BetPlacer,
    BCollapse,
    BDropdown,
    BDropdownItem,
    BTooltip,
    BIconChevronDown,
    BIconChevronUp,
    BIconArrowClockwise,
    BIconThreeDotsVertical,
    BIconQuestionCircle,
  },
  data: function () {
    const conn = new Conn(this.connected);

    return {
      conn,
      address: null,
      addressBalance: null,
      addressNonce: 0,
      epoch: 0,
      betting: false,
      contractState: {
        feeBps: 400,
        burnBps: 100,
        proofSubmissionWindow: 100,
        minBet: 10,
        maxBet: 1000,
        liqBalance: 200,
        frozen: 0,
      },
      betHistory: {},
      oldestBetID: 0,
      newestBetID: 0,
      waitingForReceipt: null,
      txError: null,
      refreshing: 0,

      ConnState,
      BetState,
      BetStateHuman,
      HOT_CONTRACT,
    };
  },
  methods: {
    signIn: function (address) {
      this.address = address.toLowerCase();
      localStorage.address = address;
    },
    signOut: function () {
      history.pushState("", document.title, location.pathname);
      this.address = null;
      localStorage.removeItem("address");
    },
    connected: function () {
      console.log("connected!");
    },
    sendPlaceBetTx: async function (args) {
      const argsArray = [
        {
          index: 0,
          format: "int64",
          value: args.coinSide.toString(),
        },
      ];
      await this.buildTx("placeBet", argsArray, args.betSize);
    },
    sendPayOutTx: async function (bet) {
      const argsArray = [
        {
          index: 0,
          format: "int64",
          value: bet.block.toString(),
        },
      ];
      await this.buildTx("payOut", argsArray);
    },
    sendRefundTx: async function (bet) {
      const argsArray = [
        {
          index: 0,
          format: "int64",
          value: bet.block.toString(),
        },
      ];
      await this.buildTx("refundBets", argsArray);
    },
    buildTx: async function (method, args, amountInt = 0) {
      var popup = window.open("", "_blank");
      this.generating = true;
      console.log(method, args);
      try {
        const nonce = this.addressNonce + 1;
        const maxFeeInt = await this.conn.estimateFee(
          method,
          args,
          this.address,
          amountInt.toString()
        );
        console.log("maxFeeInt", maxFeeInt);
        const maxFee = new BN(maxFeeInt.toString());
        const payload = proto.encodeProtoCallContractAttachment({
          method,
          args: argsToSlice(args),
        });
        console.log(payload);
        console.log(bufferToHex(payload));
        const amount = new BN(`${amountInt}000000000000000000`);
        const amountBytes = toBuffer(amount);
        const maxFeeBytes = toBuffer(maxFee);

        const tx = proto.encodeProtoTransaction({
          data: {
            type: 16,
            to: HOT_CONTRACT.buf,
            amount: amountBytes,
            maxFee: maxFeeBytes,
            nonce: nonce,
            epoch: this.epoch,
            payload: payload,
          },
        });
        const serialized = bufferToHex(tx);
        console.log("serialized", serialized);
        const page_url =
          location.protocol + "//" + location.host + location.pathname;
        const callback_url = encodeURIComponent(page_url);
        console.log("callback", callback_url);
        const url = `https://app.idena.io/dna/raw?tx=${serialized}
        &callback_url=${callback_url}?method=${method}`;
        popup.location = url;
      } catch (e) {
        popup.close();
        console.error(e);
      }
      this.generating = false;
    },
    waitForReceipt: async function (hash) {
      this.waitingForReceipt = hash;
      while (true) {
        try {
          const receipt = await this.conn.getTxReceipt(hash);
          if (receipt) {
            this.waitingForReceipt = null;
            return receipt;
          }
        } catch (e) {
          // console.error(e);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    },
    updateContractState: async function () {
      const state = await this.conn.getContractState();
      Object.keys(state).forEach((key) => {
        if (key == "_liqBalance") state[key] = state[key] / 1e18;
        this.contractState[key.replace(/^_/, "")] = state[key];
        // console.log(key, state[key]);
      });
    },
    initAddress: async function () {
      // console.log("initAddress");
      if (this.address) {
        // console.log("address", this.address);
        this.epoch = (await this.conn.getEpoch()).epoch;
        const balanceResp = await this.conn.getBalance(this.address);
        this.addressBalance = Number.parseFloat(balanceResp.balance);
        this.addressNonce = balanceResp.mempoolNonce;
      }
    },
    refreshEverything: async function () {
      this.refreshing += 1;
      try {
        await this.fetchRecentBets(10);
        await this.updateContractState();
        await this.initAddress();
      } catch (e) {
        console.error(e);
      }
      this.refreshing = 0;
    },
    fetchRecentBets: async function (amount = 10, reset = false) {
      this.refreshing += 1;
      try {
        let bets = await this.conn.getBets(0, amount.toString());
        const newNewestBetID = bets[0].betID;
        for (const bet of bets) {
          this.celebrateIfNeeded(bet);
          this.betHistory[bet.betID] = bet;
        }
        const newOldestBetID = bets[bets.length - 1].betID;
        if (newOldestBetID > this.newestBetID || this.oldestBetID == 0 || reset)
          this.oldestBetID = newOldestBetID;
        this.newestBetID = newNewestBetID;
      } catch (e) {
        console.error(e);
      }
      this.refreshing -= 1;
    },
    fetchOlderBets: async function (amount = 10) {
      this.refreshing += 1;
      try {
        let bets = await this.conn.getBets(this.oldestBetID, amount.toString());
        for (const bet of bets) {
          this.betHistory[bet.betID] = bet;
        }
        this.oldestBetID = bets[bets.length - 1].betID;
      } catch (e) {
        console.error(e);
      }
      this.refreshing -= 1;
    },
    celebrateIfNeeded: function (updatedBet) {
      const currentBet = this.betHistory[updatedBet.betID];
      let title, text, variant;
      if (
        currentBet &&
        updatedBet.bettor == this.address &&
        currentBet.state == BetState.Pending
      ) {
        if (updatedBet.state == BetState.WonPaid) {
          const profit = betProfit(
            Number.parseInt(updatedBet.size) / 1e18,
            this.contractState
          );
          title = `Bet #${updatedBet.betID} won`;
          text = `Your bet #${updatedBet.betID} won and you received ${profit.payout} iDNA`;
          variant = "success";
        } else if (updatedBet.state == BetState.Won) {
          title = `Bet #${updatedBet.betID} won`;
          text = `Your bet #${updatedBet.betID} won but couldn't be paid out`;
          variant = "warning";
        } else if (updatedBet.state == BetState.Lost) {
          title = `Bet #${updatedBet.betID} lost`;
          text = `Your bet #${updatedBet.betID} lost`;
          variant = "danger";
        } else if (updatedBet.state == BetState.Refunded) {
          title = `Bet #${updatedBet.betID} refunded`;
          text = `Your bet #${updatedBet.betID} was refunded`;
          variant = "info";
        }
      }

      if (title) {
        if (variant == "success") this.showConfetti();
        this.showToast(title, text, variant, true);
      }
    },
    showToast: function (title, text, variant = "info", noAutoHide = false) {
      this.$bvToast.toast(text, {
        title: title,
        toaster: "b-toaster-top-center",
        solid: false,
        appendToast: true,
        variant: variant,
        noAutoHide,
      });
    },
    showConfetti: function () {
      this.$confetti.addConfetti({
        confettiColors: ["#a865fd", "#27cdff", "#78ff42", "#ff718f", "#faff6a"],
      });
      this.$confetti.addConfetti({
        emojis: ["🪙", "💵", "💰"],
        emojiSize: 30 * window.devicePixelRatio,
        confettiNumber: 20,
      });
    },
    onStorageUpdate(event) {
      if (event.key === "address") {
        console.log("storage update", event.newValue);
        this.address = event.newValue.toLowerCase();
      }
    },
    humanBetSize(betSize) {
      betSize = parseInt(betSize / 1e18);
      if (betSize < 1000) {
        return betSize;
      }
      const magnitude = Math.floor(Math.log10(betSize) / 3);
      const postfix = ["K", "M", "B"][magnitude - 1];
      const value = (betSize / Math.pow(10, magnitude * 3)).toFixed(2);
      return value.replace(/\.?0+$/, "") + postfix;
    },
    humanBetState(bet) {
      const humanState = BetStateHuman[bet.state.toString()];
      if (this.isRefundable(bet)) {
        return "Refundable";
      }
      return humanState;
    },
    isRefundable(bet) {
      return (
        bet.state == BetState.Pending &&
        this.conn.syncState.highestBlock - bet.block >
          this.contractState.proofSubmissionWindow
      );
    },
    isPayOutable(bet) {
      return bet.state == BetState.Won;
    },
    isBetMine(bet) {
      return bet.bettor == this.address;
    },
    betRefundableIn(bet) {
      const blocks =
        this.contractState.proofSubmissionWindow -
        (this.conn.syncState.highestBlock - bet.block);
      const seconds = (blocks + 1) * 20;
      if (seconds < 0) {
        return "available";
      }

      if (seconds > 3600) {
        const h = Math.floor(seconds / 3600);
        return `in ${h} hour${h > 1 ? "s" : ""}`;
      } else if (seconds > 60) {
        const m = Math.floor(seconds / 60);
        return `in ${m} minute${m > 1 ? "s" : ""}`;
      } else {
        return `in ${seconds} seconds`;
      }
    },
    seeBettor: function (bet) {
      var popup = window.open("", "_blank");
      popup.location = `https://scan.idena.io/identity/${bet.bettor}`;
    },
  },
  mounted: async function () {
    if (
      localStorage.address != null &&
      localStorage.address != "null" &&
      localStorage.address != ""
    ) {
      console.log("address in storage", localStorage.address);
      if (isValidAddress(localStorage.address) == false) {
        console.warn("Invalid address in storage!");
        this.signOut();
        return;
      }
      this.address = localStorage.address;
    }
    window.addEventListener("storage", this.onStorageUpdate);
    await this.refreshEverything();
  },
  beforeDestroy() {
    window.removeEventListener("storage", this.onStorageUpdate);
  },
  watch: {
    address(newAddress) {
      console.log("watch newAddress", newAddress);
      if (newAddress == null || newAddress == "null" || newAddress == "") {
        return;
      }
      if (isValidAddress(newAddress) == false) {
        console.warn("Invalid address!");
        this.signOut();
        return;
      }
      localStorage.address = newAddress.toLowerCase();
      this.initAddress();
    },
  },
  computed: {
    waitingForReceiptLink() {
      return `https://scan.idena.io/transaction/${this.waitingForReceipt}`;
    },
    waitingForReceiptShortHash() {
      const shortHash =
        this.waitingForReceipt.slice(0, 6) +
        ".." +
        this.waitingForReceipt.slice(-4);
      return shortHash;
    },
    recentBetIDs() {
      const ids = Object.keys(this.betHistory)
        .map(Number)
        .sort((a, b) => a - b)
        .reverse();
      // remove bets that arent in the newest to oldest range
      const oldIndex = ids.indexOf(this.oldestBetID);
      const slice = ids.slice(0, oldIndex + 1);
      const newIndex = ids.indexOf(this.newestBetID);
      return slice.slice(newIndex);
    },
  },
  created: async function () {
    const url = new URLSearchParams(window.location.search);
    const method = url.get("method");
    if (method == "reset" || method == "resetAll") {
      localStorage.clear();
      this.signOut();
      history.pushState("", document.title, location.pathname);
    } else if (method) {
      console.log("got method", method);
      const txHash = url.get("tx");
      if (!txHash) {
        console.error("No TX hash");
        return;
      }
      const receipt = await this.waitForReceipt(txHash);
      await this.refreshEverything();
      history.pushState("", document.title, location.pathname);
      if (receipt.success == false) {
        this.txError = receipt.error;
        if (this.txError.startsWith("Error calling the VM: ")) {
          this.txError = this.txError.slice(22);
        }
        if (this.txError.startsWith("RuntimeError: ")) {
          this.txError = this.txError.slice(14);
        }
        if (this.txError.startsWith("Error in wasm module: ")) {
          this.txError = this.txError.slice(22);
        }
        console.error("TX failed", receipt);
        return;
      }
      if (method == "placeBet") {
        const buf = Buffer.from(
          receipt.actionResult.outputData.slice(2),
          "hex"
        );
        buf.reverse(); // why is it big endian????
        const betID = parseInt(buf.toString("hex"), 16);

        this.showToast(
          "Bet placed!",
          `The outcome of bet #${betID} will be known in a about 20 seconds`,
          "info"
        );
      }
    }
  },
  destroyed: function () {
    console.log("destroyed");
    this.conn.stop();
  },
};
</script>

<style>
* {
  font-family: Helvetica;
  box-sizing: border-box;
}

#wrapper {
  width: 100%;
  height: 100%;
  display: flex;
}

#main-ui-wrapper {
  margin-top: auto;
  margin-bottom: auto;
  max-width: 20rem;
  padding: 0;
}

.main-panel {
  padding: 1rem 1rem 1em 1em;
  background-color: white;
  margin-bottom: 0.5em;
}

#logo {
  width: 100%;
}

#footer {
  margin-top: 0.7rem;
  color: #777;
}

#footer .source {
  font-size: 1rem;
  color: #666;
}

#footer a {
  color: #666;
}

#footer .address {
  font-size: 0.55rem;
}

.ceremony-state {
  font-size: 0.9rem;
}

.eligibilityAlert {
  margin-bottom: 0;
}

.load-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: auto;
}

/* Define the animation keyframes */
@keyframes loading-underline {
  0% {
    left: 0;
    width: 0;
  }
  50% {
    left: 0;
    width: 100%;
  }
  100% {
    left: 100%;
    width: 0;
  }
}

/* Create the CSS class for the animated underline */
.animated-underline {
  position: relative;
  padding-bottom: 0.5em;
  /* display: inline-block; */
}

/* Add the pseudo-element and apply the animation */
.animated-underline::after {
  content: "";
  position: absolute;
  margin-top: 0.5em;
  bottom: 0;
  left: 0;
  width: 0;
  height: 2px; /* Adjust the underline thickness as needed */
  background-color: #6c757d;
  animation: loading-underline 1s cubic-bezier(0.445, 0.05, 0.55, 0.95) infinite;
}

.collapsed > .when-open,
.not-collapsed > .when-closed {
  display: none;
}

#b-header-dropdown button {
  color: inherit !important;
}

#history-panel table {
  width: 100%;
  border-collapse: collapse;
}

.icon-spin {
  animation: spin-animation 1s infinite;
  animation-timing-function: linear;
  display: inline-block;
}

@keyframes spin-animation {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(359deg);
  }
}

body,
html {
  width: 100%;
  height: 100%;
  background-color: #f0f0f0;
}
</style>
