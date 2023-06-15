#!/bin/sh

# Address of the deployed hot contract
export PROVER_CONTRACT="0xc904bfef5c06e4804e2c37a2db0d8b9289898a79"
# Private key used to sign proofs (this one specifically is for testing only, change for prod)
export PROVER_PRIVKEY="cb4bfbe4ba64c3cb0299d6a88ccffd4bc3ff47b912fbf2e8c0e0d406d3f3f089cd44e3b99b008a2140a81908dbe9577a50963d1080662d5d17c1c80cfe69187b"
# URL of the node used to send transactions
export PROVER_RPC_URL="http://127.0.0.1:9009"
# RPC key of the node
export PROVER_RPC_KEY="123"
# Address from which proof transactions will be sent (the node must hold its key)
export PROVER_ADDRESS="0xaaf6c12cec7488617e15d6910fb0c05579736971"
