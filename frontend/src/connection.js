import { HOT_CONTRACT } from "./config.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ConnState = Object.freeze({
  NotConn: 0,
  Connecting: 1,
  Connected: 3,
  Error: 4,
  WrongKey: 5,
});

export const APIKeyErrorCode = -32800;

export class Conn {
  constructor(connectedCb) {
    this.rpcAddr = null;
    this.apiKey = null;
    this.connectedCb = connectedCb;
    this.syncTicker = null;
    this.state = ConnState.NotConn;
    this.errorMessage = "";
    this.newBlockCallback = null;

    this.syncState = {
      syncing: false,
      currentBlock: 0,
      highestBlock: 0,
      wrongTime: false,
    };
  }

  async start() {
    this.state = ConnState.Connecting;
    this.last_id = 0;
    if (["", null, undefined].indexOf(this.rpcAddr) != -1) {
      console.warn("defaulting to internal node address!");
      this.rpcAddr = "http://127.0.0.1:9009";
    }
    if (!this.rpcAddr.startsWith("http"))
      this.rpcAddr = "https://" + this.rpcAddr;

    try {
      await this.updateSyncState();
    } catch (e) {
      if (e.code === APIKeyErrorCode) {
        this.state = ConnState.WrongKey;
        return this.state;
      } else {
        this.state = ConnState.Error;
        this.errorMessage = e.message;
        return this.state;
      }
    }
    if (this.syncTicker !== null) {
      clearInterval(this.syncTicker);
    }
    this.syncTicker = setInterval(() => this.updateSyncState(), 2500);
    this.state = ConnState.Connected;
    this.connectedCb();
    return this.state;
  }

  stop() {
    if (this.syncTicker !== null) {
      clearInterval(this.syncTicker);
      this.syncTicker = null;
    }
    this.state = ConnState.NotConn;
  }

  setRpc(rpcAddr, apiKey) {
    this.rpcAddr = rpcAddr;
    this.apiKey = apiKey;
  }

  setNewBlockCallback(callback) {
    this.newBlockCallback = callback;
  }

  async updateSyncState() {
    try {
      const sync = await this.call("bcn_syncing");
      if (
        sync.currentBlock > this.syncState.currentBlock &&
        this.newBlockCallback
      ) {
        this.newBlockCallback(sync.currentBlock);
      }
      Object.assign(this.syncState, sync);
    } catch (e) {
      console.error(e);
      this.errorMessage = e.message;
      this.state = ConnState.Error;
      throw e;
    }
    this.state = ConnState.Connected;
  }

  async getIdentity(address) {
    return await this.call("dna_identity", [address]);
  }

  async getEpoch() {
    return await this.call("dna_epoch");
  }

  async getBalance(address) {
    return await this.call("dna_getBalance", [address]);
  }

  async getTxReceipt(txHash) {
    return await this.call("bcn_txReceipt", [txHash]);
  }

  async getBets(start, limit = "5") {
    const hexJson = await this.readCall("getBets", [
      { index: 0, format: "int64", value: start.toString() },
      { index: 1, format: "int64", value: limit.toString() },
    ]);
    const json = strFromHex(hexJson.slice(2));
    return JSON.parse(json);
  }

  async getContractState() {
    const resp = await this.call("contract_readData", [
      HOT_CONTRACT.toString(),
      "STATE",
      "string",
    ]);
    return JSON.parse(resp);
  }

  async readCall(method, args = [], from = ZERO_ADDRESS) {
    const receipt = await this.call("contract_estimateCall", [
      {
        contract: HOT_CONTRACT.toString(),
        from,
        method,
        args,
      },
    ]);
    return receipt.actionResult.outputData;
  }

  async estimateFee(method, args, from, amount = "0") {
    try {
      const receipt = await this.call("contract_estimateCall", [
        {
          contract: HOT_CONTRACT.toString(),
          from,
          method,
          args,
          amount,
        },
      ]);
      console.log(receipt);
      const maxFee =
        Number.parseFloat(receipt.txFee) + Number.parseFloat(receipt.gasCost);
      return Number.parseInt(maxFee * 1.25 * 1e18);
    } catch (e) {
      console.error("fee estimation error:", e);
      return 1e18;
    }
  }

  async call(method, params = [], full = false) {
    const id = ++this.last_id;
    // console.log("calling", method);
    const req = await fetch(this.rpcAddr, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method,
        params,
        id,
        key: this.apiKey,
      }),
    }).catch();

    const resp = await req.json();
    // console.log("got resp", resp);

    if (resp.error) {
      throw resp.error;
    }
    if (full) {
      return resp;
    } else {
      return resp.result;
    }
  }
}

function strFromHex(h) {
  var s = "";
  for (var i = 0; i < h.length; i += 2) {
    s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  }
  return decodeURIComponent(s);
}
