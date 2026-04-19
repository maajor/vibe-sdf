import { parse } from '@babel/parser';
import type {
  Node,
  FunctionDeclaration,
  Identifier,
  File,
} from '@babel/types';

// GLSL reserved words that cannot be used as variable names
const GLSL_RESERVED = new Set([
  'external', 'in', 'out', 'inout', 'uniform', 'varying', 'attribute',
  'const', 'if', 'else', 'for', 'while', 'do', 'break', 'continue',
  'return', 'discard', 'struct', 'void', 'bool', 'int', 'float',
  'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'sampler2D',
  'highp', 'mediump', 'lowp', 'precision', 'layout', 'flat',
  'smooth', 'noperspective', 'centroid', 'patch', 'sample',
  'subroutine', 'coherent', 'volatile', 'restrict', 'readonly',
  'writeonly', 'invariant', 'precise', 'shared', 'buffer',
  'image', 'atomic_uint', 'layout',
]);

function sanitizeName(name: string): string {
  if (GLSL_RESERVED.has(name)) return `_${name}_`;
  return name;
}

// ==================== Validation System ====================

interface TranspileError {
  line: number;
  column: number;
  endColumn: number;
  code: string;
  message: string;
  detail: string;
}

interface ValidationResult {
  errors: TranspileError[];
  valid: boolean;
  report: string;
}

const SDF_PRIMITIVE_SIGNATURES: Record<string, {
  requiredArgs: number;
  paramNames: string[];
  paramDescriptions: string;
}> = {
  sphere:      { requiredArgs: 2, paramNames: ['p', 'r'], paramDescriptions: 'p (vec3 position), r (float radius)' },
  box:         { requiredArgs: 2, paramNames: ['p', 'b'], paramDescriptions: 'p (vec3 position), b (vec3 half-size)' },
  roundedBox:  { requiredArgs: 3, paramNames: ['p', 'b', 'r'], paramDescriptions: 'p (vec3 position), b (vec3 half-size), r (float corner radius)' },
  torus:       { requiredArgs: 2, paramNames: ['p', 't'], paramDescriptions: 'p (vec3 position), t (vec2 major radius, tube radius)' },
  capsule:     { requiredArgs: 4, paramNames: ['p', 'a', 'b', 'r'], paramDescriptions: 'p (vec3 position), a (vec3 start endpoint), b (vec3 end endpoint), r (float radius)' },
  cylinder:    { requiredArgs: 3, paramNames: ['p', 'h', 'r'], paramDescriptions: 'p (vec3 position), h (float half-height), r (float radius)' },
  cone:        { requiredArgs: 3, paramNames: ['p', 'h', 'r'], paramDescriptions: 'p (vec3 position), h (float half-height), r (float base radius)' },
  plane:       { requiredArgs: 2, paramNames: ['p', 'n'], paramDescriptions: 'p (vec3 position), n (vec3 normal)' },
};

const CSG_OPS = new Set(['union', 'subtract', 'intersect']);
const TRANSFORMS = new Set(['vec3', 'vec2', 'rotateX', 'rotateY', 'rotateZ']);
const MATH_FNS = new Set([
  'sin', 'cos', 'tan', 'atan', 'atan2', 'sqrt', 'pow', 'abs',
  'min', 'max', 'clamp', 'floor', 'ceil', 'fract', 'mix',
  'step', 'smoothstep', 'mod', 'length', 'dot', 'cross',
  'normalize', 'reflect', 'exp', 'log', 'sign',
]);
const DSL_CONSTANTS = new Set(['PI', 'TAU']);
const ALL_DSL_NAMES = new Set([
  ...Object.keys(SDF_PRIMITIVE_SIGNATURES),
  ...CSG_OPS, ...TRANSFORMS, ...MATH_FNS, ...DSL_CONSTANTS,
]);

const UNSUPPORTED_NODE_TYPES = new Set([
  'ArrowFunctionExpression', 'FunctionExpression', 'ClassExpression',
  'TemplateLiteral', 'TaggedTemplateExpression',
  'TryStatement', 'CatchClause',
  'SwitchStatement', 'SwitchCase',
  'DoWhileStatement', 'ForInStatement', 'ForOfStatement',
  'SpreadElement', 'RestElement',
  'AwaitExpression', 'YieldExpression',
  'NewExpression', 'ThrowStatement',
]);

function formatError(err: TranspileError, sourceLines: string[]): string {
  const sourceLine = sourceLines[err.line - 1] ?? '';
  const prefix = `Line ${err.line}: `;
  const underlineLen = Math.max(1, err.endColumn - err.column);
  const caret = ' '.repeat(prefix.length + err.column) + '^'.repeat(underlineLen);
  return `${prefix}${sourceLine}\n${caret}\n${err.message}\n${err.detail}`;
}

