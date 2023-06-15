const fs = require("fs")
const path = require("path")
const util = require("util")

const {
  ContractRunnerProvider,
  ContractArgumentFormat,
} = require("idena-sdk-tests")
const { createHash } = require("crypto")

jest.setTimeout(2000000)

const ONE_ADDRESS = "0x111e1a4e851bf698949afc0c3280c36b2df150d8"
const TWO_ADDRESS = "0x222a3d05c4ffdd54c6f88ace2604d52f70f06107"
const THREE_ADDRESS = "0x333f94ac1d2f03b9c8ee5e24ede3bce7689a458e"
const TRUE_BOOL = '0x74727565'
const FALSE_BOOL = '0x66616c7365'
const TEST_PROOF = '0x03d5b162e7c6b84936692616f91aa932c1c6fbd7f2d8233e3572fae31a59fcc6921600c86e9f8ade624c9f4df4fd3eaf2602ddd3e680d18620b2a74a91e527c2455c6be5f805278c579b47c9e1b7e4586e'
const BAD_PROOF = '0x0334685029ecc92bace8eebf2d6c49470b0c0333d532bc3dff5bbd191e8b0aa3f3aa9ecf7925efa71bcc3cab941b8f70230a7549ac49b2b1d06b3d7a3ce6fda56f03f1c2fda2f133b0a2ffc4c376b02dd3'
const IDNA = "000000000000000000"

async function get_provider(deploy = false) {
  const provider = ContractRunnerProvider.create("http://127.0.0.1:3333", "")

  await provider.Chain.generateBlocks(1)
  await provider.Chain.resetTo(2)

  if (deploy) {
    const {contract} = await deploy_with(provider)
    return {provider, contract}
  }
  return {provider: provider}
}

async function deploy_with(provider, deposit = "0") {
  const wasm = path.join(".", "build", "release", "hot.wasm")
  const code = fs.readFileSync(wasm)

  await provider.Chain.generateBlocks(1)
  await provider.Chain.resetTo(2)

  const deployTx = await provider.Contract.deploy(
    "0",
    "9999",
    code,
    Buffer.from(""),
    []
  )
  await provider.Chain.generateBlocks(1)

  const deployReceipt = await provider.Chain.receipt(deployTx)
  console.log(util.inspect(deployReceipt, { showHidden: false, depth: null, colors: true }))
  expect(deployReceipt.success).toBe(true)
  const contract = deployReceipt.contract

  if (deposit != "0") {
    const depositTx = await provider.Contract.call(contract,
      "deposit",
      deposit,
      "50000",
      []
    )

    await provider.Chain.generateBlocks(1)

    const depositReceipt = await provider.Chain.receipt(depositTx)
    expectAndLog(depositReceipt, true)
  }

  return {contract}
}

async function estimate_output(contract, method, args, provider, success = true, logOutput = true, address = null) {
  if (address == null)
    address = await provider.Chain.godAddress()
  const receipt = await call_from(address, provider,
    contract,
    method,
    "0",
    "50000",
    args,
    true
  )
  if (logOutput)
    console.log("estimate output:", receipt)
  if (success != null)
    expect(receipt.success).toBe(success)
  return receipt.actionResult.outputData
}
async function call_from(from, provider, contract, method, amount, maxFee, args = null, estimate = false) {
  const rcpMethod = estimate ? "contract_estimateCall" : "contract_call"
  return await provider.doRequest({
      method: rcpMethod,
      params: [
          {
              contract: contract,
              method: method,
              amount: amount,
              maxFee: maxFee,
              from: from,
              args: args,
          },
      ],
  });
}

function expectAndLog(receipt, logSub = false) {
  console.log(receipt)
  for (var i = 0; i < (receipt.events || []).length; i++) {
    if (logSub)
      console.log(receipt.events[i])
  }
  for (var i = 0; i < (receipt.actionResult.subActionResults || []).length; i++) {
    if (logSub)
      console.log(receipt.actionResult.subActionResults[i])
    expect(receipt.actionResult.subActionResults[i].success).toBe(true)
    if (receipt.actionResult.subActionResults[i].subActionResults) {
      for (var j = 0; j < (receipt.actionResult.subActionResults[i].subActionResults || []).length; j++) {
        if (logSub)
          console.log(receipt.actionResult.subActionResults[i].subActionResults[j])
        expect(receipt.actionResult.subActionResults[i].subActionResults[j].success).toBe(true)
      }
    }
  }
  expect(receipt.success).toBe(true)
  return receipt
}

async function get_balances(addrs, provider) {
  let balances = {}
  for (var i = 0; i < addrs.length; i++) {
    balances[addrs[i]] = Number.parseFloat(await provider.Chain.balance(addrs[i]))
  }
  return balances
}

