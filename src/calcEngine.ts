"use strict";

/**
 * calcEngine.ts
 *
 * A small, safe expression grammar for user-defined calculated columns.
 * This is intentionally NOT a re-implementation of DAX — it is a
 * lightweight arithmetic/logic layer over columns that are already
 * present in the visual (Rows/Values), referenced by their display name.
 *
 * Grammar (case-insensitive keywords AND / OR / IF, aggregate names):
 *
 *   expr    := orExpr
 *   orExpr  := andExpr (OR andExpr)*
 *   andExpr := cmpExpr (AND cmpExpr)*
 *   cmpExpr := addExpr ((> | < | >= | <= | == | !=) addExpr)?
 *   addExpr := mulExpr ((+ | -) mulExpr)*
 *   mulExpr := unary ((* | /) unary)*
 *   unary   := '-' unary | primary
 *   primary := NUMBER
 *            | IDENT                      // bare column name, no spaces
 *            | '[' IDENT-WITH-SPACES ']'   // bracketed column name
 *            | '(' expr ')'
 *            | IF '(' expr ',' expr ',' expr ')'
 *            | (AVG|SUM|MIN|MAX) '(' columnRef ')'
 *
 * Deliberately: NO eval(), NO new Function(). Every token is parsed and
 * walked by hand, which is what makes this safe to run inside an
 * iframe-hosted, AppSource-certified visual.
 */

export type CalcValue = number | boolean | string | null;

export interface ICalcRowContext {
    /** Looks up the current row's value for a column, by display name. */
    getColumnValue(columnName: string): number | string | boolean | Date | null | undefined;
}

export interface ICalcAggregates {
    /** Precomputed AVG/SUM/MIN/MAX for a column across the current (filtered) dataset. */
    getAggregate(fn: "AVG" | "SUM" | "MIN" | "MAX", columnName: string): number | null;
}

export interface ICalcParseResult {
    ok: boolean;
    /** Human-readable message shown inline under the formula input. Never a stack trace. */
    error?: string;
    /** Column display names referenced by the formula (for validation against known columns). */
    referencedColumns: string[];
    ast?: Node;
}

// -----------------------------------------------------------------
// Tokenizer
// -----------------------------------------------------------------

type TokenType =
    | "number" | "ident" | "bracketIdent" | "string"
    | "+" | "-" | "*" | "/" | "(" | ")" | ","
    | ">" | "<" | ">=" | "<=" | "==" | "!="
    | "AND" | "OR" | "IF" | "AGG"
    | "eof";

interface Token {
    type: TokenType;
    text: string;
    value?: string; // for numbers/idents
    pos: number;
}

const KEYWORDS = new Set(["AND", "OR", "IF"]);
const AGG_FNS = new Set(["AVG", "SUM", "MIN", "MAX"]);

function tokenize(input: string): { tokens: Token[]; error?: string } {
    const tokens: Token[] = [];
    let i = 0;
    const n = input.length;

    while (i < n) {
        const c = input[i];

        if (c === " " || c === "\t" || c === "\n" || c === "\r") {
            i++;
            continue;
        }

        if (c === "[") {
            const close = input.indexOf("]", i + 1);
            if (close === -1) {
                return { tokens, error: "Missing closing ] for a column reference." };
            }
            const name = input.slice(i + 1, close).trim();
            if (name.length === 0) {
                return { tokens, error: "Empty column reference []." };
            }
            tokens.push({ type: "bracketIdent", text: input.slice(i, close + 1), value: name, pos: i });
            i = close + 1;
            continue;
        }

        if (c === '"') {
            let j = i + 1;
            let value = "";
            let closed = false;
            while (j < n) {
                if (input[j] === "\\" && input[j + 1] === '"') {
                    value += '"';
                    j += 2;
                    continue;
                }
                if (input[j] === '"') {
                    closed = true;
                    j++;
                    break;
                }
                value += input[j];
                j++;
            }
            if (!closed) {
                return { tokens, error: 'Missing closing " for a text value.' };
            }
            tokens.push({ type: "string", text: input.slice(i, j), value, pos: i });
            i = j;
            continue;
        }

        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
            let j = i;
            while (j < n && /[0-9.]/.test(input[j])) {
                j++;
            }
            const text = input.slice(i, j);
            if ((text.match(/\./g) ?? []).length > 1) {
                return { tokens, error: `Invalid number "${text}".` };
            }
            tokens.push({ type: "number", text, value: text, pos: i });
            i = j;
            continue;
        }

        if (/[A-Za-z_]/.test(c)) {
            let j = i;
            while (j < n && /[A-Za-z0-9_]/.test(input[j])) {
                j++;
            }
            const word = input.slice(i, j);
            const upper = word.toUpperCase();
            if (KEYWORDS.has(upper)) {
                tokens.push({ type: upper as TokenType, text: word, pos: i });
            } else if (AGG_FNS.has(upper)) {
                tokens.push({ type: "AGG", text: word, value: upper, pos: i });
            } else {
                tokens.push({ type: "ident", text: word, value: word, pos: i });
            }
            i = j;
            continue;
        }

        if (c === ">" || c === "<" || c === "=" || c === "!") {
            const two = input.slice(i, i + 2);
            if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
                tokens.push({ type: two as TokenType, text: two, pos: i });
                i += 2;
                continue;
            }
            if (c === ">" || c === "<") {
                tokens.push({ type: c as TokenType, text: c, pos: i });
                i++;
                continue;
            }
            return { tokens, error: `Unexpected character "${c}" — did you mean "==" or "!="?` };
        }

        if ("+-*/(),".includes(c)) {
            tokens.push({ type: c as TokenType, text: c, pos: i });
            i++;
            continue;
        }

        return { tokens, error: `Unexpected character "${c}".` };
    }

    tokens.push({ type: "eof", text: "", pos: n });
    return { tokens };
}