function getNodeLoc(node: Node): { line: number; column: number; endColumn: number } {
  if (node.loc) {
    return {
      line: node.loc.start.line,
      column: node.loc.start.column,
      endColumn: node.loc.end.column,
    };
  }
  return { line: 1, column: 0, endColumn: 0 };
}

function countPositionalArgs(args: Node[]): number {
  return args.filter(a => a.type !== 'ObjectExpression').length;
}

function validateNode(
  node: Node,
  scope: Map<string, string>,
  userFns: Set<string>,
  sourceLines: string[],
  errors: TranspileError[],
): void {
  if (!node) return;

  // Check for unsupported syntax
  if (UNSUPPORTED_NODE_TYPES.has(node.type)) {
    const loc = getNodeLoc(node);
    errors.push({
      ...loc,
      code: 'syntax.unsupported',
      message: `${node.type} is not supported in the SDF DSL.`,
      detail: 'Only simple variable declarations (const/let), if/else, for/while loops, and the SDF API functions are supported.',
    });
  }

  switch (node.type) {
    case 'CallExpression': {
      const callee = node.callee;

      if (callee.type === 'Identifier') {
        const fn = callee.name;
        const loc = getNodeLoc(callee);
        const positionalCount = countPositionalArgs(node.arguments);

        // Check 1: SDF primitive arg count
        const sig = SDF_PRIMITIVE_SIGNATURES[fn];
        if (sig && positionalCount !== sig.requiredArgs) {
          const err: TranspileError = {
            ...loc,
            code: 'sdf.wrong-arg-count',
            message: `${fn}() expects ${sig.requiredArgs} positional arguments (${sig.paramNames.join(', ')}) but got ${positionalCount}.`,
            detail: `Expected signature: ${fn}(${sig.paramDescriptions}, opts?)`,
          };
          if (fn === 'capsule') {
            err.detail += '\nThe most common mistake is passing only 3 args: capsule(p, a, r) — you need capsule(p, a, b, r) with separate start and end endpoints.';
          }
          errors.push(err);
        }

        // Check 2: CSG operation arg count
        if (CSG_OPS.has(fn)) {
          if (positionalCount < 2 || positionalCount > 3) {
            errors.push({
              ...loc,
              code: 'csg.wrong-arg-count',
              message: `${fn}() expects 2 or 3 arguments (a, b, k?) but got ${positionalCount}.`,
              detail: 'CSG operations take two SdfResult values and an optional float blend factor k.',
            });
          } else {
            // Check 3/4: CSG type mismatch
            const positionalArgs = node.arguments.filter(a => a.type !== 'ObjectExpression');
            let hasAtLeastOneSdf = false;
            for (let i = 0; i < Math.min(2, positionalArgs.length); i++) {
              const argType = inferType(positionalArgs[i], scope);
              if (argType === 'SdfResult') {
                hasAtLeastOneSdf = true;
              } else {
                // Only flag if this arg looks like it should be SdfResult (not the blend k)
                if (i < 2) {
                  errors.push({
                    ...getNodeLoc(positionalArgs[i]),
                    code: 'csg.type-mismatch',
                    message: `${fn}() argument ${i + 1} should be an SDF shape or CSG result, but appears to be ${argType}.`,
                    detail: 'Arguments to CSG operations must be SDF shapes (e.g., sphere(), box()) or other CSG operations (e.g., union()).',
                  });
                }
              }
            }
            if (!hasAtLeastOneSdf && positionalCount >= 2) {
              // Replace individual type-mismatch errors with a single no-sdf-input error
              // Remove the individual mismatch errors we just added
              errors.splice(errors.length - 2, 2);
              errors.push({
                ...loc,
                code: 'csg.no-sdf-input',
                message: `${fn}() has no SDF shape inputs. Both arguments appear to be non-SDF values.`,
                detail: 'CSG operations need at least one SDF primitive result. For example: union(sphere(p, 1.0), box(p, vec3(1,1,1))).',
              });
            }
          }
        }

        // Check 7: Unknown function
        if (!ALL_DSL_NAMES.has(fn) && !userFns.has(fn)) {
          errors.push({
            ...loc,
            code: 'call.unknown-function',
            message: `Unknown function '${fn}()'. This function is not part of the SDF DSL.`,
            detail: 'Available functions: sphere, box, roundedBox, torus, capsule, cylinder, cone, plane, union, subtract, intersect, vec3, vec2, rotateX, rotateY, rotateZ, plus math functions.',
          });
        }
      }

      // Check Math.* calls
      if (callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Math') {
        const prop = (callee.property as Identifier).name;
        if (!MATH_FNS.has(prop) && prop !== 'PI') {
          const loc = getNodeLoc(callee);
          errors.push({
            ...loc,
            code: 'call.unknown-function',
            message: `Unknown Math method 'Math.${prop}()'.`,
            detail: `Available Math methods: ${[...MATH_FNS].join(', ')}.`,
          });
        }
      }

      // Recurse into arguments
      for (const arg of node.arguments) {
        validateNode(arg, scope, userFns, sourceLines, errors);
      }
      // Recurse into callee if it's a member expression
      if (callee.type === 'MemberExpression') {
        validateNode(callee.object, scope, userFns, sourceLines, errors);
      }
      break;
    }

    case 'Identifier': {
      // Check 5: Undeclared variable
      const name = node.name;
      const sanitizedName = sanitizeName(name);
      if (!ALL_DSL_NAMES.has(name) &&
          !userFns.has(name) &&
          name !== 'Math' &&
          !scope.has(sanitizedName)) {
        const loc = getNodeLoc(node);
        errors.push({
          ...loc,
          code: 'scope.undeclared',
          message: `Variable '${name}' is used but never declared.`,
          detail: `Define it with 'const ${name} = ...' before using it, or check for typos.`,
        });
      }
      break;
    }

    case 'VariableDeclaration': {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') {
          const name = sanitizeName(decl.id.name);
          if (decl.init) {
            const glslType = inferType(decl.init, scope);
            scope.set(name, glslType);
            validateNode(decl.init, scope, userFns, sourceLines, errors);
          } else {
            scope.set(name, 'float');
          }
        }
      }
      break;
    }

    case 'ReturnStatement': {
      if (node.argument) {
        validateNode(node.argument, scope, userFns, sourceLines, errors);
      }
      break;
    }

    case 'ExpressionStatement': {
      validateNode(node.expression, scope, userFns, sourceLines, errors);
      break;
    }

    case 'BinaryExpression':
    case 'LogicalExpression': {
      validateNode(node.left, scope, userFns, sourceLines, errors);
      validateNode(node.right, scope, userFns, sourceLines, errors);
      break;
    }

    case 'UnaryExpression': {
      validateNode(node.argument, scope, userFns, sourceLines, errors);
      break;
    }

    case 'ConditionalExpression': {
      validateNode(node.test, scope, userFns, sourceLines, errors);
      validateNode(node.consequent, scope, userFns, sourceLines, errors);
      validateNode(node.alternate, scope, userFns, sourceLines, errors);
      break;
    }

    case 'AssignmentExpression': {
      validateNode(node.left, scope, userFns, sourceLines, errors);
      validateNode(node.right, scope, userFns, sourceLines, errors);
      break;
    }

    case 'UpdateExpression': {
      validateNode(node.argument, scope, userFns, sourceLines, errors);
      break;
    }

    case 'ArrayExpression': {
      for (const el of node.elements) {
        if (el) validateNode(el, scope, userFns, sourceLines, errors);
      }
      break;
    }

    case 'MemberExpression': {
      validateNode(node.object, scope, userFns, sourceLines, errors);
      if (node.computed && node.property) {
        validateNode(node.property, scope, userFns, sourceLines, errors);
      }
      break;
    }

    case 'FunctionDeclaration': {
      const fnScope = new Map(scope);
      if (node.params) {
        for (const param of node.params) {
          if (param.type === 'Identifier') {
            const pName = sanitizeName(param.name);
            fnScope.set(pName, pName === 'p' ? 'vec3' : 'float');
          }
        }
      }
      if (node.body && node.body.body) {
        for (const stmt of (node.body as { body: Node[] }).body) {
          validateNode(stmt, fnScope, userFns, sourceLines, errors);
        }
      }
      break;
    }

    case 'IfStatement': {
      validateNode(node.test, scope, userFns, sourceLines, errors);
      if (node.consequent) {
        const block = node.consequent;
        if (block.type === 'BlockStatement' && block.body) {
          const childScope = new Map(scope);
          for (const stmt of (block as { body: Node[] }).body) {
            validateNode(stmt, childScope, userFns, sourceLines, errors);
          }
        } else {
          validateNode(block, scope, userFns, sourceLines, errors);
        }
      }
      if (node.alternate) {
        if (node.alternate.type === 'IfStatement') {
          validateNode(node.alternate, scope, userFns, sourceLines, errors);
        } else if (node.alternate.type === 'BlockStatement' && node.alternate.body) {
          const childScope = new Map(scope);
          for (const stmt of (node.alternate as { body: Node[] }).body) {
            validateNode(stmt, childScope, userFns, sourceLines, errors);
          }
        } else {
          validateNode(node.alternate, scope, userFns, sourceLines, errors);
        }
      }
      break;
    }

    case 'ForStatement': {
      const forScope = new Map(scope);
      if (node.init) validateNode(node.init, forScope, userFns, sourceLines, errors);
      if (node.test) validateNode(node.test, forScope, userFns, sourceLines, errors);
      if (node.update) validateNode(node.update, forScope, userFns, sourceLines, errors);
      if (node.body) {
        if (node.body.type === 'BlockStatement' && node.body.body) {
          for (const stmt of (node.body as { body: Node[] }).body) {
            validateNode(stmt, forScope, userFns, sourceLines, errors);
          }
        } else {
          validateNode(node.body, forScope, userFns, sourceLines, errors);
        }
      }
      break;
    }

    case 'WhileStatement': {
      const whileScope = new Map(scope);
      if (node.test) validateNode(node.test, whileScope, userFns, sourceLines, errors);
      if (node.body) {
        if (node.body.type === 'BlockStatement' && node.body.body) {
          for (const stmt of (node.body as { body: Node[] }).body) {
            validateNode(stmt, whileScope, userFns, sourceLines, errors);
          }
        } else {
          validateNode(node.body, whileScope, userFns, sourceLines, errors);
        }
      }
      break;
    }

    case 'BlockStatement': {
      const childScope = new Map(scope);
      if (node.body) {
        for (const stmt of (node as { body: Node[] }).body) {
          validateNode(stmt, childScope, userFns, sourceLines, errors);
        }
      }
      break;
    }

    case 'NumericLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      // Leaf nodes, nothing to validate
      break;

    default:
      // Unknown node types - let them pass through
      break;
  }
}

