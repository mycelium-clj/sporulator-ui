// Minimal EDN parser for manifest bodies.
// Handles the subset of EDN that sporulator manifests use:
// keywords, strings, numbers, maps, vectors, sets, nil, booleans, and fn forms.

type EdnValue =
  | string
  | number
  | boolean
  | null
  | EdnKeyword
  | EdnValue[]
  | Map<string, EdnValue>
  | EdnFn;

class EdnKeyword {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  toString() { return `:${this.name}`; }
}

class EdnFn {
  source: string;
  constructor(source: string) {
    this.source = source;
  }
  toString() { return this.source; }
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",";
}

class EdnReader {
  pos = 0;
  input: string;
  constructor(input: string) {
    this.input = input;
  }

  peek(): string | undefined {
    return this.input[this.pos];
  }

  next(): string {
    return this.input[this.pos++];
  }

  skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (isWhitespace(ch)) {
        this.pos++;
      } else if (ch === ";") {
        // skip line comments
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos++;
      } else {
        break;
      }
    }
  }

  read(): EdnValue {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === undefined) throw new Error("Unexpected end of input");

    if (ch === "{") return this.readMap();
    if (ch === "[") return this.readVector();
    if (ch === "(") return this.readList();
    if (ch === ":") return this.readKeyword();
    if (ch === '"') return this.readString();
    if (ch === "#") return this.readTagged();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.readNumber();
    return this.readSymbol();
  }

  readMap(): Map<string, EdnValue> {
    this.next(); // skip {
    const map = new Map<string, EdnValue>();
    while (true) {
      this.skipWhitespace();
      if (this.peek() === "}") { this.next(); return map; }
      const key = this.read();
      const keyStr = key instanceof EdnKeyword ? key.name : String(key);
      const val = this.read();
      map.set(keyStr, val);
    }
  }

  readVector(): EdnValue[] {
    this.next(); // skip [
    const vec: EdnValue[] = [];
    while (true) {
      this.skipWhitespace();
      if (this.peek() === "]") { this.next(); return vec; }
      vec.push(this.read());
    }
  }

  readList(): EdnValue {
    // Capture the whole form as an EdnFn (for dispatch predicates etc.)
    const start = this.pos;
    this.next(); // skip (
    let depth = 1;
    while (depth > 0 && this.pos < this.input.length) {
      const ch = this.next();
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    return new EdnFn(this.input.slice(start, this.pos));
  }

  readKeyword(): EdnKeyword {
    this.next(); // skip :
    let name = "";
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (isWhitespace(ch) || ch === "}" || ch === "]" || ch === ")" || ch === "{" || ch === "[" || ch === "(") break;
      name += ch;
      this.pos++;
    }
    return new EdnKeyword(name);
  }

  readString(): string {
    this.next(); // skip opening "
    let str = "";
    while (this.pos < this.input.length) {
      const ch = this.next();
      if (ch === '"') return str;
      if (ch === "\\") {
        const esc = this.next();
        if (esc === "n") str += "\n";
        else if (esc === "t") str += "\t";
        else if (esc === "\\") str += "\\";
        else if (esc === '"') str += '"';
        else str += esc;
      } else {
        str += ch;
      }
    }
    return str;
  }

  readNumber(): number {
    let num = "";
    if (this.peek() === "-") num += this.next();
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if ((ch >= "0" && ch <= "9") || ch === ".") {
        num += ch;
        this.pos++;
      } else {
        break;
      }
    }
    return parseFloat(num);
  }

  readTagged(): EdnValue {
    this.next(); // skip #
    const ch = this.peek();
    if (ch === "{") {
      // set literal #{...}
      this.next(); // skip {
      const set: EdnValue[] = [];
      while (true) {
        this.skipWhitespace();
        if (this.peek() === "}") { this.next(); return set; }
        set.push(this.read());
      }
    }
    // skip tag name and read the value
    this.readSymbolStr();
    return this.read();
  }

  readSymbolStr(): string {
    let sym = "";
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (isWhitespace(ch) || ch === "}" || ch === "]" || ch === ")" || ch === "{" || ch === "[" || ch === "(") break;
      sym += ch;
      this.pos++;
    }
    return sym;
  }

  readSymbol(): EdnValue {
    const sym = this.readSymbolStr();
    if (sym === "nil") return null;
    if (sym === "true") return true;
    if (sym === "false") return false;
    return new EdnKeyword(sym); // treat unresolved symbols as keywords
  }
}

export function parseEdn(input: string): EdnValue {
  const reader = new EdnReader(input);
  return reader.read();
}

// Convert parsed EDN to plain JS objects for easier consumption
export function ednToJs(val: EdnValue): unknown {
  if (val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return val;
  }
  if (val instanceof EdnKeyword) {
    return val.name;
  }
  if (val instanceof EdnFn) {
    return val.source;
  }
  if (Array.isArray(val)) {
    return val.map(ednToJs);
  }
  if (val instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of val) {
      obj[k] = ednToJs(v);
    }
    return obj;
  }
  return val;
}

export function parseManifestEdn(body: string): unknown {
  return ednToJs(parseEdn(body));
}

// Extract the first EDN map containing :cells from an LLM response.
// The agent wraps manifest EDN in ```edn or ```clojure fences, or inlines it.
export function extractManifestEdn(text: string): string | null {
  // Try fenced code blocks first
  const fencePattern = /```(?:edn|clojure|clj)?\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = fencePattern.exec(text)) !== null) {
    const block = match[1].trim();
    if (block.startsWith("{") && block.includes(":cells")) {
      return block;
    }
  }

  // Try to find a bare top-level map with :cells
  const mapStart = text.indexOf("{");
  if (mapStart === -1) return null;

  // Walk forward to find the matching closing brace
  let depth = 0;
  for (let i = mapStart; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(mapStart, i + 1);
        if (candidate.includes(":cells")) return candidate;
        break;
      }
    }
  }

  return null;
}