async function expect_balance_diff(prev_balances, diffs, provider) {
  let new_balances = await get_balances(Object.keys(diffs), provider)
  let new_diffs = {}
  for (var i = 0; i < Object.keys(diffs).length; i++) {
    let addr = Object.keys(diffs)[i]
    new_diffs[addr] = new_balances[addr] - prev_balances[addr]
  }
  expect(new_diffs).toEqual(diffs)
}

async function proveBlock(block, provider, contract) {
  if (typeof block === 'number') {
    block = block.toString()
    format = ContractArgumentFormat.Int64
  } else {
    format = ContractArgumentFormat.Hex
  }

  return await provider.Contract.call(contract,
  "flipCoin",
  "0",
  "50000",
  [ { index: 0, format: format, value: block },
    { index: 1, format: ContractArgumentFormat.Hex, value: TEST_PROOF },])
}

async function bet(amount, side, address, provider, contract) {
  return await call_from(address, provider, contract,
  "placeBet",
  amount,
  "50000",
  [ { index: 0, format: ContractArgumentFormat.Int8, value: side } ])
}

it("can deploy and bet", async () => {
  const {provider} = await get_provider(false)
  let {contract} = await deploy_with(provider, "1200")

  state = JSON.parse(await provider.Contract.readData(contract, "STATE", "string"))
  // console.log(state)
  expect(state._liqBalance).toBe("1200" + IDNA)

  await estimate_output(contract, "getBet", [ { index: 0, format: ContractArgumentFormat.Int64, value: "0" } ], provider, false)
  await estimate_output(contract, "getBet", [ { index: 0, format: ContractArgumentFormat.Int64, value: "1" } ], provider, false)
  bets = await estimate_output(contract, "getBets", [ { index: 0, format: ContractArgumentFormat.Int64, value: "0" }, { index: 1, format: ContractArgumentFormat.Int64, value: "5" } ], provider, true)
  bets = Buffer.from(bets.slice(2), 'hex').toString('utf8')
  expect(bets).toBe("[]")

  // Winning bet
  bet1Tx = await bet("1000", "1", ONE_ADDRESS, provider, contract)
  // Losing bet
  bet2Tx = await bet("1000", "0", TWO_ADDRESS, provider, contract)
  // Winning bet
  bet3Tx = await bet("1000", "1", THREE_ADDRESS, provider, contract)
  await provider.Chain.generateBlocks(1)

  bet1Receipt = await provider.Chain.receipt(bet1Tx)
  expectAndLog(bet1Receipt, true)
  bet2Receipt = await provider.Chain.receipt(bet2Tx)
  expectAndLog(bet2Receipt, true)
  bet3Receipt = await provider.Chain.receipt(bet3Tx)
  expectAndLog(bet3Receipt, true)

  betBlock = bet1Receipt.events[0].args[3]

  balancesBefore = await get_balances([ONE_ADDRESS, TWO_ADDRESS, THREE_ADDRESS, contract], provider)
  console.log(balancesBefore)

  // await estimate_output(contract, "needProof", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock } ], provider, false)
  // await provider.Chain.generateBlocks(1)
  await estimate_output(contract, "needProof", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock } ], provider, true)

  // Try incorrect proof
  await estimate_output(contract, "flipCoin", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock }, { index: 1, format: ContractArgumentFormat.Hex, value: BAD_PROOF } ], provider, false)

  proofTx = await proveBlock(betBlock, provider, contract)
  await provider.Chain.generateBlocks(1)
  proofReceipt = await provider.Chain.receipt(proofTx)
  expectAndLog(proofReceipt, true)

  balancesAfter = await get_balances([ONE_ADDRESS, TWO_ADDRESS, THREE_ADDRESS, contract], provider)
  console.log(balancesAfter)

  state = JSON.parse(await provider.Contract.readData(contract, "STATE", "string"))
  console.log(state._liqBalance)
  console.log('here')
  await expect_balance_diff(balancesBefore, {
    [ONE_ADDRESS]: +1950,
    [TWO_ADDRESS]: 0,
    [THREE_ADDRESS]: +1950,
    [contract]: -3920,
  }, provider)

  // console.log(state._liqBalance)
  expect(state._liqBalance).toBe("280" + IDNA)

  // Repeat submission, should fail since all bets have been resolved
  proofTx = await proveBlock(betBlock, provider, contract)
  await provider.Chain.generateBlocks(1)

  proofReceipt = await provider.Chain.receipt(proofTx)
  expect(proofReceipt.success).toBe(false)

  await expect_balance_diff(balancesAfter, {
    [ONE_ADDRESS]: 0,
    [TWO_ADDRESS]: 0,
    [THREE_ADDRESS]: 0,
    [contract]: 0,
  }, provider)

  // Testing the case where a bet is too large to be paid out.
  // THIS MIGHT FAIL because bet ordering within a block is not deterministic.

  // Small winning bet that will be paid out
  bet1Tx = await bet("100", "1", ONE_ADDRESS, provider, contract)
  // Large winning bet that will be unable to be paid out
  bet2Tx = await bet("200", "1", TWO_ADDRESS, provider, contract)
  await provider.Chain.generateBlocks(1)
  bet1Receipt = await provider.Chain.receipt(bet1Tx)
  expectAndLog(bet1Receipt, true)
  bet2Receipt = await provider.Chain.receipt(bet2Tx)
  expectAndLog(bet2Receipt, true)

  betBlock = bet1Receipt.events[0].args[3]

  balancesBefore = await get_balances([ONE_ADDRESS, TWO_ADDRESS, contract], provider)
  proofTx = await proveBlock(betBlock, provider, contract)
  await provider.Chain.generateBlocks(1)
  proofReceipt = await provider.Chain.receipt(proofTx)
  expectAndLog(proofReceipt, true)
  balancesAfter = await get_balances([ONE_ADDRESS, TWO_ADDRESS, contract], provider)

  await expect_balance_diff(balancesBefore, {
    [ONE_ADDRESS]: +195,
    [TWO_ADDRESS]: 0,
    [contract]: -196,
  }, provider)

  // Repeat submission, should be a no-op since all payable bets have been resolved
  proofTx = await proveBlock(betBlock, provider, contract)
  await provider.Chain.generateBlocks(1)

  proofReceipt = await provider.Chain.receipt(proofTx)
  expectAndLog(proofReceipt, true)

  await expect_balance_diff(balancesAfter, {
    [ONE_ADDRESS]: 0,
    [TWO_ADDRESS]: 0,
    [contract]: 0,
  }, provider)

  depositMoreTx = await provider.Contract.call(contract,
    "deposit",
    "2000",
    "50000",
    []
  )

  await provider.Chain.generateBlocks(1)

  depositMoreReceipt = await provider.Chain.receipt(depositMoreTx)
  expectAndLog(depositMoreReceipt, true)

  balancesBefore = await get_balances([ONE_ADDRESS, TWO_ADDRESS, contract], provider)

  // Payout TX for the unpaid bet
  payOutTx = await provider.Contract.call(contract,
    "payOut",
    "0",
    "50000",
    [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock } ]  )
  await provider.Chain.generateBlocks(1)

  payOutReceipt = await provider.Chain.receipt(payOutTx)
  expectAndLog(payOutReceipt, true)

  await expect_balance_diff(balancesBefore, {
    [ONE_ADDRESS]: 0,
    [TWO_ADDRESS]: +390,
    [contract]: -392,
  }, provider)

  state = JSON.parse(await provider.Contract.readData(contract, "STATE", "string"))
  expect(state._liqBalance).toBe("1992" + IDNA)

  // Testing payouts with zero fee and burn
  setFeeTx = await provider.Contract.call(contract,
    "setFee",
    "0",
    "50000",
    [ { index: 0, format: ContractArgumentFormat.Int64, value: "0" } ]  )
  setBurnTx = await provider.Contract.call(contract,
    "setBurn",
    "0",
    "50000",
    [ { index: 0, format: ContractArgumentFormat.Int64, value: "0" } ]  )

  await provider.Chain.generateBlocks(1)

  setFeeReceipt = await provider.Chain.receipt(setFeeTx)
  expectAndLog(setFeeReceipt, true)
  setBurnReceipt = await provider.Chain.receipt(setBurnTx)
  expectAndLog(setBurnReceipt, true)

  bet1Tx = await bet("100", "1", ONE_ADDRESS, provider, contract)
  bet2Tx = await bet("50", "1", TWO_ADDRESS, provider, contract)
  await provider.Chain.generateBlocks(1)
  bet1Receipt = await provider.Chain.receipt(bet1Tx)
  expectAndLog(bet1Receipt, true)
  bet2Receipt = await provider.Chain.receipt(bet2Tx)
  expectAndLog(bet2Receipt, true)

  betBlock = bet1Receipt.events[0].args[3]

  balancesBefore = await get_balances([ONE_ADDRESS, TWO_ADDRESS, contract], provider)
  console.log(balancesBefore)
  proofTx = await proveBlock(betBlock, provider, contract)
  await provider.Chain.generateBlocks(1)
  proofReceipt = await provider.Chain.receipt(proofTx)
  expectAndLog(proofReceipt, true)

  balancesAfter = await get_balances([ONE_ADDRESS, TWO_ADDRESS, contract], provider)
  console.log(balancesAfter)

  await expect_balance_diff(balancesBefore, {
    [ONE_ADDRESS]: +200,
    [TWO_ADDRESS]: +100,
    [contract]: -300,
  }, provider)

  // Withdraw all funds from the contract
  balancesBefore = await get_balances([contract], provider)
  state = JSON.parse(await provider.Contract.readData(contract, "STATE", "string"))

  withdrawTx = await provider.Contract.call(contract,
    "withdraw",
    "0",
    "50000",
    [ { index: 0, format: ContractArgumentFormat.Bigint, value: state._liqBalance } ]  )

  await provider.Chain.generateBlocks(1)
  withdrawTxReceipt = await provider.Chain.receipt(withdrawTx)
  expectAndLog(withdrawTxReceipt, true)

  balancesAfter = await get_balances([contract], provider)

  await expect_balance_diff(balancesBefore, {
    [contract]: -1842,
  }, provider)
})