function validateFromAst(ast: File, source: string): ValidationResult {
  const sourceLines = source.split('\n');
  const errors: TranspileError[] = [];
  const userFns = new Set<string>();
  const globalScope = new Map<string, string>();

  // First pass: collect top-level function names
  for (const node of ast.program.body) {
    if (node.type === 'FunctionDeclaration' && node.id) {
      userFns.add(node.id.name);
    }
  }

  // Second pass: walk and validate all top-level nodes
  for (const node of ast.program.body) {
    validateNode(node, globalScope, userFns, sourceLines, errors);
  }

  // Check for missing map function
  if (!userFns.has('map')) {
    errors.push({
      line: 1, column: 0, endColumn: 0,
      code: 'missing.map-function',
      message: 'No map() function found.',
      detail: 'Define a function called "map" that takes a vec3 parameter p and returns an SDF result.',
    });
  }

  const report = errors.map(e => formatError(e, sourceLines)).join('\n\n');
  return { errors, valid: errors.length === 0, report };
}

// ==================== End Validation System ====================

// Material color tracking
let materialCounter = 0;
let materialColors: Map<number, [number, number, number]>;

// Const array value tracking (for resolving variable refs in opts like { color: stone })
let constArrays: Map<string, number[]>;

interface TranspileResult {
  glslMapFunction: string;
  materialColorTable: string;
  error?: string;
}

