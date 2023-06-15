<template>
  <div id="betPlacer">
    <h5 v-if="address != null">Place a bet</h5>
    <h5 v-else>Sign in to bet</h5>
    <div id="blur-wrapper" :class="{ blur: address == null }">
      <h6>Pick heads or tails</h6>
      <Coin @side="setCoinSide" />
      <h6>Set the size of the bet</h6>
      <div id="bet-size-wrapper">
        <b-form-input
          id="bet-size"
          v-model="betSize"
          :placeholder="minBet.toString()"
          :state="betValid != false || betSize == '' ? null : false"
          :formatter="sizeFormatter"
        ></b-form-input>
        iDNA
        <button class="btn btn-secondary" @click="halveBet">½x</button>
        <button class="btn btn-secondary" @click="doubleBet">2x</button>
      </div>
      <b-form-invalid-feedback
        id="bet-size-feedback"
        :state="betValid == false && betSize == ''"
      >
        {{ sizeFeedback }}
      </b-form-invalid-feedback>
      Profit on win:
      <strong class="text-success">+{{ profit.profit }} iDNA</strong>
      <a
        href="#collapseIndicatorProfit"
        v-b-toggle.collapse-profit
        @click.prevent
        data-bs-toggle="collapse"
        aria-expanded="false"
        aria-controls="collapseIndicatorProfit"
      >
        <b-icon-question-circle
          id="profitQuestion"
          style="margin-left: 0.5rem"
        />
      </a>
      <b-collapse id="collapse-profit">
        <table style="width: 100%">
          <tr>
            <td>Total payout:</td>
            <td>
              <strong class="text-success">{{ profit.payout }} iDNA</strong>
            </td>
          </tr>
          <tr>
            <td>Fee:</td>
            <td>
              <strong class="text-warning">-{{ profit.fee }} iDNA</strong> ({{
                profit.feePercent
              }}%)
              <b-icon-question-circle id="feeQuestion" />
            </td>
          </tr>
          <tr>
            <td>Burn:</td>
            <td>
              <strong class="text-warning">-{{ profit.burn }} iDNA</strong> ({{
                profit.burnPercent
              }}%)
              <b-icon-question-circle id="burnQuestion" />
            </td>
          </tr>
        </table>
      </b-collapse>

      <button
        class="bet-btn btn btn-primary btn-lg btn-block"
        style="width: 100%; margin-top: 1rem"
        :disabled="betValid == false || betting || contractState.frozen != 0"
        @click="bet"
      >
        <div
          v-if="betting"
          class="load-spinner spinner-border spinner-border-sm"
          role="status"
        >
          <span class="sr-only">Betting...</span>
        </div>
        <div v-else-if="contractState.frozen != 0">Betting is frozen</div>
        <div v-else-if="betValid != false">
          Bet {{ betSize }} iDNA on {{ sideEmoji }}
        </div>
        <div v-else>Invalid bet size</div>
      </button>
      <b-tooltip target="feeQuestion" triggers="hover">
        Needed to subsidize VRF proof verification
      </b-tooltip>
      <b-tooltip target="burnQuestion" triggers="hover">
        Coin burn good
      </b-tooltip>
    </div>
  </div>
</template>

<script>
import {
  BFormInput,
  BFormInvalidFeedback,
  BIconQuestionCircle,
  BCollapse,
  BTooltip,
} from "bootstrap-vue";
import Coin from "./Coin.vue";
import { betProfit } from "../utils";

export default {
  name: "BetPlacer",
  components: {
    BFormInput,
    BFormInvalidFeedback,
    BIconQuestionCircle,
    BCollapse,
    BTooltip,
    Coin,
  },
  data: function () {
    return {
      betSize: "",
      coinSide: null,
      betting: false,
      sizeFeedback: "hey",
    };
  },
  props: {
    contractState: Object,
    addressBalance: Number,
    address: String,
  },
  methods: {
    bet() {
      this.betting = true;
      this.$emit("placeBet", {
        betSize: this.betSize,
        coinSide: this.coinSide,
      });
    },
    doubleBet() {
      this.betSize *= 2;
      this.fixBetSize();
    },
    halveBet() {
      this.betSize = Math.floor(this.betSize / 2);
      this.fixBetSize();
    },
    fixBetSize() {
      if (this.betSize > this.maxBet) {
        this.betSize = this.maxBet;
      } else if (this.betSize < this.minBet) {
        this.betSize = this.minBet;
        if (this.betSize > this.maxBet) {
          this.betSize = 0;
        }
      }
    },
    setCoinSide(side) {
      this.coinSide = side;
      console.log("bp", side);
    },
    sizeFormatter(value) {
      if (value == "") {
        return "";
      }
      let size = Number.parseInt(value);
      if (isNaN(size) || size < 0) {
        size = this.betSize;
      }
      return size;
    },
  },
  computed: {
    profit() {
      return betProfit(this.betSize, this.contractState);
    },
    minBet() {
      return this.contractState.minBet;
    },
    maxBet() {
      return Math.min(
        this.addressBalance,
        this.contractState.maxBet,
        this.contractState.liqBalance
      );
    },
    sideEmoji() {
      return this.coinSide === 0 ? "⚪" : "⚫";
    },
    betValid() {
      let valid = true;
      if (this.contractState.frozen != 0) {
        this.sizeFeedback = "Betting is frozen";
        valid = false;
      } else if (this.betSize < this.minBet) {
        this.sizeFeedback = `Bet size too small (${this.contractState.minBet} iDNA minimum)`;
        valid = false;
      } else if (this.betSize > this.contractState.maxBet) {
        this.sizeFeedback = `Bet size too large (${this.contractState.maxBet} iDNA maximum)`;
        valid = false;
      } else if (this.betSize > this.addressBalance) {
        this.sizeFeedback = "Insufficient balance";
        valid = false;
      } else if (this.betSize > this.contractState.liqBalance) {
        this.sizeFeedback = `Contract's balance too low (${this.contractState.liqBalance} iDNA available)`;
        valid = false;
      } else {
        this.sizeFeedback = "";
      }
      return valid ? null : false;
    },
  },
  mounted: function () {
    this.betSize = this.contractState.minBet;
  },
  watch: {
    addressBalance: function () {
      this.fixBetSize();
    },
    contractState: {
      handler: function () {
        this.fixBetSize();
      },
      deep: true,
    },
  },
};
</script>

<style scoped>
#betPlacer {
  text-align: center;
}

#bet-size-wrapper {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 0.5rem;
}

#collapse-profit table td {
  padding-left: 0.2rem;
  padding-right: 0.2rem;
}

#collapse-profit table td {
  text-align: right;
}

#collapse-profit table td:nth-child(2) {
  text-align: left;
}

#bet-size-wrapper input {
  margin-right: 0.5rem;
}
#bet-size-wrapper button {
  margin-left: 0.5rem;
}

.bet-btn {
  height: 3rem;
}

.blur {
  filter: blur(5px);
  pointer-events: none;
}
</style>
