import ts from "typescript";
import type { EditEpisode, Evidence, PairRange } from "./types";

interface ImportRecord {
  readonly specifier: string;
  readonly range: PairRange;
}

interface SignatureRecord {
  readonly key: string;
  readonly displayName: string;
  readonly signatures: readonly string[];
  readonly range: PairRange;
}

interface ComplexityRecord {
  readonly key: string;
  readonly displayName: string;
  readonly branchCount: number;
  readonly range: PairRange;
}

interface SubjectIdentity {
  readonly key: string;
  readonly displayName: string;
}

const ANALYZER_SOURCE = "typescript-semantic-analyzer";
const DEFAULT_EXPORT_KEY = "default-export";
const DEFAULT_EXPORT_DISPLAY = "default export";

export class TypeScriptSemanticAnalyzer {
  public analyze(episode: EditEpisode): readonly Evidence[] {
    const previousSource = createSourceFile(episode, episode.previousText);
    const currentSource = createSourceFile(episode, episode.currentText);

    if (hasParseDiagnostics(currentSource)) {
      return [];
    }

    const evidence = [
      ...collectNewDependencyEvidence(previousSource, currentSource),
      ...collectPublicApiChangeEvidence(previousSource, currentSource),
      ...collectComplexityGrowthEvidence(previousSource, currentSource),
    ];

    return evidence.sort(compareEvidence);
  }
}

const createSourceFile = (episode: EditEpisode, text: string): ts.SourceFile =>
  ts.createSourceFile(
    episode.uri,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForLanguageId(episode.languageId),
  );

const scriptKindForLanguageId = (languageId: string): ts.ScriptKind => {
  switch (languageId) {
    case "javascript":
      return ts.ScriptKind.JS;
    case "javascriptreact":
      return ts.ScriptKind.JSX;
    case "typescriptreact":
      return ts.ScriptKind.TSX;
    case "typescript":
    default:
      return ts.ScriptKind.TS;
  }
};

const collectNewDependencyEvidence = (
  previousSource: ts.SourceFile,
  currentSource: ts.SourceFile,
): Evidence[] => {
  const previousImports = collectImportRecords(previousSource);
  const currentImports = collectImportRecords(currentSource);
  const evidence: Evidence[] = [];

  for (const [specifier, record] of currentImports.entries()) {
    if (previousImports.has(specifier)) {
      continue;
    }

    evidence.push({
      id: buildEvidenceId("new-dependency", specifier),
      kind: "new-dependency",
      severity: "warning",
      title: "New dependency introduced",
      detail: `Imported a new module dependency: ${specifier}.`,
      source: ANALYZER_SOURCE,
      confidence: 0.94,
      range: record.range,
      references: [record.specifier],
    });
  }

  return evidence;
};

const collectImportRecords = (sourceFile: ts.SourceFile): ReadonlyMap<string, ImportRecord> => {
  const imports = new Map<string, ImportRecord>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      continue;
    }

    const specifier = moduleSpecifier.text;
    if (imports.has(specifier)) {
      continue;
    }

    imports.set(specifier, {
      specifier,
      range: rangeForNode(sourceFile, moduleSpecifier),
    });
  }

  return imports;
};

const collectPublicApiChangeEvidence = (
  previousSource: ts.SourceFile,
  currentSource: ts.SourceFile,
): Evidence[] => {
  const previousSignatures = collectExportedSignatures(previousSource);
  const currentSignatures = collectExportedSignatures(currentSource);
  const evidence: Evidence[] = [];

  for (const [key, currentSignature] of currentSignatures.entries()) {
    const previousSignature = previousSignatures.get(key);
    if (
      previousSignature === undefined ||
      sameOrderedValues(previousSignature.signatures, currentSignature.signatures)
    ) {
      continue;
    }

    evidence.push({
      id: buildEvidenceId("public-api-change", key),
      kind: "public-api-change",
      severity: "warning",
      title: "Exported API signature changed",
      detail: `Updated the exported signature for ${currentSignature.displayName}.`,
      source: ANALYZER_SOURCE,
      confidence: 0.91,
      range: currentSignature.range,
      references: [currentSignature.displayName],
    });
  }

  for (const [key, previousSignature] of previousSignatures.entries()) {
    if (currentSignatures.has(key)) {
      continue;
    }

    evidence.push({
      id: buildEvidenceId("public-api-change", key),
      kind: "public-api-change",
      severity: "warning",
      title: "Exported API removed",
      detail: `Removed the exported signature for ${previousSignature.displayName}.`,
      source: ANALYZER_SOURCE,
      confidence: 0.94,
      range: zeroWidthRangeAtSourceStart(currentSource),
      references: [previousSignature.displayName],
    });
  }

  return evidence;
};