it("can refund after window", async () => {
  const {provider} = await get_provider(false)
  let {contract} = await deploy_with(provider, "1200")

  setProofSubmissionWindowTx = await provider.Contract.call(contract,
    "setProofSubmissionWindow", "0", "50000",
    [ { index: 0, format: ContractArgumentFormat.Int64, value: "10" } ]
  )
  await provider.Chain.generateBlocks(1)
  expectAndLog(await provider.Chain.receipt(setProofSubmissionWindowTx), true)

  bet1Tx = await bet("100", "1", ONE_ADDRESS, provider, contract)
  bet2Tx = await bet("1000", "1", TWO_ADDRESS, provider, contract)
  await provider.Chain.generateBlocks(1)
  bet1Receipt = await provider.Chain.receipt(bet1Tx)
  expectAndLog(bet1Receipt, true)
  bet2Receipt = await provider.Chain.receipt(bet2Tx)
  expectAndLog(bet2Receipt, true)

  betBlock = bet1Receipt.events[0].args[3]

  await provider.Chain.generateBlocks(10)

  // On the last block of the window the proof is still needed and a refund is not yet available.
  expect((await estimate_output(contract, "needProof", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock } ], provider, true))).toHaveLength(66)
  await estimate_output(contract, "flipCoin", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock }, { index: 1, format: ContractArgumentFormat.Hex, value: TEST_PROOF } ], provider, true)
  await estimate_output(contract, "refundBets", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock } ], provider, false)

  await provider.Chain.generateBlocks(1)

  // On the first block after the window the proof can no longer be submitted and a refund is available.
  expect((await estimate_output(contract, "needProof", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock } ], provider, true))).toHaveLength(2)
  await estimate_output(contract, "flipCoin", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock }, { index: 1, format: ContractArgumentFormat.Hex, value: TEST_PROOF } ], provider, false)
  await estimate_output(contract, "refundBets", [ { index: 0, format: ContractArgumentFormat.Hex, value: betBlock } ], provider, true)
})