function emitVec3(args: string[]): string {
  while (args.length < 3) args.push('0.0');
  return `vec3(${args.join(', ')})`;
}

function emitVec2(args: string[]): string {
  return `vec2(${args.join(', ')})`;
}

function transpileExpression(node: Node, scopeVars: Map<string, string>): string {
  if (!node) return '0.0';

  switch (node.type) {
    case 'NumericLiteral':
      return Number.isInteger(node.value) ? `${node.value}.0` : `${node.value}`;

    case 'Identifier': {
      const name = sanitizeName(node.name);
      // Math constants
      if (name === 'PI') return '3.14159265359';
      if (name === 'TAU') return '6.28318530718';
      // Scope variable lookup
      if (scopeVars.has(name)) return name;
      return name;
    }

    case 'CallExpression': {
      const callee = node.callee;
      const args = node.arguments
        .filter((a: Node) => a.type !== 'ObjectExpression')
        .map((a: Node) => transpileExpression(a, scopeVars));

      if (callee.type === 'Identifier') {
        const fn = callee.name;

        // Primitives - return SdfResult
        if (fn === 'sphere') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 2, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          const hasRotation = opts.rotation !== null;
          let pExpr = args[0];
          if (hasRotation) {
            pExpr = applyRotation(pExpr, opts.rotation!);
          }
          return `sdSphere(${pExpr}, ${args[1]}, ${matId}.0)`;
        }
        if (fn === 'box') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 2, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          let pExpr = args[0];
          if (opts.rotation) pExpr = applyRotation(pExpr, opts.rotation);
          return `sdBox(${pExpr}, ${args[1]}, ${matId}.0)`;
        }
        if (fn === 'roundedBox') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 3, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          let pExpr = args[0];
          if (opts.rotation) pExpr = applyRotation(pExpr, opts.rotation);
          return `sdRoundedBox(${pExpr}, ${args[1]}, ${args[2]}, ${matId}.0)`;
        }
        if (fn === 'torus') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 2, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          let pExpr = args[0];
          if (opts.rotation) pExpr = applyRotation(pExpr, opts.rotation);
          return `sdTorus(${pExpr}, ${args[1]}, ${matId}.0)`;
        }
        if (fn === 'capsule') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 4, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          let pExpr = args[0];
          if (opts.rotation) pExpr = applyRotation(pExpr, opts.rotation);
          return `sdCapsule(${pExpr}, ${args[1]}, ${args[2]}, ${args[3]}, ${matId}.0)`;
        }
        if (fn === 'cylinder') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 3, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          let pExpr = args[0];
          if (opts.rotation) pExpr = applyRotation(pExpr, opts.rotation);
          return `sdCylinder(${pExpr}, ${args[1]}, ${args[2]}, ${matId}.0)`;
        }
        if (fn === 'cone') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 3, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          let pExpr = args[0];
          if (opts.rotation) pExpr = applyRotation(pExpr, opts.rotation);
          return `sdCone(${pExpr}, ${args[1]}, ${args[2]}, ${matId}.0)`;
        }
        if (fn === 'plane') {
          const matId = materialCounter++;
          const opts = extractOpts(node.arguments, 2, scopeVars);
          if (opts.color) materialColors.set(matId, opts.color);
          let pExpr = args[0];
          if (opts.rotation) pExpr = applyRotation(pExpr, opts.rotation);
          return `sdPlane(${pExpr}, ${args[1]}, ${matId}.0)`;
        }

        // CSG operations
        if (fn === 'union') {
          if (args.length >= 3) {
            return `opSmoothUnion(${args[0]}, ${args[1]}, ${args[2]})`;
          }
          return `opUnion(${args[0]}, ${args[1]})`;
        }
        if (fn === 'subtract') {
          if (args.length >= 3) {
            return `opSmoothSubtract(${args[0]}, ${args[1]}, ${args[2]})`;
          }
          return `opSubtract(${args[0]}, ${args[1]})`;
        }
        if (fn === 'intersect') {
          if (args.length >= 3) {
            return `opSmoothIntersect(${args[0]}, ${args[1]}, ${args[2]})`;
          }
          return `opIntersect(${args[0]}, ${args[1]})`;
        }

        // Spatial transforms
        if (fn === 'vec3') return emitVec3(args);
        if (fn === 'vec2') return emitVec2(args);
        if (fn === 'rotateX') return `opRotateX(${args[0]}, ${args[1]})`;
        if (fn === 'rotateY') return `opRotateY(${args[0]}, ${args[1]})`;
        if (fn === 'rotateZ') return `opRotateZ(${args[0]}, ${args[1]})`;

        // Math functions - direct mapping
        const mathFns = ['sin', 'cos', 'tan', 'atan', 'atan2', 'sqrt', 'pow', 'abs',
                         'min', 'max', 'clamp', 'floor', 'ceil', 'fract', 'mix',
                         'step', 'smoothstep', 'mod', 'length', 'dot', 'cross',
                         'normalize', 'reflect', 'exp', 'log', 'sign'];
        if (mathFns.includes(fn)) return `${fn}(${args.join(', ')})`;

        // User-defined function call - sanitize the name to match the sanitized definition
        const safeFn = sanitizeName(fn);
        return `${safeFn}(${args.join(', ')})`;
      }

      if (callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Math') {
        const prop = (callee.property as Identifier).name;
        const mathFns = ['sin', 'cos', 'tan', 'atan', 'atan2', 'sqrt', 'pow', 'abs',
                         'min', 'max', 'clamp', 'floor', 'ceil', 'exp', 'log', 'sign'];
        if (mathFns.includes(prop)) return `${prop}(${args.join(', ')})`;
        if (prop === 'PI') return '3.14159265359';
        return `${prop}(${args.join(', ')})`;
      }

      return `${transpileExpression(callee, scopeVars)}(${args.join(', ')})`;
    }

    case 'BinaryExpression': {
      const left = transpileExpression(node.left, scopeVars);
      const right = transpileExpression(node.right, scopeVars);
      let op = node.operator;
      // JS === -> GLSL ==
      if (op === '===') op = '==';
      if (op === '!==') op = '!=';
      return `(${left} ${op} ${right})`;
    }

    case 'UnaryExpression': {
      const arg = transpileExpression(node.argument, scopeVars);
      if (node.operator === '!') return `(!${arg})`;
      return `(${node.operator}${arg})`;
    }

    case 'LogicalExpression': {
      const left = transpileExpression(node.left, scopeVars);
      const right = transpileExpression(node.right, scopeVars);
      if (node.operator === '&&') return `(${left} && ${right})`;
      if (node.operator === '||') return `(${left} || ${right})`;
      return `(${left} ${node.operator} ${right})`;
    }

    case 'ConditionalExpression': {
      const test = transpileExpression(node.test, scopeVars);
      const cons = transpileExpression(node.consequent, scopeVars);
      const alt = transpileExpression(node.alternate, scopeVars);
      return `(${test} ? ${cons} : ${alt})`;
    }

    case 'AssignmentExpression': {
      const left = transpileExpression(node.left, scopeVars);
      const right = transpileExpression(node.right, scopeVars);
      return `${left} ${node.operator} ${right}`;
    }

    case 'UpdateExpression': {
      const arg = transpileExpression(node.argument, scopeVars);
      if (node.prefix) return `${node.operator}${arg}`;
      return `${arg}${node.operator}`;
    }

    case 'SequenceExpression': {
      return node.expressions.map((e: Node) => transpileExpression(e, scopeVars)).join(', ');
    }

    case 'ArrayExpression': {
      const elements = (node.elements as Node[]).filter((e) => e !== null).map((e) => transpileExpression(e, scopeVars));
      if (elements.length === 3) return emitVec3(elements);
      if (elements.length === 2) return emitVec2(elements);
      return `float[${elements.length}](${elements.join(', ')})`;
    }

    case 'MemberExpression': {
      const obj = transpileExpression(node.object, scopeVars);
      const prop = (node.property as Identifier).name;
      // Swizzle: p.x, p.y, p.z for vec3 access
      if (node.computed) {
        return `${obj}[${transpileExpression(node.property, scopeVars)}]`;
      }
      return `${obj}.${prop}`;
    }

    default:
      console.warn(`[transpiler] Unsupported expression type: ${node.type}`);
      return `0.0 /* unsupported expression: ${node.type} */`;
  }
}