const collectExportedSignatures = (
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, SignatureRecord> => {
  const signatures = new Map<string, SignatureRecord>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const identity = exportedFunctionIdentity(statement);
      if (identity === undefined) {
        continue;
      }

      appendSignatureRecord(
        signatures,
        `function:${identity.key}`,
        identity.displayName,
        serializeFunctionLikeSignature(statement, sourceFile),
        rangeForNameNode(sourceFile, statement.name, statement),
      );
      continue;
    }

    if (!ts.isClassDeclaration(statement) || !hasExportModifier(statement)) {
      continue;
    }

    const classIdentity = exportedClassIdentity(statement);
    if (classIdentity === undefined) {
      continue;
    }

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || hasNonPublicModifier(member)) {
        continue;
      }

      const methodName = propertyNameText(member.name);
      if (methodName === undefined) {
        continue;
      }

      const staticPrefix = hasModifier(member, ts.SyntaxKind.StaticKeyword) ? "." : "#";
      appendSignatureRecord(
        signatures,
        `method:${classIdentity.key}${staticPrefix}${methodName}`,
        `${classIdentity.displayName}${staticPrefix}${methodName}`,
        serializeFunctionLikeSignature(member, sourceFile),
        rangeForNameNode(sourceFile, member.name, member),
      );
    }
  }

  return signatures;
};

const collectComplexityGrowthEvidence = (
  previousSource: ts.SourceFile,
  currentSource: ts.SourceFile,
): Evidence[] => {
  const previousComplexity = collectComplexityRecords(previousSource);
  const currentComplexity = collectComplexityRecords(currentSource);
  const evidence: Evidence[] = [];

  for (const [key, currentRecord] of currentComplexity.entries()) {
    const previousCount = previousComplexity.get(key)?.branchCount ?? 0;
    const growth = currentRecord.branchCount - previousCount;
    if (currentRecord.branchCount < 6 || growth < 3) {
      continue;
    }

    evidence.push({
      id: buildEvidenceId("complexity-growth", key),
      kind: "complexity-growth",
      severity: "info",
      title: "Complexity increased substantially",
      detail: `${currentRecord.displayName} now has ${currentRecord.branchCount} branches, up from ${previousCount}.`,
      source: ANALYZER_SOURCE,
      confidence: 0.79,
      range: currentRecord.range,
      references: [currentRecord.displayName],
    });
  }

  return evidence;
};

