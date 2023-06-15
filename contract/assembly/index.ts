import {
  Address,
  Bytes,
  Balance,
  Context,
  PersistentMap,
  util,
  Host,
  BASE_IDNA,
} from "idena-sdk-as"

import { vrf_verify, vrf_hash } from "./vrf_verify"

const VRF_PUBKEY = Bytes.fromBytes(util.decodeFromHex("cd44e3b99b008a2140a81908dbe9577a50963d1080662d5d17c1c80cfe69187b"))


class Bet {
  // it's called gas optimization, sweetie, look it up
  a: Address  // bettor
  b: u32      // block
  c: u8       // coinSide
  v: Balance  // size
  s: BetState // state

  constructor(bettor: Address, block: u32, bet: u8, size: Balance, state: BetState) {
    this.a = bettor
    this.b = block
    this.c = bet
    this.v = size
    this.s = state
  }

  @inline
  get bettor(): Address {
    return this.a
  }

  @inline
  get block(): u32 {
    return this.b
  }

  @inline
  get coinSide(): u8 {
    return this.c
  }

  @inline
  get size(): Balance {
    return this.v
  }

  @inline
  get state(): BetState {
    return this.s
  }

  @inline
  set state(state: BetState) {
    this.s = state
  }

  // Makes field names and values human readable unlike the built-in toJSON
  toHumanJSON(betID: u32): string {
    return `{"betID": ${betID}, "bettor": "0x${this.bettor.toHex()}", "block": ${this.block}, "coinSide": ${this.coinSide}, "size": "${this.size.toString()}", "state": ${this.state}}`
  }
}

@idenaBindgenIgnore
enum BetState {
  Invalid,
  Pending,
  Won,
  WonPaid,
  Lost,
  Refunded,
}

const NO_ADDRESS: Address = Address.fromBytes(new Uint8Array(1))
const NO_BET = new Bet(NO_ADDRESS, 0, 0, Balance.Zero, BetState.Invalid)

// Types are weird here because of gas memery - one Balance in a class adds
// 600k gas to EVERY call
export class CoinFlip {
  // Fee amount (in basis points) deducted from winning bets, gets added to the liqBalance
  _feeBps: u16 = 400
  // Burn amount (in basis points) deducted from winning bets, gets burned
  _burnBps: u16 = 100
  // Delay for how soon a bet can be placed (in blocks). Zero should be fine (famous last words)
  _blockDelay: u32 = 0
  // How long (in blocks) before the bets for a block can be refunded due to a missing proof
  _proofSubmissionWindow: u32 = 100
  // In IDNA
  _minBet: u32 = 10
  _maxBet: u32 = 1000

  // Map of bet IDs to bets
  _bets: PersistentMap<u32, Bet> = PersistentMap.withStringPrefix<u32, Bet>("be:")
  _lastBetId: u32 = 0
  // Stores bets for a specific block in a list by key (block:index) with the bet ID as value.
  // Entry for a bet gets deleted when the bet is resolved (won/lost/refunded).
  _betsForBlock: PersistentMap<string, u32> = PersistentMap.withStringPrefix<string, u32>("bb:")
  // Stores the number of bets for each block. Gets deleted when all bets in a block are resolved (won/lost/refunded).
  _betsForBlockCount: PersistentMap<u32, u32> = PersistentMap.withStringPrefix<u32, u32>("bbc:")

  // Tracks the deposited liquidity, increases with fees and lost bets
  _liqBalance: Balance = Balance.Zero
  // Non-zero value freezes new bet placement. Does not affect existing bets.
  _frozen: u8 = 0
  _owner: Address

  constructor() {
    this._owner = Context.caller()
  }

