// This is an almost exact translation of github.com/yoseplee/vrf and edwards25519
// from Go's stdlib.
// Because SHA256 isn't available, Kecak256 is used instead (test suite of the
// original library passes with this change).

// This thing eats gas like crazy (26M for verification), but since it's not
// my code I have no idea how to optimize it.

import { Bytes, Host } from "idena-sdk-as";
import { bi, base } from "./vrf_const"

const limit    = 100
const N2       = 32
const N        = N2 / 2
const cofactor = 8
const NOSIGN   = 3

const d = [-10913610, 13857413, -15372611, 6949391, 114729, -8787816, -6275908, -3247719, -18696448, -12055116]
const d2 = [-21827239, -5839606, -30745221, 13898782, 229458, 15978800, -12551817, -6495438, 29715968, 9444199]
const SqrtM1 = [-32595792, -7943725, 9377950, 3500415, 12389472, -272473, -25146209, -2005654, 326686, 11406482]

type FieldElement = Array<i32>

function getBi(i: u32): PreComputedGroupElement {
    i = i * 3 * 10
    const bi0 = bi.slice(i + 0 * 10, i + 0 * 10 + 10)
    const bi1 = bi.slice(i + 1 * 10, i + 1 * 10 + 10)
    const bi2 = bi.slice(i + 2 * 10, i + 2 * 10 + 10)
	return new PreComputedGroupElement(bi0, bi1, bi2)
}

function getBase(pos: u32, i: u32): PreComputedGroupElement {
    i = pos * 8 + i * 3 * 10
    const base0 = base.slice(i + 0 * 10, i + 0 * 10 + 10)
    const base1 = base.slice(i + 1 * 10, i + 1 * 10 + 10)
    const base2 = base.slice(i + 2 * 10, i + 2 * 10 + 10)
	return new PreComputedGroupElement(base0, base1, base2)
}

export function vrf_verify(
    publicKey: Bytes,
    proof: Bytes,
    message: Bytes
): bool {
    const decoded = decodeProof(proof)
    if (decoded == null) {
        return false
    }
    const r = decoded.r
    const c = decoded.c
    const s = decoded.s

    let u = new ProjectiveGroupElement()
    const P = os2ECP(publicKey, publicKey[31] >> 7)
    if (P == null) {
        return false
    }

    GeDoubleScalarMultVartime(u, c, P, s)

    const h = hashToCurve(message, publicKey)
    if (h == null) {
        return false
    }
    const m1 = geScalarMult(r, c)
    const m2 = geScalarMult(h, s)

    const v = geAdd_v(m1, m2)
    const g = ge()
    const c2 = hashPoints(ecp2OS(g), ecp2OS(h), s2OS(publicKey), ecp2OS(r), ecp2OSProj(u), ecp2OS(v))

    const c2B = joinBytes([new Bytes(32 - c2.length), c2])

    return c2B.toString() == f2IP(c).toString() // TODO: why does it not work without string?
}


export function vrf_hash(proof: Bytes): Bytes {
    return Bytes.fromBytes(proof.slice(1, N2+1))
}

function joinBytes(arr: Array<Bytes>): Bytes {
    let len = arr.reduce((acc, cur) => acc + cur.length, 0)
    let bs = new Uint8Array(len);
    let curStart = 0
    for (let i = 0; i < arr.length; i++) {
        let part = arr[i]
        memory.copy(bs.dataStart + curStart, part.dataStart, part.length);
        curStart += part.length
    }
    return Bytes.fromBytes(bs)
}

function s2OS(s: Bytes): Bytes {
    const sign = s[31] >> 7
    return joinBytes([Bytes.fromU8(sign + 2), s])
}

function f2IP(f: Bytes): Bytes {
    const t = new Bytes(32)
    for (let i = 0; i < 32; i++) {
        t[32 - i - 1] = f[i]
    }
    return t
}

function ecp2OS(P: ExtendedGroupElement): Bytes {
    const s = new Bytes(32)
    P.toBytes(s)
    return s2OS(s)
}

function ecp2OSProj(P: ProjectiveGroupElement): Bytes {
    const s = new Bytes(32)
    P.toBytes(s)
    return s2OS(s)
}

class DecodedProof {
    r: ExtendedGroupElement
    c: Bytes
    s: Bytes

    constructor(r: ExtendedGroupElement, c: Bytes, s: Bytes) {
        this.r = r
        this.c = c
        this.s = s
    }
}

function decodeProof(proof: Bytes): DecodedProof | null {
    let i = 0
    const sign = proof[0]
    i++
    if (sign != 2 && sign != 3) {
        return null
    }

    const r = os2ECP(Bytes.fromBytes(proof.slice(i, i+N2)), sign - 2)
    if (r == null) {
        return null
    }
    i += N2

    const c = new Bytes(N2)
    for (let j = N - 1; j >= 0; j--) {
        c[j] = proof[i]
        i++
    }
    const s = new Bytes(N2)
    for (let j = N2 - 1; j >= 0; j--) {
        s[j] = proof[i]
        i++
    }
    return new DecodedProof(r, c, s)
}

function os2ECP(os: Bytes, sign: u8): ExtendedGroupElement | null {
    const P = new ExtendedGroupElement()

    if (sign == 0 || sign == 1) {
        os[31] = (sign << 7) | (os[31] & 0x7f)
    }
    if (!P.fromBytes(os)) {
        return null
    }

    return P
}