// I LOVE JAVASCRIPT I LOVE JAVASCRIPT I LOVE JAVASCRIPT
class SeededRandom {
  constructor(seed) {
    this.seed = seed
  }

  randomFloat() {
    const hash = createHash("sha256")
    hash.update(`random ${this.seed}`)
    this.seed++
    const digest = hash.digest()
    const n = (digest[0]) + (digest[1] << 8) + (digest[2] << 16)
    return n / 0xffffff
  }

  // min inclusive, max exclusive
  randRange(min, max) {
    return Math.floor(this.randomFloat() * (max - min) + min)
  }
}

// I have no idea if SeededRandom is any good for this, but this test isn't meant to be realistic anyway
it("soak test idk", async () => {
  const {provider} = await get_provider(false)
  let {contract} = await deploy_with(provider, "1200")
  balancesBefore = await get_balances([contract], provider)
  state = JSON.parse(await provider.Contract.readData(contract, "STATE", "string"))
  minBet = Number.parseInt(state._minBet)
  maxBet = minBet * 3
  bettors = [ONE_ADDRESS, TWO_ADDRESS, THREE_ADDRESS]
  await provider.Chain.generateBlocks(10)
  await provider.Chain.resetTo(10)

  r = new SeededRandom(123)
  for (let run = 0; run < 1000; run++) {
    numOfBets = r.randRange(1, 5)
    for (let i = 0; i < numOfBets; i++) {
      betSize = r.randRange(minBet, maxBet).toString()
      bettor = bettors[r.randRange(0, bettors.length)]
      betSide = r.randRange(0, 2).toString()
      console.log(`bet ${betSize} ${betSide} ${bettor}`)
      betTx = await bet(betSize, betSide, bettor, provider, contract)
    }
    await provider.Chain.generateBlocks(1)
    proofTx = await proveBlock(11 + run * 2, provider, contract)
    await provider.Chain.generateBlocks(1)
    proofReceipt = await provider.Chain.receipt(proofTx)
    // expectAndLog(proofReceipt, false)
    expect(proofReceipt.actionResult.success).toBe(true)
    // break
  }
  balancesAfter = await get_balances([contract], provider)
  console.log(balancesBefore, balancesAfter)
  state = JSON.parse(await provider.Contract.readData(contract, "STATE", "string"))
  console.log(state._liqBalance)
  expect(state._liqBalance).toBe("2042480000000000000000") // highly profitable trading strategy
  await expect_balance_diff(balancesBefore, {
    [contract]: +842.48,
  }, provider)

  await estimate_output(contract, "fixliqBalance", [], provider, true)

  // numOfBets = r.randRange(1, 5)
  // for (let i = 0; i < numOfBets; i++) {
  //   betSize = r.randRange(minBet, maxBet).toString()
  //   bettor = bettors[r.randRange(0, bettors.length)]
  //   betSide = r.randRange(0, 2).toString()
  //   console.log(`bet ${betSize} ${betSide} ${bettor}`)
  //   betTx = await bet(betSize, betSide, bettor, provider, contract)
  // }
})

