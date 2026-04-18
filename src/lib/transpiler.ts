import { parse } from '@babel/parser';
import type {
  Node,
  FunctionDeclaration,
  Identifier,
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

// Material color tracking
let materialCounter: number;
let materialColors: Map<number, [number, number, number]>;

interface TranspileResult {
  glslMapFunction: string;
  materialColorTable: string;
  error?: string;
}

function emitVec3(args: string[]): string {
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
      const elements = node.elements.map((e: Node) => transpileExpression(e, scopeVars));
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
          if (prop.key.name === 'color' && prop.value.type === 'ArrayExpression') {
            const vals = prop.value.elements.map((e: Node) => {
              if (e.type === 'NumericLiteral') return (e as {type: 'NumericLiteral'; value: number}).value;
              return parseFloat(transpileExpression(e, scopeVars));
            });
            if (vals.length === 3) {
              result.color = vals as [number, number, number];
            }
          }
          if (prop.key.name === 'rotation' && prop.value.type === 'ArrayExpression') {
            const vals = prop.value.elements.map((e: Node) => {
              if (e.type === 'NumericLiteral') return (e as {type: 'NumericLiteral'; value: number}).value;
              return parseFloat(transpileExpression(e, scopeVars));
            });
            if (vals.length === 3) {
              result.rotation = vals as [number, number, number];
            }
          }
        }
      }
    }
  }

  return result;
}

function applyRotation(pExpr: string, rotation: [number, number, number]): string {
  let p = pExpr;
  if (rotation[0] !== 0) p = `opRotateX(${p}, ${radians(rotation[0])})`;
  if (rotation[1] !== 0) p = `opRotateY(${p}, ${radians(rotation[1])})`;
  if (rotation[2] !== 0) p = `opRotateZ(${p}, ${radians(rotation[2])})`;
  return p;
}

function radians(deg: number): string {
  return `(${deg} * 3.14159265359 / 180.0)`;
}

function transpileStatement(node: Node, scopeVars: Map<string, string>, indent: string): string {
  switch (node.type) {
    case 'VariableDeclaration': {
      const lines: string[] = [];
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') {
          const name = sanitizeName(decl.id.name);
          if (decl.init) {
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
      const test = transpileExpression(node.test, scopeVars);
      const update = transpileExpression(node.update, scopeVars);
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
  if (!block || !block.body) return '';
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
    if (node.callee.object.name === 'Math') return 'float';
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

function buildMaterialColorTable(): string {
  let table = '';
  for (const [id, color] of materialColors) {
    table += `  if (matId < ${id + 1}.0) return vec3(${color[0]}, ${color[1]}, ${color[2]});\n`;
  }
  if (materialColors.size === 0) {
    table += '  return vec3(1.0);\n';
  }
  return table;
}

export function transpile(jsCode: string): TranspileResult {
  materialCounter = 0;
  materialColors = new Map();

  console.log('[transpiler] Input JS code:\n' + jsCode);

  try {
    const ast = parse(jsCode, {
      sourceType: 'module',
      plugins: ['typescript'],
    });

    console.log('[transpiler] AST parsed successfully, top-level nodes:',
      ast.program.body.map((n: Node) => n.type));

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

    console.log('[transpiler] Generated GLSL map function:\n' + glslOutput);
    console.log('[transpiler] Material color table:\n' + materialColorTable);

    return {
      glslMapFunction: glslOutput,
      materialColorTable,
    };
  } catch (e: unknown) {
    console.error('[transpiler] Parse error:', e.message);
    return {
      glslMapFunction: '',
      materialColorTable: '',
      error: `Transpilation error: ${e.message}`,
    };
  }
}