function hashToCurve(m: Bytes, pk: Bytes): ExtendedGroupElement | null {
    for (let i = 0; i < limit; i++) {
        // let buf = new Bytes(0)
        let ctr_buf = new Uint8Array(4); // for endianness
        let ctr_view = new DataView(ctr_buf.buffer);
        ctr_view.setUint32(0, i, false);
        const ctr = changetype<Bytes>(ctr_buf)
        const buf = joinBytes([m, pk, ctr])
        const h = Host.keccac256(buf)

        let P = os2ECP(h, NOSIGN as u8)
        if (P != null) {
            for (let j = 1; j < cofactor; j *= 2) {
                P = geDouble(P)
            }
            return P
        }
    }
    return null
}

function hashPoints(ps1: Bytes, ps2: Bytes, ps3: Bytes, ps4: Bytes, ps5: Bytes, ps6: Bytes): Bytes {
    let buf = joinBytes([ps1, ps2, ps3, ps4, ps5, ps6])

    return Bytes.fromBytes(Host.keccac256(buf).slice(0, N))
}

function toCached(r: CachedGroupElement, p: ExtendedGroupElement): void {
    FeAdd(r.yPlusX, p.Y, p.X)
    FeSub(r.yMinusX, p.Y, p.X)
    FeCopy(r.Z, p.Z)
    FeMul(r.T2d, p.T, d2)
}

function geAdd_v(p: ExtendedGroupElement, qe: ExtendedGroupElement): ExtendedGroupElement {
    const q = new CachedGroupElement()
    const r = new CompletedGroupElement()
    const t0 = new Array<i32>(10)

    toCached(q, qe)

    FeAdd(r.X, p.Y, p.X)
	FeSub(r.Y, p.Y, p.X)
	FeMul(r.Z, r.X, q.yPlusX)
	FeMul(r.Y, r.Y, q.yMinusX)
	FeMul(r.T, q.T2d, p.T)
	FeMul(r.X, p.Z, q.Z)
	FeAdd(t0, r.X, r.X)
	FeSub(r.X, r.Z, r.Y)
	FeAdd(r.Y, r.Z, r.Y)
	FeAdd(r.Z, t0, r.T)
	FeSub(r.T, t0, r.T)

    const re = new ExtendedGroupElement()
    r.toExtended(re)
    return re
}

function geDouble(p: ExtendedGroupElement): ExtendedGroupElement {
    const q = new ProjectiveGroupElement()
    p.toProjective(q)
    // debug(`geDouble q ${q.X} ${q.Y} ${q.Z}`)
    const rc = new CompletedGroupElement()
    q.Double(rc)
    // debug(`geDouble rc ${rc.X} ${rc.Y} ${rc.Z}`)
    const r = new ExtendedGroupElement()
    rc.toExtended(r)
    // debug(`geDouble r ${r.X} ${r.Y} ${r.Z} ${r.T}`)
    return r
}

function extendedGroupElementCMove(t: ExtendedGroupElement, u: ExtendedGroupElement, b: i32): void {
    FeCMove(t.X, u.X, b)
    FeCMove(t.Y, u.Y, b)
    FeCMove(t.Z, u.Z, b)
    FeCMove(t.T, u.T, b)
}

function geScalarMult(h: ExtendedGroupElement, a: Bytes): ExtendedGroupElement {
    const q = new ExtendedGroupElement()
    q.Zero()
    let p = h
    for (let i = 0; i < 256; i++) {
        const bit = (a[i >> 3] >> ((i & 7) as u8)) & 1
        const t = geAdd_v(q, p)
        extendedGroupElementCMove(q, t, bit)
        p = geDouble(p)
    }
    return q
}

function GeDoubleScalarMultVartime(
    r: ProjectiveGroupElement,
    a: Bytes,
    A: ExtendedGroupElement,
    b: Bytes
): void {

    const aSlide = new Array<i32>(256)
    const bSlide = new Array<i32>(256)
    const Ai = new Array<CachedGroupElement>(8)
    const t = new CompletedGroupElement()
    const u = new ExtendedGroupElement()
    const A2 = new ExtendedGroupElement()
    let i = 0

    slide(aSlide, a)
    slide(bSlide, b)

    Ai[0] = A.toCached()
    A.Double(t)
    t.toExtended(A2)

    for (i = 0; i < 7; i++) {
        geAdd(t, A2, Ai[i])
        t.toExtended(u)
        Ai[i+1] = u.toCached()
    }

    r.Zero()

    for (i = 255; i >= 0; i--) {
        if (aSlide[i] != 0 || bSlide[i] != 0) {
            break
        }
    }

    for (; i >= 0; i--) {
        r.Double(t)
        if (aSlide[i] > 0) {
            t.toExtended(u)
            geAdd(t, u, Ai[aSlide[i] / 2])
        } else if (aSlide[i] < 0) {
            t.toExtended(u)
            geSub(t, u, Ai[(-aSlide[i]) / 2])
        }

        if (bSlide[i] > 0) {
            t.toExtended(u)
            // const _bi = bi[bSlide[i] / 2]
            // const pc = new PreComputedGroupElement(_bi[0], _bi[1], _bi[2])
            const pc = getBi(bSlide[i] / 2)
            geMixedAdd(t, u, pc)
        } else if (bSlide[i] < 0) {
            t.toExtended(u)
            // const _bi = bi[(-bSlide[i]) / 2]
            // const pc = new PreComputedGroupElement(_bi[0], _bi[1], _bi[2])
            const pc = getBi((-bSlide[i]) / 2)
            geMixedSub(t, u, pc)
        }
        t.toProjective(r)
    }
}

