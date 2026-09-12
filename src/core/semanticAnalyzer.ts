import { createHash } from "node:crypto";
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

interface SemanticSource {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
}

const ANALYZER_SOURCE = "typescript-semantic-analyzer";
const DEFAULT_EXPORT_KEY = "default-export";
const DEFAULT_EXPORT_DISPLAY = "default export";

export type SemanticAnalysisResult =
  | {
      readonly stability: "stable";
      readonly evidence: readonly Evidence[];
    }
  | {
      readonly stability: "unstable";
      readonly evidence: readonly [];
    };

export class TypeScriptSemanticAnalyzer {
  public analyze(episode: EditEpisode): SemanticAnalysisResult {
    const previous = createSemanticSource(episode, episode.previousText);
    const current = createSemanticSource(episode, episode.currentText);

    if (hasParseDiagnostics(current.sourceFile)) {
      return {
        stability: "unstable",
        evidence: [],
      };
    }

    const evidence = [
      ...collectNewDependencyEvidence(previous.sourceFile, current.sourceFile),
      ...collectPublicApiChangeEvidence(previous, current),
      ...collectComplexityGrowthEvidence(
        previous.sourceFile,
        current.sourceFile,
      ),
    ];

    return {
      stability: "stable",
      evidence: evidence.sort(compareEvidence),
    };
  }

  public isStable(
    uri: string,
    languageId: string,
    text: string,
  ): boolean {
    return !hasParseDiagnostics(
      createSourceFile(
        {
          uri,
          languageId,
          previousText: text,
          currentText: text,
          version: 0,
          observedAt: 0,
        },
        text,
      ),
    );
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

const createSemanticSource = (
  episode: EditEpisode,
  text: string,
): SemanticSource => {
  const sourceFile = createSourceFile(episode, text);
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    module: ts.ModuleKind.CommonJS,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) =>
      fileName === sourceFile.fileName || defaultHost.fileExists(fileName),
    getSourceFile: (fileName, languageVersionOrOptions) =>
      fileName === sourceFile.fileName
        ? sourceFile
        : defaultHost.getSourceFile(fileName, languageVersionOrOptions),
    readFile: (fileName) =>
      fileName === sourceFile.fileName
        ? text
        : defaultHost.readFile(fileName),
  };
  const program = ts.createProgram(
    [sourceFile.fileName],
    compilerOptions,
    host,
  );
  return {
    sourceFile,
    checker: program.getTypeChecker(),
  };
};

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
      id: buildEvidenceId("new-dependency", currentSource.fileName, specifier),
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
  previous: SemanticSource,
  current: SemanticSource,
): Evidence[] => {
  const previousSignatures = collectExportedSignatures(previous);
  const currentSignatures = collectExportedSignatures(current);
  const evidence: Evidence[] = [];

  for (const [key, currentSignature] of currentSignatures.entries()) {
    const previousSignature = previousSignatures.get(key);
    if (
      previousSignature !== undefined &&
      sameOrderedValues(previousSignature.signatures, currentSignature.signatures)
    ) {
      continue;
    }

    evidence.push({
      id: buildEvidenceId(
        "public-api-change",
        current.sourceFile.fileName,
        key,
      ),
      kind: "public-api-change",
      severity: "warning",
      title:
        previousSignature === undefined
          ? "Exported API added"
          : "Exported API signature changed",
      detail:
        previousSignature === undefined
          ? `Added the exported signature for ${currentSignature.displayName}.`
          : `Updated the exported signature for ${currentSignature.displayName}.`,
      source: ANALYZER_SOURCE,
      confidence: previousSignature === undefined ? 0.86 : 0.91,
      range: currentSignature.range,
      references: [currentSignature.displayName],
    });
  }

  for (const [key, previousSignature] of previousSignatures.entries()) {
    if (currentSignatures.has(key)) {
      continue;
    }

    evidence.push({
      id: buildEvidenceId(
        "public-api-change",
        current.sourceFile.fileName,
        key,
      ),
      kind: "public-api-change",
      severity: "warning",
      title: "Exported API removed",
      detail: `Removed the exported signature for ${previousSignature.displayName}.`,
      source: ANALYZER_SOURCE,
      confidence: 0.94,
      range: zeroWidthRangeAtSourceStart(current.sourceFile),
      references: [previousSignature.displayName],
    });
  }

  return evidence;
};