function tryExtractNumericArray(node: Node): number[] | null {
  if (node.type !== 'ArrayExpression') return null;
  const vals: number[] = [];
  for (const el of (node as { elements: (Node | null)[] }).elements) {
    if (!el || el.type !== 'NumericLiteral') return null;
    vals.push((el as { type: 'NumericLiteral'; value: number }).value);
  }
  return vals.length > 0 ? vals : null;
}

function extractOpts(args: Node[], requiredCount: number, scopeVars: Map<string, string>): {
  color: [number, number, number] | null;
  rotation: [number, number, number] | null;
} {
  const result: { color: [number, number, number] | null; rotation: [number, number, number] | null } = {
    color: null,
    rotation: null,
  };

  if (args.length > requiredCount) {
    const optsArg = args[requiredCount];
    if (optsArg && optsArg.type === 'ObjectExpression') {
      for (const prop of optsArg.properties) {
        if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') {
          // Resolve color: inline array or variable reference
          if (prop.key.name === 'color') {
            const vals = resolveNumericArray(prop.value);
            if (vals && vals.length === 3) {
              result.color = vals as [number, number, number];
            }
          }
          // Resolve rotation: inline array or variable reference
          if (prop.key.name === 'rotation') {
            const vals = resolveNumericArray(prop.value);
            if (vals && vals.length === 3) {
              result.rotation = vals as [number, number, number];
            }
          }
        }
      }
    }
  }

  return result;
}