function slide(r: Array<i32>, a: Bytes): void {
    for (let i = 0; i < 256; i++) {
        r[i] = 1 & (a[i >> 3] >> ((i & 7) as u8))
    }

    for (let i = 0; i < 256; i++) {
        if (r[i] != 0) {
            for (let b = 1; b <= 6 && i + b < 256; b++) {
                if (r[i + b] != 0) {
                    if (r[i] + (r[i + b] << b) <= 15) {
                        r[i] += r[i + b] << b
                        r[i + b] = 0
                    } else if (r[i] - (r[i + b] << b) >= -15) {
                        r[i] -= r[i + b] << b
                        for (let k = i + b; k < 256; k++) {
                            if (r[k] == 0) {
                                r[k] = 1
                                break
                            }
                            r[k] = 0
                        }
                    } else {
                        break
                    }
                }
            }
        }
    }
}

class ProjectiveGroupElement {
    X: FieldElement = new Array<i32>(10)
    Y: FieldElement = new Array<i32>(10)
    Z: FieldElement = new Array<i32>(10)

    toBytes(s: Bytes): void {
        const recip = new Array<i32>(10)
        const x = new Array<i32>(10)
        const y = new Array<i32>(10)

        FeInvert(recip, this.Z)
        FeMul(x, this.X, recip)
        FeMul(y, this.Y, recip)
        FeToBytes(s, y)
        s[31] ^= (FeIsNegative(x) << 7) as u8
    }

    Double(r: CompletedGroupElement): void {
        const t0 = new Array<i32>(10)
        FeSquare(r.X, this.X)
        FeSquare(r.Z, this.Y)
        FeSquare2(r.T, this.Z)
        FeAdd(r.Y, this.X, this.Y)
        FeSquare(t0, r.Y)
        FeAdd(r.Y, r.Z, r.X)
        FeSub(r.Z, r.Z, r.X)
        FeSub(r.X, t0, r.Y)
        FeSub(r.T, r.T, r.Z)
    }

    Zero(): void {
        FeZero(this.X)
        FeOne(this.Y)
        FeOne(this.Z)
    }
}

class CompletedGroupElement {
    X: FieldElement = new Array<i32>(10)
    Y: FieldElement = new Array<i32>(10)
    Z: FieldElement = new Array<i32>(10)
    T: FieldElement = new Array<i32>(10)

    toExtended(r: ExtendedGroupElement): void {
        FeMul(r.X, this.X, this.T)
        FeMul(r.Y, this.Y, this.Z)
        FeMul(r.Z, this.Z, this.T)
        FeMul(r.T, this.X, this.Y)
    }

    toProjective(r: ProjectiveGroupElement): void {
        FeMul(r.X, this.X, this.T)
        FeMul(r.Y, this.Y, this.Z)
        FeMul(r.Z, this.Z, this.T)
    }
}

class CachedGroupElement {
    yPlusX: FieldElement = new Array<i32>(10)
    yMinusX: FieldElement = new Array<i32>(10)
    Z: FieldElement = new Array<i32>(10)
    T2d: FieldElement = new Array<i32>(10)
}

export class PreComputedGroupElement {
    yPlusX: FieldElement = new Array<i32>(10)
    yMinusX: FieldElement = new Array<i32>(10)
    xy2d: FieldElement = new Array<i32>(10)

    constructor(yPlusX: FieldElement, yMinusX: FieldElement, xy2d: FieldElement) {
        this.yPlusX = yPlusX
        this.yMinusX = yMinusX
        this.xy2d = xy2d
    }

    Zero(): void {
        FeOne(this.yPlusX)
        FeOne(this.yMinusX)
        FeZero(this.xy2d)
    }
}

class ExtendedGroupElement {
    X: FieldElement = new Array<i32>(10)
    Y: FieldElement = new Array<i32>(10)
    Z: FieldElement = new Array<i32>(10)
    T: FieldElement = new Array<i32>(10)

    fromBytes(s: Bytes): bool {
        const u = new Array<i32>(10)
        const v = new Array<i32>(10)
        const v3 = new Array<i32>(10)
        const vxx = new Array<i32>(10)
        const check = new Array<i32>(10)

        FeFromBytes(this.Y, s)
        FeOne(this.Z)
        FeSquare(u, this.Y)
        FeMul(v, u, d)
        FeSub(u, u, this.Z) // u = y^2-1
        FeAdd(v, v, this.Z) // v = dy^2+1
        FeSquare(v3, v)
        FeMul(v3, v3, v) // v3 = v^3
        FeSquare(this.X, v3)
        FeMul(this.X, this.X, v)
        FeMul(this.X, this.X, u) // x = uv^7
        FePow22523(this.X, this.X) // x = (uv^7)^((q-5)/8)
        FeMul(this.X, this.X, v3)
        FeMul(this.X, this.X, u) // x = uv^3(uv^7)^((q-5)/8)

        const tmpX = new Bytes(32)

        FeSquare(vxx, this.X)
        FeMul(vxx, vxx, v)
        FeSub(check, vxx, u) // vx^2-u

        if (FeIsNonZero(check) == 1) {
            FeAdd(check, vxx, u) // vx^2+u
            if (FeIsNonZero(check) == 1) {
                return false
            }
            FeMul(this.X, this.X, SqrtM1)

            FeToBytes(tmpX, this.X)
            // for ...
        }

        // const isNeg = FeIsNegative(this.X)
        // const shift = s[31] >> 7
        if (FeIsNegative(this.X) != (s[31] >> 7)) {
            FeNeg(this.X, this.X)
        }

        FeMul(this.T, this.X, this.Y)
        return true
    }