const collectExportedSignatures = (
  source: SemanticSource,
): ReadonlyMap<string, SignatureRecord> => {
  const { checker, sourceFile } = source;
  const signatures = new Map<string, SignatureRecord>();
  const functionsByName = new Map<
    string,
    readonly ts.FunctionLikeDeclaration[]
  >();
  const classesByName = new Map<string, ts.ClassDeclaration>();
  const identifiersByName = new Map<string, ts.Identifier>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      identifiersByName.set(statement.name.text, statement.name);
      const existing = functionsByName.get(statement.name.text) ?? [];
      functionsByName.set(statement.name.text, [...existing, statement]);
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      identifiersByName.set(statement.name.text, statement.name);
      classesByName.set(statement.name.text, statement);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        identifiersByName.set(declaration.name.text, declaration.name);
        const initializer = unwrapFunctionExpression(declaration.initializer);
        if (initializer !== undefined) {
          functionsByName.set(declaration.name.text, [initializer]);
        }
      }
    }
  }

  const appendFunction = (
    externalName: string,
    declarations: readonly ts.FunctionLikeDeclaration[],
    rangeNode?: ts.Node,
  ): void => {
    const displayName =
      externalName === "default" ? DEFAULT_EXPORT_DISPLAY : externalName;
    for (const declaration of declarations) {
      appendSignatureRecord(
        signatures,
        `function:${externalName}`,
        displayName,
        serializeFunctionLikeSignature(declaration, sourceFile, checker),
        rangeForNode(
          sourceFile,
          rangeNode ??
            ("name" in declaration && declaration.name !== undefined
              ? declaration.name
              : declaration),
        ),
      );
    }
  };

  const appendClass = (
    externalName: string,
    declaration: ts.ClassLikeDeclarationBase,
    rangeNode?: ts.Node,
  ): void => {
    const displayName =
      externalName === "default" ? DEFAULT_EXPORT_DISPLAY : externalName;
    for (const member of declaration.members) {
      if (!isPublicCallableClassMember(member) || hasNonPublicModifier(member)) {
        continue;
      }

      const memberName =
        ts.isConstructorDeclaration(member)
          ? "constructor"
          : propertyNameText(member.name);
      if (memberName === undefined) {
        continue;
      }
      const staticPrefix = hasModifier(member, ts.SyntaxKind.StaticKeyword)
        ? "."
        : "#";
      const separator = ts.isConstructorDeclaration(member)
        ? "#"
        : staticPrefix;
      appendSignatureRecord(
        signatures,
        `method:${externalName}${separator}${memberName}`,
        `${displayName}${separator}${memberName}`,
        serializeFunctionLikeSignature(member, sourceFile, checker),
        rangeForNode(sourceFile, rangeNode ?? member.name ?? member),
      );
    }
  };

  const appendLocalExport = (
    localName: string,
    externalName: string,
    rangeNode?: ts.Node,
  ): void => {
    const functions = functionsByName.get(localName);
    if (functions !== undefined) {
      appendFunction(externalName, functions, rangeNode);
      return;
    }
    const declaration = classesByName.get(localName);
    if (declaration !== undefined) {
      appendClass(externalName, declaration, rangeNode);
      return;
    }
    const identifier = identifiersByName.get(localName);
    if (identifier === undefined) {
      return;
    }
    const displayName =
      externalName === "default" ? DEFAULT_EXPORT_DISPLAY : externalName;
    for (const signature of checker
      .getTypeAtLocation(identifier)
      .getCallSignatures()) {
      appendSignatureRecord(
        signatures,
        `function:${externalName}`,
        displayName,
        checker.signatureToString(
          signature,
          identifier,
          ts.TypeFormatFlags.NoTruncation |
            ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
          ts.SignatureKind.Call,
        ),
        rangeForNode(sourceFile, rangeNode ?? identifier),
      );
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const externalName = externalDeclarationName(statement);
      if (externalName === undefined) {
        continue;
      }
      appendFunction(externalName, [statement]);
      continue;
    }

    if (ts.isClassDeclaration(statement) && hasExportModifier(statement)) {
      const externalName = externalDeclarationName(statement);
      if (externalName !== undefined) {
        appendClass(externalName, statement);
      }
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          appendLocalExport(
            declaration.name.text,
            declaration.name.text,
            declaration.name,
          );
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        continue;
      }
      for (const element of statement.exportClause.elements) {
        const externalName = element.name.text;
        const localName = element.propertyName?.text ?? externalName;
        if (statement.moduleSpecifier === undefined) {
          appendLocalExport(localName, externalName, element.name);
        } else if (ts.isStringLiteral(statement.moduleSpecifier)) {
          appendSignatureRecord(
            signatures,
            `re-export:${externalName}`,
            externalName === "default"
              ? DEFAULT_EXPORT_DISPLAY
              : externalName,
            `re-export:${statement.moduleSpecifier.text}:${localName}`,
            rangeForNode(sourceFile, element.name),
          );
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      appendExpressionExport(
        statement.expression,
        "default",
        statement.expression,
        appendFunction,
        appendClass,
        appendLocalExport,
      );
      continue;
    }

    if (ts.isExpressionStatement(statement)) {
      collectCommonJsExport(
        statement.expression,
        appendFunction,
        appendClass,
        appendLocalExport,
      );
    }
  }

  return signatures;
};