// -----------------------------------------------------------------
// AST
// -----------------------------------------------------------------

type Node =
    | { kind: "num"; value: number }
    | { kind: "str"; value: string }
    | { kind: "col"; name: string }
    | { kind: "agg"; fn: "AVG" | "SUM" | "MIN" | "MAX"; column: string }
    | { kind: "unary"; op: "-"; expr: Node }
    | { kind: "bin"; op: "+" | "-" | "*" | "/" | ">" | "<" | ">=" | "<=" | "==" | "!=" | "AND" | "OR"; left: Node; right: Node }
    | { kind: "if"; cond: Node; thenExpr: Node; elseExpr: Node };

class ParseError extends Error {}

// -----------------------------------------------------------------
// Parser (recursive descent)
// -----------------------------------------------------------------

class Parser {
    private tokens: Token[];
    private idx = 0;
    public referencedColumns: string[] = [];

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    private peek(): Token {
        return this.tokens[this.idx];
    }

    private next(): Token {
        return this.tokens[this.idx++];
    }

    private expect(type: TokenType): Token {
        const t = this.peek();
        if (t.type !== type) {
            throw new ParseError(`Expected "${type}" but found "${t.text || "end of formula"}".`);
        }
        return this.next();
    }

    public parseExpression(): Node {
        const node = this.parseOr();
        if (this.peek().type !== "eof") {
            throw new ParseError(`Unexpected "${this.peek().text}".`);
        }
        return node;
    }

    private parseOr(): Node {
        let left = this.parseAnd();
        while (this.peek().type === "OR") {
            this.next();
            const right = this.parseAnd();
            left = { kind: "bin", op: "OR", left, right };
        }
        return left;
    }

    private parseAnd(): Node {
        let left = this.parseCmp();
        while (this.peek().type === "AND") {
            this.next();
            const right = this.parseCmp();
            left = { kind: "bin", op: "AND", left, right };
        }
        return left;
    }

    private parseCmp(): Node {
        const left = this.parseAdd();
        const t = this.peek().type;
        if (t === ">" || t === "<" || t === ">=" || t === "<=" || t === "==" || t === "!=") {
            this.next();
            const right = this.parseAdd();
            return { kind: "bin", op: t, left, right };
        }
        return left;
    }

    private parseAdd(): Node {
        let left = this.parseMul();
        while (this.peek().type === "+" || this.peek().type === "-") {
            const op = this.next().type as "+" | "-";
            const right = this.parseMul();
            left = { kind: "bin", op, left, right };
        }
        return left;
    }

    private parseMul(): Node {
        let left = this.parseUnary();
        while (this.peek().type === "*" || this.peek().type === "/") {
            const op = this.next().type as "*" | "/";
            const right = this.parseUnary();
            left = { kind: "bin", op, left, right };
        }
        return left;
    }