    toCached(): CachedGroupElement {
        const r = new CachedGroupElement()
        FeAdd(r.yPlusX, this.Y, this.X)
        FeSub(r.yMinusX, this.Y, this.X)
        FeCopy(r.Z, this.Z)
        FeMul(r.T2d, this.T, d2)
        return r
    }

    toProjective(r: ProjectiveGroupElement): void {
        FeCopy(r.X, this.X)
        FeCopy(r.Y, this.Y)
        FeCopy(r.Z, this.Z)
    }

    toBytes(s: Bytes): void {
        const recip = new Array<i32>(10)
        const x = new Array<i32>(10)
        const y = new Array<i32>(10)

        FeInvert(recip, this.Z)
        FeMul(x, this.X, recip)
        FeMul(y, this.Y, recip)
        FeToBytes(s, y)

        s[31] ^= (FeIsNegative(x) << 7) as u8
    }

    Double(r: CompletedGroupElement): void {
        let q = new ProjectiveGroupElement()
        this.toProjective(q)
        q.Double(r)
    }

    Zero(): void {
        FeZero(this.X)
        FeOne(this.Y)
        FeOne(this.Z)
        FeZero(this.T)
    }

}

function load3(s: Bytes, i: i32): i64 {
    let r: i64 = s[i + 0]
    r |= i64(s[i + 1]) << 8
    r |= i64(s[i + 2]) << 16
    return r
}

function load4(s: Bytes, i: i32): i64 {
    let r: i64 = s[i + 0]
    r |= i64(s[i + 1]) << 8
    r |= i64(s[i + 2]) << 16
    r |= i64(s[i + 3]) << 24
    return r
}

function FeFromBytes(dst: FieldElement, s: Bytes): void {
    const h0 = load4(s, 0)
    const h1 = load3(s, 4) << 6
    const h2 = load3(s, 7) << 5
    const h3 = load3(s, 10) << 3
    const h4 = load3(s, 13) << 2
    const h5 = load4(s, 16)
    const h6 = load3(s, 20) << 7
    const h7 = load3(s, 23) << 5
    const h8 = load3(s, 26) << 4
    const h9 = (load3(s, 29) & 8388607) << 2
    // debug(`${h0} ${h1} ${h2} ${h3} ${h4} ${h5} ${h6} ${h7} ${h8} ${h9}`)

    FeCombine(dst, h0, h1, h2, h3, h4, h5, h6, h7, h8, h9)
}

function FeCopy(dst: FieldElement, src: FieldElement): void {
    for (let i = 0; i < 10; i++) {
        dst[i] = src[i]
    }
}

function FeCMove(f: FieldElement, g: FieldElement, b: i32): void {
    b = -b
    for (let i = 0; i < 10; i++) {
        f[i] ^= b & (f[i] ^ g[i])
    }
}

function FeZero(dst: FieldElement): void {
    for (let i = 0; i < 10; i++) {
        dst[i] = 0
    }
}

function FeOne(dst: FieldElement): void {
    FeZero(dst)
    dst[0] = 1
}

function FeSquare(h: FieldElement, f: FieldElement): void {
    const sq = feSquare(f)
    FeCombine(h, sq[0], sq[1], sq[2], sq[3], sq[4], sq[5], sq[6], sq[7], sq[8], sq[9])
}

function FeSquare2(h: FieldElement, f: FieldElement): void {
    const sq = feSquare(f)

    sq[0] += sq[0]
    sq[1] += sq[1]
    sq[2] += sq[2]
    sq[3] += sq[3]
    sq[4] += sq[4]
    sq[5] += sq[5]
    sq[6] += sq[6]
    sq[7] += sq[7]
    sq[8] += sq[8]
    sq[9] += sq[9]

    FeCombine(h, sq[0], sq[1], sq[2], sq[3], sq[4], sq[5], sq[6], sq[7], sq[8], sq[9])
}

function feSquare(f: FieldElement): Array<i64> {
    const f0 = i64(f[0])
    const f1 = i64(f[1])
    const f2 = i64(f[2])
    const f3 = i64(f[3])
    const f4 = i64(f[4])
    const f5 = i64(f[5])
    const f6 = i64(f[6])
    const f7 = i64(f[7])
    const f8 = i64(f[8])
    const f9 = i64(f[9])

    const f0_2 = i64(f0 * 2)
    const f1_2 = i64(f1 * 2)
    const f2_2 = i64(f2 * 2)
    const f3_2 = i64(f3 * 2)
    const f4_2 = i64(f4 * 2)
    const f5_2 = i64(f5 * 2)
    const f6_2 = i64(f6 * 2)
    const f7_2 = i64(f7 * 2)
    const f5_38 = f5 * 38
    const f6_19 = f6 * 19
    const f7_38 = f7 * 38
    const f8_19 = f8 * 19
    const f9_38 = f9 * 38

    const h0 = f0*f0 + f1_2*f9_38 + f2_2*f8_19 + f3_2*f7_38 + f4_2*f6_19 + f5*f5_38
    const h1 = f0_2*f1 + f2*f9_38 + f3_2*f8_19 + f4*f7_38 + f5_2*f6_19
    const h2 = f0_2*f2 + f1_2*f1 + f3_2*f9_38 + f4_2*f8_19 + f5_2*f7_38 + f6*f6_19
    const h3 = f0_2*f3 + f1_2*f2 + f4*f9_38 + f5_2*f8_19 + f6*f7_38
    const h4 = f0_2*f4 + f1_2*f3_2 + f2*f2 + f5_2*f9_38 + f6_2*f8_19 + f7*f7_38
    const h5 = f0_2*f5 + f1_2*f4 + f2_2*f3 + f6*f9_38 + f7_2*f8_19
    const h6 = f0_2*f6 + f1_2*f5_2 + f2_2*f4 + f3_2*f3 + f7_2*f9_38 + f8*f8_19
    const h7 = f0_2*f7 + f1_2*f6 + f2_2*f5 + f3_2*f4 + f8*f9_38
    const h8 = f0_2*f8 + f1_2*f7_2 + f2_2*f6 + f3_2*f5_2 + f4*f4 + f9*f9_38
    const h9 = f0_2*f9 + f1_2*f8 + f2_2*f7 + f3_2*f6 + f4_2*f5

    return [h0, h1, h2, h3, h4, h5, h6, h7, h8, h9]
}

