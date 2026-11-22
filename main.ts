// Tiny stack VM: runs every instance of a set (i001..i040) in one run.
// ISA: 32-bit wrapping ints, 256-value stack, 64-deep call stack,
// 256 words of memory, ten traps, 1,000,000 steps, 65,536 output bytes.
// Reads <input>/<id>/program.bin + input.bin, writes <output>/<id>/stdout.bin + exit.txt
// (input/output are /input and /output in the sandbox, MAKEFUN_*_DIR under the process driver).
import fs from "node:fs";

const enc = new TextEncoder();
// Mounts: in the docker sandbox these are /input and /output; the process
// driver stands them in as MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR instead.
const IN = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUT = process.env.MAKEFUN_OUTPUT_DIR || "/output";

// Run one program; returns [output bytes, exit code].
function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256); // data stack
  const C = new Int32Array(64); // call stack
  const M = new Int32Array(256); // memory
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, pc = 0, steps = 0, ol = 0, ip = 0;
  const done = (e) => [out.subarray(0, ol), e];
  for (;;) {
    if (steps === 1000000) return done(10); // step limit
    if (pc < 0 || pc >= n) return done(9); // pc outside program
    const o = p[pc];
    // Immediate length: PUSH8=1, PUSH32=4, JMP/JZ/JNZ/CALL=2, else 0.
    const imm = o === 1 ? 1 : o === 2 ? 4 : o >= 48 && o <= 51 ? 2 : 0;
    // Valid opcodes: 00-07, 10-1E, 20-22, 30-34, 40-41, 50-53 (0x1F is not an opcode).
    if (!(o < 8 || (o >= 16 && o <= 34 && o !== 31) || (o >= 48 && o <= 52) || o === 64 || o === 65 || (o >= 80 && o <= 83))) return done(5);
    if (pc + imm >= n) return done(9); // immediate cut off by end of program
    steps++;
    const nx = pc + 1 + imm;
    pc = nx;
    switch (o) {
      case 0: return done(0); // HALT
      case 1: // PUSH8, sign-extended
        if (sp === 256) return done(3);
        D[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 2: // PUSH32, little-endian
        if (sp === 256) return done(3);
        D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 3: // POP
        if (sp < 1) return done(2);
        sp--;
        break;
      case 4: // DUP
        if (sp < 1) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 5: // SWAP
        if (sp < 2) return done(2);
        { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; }
        break;
      case 6: // OVER
        if (sp < 2) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 7: { // ROT
        if (sp < 3) return done(2);
        const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a;
        break;
      }
      case 0x17: // NEG
        if (sp < 1) return done(2);
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 0x1b: // NOT
        if (sp < 1) return done(2);
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: { // binary ops
        if (sp < 2) return done(2);
        const b = D[sp - 1], a = D[sp - 2];
        let r = 0;
        switch (o) {
          case 0x10: r = (a + b) | 0; break; // ADD
          case 0x11: r = (a - b) | 0; break; // SUB
          case 0x12: r = Math.imul(a, b); break; // MUL, low 32 bits
          case 0x13: // DIV, truncates toward zero
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14: // MOD, sign of a
            if (b === 0) return done(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15: // DIVU
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16: // MODU
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break; // AND
          case 0x19: r = a | b; break; // OR
          case 0x1a: r = a ^ b; break; // XOR
          case 0x1c: r = a << (b & 31); break; // SHL
          case 0x1d: r = a >> (b & 31); break; // SHR, arithmetic
          case 0x1e: r = (a >>> (b & 31)) | 0; break; // SHRU, logical
          case 0x20: r = a === b ? 1 : 0; break; // EQ
          case 0x21: r = a < b ? 1 : 0; break; // LT, signed
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU, unsigned
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: { // JMP / JZ / JNZ
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        if (o === 0x30) { pc = nx + rel; break; }
        if (sp < 1) return done(2);
        const v = D[--sp];
        if ((o === 0x31) === (v === 0)) pc = nx + rel;
        break;
      }
      case 0x33: // CALL
        if (csp === 64) return done(7);
        C[csp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34: // RET
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: { // LOAD
        if (sp < 1) return done(2);
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return done(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: { // STORE
        if (sp < 2) return done(2);
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= 256) return done(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 0x50: { // PRINT, decimal ASCII
        if (sp < 1) return done(2);
        const s = enc.encode(String(D[sp - 1]));
        if (ol + s.length > 65536) return done(11);
        sp--;
        out.set(s, ol);
        ol += s.length;
        break;
      }
      case 0x51: // PUTC
        if (sp < 1) return done(2);
        if (ol + 1 > 65536) return done(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52: // IN, -1 past end of input
        if (sp === 256) return done(3);
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53: // EXIT, low byte of v
        if (sp < 1) return done(2);
        return done(D[--sp] & 255);
    }
  }
}

for (let k = 1; k <= 40; k++) {
  const id = "i" + String(k).padStart(3, "0");
  const p = fs.readFileSync(`${IN}/${id}/program.bin`);
  let inp = Buffer.alloc(0);
  try { inp = fs.readFileSync(`${IN}/${id}/input.bin`); } catch {}
  const [o, e] = run(p, inp);
  fs.mkdirSync(`${OUT}/${id}`, { recursive: true });
  fs.writeFileSync(`${OUT}/${id}/stdout.bin`, o);
  fs.writeFileSync(`${OUT}/${id}/exit.txt`, String(e));
}
