import fs from "node:fs";
const enc = new TextEncoder();
const IN = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUT = process.env.MAKEFUN_OUTPUT_DIR || "/output";
function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, pc = 0, steps = 0, ol = 0, ip = 0;
  const done = (e) => [out.subarray(0, ol), e];
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const o = p[pc];
    const imm = o === 1 ? 1 : o === 2 ? 4 : o >= 48 && o <= 51 ? 2 : 0;
    if (!(o < 8 || (o >= 16 && o <= 34 && o !== 31) || (o >= 48 && o <= 52) || o === 64 || o === 65 || (o >= 80 && o <= 83))) return done(5);
    if (pc + imm >= n) return done(9);
    steps++;
    const nx = pc + 1 + imm;
    pc = nx;
    switch (o) {
      case 0: return done(0);
      case 1:
        if (sp === 256) return done(3);
        D[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 2:
        if (sp === 256) return done(3);
        D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 3:
        if (sp < 1) return done(2);
        sp--;
        break;
      case 4:
        if (sp < 1) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 5:
        if (sp < 2) return done(2);
        { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; }
        break;
      case 6:
        if (sp < 2) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 7: {
        if (sp < 3) return done(2);
        const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a;
        break;
      }
      case 0x17:
        if (sp < 1) return done(2);
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 0x1b:
        if (sp < 1) return done(2);
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        if (sp < 2) return done(2);
        const b = D[sp - 1], a = D[sp - 2];
        let r = 0;
        switch (o) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14:
            if (b === 0) return done(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15:
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        if (o === 0x30) { pc = nx + rel; break; }
        if (sp < 1) return done(2);
        const v = D[--sp];
        if ((o === 0x31) === (v === 0)) pc = nx + rel;
        break;
      }
      case 0x33:
        if (csp === 64) return done(7);
        C[csp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: {
        if (sp < 1) return done(2);
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return done(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: {
        if (sp < 2) return done(2);
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= 256) return done(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 0x50: {
        if (sp < 1) return done(2);
        const s = enc.encode(String(D[sp - 1]));
        if (ol + s.length > 65536) return done(11);
        sp--;
        out.set(s, ol);
        ol += s.length;
        break;
      }
      case 0x51:
        if (sp < 1) return done(2);
        if (ol + 1 > 65536) return done(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52:
        if (sp === 256) return done(3);
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
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