function FeMul(h: FieldElement, f: FieldElement, g: FieldElement): void {
    const f0 = i64(f[0])
    const f1 = i64(f[1])
    const f2 = i64(f[2])
    const f3 = i64(f[3])
    const f4 = i64(f[4])
    const f5 = i64(f[5])
    const f6 = i64(f[6])
    const f7 = i64(f[7])
    const f8 = i64(f[8])
    const f9 = i64(f[9])

    const f1_2 = i64(f1 * 2)
    const f3_2 = i64(f3 * 2)
    const f5_2 = i64(f5 * 2)
    const f7_2 = i64(f7 * 2)
    const f9_2 = i64(f9 * 2)

    const g0 = i64(g[0])
    const g1 = i64(g[1])
    const g2 = i64(g[2])
    const g3 = i64(g[3])
    const g4 = i64(g[4])
    const g5 = i64(g[5])
    const g6 = i64(g[6])
    const g7 = i64(g[7])
    const g8 = i64(g[8])
    const g9 = i64(g[9])

    const g1_19 = i64(g1 * 19)
    const g2_19 = i64(g2 * 19)
    const g3_19 = i64(g3 * 19)
    const g4_19 = i64(g4 * 19)
    const g5_19 = i64(g5 * 19)
    const g6_19 = i64(g6 * 19)
    const g7_19 = i64(g7 * 19)
    const g8_19 = i64(g8 * 19)
    const g9_19 = i64(g9 * 19)

    const h0 = f0*g0 + f1_2*g9_19 + f2*g8_19 + f3_2*g7_19 + f4*g6_19 + f5_2*g5_19 + f6*g4_19 + f7_2*g3_19 + f8*g2_19 + f9_2*g1_19
    const h1 = f0*g1 + f1*g0 + f2*g9_19 + f3*g8_19 + f4*g7_19 + f5*g6_19 + f6*g5_19 + f7*g4_19 + f8*g3_19 + f9*g2_19
    const h2 = f0*g2 + f1_2*g1 + f2*g0 + f3_2*g9_19 + f4*g8_19 + f5_2*g7_19 + f6*g6_19 + f7_2*g5_19 + f8*g4_19 + f9_2*g3_19
    const h3 = f0*g3 + f1*g2 + f2*g1 + f3*g0 + f4*g9_19 + f5*g8_19 + f6*g7_19 + f7*g6_19 + f8*g5_19 + f9*g4_19
    const h4 = f0*g4 + f1_2*g3 + f2*g2 + f3_2*g1 + f4*g0 + f5_2*g9_19 + f6*g8_19 + f7_2*g7_19 + f8*g6_19 + f9_2*g5_19
    const h5 = f0*g5 + f1*g4 + f2*g3 + f3*g2 + f4*g1 + f5*g0 + f6*g9_19 + f7*g8_19 + f8*g7_19 + f9*g6_19
    const h6 = f0*g6 + f1_2*g5 + f2*g4 + f3_2*g3 + f4*g2 + f5_2*g1 + f6*g0 + f7_2*g9_19 + f8*g8_19 + f9_2*g7_19
    const h7 = f0*g7 + f1*g6 + f2*g5 + f3*g4 + f4*g3 + f5*g2 + f6*g1 + f7*g0 + f8*g9_19 + f9*g8_19
    const h8 = f0*g8 + f1_2*g7 + f2*g6 + f3_2*g5 + f4*g4 + f5_2*g3 + f6*g2 + f7_2*g1 + f8*g0 + f9_2*g9_19
    const h9 = f0*g9 + f1*g8 + f2*g7 + f3*g6 + f4*g5 + f5*g4 + f6*g3 + f7*g2 + f8*g1 + f9*g0

    FeCombine(h, h0, h1, h2, h3, h4, h5, h6, h7, h8, h9)
}

