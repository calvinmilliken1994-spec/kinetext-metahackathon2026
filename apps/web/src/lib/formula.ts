// Safe formula evaluator for formula-explorer-v1 (pure). It implements ONLY the frozen grammar (design §2.7) with a
// hand-written lexer and recursive-descent parser over a tiny AST; there is no dynamic code execution of any kind.
//
//   Expr := Term (("+"|"-") Term)*
//   Term := Unary (("*"|"/") Unary)*
//   Unary := "-" Unary | Power
//   Power := Primary ("^" Unary)?          -x^2 = -(x^2); a^b^c = a^(b^c); 2^-1 is allowed
//   Primary := Number | Variable | FuncCall | Constant | "(" Expr ")"
//
// Functions sqrt|exp|log|sin|cos|tan (log is natural, trig in radians); constants pi|e. Domain errors give NaN.

import { FORMULA_CONSTANTS, FORMULA_FUNCTIONS, KIT_LIMITS } from '../../../../packages/contracts/kit.ts';

export type FormulaFn = typeof FORMULA_FUNCTIONS[number];
export type FormulaConst = typeof FORMULA_CONSTANTS[number];

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'const'; name: FormulaConst }
  | { t: 'neg'; x: Ast }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; l: Ast; r: Ast }
  | { t: 'call'; fn: FormulaFn; arg: Ast };

export type ParseCode = 'EMPTY' | 'TOO_LONG' | 'BAD_CHAR' | 'SYNTAX' | 'UNKNOWN_NAME' | 'RESERVED_VARIABLE' | 'TOO_COMPLEX' | 'EXPONENT_RANGE';
export type ParseResult = { ok: true; ast: Ast; nodes: number } | { ok: false; code: ParseCode; message: string };

const LIMITS = KIT_LIMITS.formulaExplorer;
const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-',
};

/** The fixed normalisation applied before lexing: times signs, minus signs, ** and superscripts become the final ASCII form. */
export function normalizeFormula(src: string): string {
  return src
    .replace(/[×·∙⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*/g, '^')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (run) => '^' + [...run].map((c) => SUPERSCRIPTS[c] ?? '').join(''));
}

type Token = { k: 'num'; v: number } | { k: 'id'; text: string } | { k: 'op'; text: string };

class FormulaError extends Error {
  readonly code: ParseCode;
  constructor(code: ParseCode, message: string) {
    super(message);
    this.code = code;
  }
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /[a-z][a-z0-9_]*/y;

function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      if (m === null) throw new FormulaError('SYNTAX', 'A number is not written correctly.');
      const v = Number(m[0]);
      if (!Number.isFinite(v)) throw new FormulaError('SYNTAX', 'A number is too large.');
      out.push({ k: 'num', v });
      i += m[0].length;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      IDENT.lastIndex = i;
      const m = IDENT.exec(src) as RegExpExecArray;
      out.push({ k: 'id', text: m[0] });
      i += m[0].length;
      continue;
    }
    if ('+-*/^()'.includes(ch)) { out.push({ k: 'op', text: ch }); i++; continue; }
    throw new FormulaError('BAD_CHAR', `The character “${ch}” is not allowed in a formula.`);
  }
  return out;
}

const isFn = (s: string): s is FormulaFn => (FORMULA_FUNCTIONS as readonly string[]).includes(s);
const isConst = (s: string): s is FormulaConst => (FORMULA_CONSTANTS as readonly string[]).includes(s);

class Parser {
  private pos = 0;
  nodes = 0;
  private readonly tokens: Token[];
  private readonly vars: ReadonlySet<string>;
  constructor(tokens: Token[], vars: ReadonlySet<string>) {
    this.tokens = tokens;
    this.vars = vars;
  }

  private peekOp(text: string): boolean {
    const t = this.tokens[this.pos];
    return t !== undefined && t.k === 'op' && t.text === text;
  }
  private node<T extends Ast>(n: T): T {
    this.nodes++;
    if (this.nodes > LIMITS.astMaxNodes) throw new FormulaError('TOO_COMPLEX', `The formula has more than ${LIMITS.astMaxNodes} parts.`);
    return n;
  }

  parse(): Ast {
    const ast = this.expr();
    if (this.pos < this.tokens.length) throw new FormulaError('SYNTAX', 'The formula has something left over after it ends (is a multiplication sign missing?).');
    return ast;
  }

  private expr(): Ast {
    let left = this.term();
    while (this.peekOp('+') || this.peekOp('-')) {
      const op = (this.tokens[this.pos++] as { text: '+' | '-' }).text;
      left = this.node({ t: 'bin', op, l: left, r: this.term() });
    }
    return left;
  }

  private term(): Ast {
    let left = this.unary();
    while (this.peekOp('*') || this.peekOp('/')) {
      const op = (this.tokens[this.pos++] as { text: '*' | '/' }).text;
      left = this.node({ t: 'bin', op, l: left, r: this.unary() });
    }
    return left;
  }

  private unary(): Ast {
    if (this.peekOp('-')) {
      this.pos++;
      return this.node({ t: 'neg', x: this.unary() });
    }
    return this.power();
  }