const collectComplexityRecords = (
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ComplexityRecord> => {
  const records = new Map<string, ComplexityRecord>();

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      const identity = functionIdentity(node);
      if (identity !== undefined) {
        records.set(`function:${identity.key}`, {
          key: `function:${identity.key}`,
          displayName: identity.displayName,
          branchCount: countBranches(node),
          range: rangeForNameNode(sourceFile, node.name, node),
        });
      }
    } else if (ts.isMethodDeclaration(node)) {
      const identity = methodIdentity(node);
      if (identity !== undefined) {
        records.set(`method:${identity.key}`, {
          key: `method:${identity.key}`,
          displayName: identity.displayName,
          branchCount: countBranches(node),
          range: rangeForNameNode(sourceFile, node.name, node),
        });
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      const identity = variableFunctionIdentity(node);
      if (
        initializer !== undefined &&
        identity !== undefined &&
        isFunctionExpressionLike(initializer)
      ) {
        records.set(`function:${identity.key}`, {
          key: `function:${identity.key}`,
          displayName: identity.displayName,
          branchCount: countBranches(initializer),
          range: rangeForNameNode(sourceFile, node.name, node),
        });
      }
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);
  return records;
};

const appendSignatureRecord = (
  signatures: Map<string, SignatureRecord>,
  key: string,
  displayName: string,
  signature: string,
  range: PairRange,
): void => {
  const existing = signatures.get(key);
  if (existing === undefined) {
    signatures.set(key, {
      key,
      displayName,
      signatures: [signature],
      range,
    });
    return;
  }

  signatures.set(key, {
    key,
    displayName: existing.displayName,
    signatures: [...existing.signatures, signature],
    range: existing.range,
  });
};

const functionIdentity = (node: ts.FunctionDeclaration): SubjectIdentity | undefined => {
  const name = node.name?.text;
  if (name !== undefined) {
    return qualifyIdentity(enclosingScopeIdentity(node.parent), name, name);
  }

  if (!hasModifier(node, ts.SyntaxKind.DefaultKeyword) || !hasExportModifier(node)) {
    return undefined;
  }

  return qualifyIdentity(
    enclosingScopeIdentity(node.parent),
    DEFAULT_EXPORT_KEY,
    DEFAULT_EXPORT_DISPLAY,
  );
};

const exportedFunctionIdentity = (node: ts.FunctionDeclaration): SubjectIdentity | undefined => {
  const name = node.name?.text;
  if (name !== undefined) {
    return {
      key: name,
      displayName: name,
    };
  }

  if (!hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    return undefined;
  }

  return {
    key: DEFAULT_EXPORT_KEY,
    displayName: DEFAULT_EXPORT_DISPLAY,
  };
};

const classIdentity = (node: ts.ClassDeclaration): SubjectIdentity | undefined => {
  const name = node.name?.text;
  if (name !== undefined) {
    return qualifyIdentity(enclosingScopeIdentity(node.parent), name, name);
  }

  if (!hasModifier(node, ts.SyntaxKind.DefaultKeyword) || !hasExportModifier(node)) {
    return undefined;
  }

  return qualifyIdentity(
    enclosingScopeIdentity(node.parent),
    DEFAULT_EXPORT_KEY,
    DEFAULT_EXPORT_DISPLAY,
  );
};

const exportedClassIdentity = (node: ts.ClassDeclaration): SubjectIdentity | undefined => {
  const name = node.name?.text;
  if (name !== undefined) {
    return {
      key: name,
      displayName: name,
    };
  }

  if (!hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    return undefined;
  }

  return {
    key: DEFAULT_EXPORT_KEY,
    displayName: DEFAULT_EXPORT_DISPLAY,
  };
};

const methodIdentity = (node: ts.MethodDeclaration): SubjectIdentity | undefined => {
  const classDeclaration = node.parent;
  if (!ts.isClassDeclaration(classDeclaration)) {
    return undefined;
  }

  const ownerIdentity = classIdentity(classDeclaration);
  const methodName = propertyNameText(node.name);
  if (ownerIdentity === undefined || methodName === undefined) {
    return undefined;
  }

  const staticPrefix = hasModifier(node, ts.SyntaxKind.StaticKeyword) ? "." : "#";

  return {
    key: `${ownerIdentity.key}${staticPrefix}${methodName}`,
    displayName: `${ownerIdentity.displayName}${staticPrefix}${methodName}`,
  };
};

const variableFunctionIdentity = (node: ts.VariableDeclaration): SubjectIdentity | undefined => {
  if (!ts.isIdentifier(node.name)) {
    return undefined;
  }

  return qualifyIdentity(enclosingScopeIdentity(node.parent), node.name.text, node.name.text);
};

const enclosingScopeIdentity = (node: ts.Node | undefined): SubjectIdentity | undefined => {
  let current = node;

  while (current !== undefined) {
    if (ts.isMethodDeclaration(current)) {
      return methodIdentity(current);
    }

    if (ts.isFunctionDeclaration(current)) {
      return functionIdentity(current);
    }

    if (ts.isClassDeclaration(current)) {
      return classIdentity(current);
    }

    if (ts.isVariableDeclaration(current)) {
      const initializer = current.initializer;
      if (initializer !== undefined && isFunctionExpressionLike(initializer)) {
        return variableFunctionIdentity(current);
      }
    }

    current = current.parent;
  }
};

const qualifyIdentity = (
  parent: SubjectIdentity | undefined,
  key: string,
  displayName: string,
): SubjectIdentity => {
  if (parent === undefined) {
    return { key, displayName };
  }

  return {
    key: `${parent.key}/${key}`,
    displayName: `${parent.displayName}.${displayName}`,
  };
};

const sameOrderedValues = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

const serializeFunctionLikeSignature = (
  declaration: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile,
): string => {
  const modifierText = [
    hasModifier(declaration, ts.SyntaxKind.AsyncKeyword) ? "async" : "",
    hasModifier(declaration, ts.SyntaxKind.StaticKeyword) ? "static" : "",
  ]
    .filter((value) => value.length > 0)
    .join(" ");
  const typeParameters = declaration.typeParameters
    ?.map((parameter) => canonicalizeNodeText(parameter, sourceFile))
    .join(", ");
  const parameters = declaration.parameters
    .map((parameter) => serializeParameter(parameter, sourceFile))
    .join(", ");
  const returnType =
    declaration.type === undefined ? "void" : canonicalizeNodeText(declaration.type, sourceFile);

  return [
    modifierText,
    typeParameters === undefined || typeParameters.length === 0 ? "" : `<${typeParameters}>`,
    `(${parameters})`,
    `:${returnType}`,
  ].join(" ");
};

const serializeParameter = (
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
): string => {
  const decorators =
    parameter.modifiers?.map((modifier) => canonicalizeNodeText(modifier, sourceFile)) ?? [];
  const prefix = parameter.dotDotDotToken === undefined ? "" : "...";
  const optional = parameter.questionToken === undefined && parameter.initializer === undefined ? "" : "?";
  const type = parameter.type === undefined ? "unknown" : canonicalizeNodeText(parameter.type, sourceFile);

  return `${decorators.join(" ")}${decorators.length > 0 ? " " : ""}${prefix}${canonicalizeNodeText(
    parameter.name,
    sourceFile,
  )}${optional}: ${type}`;
};

const canonicalizeNodeText = (node: ts.Node, sourceFile: ts.SourceFile): string => {
  const text = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd());
  const scanner = ts.createScanner(
    sourceFile.languageVersion,
    true,
    sourceFile.languageVariant,
    text,
  );
  const tokens: string[] = [];

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push(scanner.getTokenText());
    token = scanner.scan();
  }

  return tokens.join(" ");
};