function FePow22523(out: FieldElement, z: FieldElement): void {
    const t0 = new Array<i32>(10)
    const t1 = new Array<i32>(10)
    const t2 = new Array<i32>(10)

    FeSquare(t0, z)
    for (let i = 1; i < 1; i++) {
        FeSquare(t0, t0)
    }

    FeSquare(t1, t0)
    for (let i = 1; i < 2; i++) {
        FeSquare(t1, t1)
    }

    FeMul(t1, z, t1)
    FeMul(t0, t0, t1)
    FeSquare(t0, t0)
    for (let i = 1; i < 1; i++) {
        FeSquare(t0, t0)
    }

    FeMul(t0, t1, t0)
    FeSquare(t1, t0)
    for (let i = 1; i < 5; i++) {
        FeSquare(t1, t1)
    }

    FeMul(t0, t1, t0)
    FeSquare(t1, t0)
    for (let i = 1; i < 10; i++) {
        FeSquare(t1, t1)
    }

    FeMul(t1, t1, t0)
    FeSquare(t2, t1)
    for (let i = 1; i < 20; i++) {
        FeSquare(t2, t2)
    }

    FeMul(t1, t2, t1)
    FeSquare(t1, t1)
    for (let i = 1; i < 10; i++) {
        FeSquare(t1, t1)
    }

    FeMul(t0, t1, t0)
    FeSquare(t1, t0)
    for (let i = 1; i < 50; i++) {
        FeSquare(t1, t1)
    }

    FeMul(t1, t1, t0)
    FeSquare(t2, t1)
    for (let i = 1; i < 100; i++) {
        FeSquare(t2, t2)
    }

    FeMul(t1, t2, t1)
    FeSquare(t1, t1)
    for (let i = 1; i < 50; i++) {
        FeSquare(t1, t1)
    }

    FeMul(t0, t1, t0)
    FeSquare(t0, t0)
    for (let i = 1; i < 2; i++) {
        FeSquare(t0, t0)
    }

    FeMul(out, t0, z)
}

function FeInvert(out: FieldElement, z: FieldElement): void {
    const t0 = new Array<i32>(10)
    const t1 = new Array<i32>(10)
    const t2 = new Array<i32>(10)
    const t3 = new Array<i32>(10)
    let i = 0

    FeSquare(t0, z)
    FeSquare(t1, t0)
    for (i = 1; i < 2; i++) {
        FeSquare(t1, t1)
    }

    FeMul(t1, z, t1)      // 2^3 + 2^0
	FeMul(t0, t0, t1)    // 2^3 + 2^1 + 2^0
	FeSquare(t2, t0)      // 2^4 + 2^2 + 2^1
	FeMul(t1, t1, t2)    // 2^4 + 2^3 + 2^2 + 2^1 + 2^0
	FeSquare(t2, t1)      // 5,4,3,2,1
	for (i = 1; i < 5; i++) { // 9,8,7,6,5
		FeSquare(t2, t2)
	}
	FeMul(t1, t2, t1)     // 9,8,7,6,5,4,3,2,1,0
	FeSquare(t2, t1)       // 10..1
	for (i = 1; i < 10; i++) { // 19..10
		FeSquare(t2, t2)
	}
	FeMul(t2, t2, t1)     // 19..0
	FeSquare(t3, t2)       // 20..1
	for (i = 1; i < 20; i++) { // 39..20
		FeSquare(t3, t3)
	}
	FeMul(t2, t3, t2)     // 39..0
	FeSquare(t2, t2)       // 40..1
	for (i = 1; i < 10; i++) { // 49..10
		FeSquare(t2, t2)
	}
	FeMul(t1, t2, t1)     // 49..0
	FeSquare(t2, t1)       // 50..1
	for (i = 1; i < 50; i++) { // 99..50
		FeSquare(t2, t2)
	}
	FeMul(t2, t2, t1)      // 99..0
	FeSquare(t3, t2)        // 100..1
	for (i = 1; i < 100; i++) { // 199..100
		FeSquare(t3, t3)
	}
	FeMul(t2, t3, t2)     // 199..0
	FeSquare(t2, t2)       // 200..1
	for (i = 1; i < 50; i++) { // 249..50
		FeSquare(t2, t2)
	}
	FeMul(t1, t2, t1)    // 249..0
	FeSquare(t1, t1)      // 250..1
	for (i = 1; i < 5; i++) { // 254..5
		FeSquare(t1, t1)
	}
	FeMul(out, t1, t0) // 254..5,3,1,
}


function FeAdd(dst: FieldElement, a: FieldElement, b: FieldElement): void {
    dst[0] = a[0] + b[0]
    dst[1] = a[1] + b[1]
    dst[2] = a[2] + b[2]
    dst[3] = a[3] + b[3]
    dst[4] = a[4] + b[4]
    dst[5] = a[5] + b[5]
    dst[6] = a[6] + b[6]
    dst[7] = a[7] + b[7]
    dst[8] = a[8] + b[8]
    dst[9] = a[9] + b[9]
}

function FeSub(h: FieldElement, f: FieldElement, g: FieldElement): void {
    h[0] = f[0] - g[0]
    h[1] = f[1] - g[1]
    h[2] = f[2] - g[2]
    h[3] = f[3] - g[3]
    h[4] = f[4] - g[4]
    h[5] = f[5] - g[5]
    h[6] = f[6] - g[6]
    h[7] = f[7] - g[7]
    h[8] = f[8] - g[8]
    h[9] = f[9] - g[9]
}

