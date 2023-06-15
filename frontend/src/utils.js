import BN from "bn.js";
import { Buffer } from "buffer";

export function toBytes(data) {
  try {
    switch (data.format) {
      case "byte": {
        const val = parseInt(data.value, 10);
        if (val >= 0 && val <= 255) {
          return [val];
        }
        throw new Error("invalid byte value");
      }
      case "int8": {
        const val = parseInt(data.value, 10);
        if (val >= 0 && val <= 255) {
          return [val];
        }
        throw new Error("invalid int8 value");
      }
      case "uint64": {
        const res = new BN(data.value);
        if (res.isNeg()) throw new Error("invalid uint64 value");
        const arr = res.toArray("le");
        return [...arr, ...new Array(8).fill(0)].slice(0, 8);
      }
      case "int64": {
        const arr = new BN(data.value).toArray("le");
        return [...arr, ...new Array(8).fill(0)].slice(0, 8);
      }
      case "string": {
        return [...Buffer.from(data.value, "utf8")];
      }
      case "bigint": {
        return new BN(data.value).toArray();
      }
      case "hex": {
        return [...hexToUint8Array(data.value)];
      }
      default: {
        return [...hexToUint8Array(data.value)];
      }
    }
  } catch (e) {
    throw new Error(
      `cannot parse ${data.format} at index ${data.index}: ${e.message}`
    );
  }
}

export function argsToSlice(args) {
  const maxIndex = Math.max(...args.map((x) => x.index));

  const result = new Array(maxIndex).fill(null);

  args.forEach((element) => {
    result[element.index] = toBytes(element);
  });

  return result;
}

export function hexToUint8Array(hexString) {
  const str = stripHexPrefix(hexString);

  const arrayBuffer = new Uint8Array(str.length / 2);

  for (let i = 0; i < str.length; i += 2) {
    const byteValue = parseInt(str.substr(i, 2), 16);
    if (isNaN(byteValue)) {
      throw new Error("Invalid hexString");
    }
    arrayBuffer[i / 2] = byteValue;
  }

  return arrayBuffer;
}

export function toBuffer(v) {
  if (v === null || v === undefined) {
    return Buffer.allocUnsafe(0);
  }

  if (Buffer.isBuffer(v)) {
    return Buffer.from(v);
  }

  if (Array.isArray(v) || v instanceof Uint8Array) {
    return Buffer.from(v);
  }

  if (typeof v === "string") {
    if (!isHexString(v)) {
      throw new Error(
        `Cannot convert string to buffer. toBuffer only supports 0x-prefixed hex strings and this string was given: ${v}`
      );
    }
    return Buffer.from(padToEven(stripHexPrefix(v)), "hex");
  }

  if (BN.isBN(v)) {
    return v.toArrayLike(Buffer);
  }
}

function padToEven(value) {
  if (typeof value !== "string") {
    throw new Error(
      `[padToEven] value must be string, is currently ${typeof value}, while padToEven.`
    );
  }

  if (value.length % 2) {
    return `0${value}`;
  }

  return value;
}

export function isHexPrefixed(str) {
  if (typeof str !== "string") {
    throw new Error(
      `[isHexPrefixed] input must be type 'string', received type ${typeof str}`
    );
  }

  return str[0] === "0" && str[1] === "x";
}

function stripHexPrefix(str) {
  if (typeof str !== "string")
    throw new Error(
      `[stripHexPrefix] input must be type 'string', received ${typeof str}`
    );

  return isHexPrefixed(str) ? str.slice(2) : str;
}

export function bufferToHex(buf) {
  buf = toBuffer(buf);
  return "0x" + buf.toString("hex");
}

export function isHexString(value, length = null) {
  if (typeof value !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/))
    return false;

  if (length && value.length !== 2 + 2 * length) return false;

  return true;
}

export function isValidAddress(hexAddress) {
  if (!isHexString(hexAddress)) {
    const msg = `This method only supports 0x-prefixed hex strings but string was: ${hexAddress}`;
    throw new Error(msg);
  }
  return /^0x[0-9a-fA-F]{40}$/.test(hexAddress);
}

export class Address {
  constructor(buf) {
    if (buf.length !== 20) throw "Invalid address length";
    this.buf = buf;
  }

  static fromString(str) {
    if (!isValidAddress(str)) throw "Invalid address";
    return new Address(toBuffer(str));
  }

  equals(address) {
    return this.buf.equals(address.buf);
  }

  isZero() {
    return this.equals(Address.zero());
  }

  toString() {
    return "0x" + this.buf.toString("hex");
  }

  toBuffer() {
    return Buffer.from(this.buf);
  }
}

export function betProfit(betSize, contractState) {
  let size = Number.parseInt(betSize);
  if (isNaN(size) || size < 0) {
    size = 0;
  }
  const fee = Number.parseFloat(
    (size * (contractState.feeBps / 10000)).toFixed(2)
  );
  const burn = Number.parseFloat(
    (size * (contractState.burnBps / 10000)).toFixed(2)
  );
  const profit = Number.parseFloat((size - fee - burn).toFixed(2));
  const payout = Number.parseFloat((size + profit).toFixed(2));
  const feePercent = contractState.feeBps / 100;
  const burnPercent = contractState.burnBps / 100;
  return { profit, fee, burn, payout, feePercent, burnPercent };
}
