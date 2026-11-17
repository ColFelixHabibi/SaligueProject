// The crash shoppers actually met on Live ("u is not a function", October 2026): a useEffect that hands React back
// something other than a clean-up function — a Promise from an async helper, `false` from `a && b()`, an element
// from a ref assignment. React keeps it and calls it when the screen closes, and the page dies on the way out.
// TypeScript knows every effect's return type, so this asks it, for every effect in src/, instead of trusting eyes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const ts = createRequire(import.meta.url)('typescript');

test('every useEffect returns nothing or a clean-up function', () => {
  const config = ts.getParsedCommandLineOfConfigFile('tsconfig.json', {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const program = ts.createProgram(config.fileNames.filter((f) => f.includes('/src/')), config.options);
  const checker = program.getTypeChecker();
  const bad = [];
  let effects = 0;
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.includes('/src/') || file.fileName.includes('node_modules')) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node) && /^(React\.)?use(Layout|Insertion)?Effect$/.test(node.expression.getText(file))) {
        const fn = node.arguments[0];
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          effects += 1;
          const returned = checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(fn));
          const parts = returned.isUnion() ? returned.types : [returned];
          const wrong = parts.filter((t) => !(t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) && !t.getCallSignatures().length);
          if (wrong.length) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
            bad.push(`${file.fileName.slice(file.fileName.indexOf('src/'))}:${line + 1} returns ${checker.typeToString(returned)}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.ok(effects > 200, `only ${effects} effects found — the scan is not seeing the screens`);
  assert.deepEqual(bad, [], `These effects give React something it will try to call when the screen closes:\n  ${bad.join('\n  ')}\nWrap the body in braces, or start the call with \`void\`.`);
});