const countBranches = (root: ts.Node): number => {
  let branchCount = 0;

  const visit = (node: ts.Node): void => {
    if (node !== root && isFunctionLikeContainer(node)) {
      return;
    }

    if (ts.isIfStatement(node)) {
      branchCount += 1;
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      branchCount += 1;
    } else if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      branchCount += 1;
    } else if (ts.isCatchClause(node)) {
      branchCount += 1;
    } else if (ts.isConditionalExpression(node)) {
      branchCount += 1;
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      branchCount += 1;
    }

    node.forEachChild(visit);
  };

  visit(root);
  return branchCount;
};

const isFunctionExpressionLike = (
  node: ts.Node,
): node is ts.FunctionExpression | ts.ArrowFunction =>
  ts.isFunctionExpression(node) || ts.isArrowFunction(node);

const isFunctionLikeContainer = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isConstructorDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isArrowFunction(node);

const propertyNameText = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
};

const hasExportModifier = (node: ts.Node): boolean =>
  hasModifier(node, ts.SyntaxKind.ExportKeyword);

const hasNonPublicModifier = (node: ts.Node): boolean =>
  hasModifier(node, ts.SyntaxKind.PrivateKeyword) ||
  hasModifier(node, ts.SyntaxKind.ProtectedKeyword);

const hasModifier = (node: ts.Node, modifier: ts.SyntaxKind): boolean => {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }

  return ts.getModifiers(node)?.some((item) => item.kind === modifier) ?? false;
};

const rangeForNameNode = (
  sourceFile: ts.SourceFile,
  name: ts.Node | undefined,
  fallbackNode: ts.Node,
): PairRange => rangeForNode(sourceFile, name ?? fallbackNode);

const zeroWidthRangeAtSourceStart = (sourceFile: ts.SourceFile): PairRange => {
  const position = lineAndCharacter(sourceFile, 0);

  return {
    start: position,
    end: position,
  };
};

const rangeForNode = (sourceFile: ts.SourceFile, node: ts.Node): PairRange => ({
  start: lineAndCharacter(sourceFile, node.getStart(sourceFile)),
  end: lineAndCharacter(sourceFile, node.getEnd()),
});

const lineAndCharacter = (
  sourceFile: ts.SourceFile,
  position: number,
): PairRange["start"] => {
  const safePosition = Math.min(Math.max(position, 0), sourceFile.end);
  const lineAndCharacter = sourceFile.getLineAndCharacterOfPosition(safePosition);

  return {
    line: lineAndCharacter.line,
    character: lineAndCharacter.character,
  };
};

const buildEvidenceId = (kind: Evidence["kind"], subject: string): string =>
  `ts-semantic:${kind}:${encodeURIComponent(subject)}`;

const hasParseDiagnostics = (sourceFile: ts.SourceFile): boolean =>
  "parseDiagnostics" in sourceFile &&
  Array.isArray(sourceFile.parseDiagnostics) &&
  sourceFile.parseDiagnostics.length > 0;

const compareEvidence = (left: Evidence, right: Evidence): number => {
  if (left.range.start.line !== right.range.start.line) {
    return left.range.start.line - right.range.start.line;
  }

  if (left.range.start.character !== right.range.start.character) {
    return left.range.start.character - right.range.start.character;
  }

  return left.id.localeCompare(right.id);
};