type AppendFunctionExport = (
  externalName: string,
  declarations: readonly ts.FunctionLikeDeclaration[],
  rangeNode?: ts.Node,
) => void;

type AppendClassExport = (
  externalName: string,
  declaration: ts.ClassLikeDeclarationBase,
  rangeNode?: ts.Node,
) => void;

type AppendLocalExport = (
  localName: string,
  externalName: string,
  rangeNode?: ts.Node,
) => void;

const externalDeclarationName = (
  declaration: ts.FunctionDeclaration | ts.ClassDeclaration,
): string | undefined => {
  if (hasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) {
    return "default";
  }
  return declaration.name?.text;
};

const unwrapFunctionExpression = (
  expression: ts.Expression | undefined,
): ts.FunctionExpression | ts.ArrowFunction | undefined => {
  let current = expression;
  while (
    current !== undefined &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current !== undefined && isFunctionExpressionLike(current)
    ? current
    : undefined;
};

const appendExpressionExport = (
  expression: ts.Expression,
  externalName: string,
  rangeNode: ts.Node,
  appendFunction: AppendFunctionExport,
  appendClass: AppendClassExport,
  appendLocalExport: AppendLocalExport,
): void => {
  const functionExpression = unwrapFunctionExpression(expression);
  if (functionExpression !== undefined) {
    appendFunction(externalName, [functionExpression], rangeNode);
    return;
  }
  if (ts.isClassExpression(expression)) {
    appendClass(externalName, expression, rangeNode);
    return;
  }
  if (ts.isIdentifier(expression)) {
    appendLocalExport(expression.text, externalName, rangeNode);
  }
};

const collectCommonJsExport = (
  expression: ts.Expression,
  appendFunction: AppendFunctionExport,
  appendClass: AppendClassExport,
  appendLocalExport: AppendLocalExport,
): void => {
  if (
    !ts.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return;
  }
  const externalName = commonJsExportName(expression.left);
  if (externalName === undefined) {
    return;
  }

  if (
    externalName === "default" &&
    ts.isObjectLiteralExpression(expression.right)
  ) {
    for (const property of expression.right.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        appendLocalExport(property.name.text, property.name.text, property.name);
      } else if (ts.isPropertyAssignment(property)) {
        const propertyName = propertyNameText(property.name);
        if (propertyName !== undefined) {
          appendExpressionExport(
            property.initializer,
            propertyName,
            property.name,
            appendFunction,
            appendClass,
            appendLocalExport,
          );
        }
      } else if (ts.isMethodDeclaration(property)) {
        const propertyName = propertyNameText(property.name);
        if (propertyName !== undefined) {
          appendFunction(propertyName, [property], property.name);
        }
      }
    }
    return;
  }

  appendExpressionExport(
    expression.right,
    externalName,
    expression.left,
    appendFunction,
    appendClass,
    appendLocalExport,
  );
};