function FeCombine(dst: FieldElement, h0: i64, h1: i64, h2: i64, h3: i64, h4: i64, h5: i64, h6: i64, h7: i64, h8: i64, h9: i64): void {
    let c0 = h0 + (1 << 25) >> 26
    h1 += c0
    h0 -= c0 << 26
    let c4 = h4 + (1 << 25) >> 26
    h5 += c4
    h4 -= c4 << 26

    let c1 = h1 + (1 << 24) >> 25
    h2 += c1
    h1 -= c1 << 25
    let c5 = h5 + (1 << 24) >> 25
    h6 += c5
    h5 -= c5 << 25

    let c2 = h2 + (1 << 25) >> 26
    h3 += c2
    h2 -= c2 << 26
    let c6 = h6 + (1 << 25) >> 26
    h7 += c6
    h6 -= c6 << 26

    let c3 = h3 + (1 << 24) >> 25
    h4 += c3
    h3 -= c3 << 25
    let c7 = h7 + (1 << 24) >> 25
    h8 += c7
    h7 -= c7 << 25

    c4 = h4 + (1 << 25) >> 26
    h5 += c4
    h4 -= c4 << 26
    let c8 = h8 + (1 << 25) >> 26
    h9 += c8
    h8 -= c8 << 26

    let c9 = h9 + (1 << 24) >> 25
    h0 += c9 * 19
    h9 -= c9 << 25

    c0 = h0 + (1 << 25) >> 26
    h1 += c0
    h0 -= c0 << 26

    dst[0] = h0 as i32
    dst[1] = h1 as i32
    dst[2] = h2 as i32
    dst[3] = h3 as i32
    dst[4] = h4 as i32
    dst[5] = h5 as i32
    dst[6] = h6 as i32
    dst[7] = h7 as i32
    dst[8] = h8 as i32
    dst[9] = h9 as i32
}


function FeToBytes(s: Bytes, h: FieldElement): void {
    let carry = new Array<i32>(10)

    let q = (19 * h[9] + (1 << 24)) >> 25
    q = (h[0] + q) >> 26
    q = (h[1] + q) >> 25
    q = (h[2] + q) >> 26
    q = (h[3] + q) >> 25
    q = (h[4] + q) >> 26
    q = (h[5] + q) >> 25
    q = (h[6] + q) >> 26
    q = (h[7] + q) >> 25
    q = (h[8] + q) >> 26
    q = (h[9] + q) >> 25

    h[0] += 19 * q

    carry[0] = h[0] >> 26
	h[1] += carry[0]
	h[0] -= carry[0] << 26
	carry[1] = h[1] >> 25
	h[2] += carry[1]
	h[1] -= carry[1] << 25
	carry[2] = h[2] >> 26
	h[3] += carry[2]
	h[2] -= carry[2] << 26
	carry[3] = h[3] >> 25
	h[4] += carry[3]
	h[3] -= carry[3] << 25
	carry[4] = h[4] >> 26
	h[5] += carry[4]
	h[4] -= carry[4] << 26
	carry[5] = h[5] >> 25
	h[6] += carry[5]
	h[5] -= carry[5] << 25
	carry[6] = h[6] >> 26
	h[7] += carry[6]
	h[6] -= carry[6] << 26
	carry[7] = h[7] >> 25
	h[8] += carry[7]
	h[7] -= carry[7] << 25
	carry[8] = h[8] >> 26
	h[9] += carry[8]
	h[8] -= carry[8] << 26
	carry[9] = h[9] >> 25
	h[9] -= carry[9] << 25

    s[0] = h[0] as u8
    s[1] = h[0] >> 8 as u8
    s[2] = h[0] >> 16 as u8
    s[3] = (h[0] >> 24 | h[1] << 2) as u8
    s[4] = h[1] >> 6 as u8
    s[5] = h[1] >> 14 as u8
    s[6] = (h[1] >> 22 | h[2] << 3) as u8
    s[7] = h[2] >> 5 as u8
    s[8] = h[2] >> 13 as u8
    s[9] = (h[2] >> 21 | h[3] << 5) as u8
    s[10] = h[3] >> 3 as u8
    s[11] = h[3] >> 11 as u8
    s[12] = (h[3] >> 19 | h[4] << 6) as u8
    s[13] = h[4] >> 2 as u8
    s[14] = h[4] >> 10 as u8
    s[15] = h[4] >> 18 as u8
    s[16] = h[5] as u8
    s[17] = h[5] >> 8 as u8
    s[18] = h[5] >> 16 as u8
    s[19] = (h[5] >> 24 | h[6] << 1) as u8
    s[20] = h[6] >> 7 as u8
    s[21] = h[6] >> 15 as u8
    s[22] = (h[6] >> 23 | h[7] << 3) as u8
    s[23] = h[7] >> 5 as u8
    s[24] = h[7] >> 13 as u8
    s[25] = (h[7] >> 21 | h[8] << 4) as u8
    s[26] = h[8] >> 4 as u8
    s[27] = h[8] >> 12 as u8
    s[28] = (h[8] >> 20 | h[9] << 6) as u8
    s[29] = h[9] >> 2 as u8
    s[30] = h[9] >> 10 as u8
    s[31] = h[9] >> 18 as u8
}

function FeIsNegative(f: FieldElement): i32 {
    let s = new Bytes(32)
    FeToBytes(s, f)
    return s[0] & 1
}

function FeIsNonZero(f: FieldElement): i32 {
    let s = new Bytes(32)
    FeToBytes(s, f)

    let x = 0
    for (let i = 0; i < 32; i++) {
        x |= s[i]
    }

    x = (x) | (x >> 4)
    x = (x) | (x >> 2)
    x = (x) | (x >> 1)

    return (x & 1) as i32
}

function FeNeg(h: FieldElement, f: FieldElement): void {
    h[0] = -f[0]
    h[1] = -f[1]
    h[2] = -f[2]
    h[3] = -f[3]
    h[4] = -f[4]
    h[5] = -f[5]
    h[6] = -f[6]
    h[7] = -f[7]
    h[8] = -f[8]
    h[9] = -f[9]
}