  private power(): Ast {
    const base = this.primary();
    if (this.peekOp('^')) {
      this.pos++;
      const exponent = this.unary();
      const literal = exponent.t === 'num' ? exponent.v : exponent.t === 'neg' && exponent.x.t === 'num' ? -exponent.x.v : null;
      if (literal !== null && Math.abs(literal) > LIMITS.exponentAbsMax) throw new FormulaError('EXPONENT_RANGE', `An exponent may not be larger than ${LIMITS.exponentAbsMax}.`);
      return this.node({ t: 'bin', op: '^', l: base, r: exponent });
    }
    return base;
  }

  private primary(): Ast {
    const t = this.tokens[this.pos];
    if (t === undefined) throw new FormulaError('SYNTAX', 'The formula ends too early.');
    this.pos++;
    if (t.k === 'num') return this.node({ t: 'num', v: t.v });
    if (t.k === 'op') {
      if (t.text !== '(') throw new FormulaError('SYNTAX', `Unexpected “${t.text}”.`);
      const inner = this.expr();
      if (!this.peekOp(')')) throw new FormulaError('SYNTAX', 'A bracket is not closed.');
      this.pos++;
      return inner;
    }
    if (isFn(t.text)) {
      if (!this.peekOp('(')) throw new FormulaError('SYNTAX', `${t.text} needs brackets, like ${t.text}(x).`);
      this.pos++;
      const arg = this.expr();
      if (!this.peekOp(')')) throw new FormulaError('SYNTAX', `${t.text} takes exactly one value in brackets.`);
      this.pos++;
      return this.node({ t: 'call', fn: t.text, arg });
    }
    if (this.vars.has(t.text)) return this.node({ t: 'var', name: t.text });
    if (isConst(t.text)) return this.node({ t: 'const', name: t.text });
    throw new FormulaError('UNKNOWN_NAME', this.peekOp('(') ? `“${t.text}” is not a function this calculator knows.` : `“${t.text}” is not a variable of this formula.`);
  }
}

/** Parse `src` against the declared variable names. Never throws. */
export function parseFormula(src: string, variables: readonly string[]): ParseResult {
  try {
    const reserved = variables.find((v) => isFn(v) || isConst(v));
    if (reserved !== undefined) throw new FormulaError('RESERVED_VARIABLE', `“${reserved}” is reserved and cannot be a variable name.`);
    const text = normalizeFormula(src);
    if (text.trim() === '') throw new FormulaError('EMPTY', 'The formula is empty.');
    if (text.length > LIMITS.expressionMaxChars) throw new FormulaError('TOO_LONG', `The formula is longer than ${LIMITS.expressionMaxChars} characters.`);
    const parser = new Parser(lex(text), new Set(variables));
    const ast = parser.parse();
    return { ok: true, ast, nodes: parser.nodes };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'SYNTAX', message: 'The formula could not be read.' };
  }
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Evaluate with the given variable values. Any domain error (÷0, sqrt of a negative, log of zero or less, 0 to a negative power, overflow, an exponent above 100) gives NaN. */
export function evaluate(ast: Ast, values: Readonly<Record<string, number>>): number {
  switch (ast.t) {
    case 'num': return ast.v;
    case 'var': return values[ast.name] ?? Number.NaN;
    case 'const': return ast.name === 'pi' ? Math.PI : Math.E;
    case 'neg': return -evaluate(ast.x, values);
    case 'call': {
      const x = evaluate(ast.arg, values);
      switch (ast.fn) {
        case 'sqrt': return x < 0 ? Number.NaN : finite(Math.sqrt(x));
        case 'exp': return finite(Math.exp(x));
        case 'log': return x <= 0 ? Number.NaN : finite(Math.log(x));
        case 'sin': return finite(Math.sin(x));
        case 'cos': return finite(Math.cos(x));
        case 'tan': return finite(Math.tan(x));
      }
      return Number.NaN;
    }
    case 'bin': {
      const l = evaluate(ast.l, values);
      const r = evaluate(ast.r, values);
      switch (ast.op) {
        case '+': return finite(l + r);
        case '-': return finite(l - r);
        case '*': return finite(l * r);
        case '/': return r === 0 ? Number.NaN : finite(l / r);
        case '^': return Math.abs(r) > LIMITS.exponentAbsMax ? Number.NaN : l === 0 && r < 0 ? Number.NaN : finite(Math.pow(l, r));
      }
      return Number.NaN;
    }
  }
}

/** Parse then evaluate in one step, taking the variable names from `values`; NaN when the text does not parse. */
export function evalExpression(src: string, values: Readonly<Record<string, number>>): number {
  const p = parseFormula(src, Object.keys(values));
  return p.ok ? evaluate(p.ast, values) : Number.NaN;
}

export function astVariables(ast: Ast): Set<string> {
  const out = new Set<string>();
  const walk = (a: Ast): void => {
    switch (a.t) {
      case 'var': out.add(a.name); break;
      case 'neg': walk(a.x); break;
      case 'call': walk(a.arg); break;
      case 'bin': walk(a.l); walk(a.r); break;
      default: break;
    }
  };
  walk(ast);
  return out;
}

export function astNodeCount(ast: Ast): number {
  switch (ast.t) {
    case 'neg': return 1 + astNodeCount(ast.x);
    case 'call': return 1 + astNodeCount(ast.arg);
    case 'bin': return 1 + astNodeCount(ast.l) + astNodeCount(ast.r);
    default: return 1;
  }
}