  // Place bet (0 or 1) on the closest block.
  @mutateState
  placeBet(coinSide: u8): u32 {
    const betSize = Context.payAmount()
    const block = u32(Context.blockNumber()) + this._blockDelay
    util.assert(this._frozen == 0, "Betting is frozen")
    util.assert(betSize >= Balance.from(this._minBet) * BASE_IDNA, "Bet is too small")
    util.assert(betSize <= Balance.from(this._maxBet) * BASE_IDNA, "Bet is too big")
    util.assert(betSize <= this._liqBalance, "Bet is larger than contract's balance") // i don't care enough to add more protection, it can go in the frontend if needed
    util.assert(coinSide == 0 || coinSide == 1, "Invalid coin side")
    // Technically it's possible for one address to place any number of
    // bets on one block, but it would be a waste of gas

    this._lastBetId++
    const betID = this._lastBetId
    const bet = new Bet(Context.caller(), block, coinSide, betSize, BetState.Pending)
    this._bets.set(betID, bet)
    let blockBetCount = this._betsForBlockCount.get(block, 0)
    this._betsForBlockCount.set(block, blockBetCount + 1)
    this._betsForBlock.set(this.betKey(block, blockBetCount), betID)
    Host.emitEvent("BetCreated", [Bytes.fromU32(betID), Context.caller(), Bytes.fromU8(coinSide), Bytes.fromU32(block), Bytes.fromBytes(betSize.toBytes())])
    return betID
  }

  // Decide bet results for the given block with the given VRF proof.
  @mutateState
  flipCoin(blockHeight: u32, proof: Bytes): Balance {
    util.assert(Context.caller() == this._owner, "Only owner can flip the coin")
    const currentBlock = u32(Context.blockNumber())
    util.assert(currentBlock >= blockHeight, "Too early to flip the coin")
    util.assert(currentBlock <= blockHeight + this._proofSubmissionWindow, "Proof submission window has passed")
    const betCount = this._betsForBlockCount.get(blockHeight, 0)
    util.assert(betCount > 0, `No bets for this block (${blockHeight})`)
    const blockSeed = this.getBlockSeed(blockHeight)
    if (blockSeed.length == 0) { // should never happen, bets will become refundable later
      Host.emitEvent("BlockSeedMissing", [Bytes.fromU32(blockHeight)])
      return Balance.Zero;
    }
    Host.emitEvent("BlockSeed", [Bytes.fromBytes(blockSeed.toBytes())])
    util.assert(vrf_verify(VRF_PUBKEY, proof, blockSeed), "Invalid VRF proof")

    const hash = vrf_hash(proof)
    this._decideBets(blockHeight, hash)
    return this.payOut(blockHeight)
  }

  // Change bet state to Won or Lost based on the given hash from the proof.
  @mutateState
  _decideBets(blockHeight: u32, hash: Bytes): void {
    util.assert(Context.caller() == this._owner, "Only owner can decide bets") // technically not needed because the method is private but who knows
    Host.emitEvent("Hash", [Bytes.fromBytes(hash.toBytes())])
    const winningValue = hash[0] % 2
    Host.emitEvent("WinningValue", [Bytes.fromU8(winningValue)])
    const betCount = this._betsForBlockCount.get(blockHeight, 0)
    for (let i = u32(0); i < betCount; i++) {
      const betID = this._betsForBlock.get(this.betKey(blockHeight, i), 0)
      const bet = this._bets.get(betID, NO_BET)
      if (bet.state != BetState.Pending) {
        continue
      }
      if (bet.coinSide == winningValue) {
        bet.state = BetState.Won
        Host.emitEvent("BetWon", [Bytes.fromU32(betID)])
      } else {
        bet.state = BetState.Lost
        this._liqBalance += bet.size
        Host.emitEvent("BetLost", [Bytes.fromU32(betID)])
      }
      this._bets.set(betID, bet)
    }
  }

  // Pay out the bets that were marked as Won by `_decideBets`.
  // If the contract runs out of balance, it will stop paying out and resume when
  // funds are added. This is why this method can be called on its own by anyone.
  @mutateState
  payOut(blockHeight: u32): Balance {
    let paidOut = Balance.Zero
    let burned = Balance.Zero
    let paidOutAll = true
    const betCount = this._betsForBlockCount.get(blockHeight, 0)
    let liq = this._liqBalance
    for (let i = u32(0); i < betCount; i++) {
      const key = this.betKey(blockHeight, i)
      const betID = this._betsForBlock.get(key, 0)
      const bet = this._bets.get(betID, NO_BET)
      if (bet.state != BetState.Won) {
        continue
      }
      const fee = bet.size * Balance.from(this._feeBps) / Balance.from(10000)
      const burn = bet.size * Balance.from(this._burnBps) / Balance.from(10000)
      const betPayout = bet.size * Balance.from(2) - fee - burn
      const liqLoss = bet.size - fee
      // If the liq has enough balance, pay out immediately, otherwise leave as Won
      if (liqLoss <= liq) {
        paidOut += betPayout
        burned += burn
        liq -= liqLoss
        bet.state = BetState.WonPaid
        this._bets.set(betID, bet)
        Host.createTransferPromise(bet.bettor, betPayout)
        Host.emitEvent("BetPaidOut", [Bytes.fromU32(betID)])
        this._betsForBlock.delete(key)
      } else {
        paidOutAll = false
        break
      }
    }
    if (paidOutAll) {
      this._betsForBlockCount.delete(blockHeight)
    }
    Host.burn(burned)
    this._liqBalance = liq
    return paidOut
  }