function geAdd(r: CompletedGroupElement, p: ExtendedGroupElement, q: CachedGroupElement): void {
    let t0 = new Array<i32>(10)

    FeAdd(r.X, p.Y, p.X)
	FeSub(r.Y, p.Y, p.X)
	FeMul(r.Z, r.X, q.yPlusX)
	FeMul(r.Y, r.Y, q.yMinusX)
	FeMul(r.T, q.T2d, p.T)
	FeMul(r.X, p.Z, q.Z)
	FeAdd(t0, r.X, r.X)
	FeSub(r.X, r.Z, r.Y)
	FeAdd(r.Y, r.Z, r.Y)
	FeAdd(r.Z, t0, r.T)
	FeSub(r.T, t0, r.T)
}

function geSub(r: CompletedGroupElement, p: ExtendedGroupElement, q: CachedGroupElement): void {
    let t0 = new Array<i32>(10)

    FeAdd(r.X, p.Y, p.X)
	FeSub(r.Y, p.Y, p.X)
	FeMul(r.Z, r.X, q.yMinusX)
	FeMul(r.Y, r.Y, q.yPlusX)
	FeMul(r.T, q.T2d, p.T)
	FeMul(r.X, p.Z, q.Z)
	FeAdd(t0, r.X, r.X)
	FeSub(r.X, r.Z, r.Y)
	FeAdd(r.Y, r.Z, r.Y)
	FeSub(r.Z, t0, r.T)
	FeAdd(r.T, t0, r.T)
}

function geMixedAdd(r: CompletedGroupElement, p: ExtendedGroupElement, q: PreComputedGroupElement): void {
    let t0 = new Array<i32>(10)

    FeAdd(r.X, p.Y, p.X)
	FeSub(r.Y, p.Y, p.X)
	FeMul(r.Z, r.X, q.yPlusX)
	FeMul(r.Y, r.Y, q.yMinusX)
	FeMul(r.T, q.xy2d, p.T)
	FeAdd(t0, p.Z, p.Z)
	FeSub(r.X, r.Z, r.Y)
	FeAdd(r.Y, r.Z, r.Y)
	FeAdd(r.Z, t0, r.T)
	FeSub(r.T, t0, r.T)
}

function geMixedSub(r: CompletedGroupElement, p: ExtendedGroupElement, q: PreComputedGroupElement): void {
    let t0 = new Array<i32>(10)

    FeAdd(r.X, p.Y, p.X)
	FeSub(r.Y, p.Y, p.X)
	FeMul(r.Z, r.X, q.yMinusX)
	FeMul(r.Y, r.Y, q.yPlusX)
	FeMul(r.T, q.xy2d, p.T)
	FeAdd(t0, p.Z, p.Z)
	FeSub(r.X, r.Z, r.Y)
	FeAdd(r.Y, r.Z, r.Y)
	FeSub(r.Z, t0, r.T)
	FeAdd(r.T, t0, r.T)
}

function equal(b: i32, c: i32): i32 {
    const x = b ^ c
    const y = x - 1
    return ((y ^ x) >> 8) & 1
}

function negative(b: i32): i32 {
    return (b >> 31) & 1
}

function PreComputedGroupElementCMove(t: PreComputedGroupElement, u: PreComputedGroupElement, b: i32): void {
    FeCMove(t.yPlusX, u.yPlusX, b)
    FeCMove(t.yMinusX, u.yMinusX, b)
    FeCMove(t.xy2d, u.xy2d, b)
}

function selectPoint(t: PreComputedGroupElement, pos: i32, b: i32): void {
    const minusT = new PreComputedGroupElement(new Array<i32>(10), new Array<i32>(10), new Array<i32>(10))
    const bNegative = negative(b)
    const bAbs = b - (((-bNegative) & b) << 1)

    t.Zero()
    for (let i = 0; i < 8; i++) {
        // const pc = new PreComputedGroupElement(base[pos][i][0], base[pos][i][1], base[pos][i][2])
        const pc = getBase(pos, i)
        PreComputedGroupElementCMove(t, pc, equal(bAbs, i + 1))
    }
}

function GeScalarMultBase(h: ExtendedGroupElement, a: Bytes): void {
    let e = new Array<i8>(64)

    for (let i = 0; i < a.length; i++) {
        e[2 * i + 0] = i8((a[i] >> 0) & 15)
        e[2 * i + 1] = i8((a[i] >> 4) & 15)
    }

    let carry = i8(0)
    for (let i = 0; i < 63; i++) {
        e[i] += carry
        carry = (e[i] + 8) >> 4
        e[i] -= carry << 4
    }
    e[63] += carry

    h.Zero()
    const t = new PreComputedGroupElement(new Array<i32>(10), new Array<i32>(10), new Array<i32>(10))
    const r = new CompletedGroupElement()
    for (let i = 1; i < 64; i += 2) {
        selectPoint(t, i / 2, i32(e[i]))
        geMixedAdd(r, h, t)
        r.toExtended(h)
    }

    const s = new ProjectiveGroupElement()

    h.Double(r)
	r.toProjective(s)
	s.Double(r)
	r.toProjective(s)
	s.Double(r)
	r.toProjective(s)
	s.Double(r)
	r.toExtended(h)

    for (let i = 0; i < 64; i += 2) {
        selectPoint(t, i / 2, i32(e[i]))
        geMixedAdd(r, h, t)
        r.toExtended(h)
    }
}

function ge(): ExtendedGroupElement {
    const g = new ExtendedGroupElement()
    const f = new Array<i32>(10)
    FeOne(f)
    const s = new Bytes(32)
    FeToBytes(s, f)
    GeScalarMultBase(g, s)
    return g
}