it("vrf_verify", async () => {
  const {provider, contract} = await get_provider(true)

  const data = require('./vrfData.json')//.slice(0, 1)
  const dataInvalid = require('./vrfDataInvalid.json')//.slice(0, 1)
  const testCases = data.concat(dataInvalid)

  for (const testCase of testCases) {
    // console.log(testCase)
    let {pk, proof, msg, result} = testCase

    const gotResult = await estimate_output(contract, "verifyVrfProof", [
      { index: 0, format: ContractArgumentFormat.Hex,  value: pk },
      { index: 1, format: ContractArgumentFormat.Hex, value: proof },
      { index: 2, format: ContractArgumentFormat.Hex, value: msg }
    ], provider, null, false)

    if (result == true)
      expect(gotResult).toBe(TRUE_BOOL)
    else
      expect(gotResult).not.toBe(TRUE_BOOL)
  }
})

// it("can cancel", async () => {
//   const {provider} = await get_provider(false)
//   let {contract} = await deploy_with(provider, "1200")

//   setBlockDelayTx = await provider.Contract.call(contract,
//     "setBlockDelay", "0", "50000",
//     [ { index: 0, format: ContractArgumentFormat.Int64, value: "3" } ]
//   )
//   await provider.Chain.generateBlocks(1)
//   expectAndLog(await provider.Chain.receipt(setBlockDelayTx), true)

//   bet1Tx = await bet("100", "12", "1", ONE_ADDRESS, provider, contract)
//   await provider.Chain.generateBlocks(10)

//   await provider.Chain.resetTo(8)
//   await estimate_output(contract, "cancelBet", [ { index: 0, format: ContractArgumentFormat.Int64, value: "1" } ], provider, true, true, ONE_ADDRESS)
//   await provider.Chain.generateBlocks(1)
//   await estimate_output(contract, "cancelBet", [ { index: 0, format: ContractArgumentFormat.Int64, value: "1" } ], provider, false, true, ONE_ADDRESS)

//   setBlockDelayTx = await provider.Contract.call(contract,
//     "setBlockDelay", "0", "50000",
//     [ { index: 0, format: ContractArgumentFormat.Int64, value: "0" } ]
//   )
//   await provider.Chain.generateBlocks(1)
//   expectAndLog(await provider.Chain.receipt(setBlockDelayTx), true)

//   // should not be possible to bet and cancel in the same block
//   bet2Tx = await bet("100", "0", "1", ONE_ADDRESS, provider, contract)
//   cancel2Tx = await call_from(ONE_ADDRESS, provider, contract, "cancelBet", "0", "50000", [ { index: 0, format: ContractArgumentFormat.Int64, value: "2" } ])
//   await provider.Chain.generateBlocks(1)

//   bet2Receipt = await provider.Chain.receipt(bet2Tx)
//   expectAndLog(bet2Receipt, true)
//   cancel2Receipt = await provider.Chain.receipt(cancel2Tx)
//   console.log(cancel2Receipt)
//   expect(cancel2Receipt.success).toBe(false)
// })