  // Refund all bets for a given block.
  @mutateState
  refundBets(blockHeight: u32): void {
    const currentBlock = Context.blockNumber()
    util.assert(currentBlock > blockHeight + this._proofSubmissionWindow, "Too early to refund")
    const betCount = this._betsForBlockCount.get(blockHeight, 0)
    util.assert(betCount > 0, "No bets to refund")
    let refunded = Balance.Zero
    let refundedAll = true
    const initialBalance = Context.contractBalance()
    for (let i = u32(0); i < betCount; i++) {
      const key = this.betKey(blockHeight, i)
      const betID = this._betsForBlock.get(key, 0)
      const bet = this._bets.get(betID, NO_BET)
      if (bet.state != BetState.Pending) {
        continue
      }
      if (bet.size + refunded > initialBalance) {
        refundedAll = false
        break
      }
      bet.state = BetState.Refunded
      this._bets.set(betID, bet)
      this._betsForBlock.delete(key)
      Host.createTransferPromise(bet.bettor, bet.size)
      refunded += bet.size
      Host.emitEvent("BetRefunded", [Bytes.fromU32(betID)])
    }
    if (refundedAll) {
      this._betsForBlockCount.delete(blockHeight)
    }
  }

  // Add betting liquidity. Can be withdrawn only by the owner.
  @mutateState
  deposit(): void {
    this._liqBalance += Context.payAmount()
  }

  // Remove betting liquidity.
  // Includes fees and lost bets, doesn't include balance from pending bets.
  @mutateState
  withdraw(amount: Balance): void {
    util.assert(Context.caller() == this._owner, "Only owner can withdraw")
    util.assert(amount <= this._liqBalance, "Not enough withdrawable balance")
    util.assert(Context.contractBalance() >= this._liqBalance, "Contract balance is less than expected")
    Host.createTransferPromise(Context.caller(), amount)
    this._liqBalance -= amount
  }

  // If someone sends coins directly to the contract, this function can be used
  // to make them "unstuck". Otherwise there would be no way to withdraw them.
  @mutateState
  fixliqBalance(): void {
    util.assert(Context.caller() == this._owner, "Only owner can fix contract's balance")
    // Checking that there aren't recent pending or unpaid bets to not steal their deposits
    for (let i = this._lastBetId; i > 0 && this._lastBetId - i < 200; i--) {
      const bet = this._bets.get(i, NO_BET)
      util.assert(bet.state != BetState.Pending && bet.state != BetState.Won, "There are pending bets")
    }
    this._liqBalance = Context.contractBalance()
  }

  @inline
  betKey(blockHeight: u32, betIndex: u32): string {
    return blockHeight.toString() + ":" + betIndex.toString()
  }

  @view
  getBlockSeed(blockHeight: u32): Bytes {
    // return Bytes.fromBytes(util.decodeFromHex("0x544553545f4d4553534147455f544553545f4d4553534147455f544553545f4d")) // for testing
    let seed = new Bytes(0);
    const currentBlock = u32(Context.blockNumber())

    if (blockHeight == currentBlock) {
      seed = Bytes.fromBytes(Context.blockSeed())
    } else {
      const betBlock = Host.blockHeader(blockHeight)
      // i love typescript
      const proposedHeader = betBlock.proposedHeader
      const emptyHeader = betBlock.emptyHeader
      if (proposedHeader != null) {
        seed = Bytes.fromBytes(proposedHeader.blockSeed)
      } else if (emptyHeader != null) {
        seed = Bytes.fromBytes(emptyHeader.blockSeed)
      } else { // should never happen
        return new Bytes(0)
      }
    }
    return seed
  }

