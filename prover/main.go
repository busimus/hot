// This is a hastily written VRF proof publisher for the coin flip contract.
// It sends the proof TX for the last mined block if it had any bets, which
// dedcides the winning bets and pays out the rewards.

package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

func getEnv() (privkey []byte, pubkey []byte, idena *idenaProvider) {
	contract := os.Getenv("PROVER_CONTRACT")  // contract address
	privkeyStr := os.Getenv("PROVER_PRIVKEY") // key used to generate proofs
	rpcUrl := os.Getenv("PROVER_RPC_URL")     // url of the node
	rpcKey := os.Getenv("PROVER_RPC_KEY")     // node key
	address := os.Getenv("PROVER_ADDRESS")    // address that will send transactions

	if contract == "" || privkeyStr == "" || rpcUrl == "" || rpcKey == "" || address == "" {
		fmt.Println("Environment not set")
		os.Exit(1)
	}

	privkey, err := hex.DecodeString(privkeyStr)
	pubkey = privkey[32:]
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	idena = NewIdenaProvider(rpcUrl, rpcKey, address, contract)
	return
}

func run() {
	privkey, pubkey, idena := getEnv()

	proofWindow, err := idena.GetSubmissionWindow()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	startBlock, err := idena.GetLatestBlockHeight()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	lastProvedBlock := startBlock - proofWindow - 1
	if lastProvedBlock < 0 {
		lastProvedBlock = 0
	}

	for {
		provingBlock := lastProvedBlock + 1
		// fmt.Printf("Trying to prove: %d\n", provingBlock)
		seed, err := idena.GetProvableSeed(provingBlock)
		// if block wasn't mined
		if err != nil {
			// fmt.Printf("Error getting seed: %s\n", err)
			time.Sleep(2 * time.Second)
			continue
		}
		lastProvedBlock++
		// if block was mined and contract returned a seed (so it has bets)
		if seed != nil {
			fmt.Printf("Proving block %d\n", provingBlock)
			fmt.Printf("Seed:  %x\n", seed)
			proof, hash, err := Prove(pubkey, privkey, seed)
			fmt.Printf("Proof: %x\n", proof)
			fmt.Printf("Hash:  %x\n", hash)
			if err != nil {
				fmt.Printf("Couldn't prove block %d: %s\n", provingBlock, err)
				continue
			}
			txHash, err := idena.SubmitProof(provingBlock, proof)
			if err != nil {
				fmt.Printf("Couldn't submit proof for block %d: %s\n", provingBlock, err)
				continue
			}
			fmt.Printf("Submitted proof for block %d: %s\n", provingBlock, txHash)
		}
		// don't sleep if the prover is catching up
		if lastProvedBlock > startBlock {
			time.Sleep(3 * time.Second)
		}
	}
}

func simulate() {
	privkey, pubkey, idena := getEnv()

	startBlock, err := idena.GetLatestBlockHeight()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	// open file for writing
	f, err := os.Create("/tmp/simulation.txt")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	coin0, coin1 := 0, 0
	// decrement startBlock until zero
	for startBlock > 0 {
		seed, err := idena.GetBlockSeed(startBlock)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		proof, hash, err := Prove(pubkey, privkey, seed)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		coinSide := hash[0] % 2
		if coinSide == 0 {
			coin0++
		} else {
			coin1++
		}
		percentage := float64(coin0) / float64(coin0+coin1) * 100
		fmt.Printf("Block %d: %d %d (%f%%)\r", startBlock, coin0, coin1, percentage)
		fmt.Fprintf(f, "%d 0x%x %x = %d\n", startBlock, seed, proof, coinSide)

		if startBlock%1000 == 0 {
			f.Sync()
		}
		startBlock--
	}
}

func main() {
	// Parse command line arguments
	var (
		msgFlag        = flag.String("msg", "", "Prove or verify this text string (or binary data if prefixed with 0x)")
		proofFlag      = flag.String("proof", "", "Verify this proof for given message")
		publicKeyFlag  = flag.String("pubkey", "", "Public key for verification")
		privateKeyFlag = flag.String("privkey", "", "Private key for proving or verification")
	)

	flag.Parse()

	cmd := flag.Args()[0]

	msg := []byte(*msgFlag)
	var err error
	if strings.HasPrefix(*msgFlag, "0x") {
		msg, err = hex.DecodeString(strings.TrimPrefix(*msgFlag, "0x"))
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
	}

	proof, _ := hex.DecodeString(*proofFlag)

	var pubkey []byte
	var privkey []byte
	if *privateKeyFlag != "" {
		privkey, err = hex.DecodeString(*privateKeyFlag)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		pubkey = privkey[32:]
	}
	if *publicKeyFlag != "" {
		pubkey, _ = hex.DecodeString(*publicKeyFlag)
	}

	// fmt.Printf("pub:  %x\n", pubkey)
	// fmt.Printf("priv: %x\n", privkey)
	// fmt.Printf("msg:  %x\n", msg)
	// fmt.Printf("prof: %x\n", proof)
	switch cmd {
	case "run":
		run()
	case "simulate":
		simulate()
	case "gen":
		pubkey, privkey, err := ed25519.GenerateKey(nil)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		fmt.Printf("Public key: %x\n", pubkey)
		fmt.Printf("Private key: %x\n", privkey)
	case "prove":
		pi, hash, err := Prove(pubkey, privkey, msg)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		fmt.Printf("Proof: %x\n", pi)
		fmt.Printf("Hash: %x\n", hash)
	case "verify":
		result, err := Verify(pubkey, proof, msg)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}

		hash := Hash(proof)
		fmt.Printf("%t", result)
		if result {
			fmt.Printf(" (outcome: %d)", hash[0]%2)
		}
		fmt.Println("")
	default:
		fmt.Println("Specify a command: run, gen, prove, verify, or simulate")
	}
}