function resolveNumericArray(node: Node): number[] | null {
  // Direct array literal
  if (node.type === 'ArrayExpression') {
    return tryExtractNumericArray(node);
  }
  // Variable reference — look up tracked const arrays
  if (node.type === 'Identifier') {
    const name = sanitizeName(node.name);
    const vals = constArrays.get(name);
    if (vals) return vals;
  }
  return null;
}

function applyRotation(pExpr: string, rotation: [number, number, number]): string {
  let p = pExpr;
  if (rotation[0] !== 0) p = `opRotateX(${p}, ${radians(rotation[0])})`;
  if (rotation[1] !== 0) p = `opRotateY(${p}, ${radians(rotation[1])})`;
  if (rotation[2] !== 0) p = `opRotateZ(${p}, ${radians(rotation[2])})`;
  return p;
}

function radians(deg: number): string {
  const d = Number.isInteger(deg) ? `${deg}.0` : `${deg}`;
  return `(${d} * 3.14159265359 / 180.0)`;
}

function transpileStatement(node: Node, scopeVars: Map<string, string>, indent: string): string {
  switch (node.type) {
    case 'VariableDeclaration': {
      const lines: string[] = [];
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') {
          const name = sanitizeName(decl.id.name);
          if (decl.init) {
            // Track const array literal values for opts variable resolution
            if (decl.init.type === 'ArrayExpression') {
              const vals = tryExtractNumericArray(decl.init);
              if (vals) constArrays.set(name, vals);
            }
            const expr = transpileExpression(decl.init, scopeVars);
            // Detect type from the expression
            const glslType = inferType(decl.init, scopeVars);
            scopeVars.set(name, glslType);
            lines.push(`${indent}${glslType} ${name} = ${expr};`);
          } else {
            scopeVars.set(name, 'float');
            lines.push(`${indent}float ${name};`);
          }
        }
      }
      return lines.join('\n');
    }

    case 'ReturnStatement': {
      if (!node.argument) return `${indent}return;`;
      const expr = transpileExpression(node.argument, scopeVars);
      // If returning an SdfResult expression, return it directly
      return `${indent}return ${expr};`;
    }

    case 'ExpressionStatement': {
      const expr = transpileExpression(node.expression, scopeVars);
      return `${indent}${expr};`;
    }

    case 'IfStatement': {
      const test = transpileExpression(node.test, scopeVars);
      let result = `${indent}if (${test}) {\n`;
      result += transpileBlock(node.consequent, scopeVars, indent + '  ');
      result += `${indent}}`;
      if (node.alternate) {
        if (node.alternate.type === 'IfStatement') {
          result += ` else ${transpileStatement(node.alternate, scopeVars, indent)}`;
        } else {
          result += ` else {\n`;
          result += transpileBlock(node.alternate, scopeVars, indent + '  ');
          result += `${indent}}`;
        }
      }
      return result;
    }

    case 'ForStatement': {
      const init = node.init ? transpileStatement(node.init, new Map(scopeVars), '') : '';
      const test = node.test ? transpileExpression(node.test, scopeVars) : '';
      const update = node.update ? transpileExpression(node.update, scopeVars) : '';
      let result = `${indent}for (${init} ${test}; ${update}) {\n`;
      result += transpileBlock(node.body, scopeVars, indent + '  ');
      result += `${indent}}`;
      return result;
    }

    case 'WhileStatement': {
      const test = transpileExpression(node.test, scopeVars);
      let result = `${indent}while (${test}) {\n`;
      result += transpileBlock(node.body, scopeVars, indent + '  ');
      result += `${indent}}`;
      return result;
    }

    case 'BlockStatement': {
      return transpileBlock(node, scopeVars, indent);
    }

    default:
      console.warn(`[transpiler] Unsupported statement type: ${node.type}`);
      return `${indent}/* unsupported statement: ${node.type} */`;
  }
}