  // Returns a "human" JSON representation of a bet.
  @view
  getBet(betID: u32): string {
    const bet = this._bets.get(betID, NO_BET)
    util.assert(bet.state != BetState.Invalid, "Invalid bet")
    return bet.toHumanJSON(betID)
  }

  // Returns a JSON array of bets, starting from `afterID` and up to `count`.
  // If `afterID` is 0, it will start from the most recent bet.
  @view
  getBets(afterID: u32, count: u32): string {
    afterID = afterID > 0 ? afterID : this._lastBetId + 1
    let json = "["
    while (afterID > 1 && count > 0) {
      json += this.getBet(afterID - 1)
      afterID--
      count--
      if (afterID > 1 && count > 0) {
        json += ","
      }
    }
    json += "]"
    return json
  }

  @view
  getFee(): Balance {
    return Balance.from(this._feeBps)
  }

  @mutateState
  setFee(fee: u16): void {
    util.assert(Context.caller() == this._owner, "Only owner can set fee")
    this._feeBps = fee
  }

  @view
  getBurn(): Balance {
    return Balance.from(this._feeBps)
  }

  @mutateState
  setBurn(burn: u16): void {
    util.assert(Context.caller() == this._owner, "Only owner can set burn")
    this._burnBps = burn
  }

  @view
  getBlockDelay(): u32 {
    return this._blockDelay
  }

  @mutateState
  setBlockDelay(blockDelay: u32): void {
    util.assert(Context.caller() == this._owner, "Only owner can set block delay")
    this._blockDelay = blockDelay
  }

  @view
  getMinBet(): Balance {
    return Balance.from(this._minBet) * BASE_IDNA
  }

  @mutateState
  setMinBet(minBet: u32): void {
    util.assert(Context.caller() == this._owner, "Only owner can set min bet")
    this._minBet = minBet
  }

  @view
  getMaxBet(): Balance {
    return Balance.from(this._maxBet) * BASE_IDNA
  }

  @mutateState
  setMaxBet(maxBet: u32): void {
    util.assert(Context.caller() == this._owner, "Only owner can set max bet")
    this._maxBet = maxBet
  }

  @view
  frozen(): boolean {
    return this._frozen == 0 ? false : true
  }

  @mutateState
  setFrozen(frozen: u8): void {
    util.assert(Context.caller() == this._owner, "Only owner can freeze")
    this._frozen = frozen
  }

  @view
  liqBalance(): Balance {
    return this._liqBalance
  }

  @view
  proofSubmissionWindow(): u32 {
    return this._proofSubmissionWindow
  }

  @mutateState
  setProofSubmissionWindow(proofSubmissionWindow: u32): void {
    util.assert(Context.caller() == this._owner, "Only owner can set proof submission window")
    this._proofSubmissionWindow = proofSubmissionWindow
  }

  // Returns block seed if bets are pending for the specified block. Convenience function for the prover.
  @view
  needProof(blockHeight: u32): Bytes {
    util.assert(blockHeight <= Context.blockNumber(), "Block height must be in the past")
    // This is not an assert because failure signals to the prover that block hasn't been mined yet
    if (Context.blockNumber() - blockHeight > this._proofSubmissionWindow) {
      return new Bytes(0)
    }
    const betID = this._betsForBlock.get(this.betKey(blockHeight, 0), 0)
    const bet = this._bets.get(betID, NO_BET)
    if (bet.state != BetState.Pending) {
      return new Bytes(0)
    }

    return this.getBlockSeed(blockHeight)
  }

  @mutateState
  transferOwnership(newOwner: Address): void {
    util.assert(Context.caller() == this._owner, "Only owner can transfer ownership")
    this._owner = newOwner
  }

  // re-export of vrf_verify for testing
  @view
  verifyVrfProof(publicKey: Bytes, proof: Bytes, msg: Bytes): bool {
    return vrf_verify(publicKey, proof, msg)
  }

  @view
  vrfPubkey(): Bytes {
    return VRF_PUBKEY
  }
}