const commonJsExportName = (expression: ts.Expression): string | undefined => {
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "exports"
  ) {
    return expression.name.text;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    isModuleExports(expression.expression)
  ) {
    return expression.name.text;
  }
  if (isModuleExports(expression)) {
    return "default";
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    const name =
      argument !== undefined &&
      (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument))
        ? argument.text
        : undefined;
    if (name === undefined) {
      return undefined;
    }
    if (
      (ts.isIdentifier(expression.expression) &&
        expression.expression.text === "exports") ||
      isModuleExports(expression.expression)
    ) {
      return name;
    }
  }
  return undefined;
};

const isModuleExports = (expression: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === "module" &&
  expression.name.text === "exports";

const isPublicCallableClassMember = (
  member: ts.ClassElement,
): member is
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration =>
  ts.isMethodDeclaration(member) ||
  ts.isGetAccessorDeclaration(member) ||
  ts.isSetAccessorDeclaration(member) ||
  ts.isConstructorDeclaration(member);

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
      id: buildEvidenceId(
        "complexity-growth",
        currentSource.fileName,
        key,
      ),
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
  declaration: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): string => {
  const syntaxMarkers = [
    hasModifier(declaration, ts.SyntaxKind.AsyncKeyword) ? "async" : "",
    hasModifier(declaration, ts.SyntaxKind.StaticKeyword) ? "static" : "",
    declaration.asteriskToken === undefined ? "" : "generator",
    declaration.questionToken === undefined ? "" : "optional",
    declaration.exclamationToken === undefined ? "" : "definite",
  ]
    .filter((value) => value.length > 0)
    .join("|");
  const signature = checker.getSignatureFromDeclaration(declaration);
  const checkerSignature =
    signature === undefined
      ? fallbackFunctionSignature(declaration, sourceFile)
      : checker.signatureToString(
          signature,
          declaration,
          ts.TypeFormatFlags.NoTruncation |
            ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
          ts.SignatureKind.Call,
        );

  return `${syntaxMarkers}:${checkerSignature}`;
};

const fallbackFunctionSignature = (
  declaration: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): string =>
  sourceFile.text.slice(
    declaration.getStart(sourceFile),
    declaration.body?.getStart(sourceFile) ?? declaration.getEnd(),
  );

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

export const canonicalModuleHash = (uri: string): string => {
  let canonicalUri = uri;
  try {
    const parsed = new URL(uri);
    parsed.search = "";
    parsed.hash = "";
    canonicalUri = parsed.toString();
  } catch {
    canonicalUri = uri.replaceAll("\\", "/");
  }

  return createHash("sha256")
    .update(canonicalUri, "utf8")
    .digest("hex")
    .slice(0, 16);
};

const buildEvidenceId = (
  kind: Evidence["kind"],
  uri: string,
  subject: string,
): string => {
  const subjectHash = createHash("sha256")
    .update(subject, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `ts-semantic:${kind}:${canonicalModuleHash(uri)}:${subjectHash}`;
};

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