    private parseUnary(): Node {
        if (this.peek().type === "-") {
            this.next();
            return { kind: "unary", op: "-", expr: this.parseUnary() };
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Node {
        const t = this.peek();

        if (t.type === "number") {
            this.next();
            return { kind: "num", value: parseFloat(t.value!) };
        }

        if (t.type === "string") {
            this.next();
            return { kind: "str", value: t.value! };
        }

        if (t.type === "bracketIdent") {
            this.next();
            this.referencedColumns.push(t.value!);
            return { kind: "col", name: t.value! };
        }

        if (t.type === "(") {
            this.next();
            const inner = this.parseOr();
            this.expect(")");
            return inner;
        }

        if (t.type === "IF") {
            this.next();
            this.expect("(");
            const cond = this.parseOr();
            this.expect(",");
            const thenExpr = this.parseOr();
            this.expect(",");
            const elseExpr = this.parseOr();
            this.expect(")");
            return { kind: "if", cond, thenExpr, elseExpr };
        }

        if (t.type === "AGG") {
            const fn = t.value as "AVG" | "SUM" | "MIN" | "MAX";
            this.next();
            this.expect("(");
            const colTok = this.peek();
            let columnName: string;
            if (colTok.type === "bracketIdent" || colTok.type === "ident") {
                columnName = colTok.value!;
                this.next();
            } else {
                throw new ParseError(`${fn}( ) expects a column name, e.g. ${fn}(Revenue) or ${fn}([Net Revenue]).`);
            }
            this.expect(")");
            this.referencedColumns.push(columnName);
            return { kind: "agg", fn, column: columnName };
        }

        if (t.type === "ident") {
            this.next();
            this.referencedColumns.push(t.value!);
            return { kind: "col", name: t.value! };
        }

        throw new ParseError(`Check your formula — unexpected "${t.text || "end of formula"}".`);
    }
}

/** Parses and validates a formula string. Never throws — reports errors via the result object. */
export function parseCalcFormula(formula: string): ICalcParseResult {
    const trimmed = formula.trim();
    if (trimmed.length === 0) {
        return { ok: false, error: "Enter a formula, e.g. Revenue - Cost", referencedColumns: [] };
    }

    const { tokens, error: tokenError } = tokenize(trimmed);
    if (tokenError) {
        return { ok: false, error: `Check your formula — ${tokenError}`, referencedColumns: [] };
    }

    try {
        const parser = new Parser(tokens);
        const ast = parser.parseExpression();
        return { ok: true, referencedColumns: Array.from(new Set(parser.referencedColumns)), ast };
    } catch (e) {
        const message = e instanceof ParseError ? e.message : "Could not understand this formula.";
        return { ok: false, error: `Check your formula — ${message} Example: Revenue - Cost`, referencedColumns: [] };
    }
}

// -----------------------------------------------------------------
// Evaluator
// -----------------------------------------------------------------

function toNumber(v: CalcValue): number {
    if (v === null || v === undefined) {
        return 0;
    }
    if (typeof v === "number") {
        return v;
    }
    if (typeof v === "boolean") {
        return v ? 1 : 0;
    }
    const parsed = parseFloat(v);
    return isNaN(parsed) ? 0 : parsed;
}

function toBool(v: CalcValue): boolean {
    if (typeof v === "boolean") {
        return v;
    }
    if (typeof v === "number") {
        return v !== 0;
    }
    return !!v;
}

function evalNode(node: Node, ctx: ICalcRowContext, agg: ICalcAggregates): CalcValue {
    switch (node.kind) {
        case "num":
            return node.value;
        case "str":
            return node.value;
        case "col": {
            const raw = ctx.getColumnValue(node.name);
            if (raw === null || raw === undefined) {
                return null;
            }
            if (raw instanceof Date) {
                return raw.getTime();
            }
            return raw as number | string | boolean;
        }
        case "agg":
            return agg.getAggregate(node.fn, node.column) ?? 0;
        case "unary":
            return -toNumber(evalNode(node.expr, ctx, agg));
        case "if":
            return toBool(evalNode(node.cond, ctx, agg))
                ? evalNode(node.thenExpr, ctx, agg)
                : evalNode(node.elseExpr, ctx, agg);
        case "bin": {
            const op = node.op;
            if (op === "AND") {
                return toBool(evalNode(node.left, ctx, agg)) && toBool(evalNode(node.right, ctx, agg));
            }
            if (op === "OR") {
                return toBool(evalNode(node.left, ctx, agg)) || toBool(evalNode(node.right, ctx, agg));
            }
            const l = evalNode(node.left, ctx, agg);
            const r = evalNode(node.right, ctx, agg);
            switch (op) {
                case "+": return toNumber(l) + toNumber(r);
                case "-": return toNumber(l) - toNumber(r);
                case "*": return toNumber(l) * toNumber(r);
                case "/": {
                    const denom = toNumber(r);
                    return denom === 0 ? null : toNumber(l) / denom;
                }
                case ">": return toNumber(l) > toNumber(r);
                case "<": return toNumber(l) < toNumber(r);
                case ">=": return toNumber(l) >= toNumber(r);
                case "<=": return toNumber(l) <= toNumber(r);
                case "==": return String(l) === String(r);
                case "!=": return String(l) !== String(r);
            }
        }
    }
    return null;
}

/** Evaluates a previously-parsed AST for one row. Never throws — returns null on any runtime issue. */
export function evaluateCalc(ast: Node, ctx: ICalcRowContext, agg: ICalcAggregates): CalcValue {
    try {
        return evalNode(ast, ctx, agg);
    } catch {
        return null;
    }
}
