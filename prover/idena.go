package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
)

type rpcRequest struct {
	ID      int           `json:"id"`
	JsonRPC string        `json:"jsonrpc"`
	Method  string        `json:"method"`
	Key     string        `json:"key"`
	Params  []interface{} `json:"params"`
}

type contractCall struct {
	From     string        `json:"from,omitempty"`
	Contract string        `json:"contract"`
	Method   string        `json:"method"`
	Args     []contractArg `json:"args,omitempty"`
	MaxFee   int           `json:"maxFee,omitempty"`
}

type contractArg struct {
	Index  int    `json:"index"`
	Format string `json:"format"`
	Value  string `json:"value"`
}

type rpcResp struct {
	ID      int                    `json:"id"`
	JsonRPC string                 `json:"jsonrpc"`
	Result  map[string]interface{} `json:"result"`
	Err     rpcError               `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type callResp struct {
	ID      int      `json:"id"`
	JsonRPC string   `json:"jsonrpc"`
	TxHash  string   `json:"result"`
	Err     rpcError `json:"error"`
}

type estimateResp struct {
	ID      int    `json:"id"`
	JsonRPC string `json:"jsonrpc"`
	Result  struct {
		Success      bool   `json:"success"`
		Error        string `json:"error"`
		ActionResult struct {
			OutputData string `json:"outputData"`
		} `json:"actionResult"`
	} `json:"result"`
	Err rpcError `json:"error"`
}

type idenaProvider struct {
	// url of the node
	rpcUrl string
	// node key
	rpcKey string
	// address that will send transactions
	address string
	// key used to sign raw transactions
	// key []byte
	// contract address
	contract string

	httpClient *http.Client
}

func NewIdenaProvider(rpcUrl string, rpcKey string, address string, contract string) *idenaProvider {
	tr := &http.Transport{
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     0,
		DisableCompression:  true,
	}
	client := &http.Client{Transport: tr}
	return &idenaProvider{
		rpcUrl:  rpcUrl,
		rpcKey:  rpcKey,
		address: address,
		// key:        key,
		contract:   contract,
		httpClient: client,
	}
}

func (p *idenaProvider) EstimateCall(contract string, method string, args []contractArg, from string) (output []byte, err error) {
	call := contractCall{
		Contract: p.contract,
		Method:   method,
		Args:     args,
		From:     from,
	}

	rawResp, err := p.rpcCall("contract_estimateCall", []interface{}{call})
	if err != nil {
		return nil, err
	}
	resp := estimateResp{}
	err = json.Unmarshal(rawResp, &resp)
	if err != nil {
		return nil, err
	}
	if resp.Err.Code != 0 {
		return nil, fmt.Errorf("rpc err: %s", resp.Err.Message)
	}
	if !resp.Result.Success {
		return nil, fmt.Errorf("call failed: %s", resp.Result.Error)
	}
	if len(resp.Result.ActionResult.OutputData) == 2 {
		return nil, nil
	}
	output, err = hex.DecodeString(strings.TrimPrefix(resp.Result.ActionResult.OutputData, "0x"))
	return
}

func (p *idenaProvider) Call(contract string, method string, args []contractArg, from string, maxFee int) (txHash string, err error) {
	call := contractCall{
		Contract: p.contract,
		Method:   method,
		Args:     args,
		From:     from,
		MaxFee:   maxFee,
	}

	rawResp, err := p.rpcCall("contract_call", []interface{}{call})
	if err != nil {
		return "", err
	}
	resp := callResp{}
	err = json.Unmarshal(rawResp, &resp)
	txHash = resp.TxHash
	if err != nil {
		return "", err
	}
	if resp.Err.Code != 0 {
		return "", fmt.Errorf("rpc err: %s", resp.Err.Message)
	}
	return
}

func (p *idenaProvider) rpcCall(method string, params []interface{}) (resp []byte, err error) {
	req := rpcRequest{
		ID:      1,
		JsonRPC: "2.0",
		Key:     p.rpcKey,
		Method:  method,
		Params:  params,
	}

	payload, err := json.Marshal(req)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	rawResp, err := p.httpClient.Post(p.rpcUrl, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return
	}

	// read response body
	resp, err = io.ReadAll(rawResp.Body)
	return
}

func (p *idenaProvider) GetProvableSeed(blockHeight int) (seed []byte, err error) {
	args := []contractArg{
		{
			Index:  0,
			Format: "int64",
			Value:  strconv.Itoa(blockHeight),
		}}
	seed, err = p.EstimateCall(p.contract, "needProof", args, p.address)
	if err != nil {
		return nil, err
	}
	return
}

func (p *idenaProvider) GetSubmissionWindow() (window int, err error) {
	windowBytes, err := p.EstimateCall(p.contract, "proofSubmissionWindow", []contractArg{}, p.address)
	if err != nil {
		return 0, err
	}
	window = int(binary.LittleEndian.Uint32(windowBytes))
	return
}

func (p *idenaProvider) GetLatestBlockHeight() (blockHeight int, err error) {
	respBytes, err := p.rpcCall("bcn_syncing", nil)
	if err != nil {
		return
	}
	resp := rpcResp{}
	err = json.Unmarshal(respBytes, &resp)
	if err != nil {
		return
	}
	return int(resp.Result["highestBlock"].(float64)), nil
}

func (p *idenaProvider) GetBlockSeed(blockHeight int) (seed []byte, err error) {
	respBytes, err := p.rpcCall("bcn_blockAt", []interface{}{blockHeight})
	if err != nil {
		return
	}
	resp := rpcResp{}
	err = json.Unmarshal(respBytes, &resp)
	if err != nil {
		return
	}
	return hex.DecodeString(strings.TrimPrefix(resp.Result["seed"].(string), "0x"))
}

func (p *idenaProvider) SubmitProof(blockHeight int, proof []byte) (txHash string, err error) {
	args := []contractArg{
		{
			Index:  0,
			Format: "int64",
			Value:  strconv.Itoa(blockHeight),
		},
		{
			Index:  1,
			Format: "hex",
			Value:  "0x" + hex.EncodeToString(proof),
		},
	}
	_, err = p.EstimateCall(p.contract, "flipCoin", args, p.address)
	if err != nil {
		return "", err
	}

	return p.Call(p.contract, "flipCoin", args, p.address, 10000)
}