function transpileBlock(block: Node, scopeVars: Map<string, string>, indent: string): string {
  if (!block || !('body' in block)) return '';
  const childScope = new Map(scopeVars);
  return (block as {body: Node[]}).body.map((stmt: Node) => transpileStatement(stmt, childScope, indent)).join('\n') + '\n';
}

function inferType(node: Node, scopeVars: Map<string, string>): string {
  if (!node) return 'float';

  // Check for SdfResult-returning calls
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    const fn = node.callee.name;
    const sdfPrimitives = ['sphere', 'box', 'roundedBox', 'torus', 'capsule', 'cylinder', 'cone', 'plane'];
    const csgOps = ['union', 'subtract', 'intersect'];
    if (sdfPrimitives.includes(fn) || csgOps.includes(fn)) return 'SdfResult';
    if (fn === 'vec3') return 'vec3';
    if (fn === 'vec2') return 'vec2';
    if (fn === 'rotateX' || fn === 'rotateY' || fn === 'rotateZ') return 'vec3';
    if (fn === 'length') return 'float';
    if (fn === 'dot') return 'float';
    if (fn === 'cross') return 'vec3';
    if (fn === 'normalize') return 'vec3';
    if (fn === 'abs') return 'float';
    if (fn === 'sin' || fn === 'cos' || fn === 'tan' || fn === 'sqrt' || fn === 'pow') return 'float';
    if (fn === 'min' || fn === 'max' || fn === 'clamp' || fn === 'mix') return 'float';
    if (fn === 'smoothstep' || fn === 'step' || fn === 'mod') return 'float';
  }

  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    if ((node.callee.object as Node).type === 'Identifier' && ((node.callee.object as {name: string}).name) === 'Math') return 'float';
  }

  if (node.type === 'NumericLiteral') return 'float';
  if (node.type === 'Identifier') {
    const name = sanitizeName(node.name);
    if (scopeVars.has(name)) return scopeVars.get(name)!;
    return 'float';
  }
  if (node.type === 'BinaryExpression') return 'float';
  if (node.type === 'UnaryExpression') {
    if (node.operator === '-') return inferType(node.argument, scopeVars);
    return 'float';
  }
  if (node.type === 'ArrayExpression') {
    if (node.elements.length === 3) return 'vec3';
    if (node.elements.length === 2) return 'vec2';
  }

  return 'float';
}

function transpileFunction(node: FunctionDeclaration): string {
  const name = sanitizeName(node.id?.name || 'unknown');
  const params = node.params;

  // Build parameter list
  const paramList: string[] = [];
  for (const p of params) {
    if (p.type === 'Identifier') {
      const pName = sanitizeName(p.name);
      if (pName === 'p') {
        paramList.push('vec3 p');
      } else {
        paramList.push(`float ${pName}`);
      }
    }
  }

  const scopeVars = new Map<string, string>();
  scopeVars.set('p', 'vec3');

  // Transpile body
  const body = transpileBlock(node.body, scopeVars, '  ');

  // The map function returns vec2 (dist, matId)
  // But internally we use SdfResult. We need to convert at return.
  // Actually, we'll make the user's map() function return SdfResult and add a wrapper.
  let glsl = `SdfResult ${name}_impl(${paramList.join(', ')}) {\n`;
  glsl += body;
  glsl += `}\n\n`;

  // Wrapper that returns vec2 for the ray marcher
  glsl += `vec2 ${name}(vec3 p) {\n`;
  glsl += `  SdfResult r = ${name}_impl(p);\n`;
  glsl += `  return vec2(r.dist, r.matId);\n`;
  glsl += `}\n`;

  return glsl;
}

function emitFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function buildMaterialColorTable(): string {
  let table = '';
  for (const [id, color] of materialColors) {
    table += `  if (matId < ${id + 1}.0) return vec3(${emitFloat(color[0])}, ${emitFloat(color[1])}, ${emitFloat(color[2])});\n`;
  }
  if (materialColors.size === 0) {
    table += '  return vec3(1.0);\n';
  }
  return table;
}

// ==================== Pre-parse Syntax Checks ====================

function checkSyntax(source: string): string | null {
  // Track paren balance across the whole source
  let depth = 0;
  const lines = source.split('\n');
  let lastOpenLine = 0;

  for (let i = 0; i < lines.length; i++) {
    for (const c of lines[i]) {
      if (c === '(') {
        if (depth === 0) lastOpenLine = i + 1;
        depth++;
      }
      if (c === ')') depth--;
      // If depth goes negative, we have an unmatched close
      if (depth < 0) {
        return `Line ${i + 1}: ${lines[i]}\nUnexpected ')' with no matching '('. Check that all function calls have matching opening and closing parentheses.`;
      }
    }
  }

  // If depth > 0, we have unmatched opens — show the line where the deepest group started
  if (depth > 0) {
    const line = lines[lastOpenLine - 1] || '';
    return `Line ${lastOpenLine}: ${line}\nUnbalanced parentheses — ${depth} '(' without matching ')'. Check that all function calls have matching opening and closing parentheses.`;
  }

  return null;
}

// ==================== Transpile Entry Point ====================

export function transpile(jsCode: string): TranspileResult {
  materialCounter = 0;
  materialColors = new Map();
  constArrays = new Map();

  // Pre-parse syntax check — catch unbalanced parens etc. before Babel
  const syntaxError = checkSyntax(jsCode);
  if (syntaxError) {
    console.error('[transpiler] Syntax error:', syntaxError);
    return {
      glslMapFunction: '',
      materialColorTable: '',
      error: syntaxError,
    };
  }

  try {
    const ast = parse(jsCode, {
      sourceType: 'module',
      plugins: ['typescript'],
    });

    console.log('[transpiler] AST parsed successfully, top-level nodes:',
      ast.program.body.map((n: Node) => n.type));

    // Validation pass — catch errors before transpilation
    const validation = validateFromAst(ast, jsCode);
    if (!validation.valid) {
      console.error('[transpiler] Validation errors:', validation.report);
      return {
        glslMapFunction: '',
        materialColorTable: '',
        error: validation.report,
      };
    }

    let glslOutput = '';

    // Find all function declarations
    for (const node of ast.program.body) {
      if (node.type === 'FunctionDeclaration') {
        glslOutput += transpileFunction(node) + '\n';
      }
      // Handle variable declarations at top level (helper constants)
      if (node.type === 'VariableDeclaration') {
        const scopeVars = new Map<string, string>();
        glslOutput += transpileStatement(node, scopeVars, '') + '\n';
      }
      // Report unsupported top-level nodes
      if (node.type !== 'FunctionDeclaration' && node.type !== 'VariableDeclaration') {
        console.warn(`[transpiler] Unsupported top-level node type: ${node.type}`);
      }
    }

    if (!glslOutput.includes('vec2 map(vec3 p)')) {
      return {
        glslMapFunction: '',
        materialColorTable: '',
        error: 'No map() function found in the generated code. Define a function called "map" that takes a vec3 parameter p and returns an SDF result.',
      };
    }

    const materialColorTable = buildMaterialColorTable();

    // console.log('[transpiler] Generated GLSL map function:\n' + glslOutput);
    // console.log('[transpiler] Material color table:\n' + materialColorTable);

    return {
      glslMapFunction: glslOutput,
      materialColorTable,
    };
  } catch (e: unknown) {
    console.error('[transpiler] Parse error:', e instanceof Error ? e.message : String(e));
    const msg = e instanceof Error ? e.message : String(e);
    // Extract line/column from Babel error format "(line:col)"
    const locMatch = msg.match(/\((\d+):(\d+)\)/);
    let formatted = `Syntax error: ${msg}`;
    if (locMatch) {
      const line = parseInt(locMatch[1]);
      const col = parseInt(locMatch[2]);
      const sourceLines = jsCode.split('\n');
      if (line >= 1 && line <= sourceLines.length) {
        const sourceLine = sourceLines[line - 1];
        const prefix = `Line ${line}: `;
        const pointer = ' '.repeat(prefix.length + col - 1) + '^';
        formatted = `${prefix}${sourceLine}\n${pointer}\nSyntax error at column ${col}: ${msg.replace(/\s*\(\d+:\d+\)$/, '')}`;
      }
    }
    return {
      glslMapFunction: '',
      materialColorTable: '',
      error: formatted,
    };
  }
}
