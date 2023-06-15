# Onchain Heads or Tails game for Idena

This is a coin flip smart contract for Idena. It lets anyone bet on one of two equally likely outcomes against the contract itself. It uses a Verifiable Random Function to source randomness in a way which maximizes security for all parties and minimizes the time before the outcome can be decided.

**For educational purposes only. If you're going to deploy this project (I won't) or use it (I won't!), see LICENSE file for warranty information.**

## Features
* Bets are decided with verifiable randomness that's seeded from the chain and verified by the contract
* Outcome is known as early as the next block
* Automatic payouts when the bet outcome is decided (if the contract has enough balance)
* Adjustable percentages for deducting the fee and coin burn from winning bets
* Contract owner provides liquidty and takes the other side of all bets

## Screenshot
<img src="/screenshots/hot.png?raw=true" height="200">

## Design for randomness

**TL;DR**: Using the block seed alone is highly insecure. The chosen source of randomness is Keccak-256 hash of a VRF proof created from a block seed and published by the contract owner and verified by the contract. If the proof doesn't get published then the users will be able to withdraw their deposits after a short time. This design is an embedded version of the [randomness beacon on Algorand](https://developer.algorand.org/articles/usage-and-best-practices-for-randomness-beacon/).

<details>
  <summary>Design reasoning</summary>

Idena already has a verifiable source of randomness in every block - the block seed. It comes from VRF and can't be influenced by the block proposer. However, a sophisticated proposer _can_ predict its value for many blocks ahead.

The block seed depends only on the previous block's seed, and a proposer can propose many blocks in a row (real example from a few months ago: 11 blocks starting at 5471735). **These two factors together mean that a large mining pool can predict the seed of a block in the future with high probability**. They won't have complete certainty because another proposer might have a higher VRF score for some block in the sequence, but if they see that they have a very high score for many blocks ahead then an attack on the contract might be worthwhile.

The only way to make the block seed alone a secure source of randomness is to force users to commit to its value many blocks ahead, forcing them to wait for at least 5-10 minutes. This won't solve the problem completely, but it would make exploitation considerably less likely in a simple but very annoying way.

In order to solve this problem without sacrificing security, trustlessness, or user experience of the contract, another layer of VRF was added. **The source of randomness for the contract will be the VRF proof created from the block seed using contract owner's private key.**. The owner can't predict the block seed and can't alter a proof that will be created from it, the proposer can't predict owner's proof, the contract verifies the proof using an immutable public key - everything is verifiable and no party can predict or influence the outcome.

</details>

<details>
  <summary>Issues and possible attacks</summary>

This design has a centralization issue: users of the contract would be trusting the contract owner to publish the proof. This was addressed by adding a proof submission window after which, if the proof hasn't been submitted yet, the user can withdraw their deposit at no loss to them. This is still not ideal, but I believe this represents a reasonable compromise - **it improves the user experience without sacrificing too much trustlessness and also provides security guarantees for the owner which encourages them to participate.**

The owner could also collude with the block proposer to know the block seed in advance, but the design of the contract is such that this doesn't give the owner any advantage. This is also why it's not necessary to have a large commitment delay like for a general randmoness beacon - the oracle runner can't exploit you if you're the oracle runner, the beauty of centralization!

The only potential attack that this design is vulnerable to is proof submission supression. If the attacker can predict that they'll be a proposer throughout the proof submission window, then they could take advantage of that by publishing blocks without including the proof transaction if they don't like its outcome. The solution to this is simple - a large enough proof submission window.
</details>

## Outcome fairness
**TL;DR**: The outcome of the bet is decided by the parity of the first byte of the Keccak-256 hash of the proof. There's ~50% chance it will be even or odd. There are a couple ways you can verfiy this:

<details>
  <summary>Seed and proof dump</summary>

[In the project's releases there is the output](https://github.com/busimus/hot/releases/tag/v1.0.0) of the `simulate` command of the `prover` tool from hundreds of thousands of recent blocks. The file has block numbers, seeds of those blocks, proofs created from them, and the actual outcome of the bet taken from the first byte of the hash of the proof (`= 0` or `= 1` depending on whether the 4th digit of the proof string is even or odd).

You can use `grep` to count the number of times a specific outcome occured like this: `grep '= 0' simulation.txt | wc -l` and the same with `= 1`. Both numbers should be roughly equal.

You can also verify any of the proofs in that file yourself using the `verify` command of the `prover`. Take the seed from the second column, the proof from the third column, and the pubkey from the `VRF_PUBKEY` constant in `contract/assembly/index.ts` and run the command as follows:

```sh
go run . -msg {SEED} -proof {PROOF} -pubkey {VRF_PUBKEY} verify
```

It should output `true (outcome: {0 or 1})`
</details>

<details>
  <summary>Simulation</summary>

If you modify the node to return the seed of the block in response to `bcn_blockAt` call, you'll be able to point the `prover` at it and use its `simulate` command to create a file similar to the uploaded one. It will also show the stats for the simulation while it's happening.
</details>

## Building and running

1. Generate a keypair using `prover`: `go run . gen`
2. Set the `VRF_PUBKEY` constant in `contract/assembly/index.ts` to the generated public key.
3. Build and deploy `contract`: `yarn asb`
4. Build and deploy `frontend`: `yarn build`
5. Deposit liquidity to the contract with `deposit` method
6. Fill out the `prover/env.sh` file and `source` it
7. Run `prover`: `go run . run`

### Testing
Currently tests require a modified contract runner that supports sending transactions from different addresses. I'll try to upstream these changes because I believe they're essential for testing.


## Attributions
* [Vue](https://github.com/vuejs/vue/) - MIT License, Copyright (c) 2013-present, Yuxi (Evan) You
* [Bootstrap](https://github.com/twbs/bootstrap) - MIT License, Copyright (c) 2011-2023 The Bootstrap Authors
* [Bootstrap-vue](https://github.com/bootstrap-vue/bootstrap-vue) - MIT License, Copyright (c) 2016-2023 - BootstrapVue
* [Ethereumjs-util](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/util) - MPL-2.0 License
* [vrf.go](https://github.com/yoseplee/vrf) - Apache License 2.0, Copyright (c) 2017 Yahoo Inc, Modifications Copyright 2020 Yosep Lee
* [GBP Coin](https://codepen.io/jasonhibbs/pen/DePMBb) - Jason Hibbs

### Copyright and license
This program is released under the MIT License (see LICENSE file).

Copyright © 2023 bus.
