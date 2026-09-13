import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import {
  boundEvidenceDetail,
  boundEvidenceReference,
} from "./evidencePresentation";
import type { EditEpisode, Evidence, PairRange } from "./types";

interface ImportRecord {
  readonly range: PairRange;
}

interface ComplexityRecord {
  readonly key: string;
  readonly baseKey: string;
  readonly displayName: string;
  readonly branchCount: number;
  readonly fingerprint: string;
  readonly range: PairRange;
}

interface SubjectIdentity {
  readonly key: string;
  readonly displayName: string;
}

interface SemanticSource {
  readonly sourceFile: ts.SourceFile;
  readonly program: ts.Program;
}

interface CanonicalDeclarationSurface {
  readonly fingerprint: string;
  readonly isEmpty: boolean;
}

interface TypeScriptLibraryFileSystem {
  readonly fileExists: (path: string) => boolean;
  readonly getDefaultLibFilePath: (options: ts.CompilerOptions) => string;
  readonly readFile: (path: string) => string | undefined;
  readonly realpath: (path: string) => string | undefined;
}

type PublicApiChange = "added" | "removed" | "changed";

const ANALYZER_SOURCE = "typescript-semantic-analyzer";
const DEFAULT_EXPORT_KEY = "default-export";
const DEFAULT_EXPORT_DISPLAY = "default export";
const PUBLIC_API_REFERENCE = "public declarations";
const TYPESCRIPT_LIBRARY_FILE_SYSTEM: TypeScriptLibraryFileSystem = {
  fileExists: (path) => ts.sys.fileExists(path),
  getDefaultLibFilePath: (options) => ts.getDefaultLibFilePath(options),
  readFile: (path) => ts.sys.readFile(path),
  realpath: (path) => {
    try {
      const realPath = ts.sys.realpath?.(path);
      return realPath === undefined ? undefined : resolve(realPath);
    } catch {
      return undefined;
    }
  },
};

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
  public constructor(
    private readonly libraryFileSystem: TypeScriptLibraryFileSystem =
      TYPESCRIPT_LIBRARY_FILE_SYSTEM,
  ) {}

  public analyze(episode: EditEpisode): SemanticAnalysisResult {
    const previous = createSemanticSource(
      episode,
      episode.previousText,
      this.libraryFileSystem,
    );
    const current = createSemanticSource(
      episode,
      episode.currentText,
      this.libraryFileSystem,
    );

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
  fileSystem: TypeScriptLibraryFileSystem,
): SemanticSource => {
  const sourceFile = createSourceFile(episode, text);
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    declaration: true,
    emitDeclarationOnly: true,
    module: ts.ModuleKind.CommonJS,
    noResolve: true,
    skipLibCheck: !sourceFile.isDeclarationFile,
    strictNullChecks: true,
    target: ts.ScriptTarget.Latest,
  };
  const installedLibraryFile = resolve(
    fileSystem.getDefaultLibFilePath(compilerOptions),
  );
  const installedLibraryDirectory = dirname(installedLibraryFile);
  const standardLibraryDirectory = fileSystem.realpath(
    installedLibraryDirectory,
  );
  const standardLibraryFile = (fileName: string): string | undefined => {
    if (standardLibraryDirectory === undefined) {
      return undefined;
    }
    const resolvedFileName = resolve(fileName);
    const fileBaseName = basename(resolvedFileName);
    if (!/^lib(?:\..+)?\.d\.ts$/u.test(fileBaseName)) {
      return undefined;
    }
    if (
      dirname(resolvedFileName) !== installedLibraryDirectory &&
      dirname(resolvedFileName) !== standardLibraryDirectory
    ) {
      return undefined;
    }
    const canonicalFile = fileSystem.realpath(resolvedFileName);
    if (
      canonicalFile === undefined ||
      !isContainedPath(standardLibraryDirectory, canonicalFile)
    ) {
      return undefined;
    }
    return canonicalFile;
  };
  const readStandardLibraryFile = (fileName: string): string | undefined => {
    const libraryFile = standardLibraryFile(fileName);
    return libraryFile === undefined
      ? undefined
      : fileSystem.readFile(libraryFile);
  };
  const getSourceFile: ts.CompilerHost["getSourceFile"] = (
    fileName,
    languageVersionOrOptions,
    onError,
  ) => {
    if (fileName === sourceFile.fileName) {
      return sourceFile;
    }
    const libraryFile = standardLibraryFile(fileName);
    if (libraryFile === undefined) {
      return undefined;
    }
    const libraryText = readStandardLibraryFile(libraryFile);
    if (libraryText === undefined) {
      onError?.(`Unable to read TypeScript standard library: ${libraryFile}`);
      return undefined;
    }
    return ts.createSourceFile(
      libraryFile,
      libraryText,
      languageVersionOrOptions,
      true,
      ts.ScriptKind.TS,
    );
  };
  const host: ts.CompilerHost = {
    directoryExists: (directoryName) => {
      const resolvedDirectory = resolve(directoryName);
      return (
        resolvedDirectory === installedLibraryDirectory ||
        resolvedDirectory === standardLibraryDirectory
      );
    },
    fileExists: (fileName) =>
      fileName === sourceFile.fileName ||
      (() => {
        const libraryFile = standardLibraryFile(fileName);
        return libraryFile !== undefined && fileSystem.fileExists(libraryFile);
      })(),
    getCanonicalFileName: (fileName) =>
      ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    getCurrentDirectory: () =>
      standardLibraryDirectory ?? installedLibraryDirectory,
    getDefaultLibFileName: () =>
      resolve(
        standardLibraryDirectory ?? installedLibraryDirectory,
        basename(installedLibraryFile),
      ),
    getDefaultLibLocation: () =>
      standardLibraryDirectory ?? installedLibraryDirectory,
    getDirectories: () => [],
    getNewLine: () => ts.sys.newLine,
    getSourceFile,
    getSourceFileByPath: (
      fileName,
      _path,
      languageVersionOrOptions,
      onError,
      shouldCreateNewSourceFile,
    ) =>
      getSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile,
      ),
    readDirectory: () => [],
    readFile: (fileName) =>
      fileName === sourceFile.fileName
        ? text
        : readStandardLibraryFile(fileName),
    realpath: (fileName) =>
      fileName === sourceFile.fileName
        ? fileName
        : (standardLibraryFile(fileName) ?? fileName),
    resolveModuleNameLiterals: (moduleLiterals) =>
      moduleLiterals.map(() => ({ resolvedModule: undefined })),
    resolveModuleNames: (moduleNames) =>
      moduleNames.map(() => undefined),
    resolveTypeReferenceDirectiveReferences: (typeDirectiveReferences) =>
      typeDirectiveReferences.map(() => ({
        resolvedTypeReferenceDirective: undefined,
      })),
    resolveTypeReferenceDirectives: (typeReferenceDirectiveNames) =>
      typeReferenceDirectiveNames.map(() => undefined),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    writeFile: () => undefined,
  };

  return {
    sourceFile,
    program: ts.createProgram([sourceFile.fileName], compilerOptions, host),
  };
};

const isContainedPath = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
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
  const previousImports = collectDependencyRecords(previousSource);
  const currentImports = collectDependencyRecords(currentSource);
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
      detail: boundEvidenceDetail(
        `Imported a new module dependency: ${specifier}.`,
      ),
      source: ANALYZER_SOURCE,
      confidence: 0.94,
      range: record.range,
      references: [boundEvidenceReference(specifier)],
    });
  }

  return evidence;
};

const collectDependencyRecords = (
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ImportRecord> => {
  const dependencies = new Map<string, ImportRecord>();
  const record = (moduleSpecifier: ts.Expression | undefined): void => {
    if (
      moduleSpecifier === undefined ||
      !ts.isStringLiteralLike(moduleSpecifier) ||
      dependencies.has(moduleSpecifier.text)
    ) {
      return;
    }
    dependencies.set(moduleSpecifier.text, {
      range: rangeForNode(sourceFile, moduleSpecifier),
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      const isRequireCall =
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require";
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequireCall || isDynamicImport) {
        record(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return dependencies;
};

const collectPublicApiChangeEvidence = (
  previous: SemanticSource,
  current: SemanticSource,
): Evidence[] => {
  const previousSurface = emitDeclarationSurface(previous);
  const currentSurface = emitDeclarationSurface(current);
  if (
    previousSurface === undefined ||
    currentSurface === undefined ||
    previousSurface.fingerprint === currentSurface.fingerprint
  ) {
    return [];
  }

  const change = declarationSurfaceChange(previousSurface, currentSurface);
  const detail = `${capitalize(change)} public declaration surface ${
    change === "removed" ? "from" : "in"
  } this document.`;
  const transitionHash = hashDeclarationTransition(
    previousSurface.fingerprint,
    currentSurface.fingerprint,
  );

  return [
    {
      id: `ts-semantic:public-api-change:${canonicalModuleHash(
        current.sourceFile.fileName,
      )}:${transitionHash}`,
      kind: "public-api-change",
      severity: "warning",
      title: "Public API surface changed",
      detail: boundEvidenceDetail(detail),
      source: ANALYZER_SOURCE,
      confidence: 0.9,
      range:
        change === "removed"
          ? zeroWidthRangeAtSourceStart(current.sourceFile)
          : publicDeclarationRange(current.sourceFile),
      references: [boundEvidenceReference(PUBLIC_API_REFERENCE)],
    },
  ];
};

const emitDeclarationSurface = (
  source: SemanticSource,
): CanonicalDeclarationSurface | undefined => {
  if (source.sourceFile.isDeclarationFile) {
    const diagnostics = [
      ...source.program.getSyntacticDiagnostics(source.sourceFile),
      ...source.program.getSemanticDiagnostics(source.sourceFile),
    ];
    if (
      diagnostics.some(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      )
    ) {
      return undefined;
    }
    return canonicalizeDeclaration(source.sourceFile);
  }
  if (hasParseDiagnostics(source.sourceFile)) {
    return undefined;
  }

  const declarations: ts.SourceFile[] = [];
  const emitResult = source.program.emit(
    source.sourceFile,
    (fileName, text) => {
      if (/\.d\.[cm]?ts$/u.test(fileName)) {
        declarations.push(
          ts.createSourceFile(
            fileName,
            text,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
          ),
        );
      }
    },
    undefined,
    true,
  );
  if (
    emitResult.emitSkipped ||
    emitResult.diagnostics.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ||
    declarations.length !== 1
  ) {
    return undefined;
  }

  return canonicalizeDeclaration(declarations[0]);
};

const canonicalizeDeclaration = (
  sourceFile: ts.SourceFile | undefined,
): CanonicalDeclarationSurface | undefined => {
  if (sourceFile === undefined || hasParseDiagnostics(sourceFile)) {
    return undefined;
  }
  const declaration = ts
    .createPrinter({
      newLine: ts.NewLineKind.LineFeed,
      removeComments: true,
    })
    .printFile(sourceFile)
    .trim();

  return {
    fingerprint: declaration,
    isEmpty: declaration.length === 0,
  };
};

const declarationSurfaceChange = (
  previous: CanonicalDeclarationSurface,
  current: CanonicalDeclarationSurface,
): PublicApiChange => {
  if (previous.isEmpty && !current.isEmpty) {
    return "added";
  }
  if (!previous.isEmpty && current.isEmpty) {
    return "removed";
  }
  return "changed";
};

const hashDeclarationTransition = (
  previousFingerprint: string,
  currentFingerprint: string,
): string =>
  createHash("sha256")
    .update(previousFingerprint, "utf8")
    .update("\0", "utf8")
    .update(currentFingerprint, "utf8")
    .digest("hex")
    .slice(0, 16);

const publicDeclarationRange = (sourceFile: ts.SourceFile): PairRange => {
  const declaration = sourceFile.statements.find(
    (statement) =>
      ts.isExportAssignment(statement) ||
      ts.isExportDeclaration(statement) ||
      hasExportModifier(statement),
  );
  return declaration === undefined
    ? zeroWidthRangeAtSourceStart(sourceFile)
    : rangeForNode(sourceFile, declaration);
};

const capitalize = (value: string): string =>
  `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

const collectComplexityGrowthEvidence = (
  previousSource: ts.SourceFile,
  currentSource: ts.SourceFile,
): Evidence[] => {
  const previousComplexity = collectComplexityRecords(previousSource);
  const currentComplexity = collectComplexityRecords(currentSource);
  const previousByCurrent = matchComplexityRecords(
    previousComplexity,
    currentComplexity,
  );
  const evidence: Evidence[] = [];

  for (const currentRecord of currentComplexity) {
    const previousRecord = previousByCurrent.get(currentRecord);
    if (previousRecord === undefined) {
      continue;
    }
    const growth = currentRecord.branchCount - previousRecord.branchCount;
    if (currentRecord.branchCount < 6 || growth < 3) {
      continue;
    }

    evidence.push({
      id: buildEvidenceId(
        "complexity-growth",
        currentSource.fileName,
        previousRecord.key,
      ),
      kind: "complexity-growth",
      severity: "info",
      title: "Complexity increased substantially",
      detail: `${currentRecord.displayName} now has ${currentRecord.branchCount} branches, up from ${previousRecord.branchCount}.`,
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
): readonly ComplexityRecord[] => {
  const records: ComplexityRecord[] = [];
  const occurrencesByBaseKey = new Map<string, number>();

  const recordFunction = (
    identity: SubjectIdentity,
    node: ts.FunctionLikeDeclaration,
    name: ts.Identifier | undefined,
  ): void => {
    const baseKey = `function:${identity.key}`;
    const occurrence = occurrencesByBaseKey.get(baseKey) ?? 0;
    occurrencesByBaseKey.set(baseKey, occurrence + 1);
    records.push({
      key: `${baseKey}/occurrence:${occurrence}`,
      baseKey,
      displayName: identity.displayName,
      branchCount: countBranches(node),
      fingerprint: node.getText(sourceFile),
      range: rangeForNameNode(sourceFile, name, node),
    });
  };

  const recordMethod = (
    identity: SubjectIdentity,
    node: ts.MethodDeclaration,
  ): void => {
    const baseKey = `method:${identity.key}`;
    const occurrence = occurrencesByBaseKey.get(baseKey) ?? 0;
    occurrencesByBaseKey.set(baseKey, occurrence + 1);
    records.push({
      key: `${baseKey}/occurrence:${occurrence}`,
      baseKey,
      displayName: identity.displayName,
      branchCount: countBranches(node),
      fingerprint: node.getText(sourceFile),
      range: rangeForNameNode(sourceFile, node.name, node),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      const identity = functionIdentity(node, false);
      if (identity !== undefined) {
        recordFunction(identity, node, node.name);
      }
    } else if (ts.isMethodDeclaration(node)) {
      const identity = methodIdentity(node, false);
      if (identity !== undefined) {
        recordMethod(identity, node);
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = unwrapFunctionExpression(node.initializer);
      const identity = variableFunctionIdentity(node, false);
      if (initializer !== undefined && identity !== undefined) {
        recordFunction(identity, initializer, node.name);
      }
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);
  return records;
};

const matchComplexityRecords = (
  previousRecords: readonly ComplexityRecord[],
  currentRecords: readonly ComplexityRecord[],
): ReadonlyMap<ComplexityRecord, ComplexityRecord> => {
  const previousByBaseKey = groupComplexityRecords(previousRecords);
  const currentByBaseKey = groupComplexityRecords(currentRecords);
  const previousByCurrent = new Map<ComplexityRecord, ComplexityRecord>();

  for (const [baseKey, currentGroup] of currentByBaseKey) {
    const previousGroup = previousByBaseKey.get(baseKey);
    if (previousGroup === undefined) {
      continue;
    }
    for (const [previousRecord, currentRecord] of alignComplexityRecords(
      previousGroup,
      currentGroup,
    )) {
      previousByCurrent.set(currentRecord, previousRecord);
    }
  }

  return previousByCurrent;
};

const groupComplexityRecords = (
  records: readonly ComplexityRecord[],
): ReadonlyMap<string, readonly ComplexityRecord[]> => {
  const recordsByBaseKey = new Map<string, ComplexityRecord[]>();
  for (const record of records) {
    const group = recordsByBaseKey.get(record.baseKey) ?? [];
    group.push(record);
    recordsByBaseKey.set(record.baseKey, group);
  }
  return recordsByBaseKey;
};

const alignComplexityRecords = (
  previous: readonly ComplexityRecord[],
  current: readonly ComplexityRecord[],
): ReadonlyArray<readonly [ComplexityRecord, ComplexityRecord]> => {
  const matches: Array<readonly [ComplexityRecord, ComplexityRecord]> = [];

  const alignRange = (
    previousStart: number,
    previousEnd: number,
    currentStart: number,
    currentEnd: number,
  ): void => {
    while (
      previousStart < previousEnd &&
      currentStart < currentEnd &&
      previous[previousStart]!.fingerprint ===
        current[currentStart]!.fingerprint
    ) {
      matches.push([
        previous[previousStart]!,
        current[currentStart]!,
      ]);
      previousStart += 1;
      currentStart += 1;
    }

    const suffix: Array<
      readonly [ComplexityRecord, ComplexityRecord]
    > = [];
    while (
      previousStart < previousEnd &&
      currentStart < currentEnd &&
      previous[previousEnd - 1]!.fingerprint ===
        current[currentEnd - 1]!.fingerprint
    ) {
      previousEnd -= 1;
      currentEnd -= 1;
      suffix.unshift([
        previous[previousEnd]!,
        current[currentEnd]!,
      ]);
    }

    if (
      previousEnd - previousStart ===
      currentEnd - currentStart
    ) {
      for (
        let offset = 0;
        offset < previousEnd - previousStart;
        offset += 1
      ) {
        matches.push([
          previous[previousStart + offset]!,
          current[currentStart + offset]!,
        ]);
      }
    }
    matches.push(...suffix);
  };

  alignRange(0, previous.length, 0, current.length);
  return matches;
};

const functionIdentity = (
  node: ts.FunctionDeclaration,
  includeLexicalScopes = true,
): SubjectIdentity | undefined => {
  const name = node.name?.text;
  if (name !== undefined) {
    return qualifyIdentity(
      enclosingScopeIdentity(node.parent, includeLexicalScopes),
      name,
      name,
    );
  }

  if (
    !hasModifier(node, ts.SyntaxKind.DefaultKeyword) ||
    !hasExportModifier(node)
  ) {
    return undefined;
  }

  return qualifyIdentity(
    enclosingScopeIdentity(node.parent, includeLexicalScopes),
    DEFAULT_EXPORT_KEY,
    DEFAULT_EXPORT_DISPLAY,
  );
};

const classIdentity = (
  node: ts.ClassDeclaration,
  includeLexicalScopes = true,
): SubjectIdentity | undefined => {
  const name = node.name?.text;
  if (name !== undefined) {
    return qualifyIdentity(
      enclosingScopeIdentity(node.parent, includeLexicalScopes),
      name,
      name,
    );
  }

  if (
    !hasModifier(node, ts.SyntaxKind.DefaultKeyword) ||
    !hasExportModifier(node)
  ) {
    return undefined;
  }

  return qualifyIdentity(
    enclosingScopeIdentity(node.parent, includeLexicalScopes),
    DEFAULT_EXPORT_KEY,
    DEFAULT_EXPORT_DISPLAY,
  );
};

const methodIdentity = (
  node: ts.MethodDeclaration,
  includeLexicalScopes = true,
): SubjectIdentity | undefined => {
  const classDeclaration = node.parent;
  if (!ts.isClassDeclaration(classDeclaration)) {
    return undefined;
  }

  const ownerIdentity = classIdentity(
    classDeclaration,
    includeLexicalScopes,
  );
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

const accessorIdentity = (
  node: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
  includeLexicalScopes = true,
): SubjectIdentity | undefined => {
  const classDeclaration = node.parent;
  if (!ts.isClassDeclaration(classDeclaration)) {
    return undefined;
  }

  const ownerIdentity = classIdentity(
    classDeclaration,
    includeLexicalScopes,
  );
  const propertyName = propertyNameText(node.name);
  if (ownerIdentity === undefined || propertyName === undefined) {
    return undefined;
  }

  const accessorKind = ts.isGetAccessorDeclaration(node) ? "get" : "set";
  const staticMember = hasModifier(node, ts.SyntaxKind.StaticKeyword);
  const memberPrefix = staticMember ? "." : "#";
  const scopeKind = staticMember ? "static" : "instance";

  return {
    key: `${ownerIdentity.key}/${scopeKind}-${accessorKind}-accessor:${propertyName}`,
    displayName: `${ownerIdentity.displayName}${memberPrefix}${accessorKind} ${propertyName}`,
  };
};

const variableFunctionIdentity = (
  node: ts.VariableDeclaration,
  includeLexicalScopes = true,
): SubjectIdentity | undefined => {
  if (!ts.isIdentifier(node.name)) {
    return undefined;
  }

  return qualifyIdentity(
    enclosingScopeIdentity(node.parent, includeLexicalScopes),
    node.name.text,
    node.name.text,
  );
};

const enclosingScopeIdentity = (
  node: ts.Node | undefined,
  includeLexicalScopes = true,
): SubjectIdentity | undefined => {
  let current = node;
  const lexicalBlockPath: string[] = [];

  while (current !== undefined) {
    if (
      includeLexicalScopes &&
      isIdentityBearingLexicalScope(current)
    ) {
      lexicalBlockPath.unshift(lexicalScopeIdentitySegment(current));
    }

    if (ts.isSourceFile(current)) {
      return lexicalBlockPath.length === 0
        ? undefined
        : {
            key: lexicalBlockPath.join("/"),
            displayName: "",
          };
    }

    if (
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      const identity = accessorIdentity(current, includeLexicalScopes);
      if (identity !== undefined) {
        return withLexicalBlockPath(identity, lexicalBlockPath);
      }
    }

    if (ts.isMethodDeclaration(current)) {
      return withLexicalBlockPath(
        methodIdentity(current, includeLexicalScopes),
        lexicalBlockPath,
      );
    }

    if (ts.isFunctionDeclaration(current)) {
      return withLexicalBlockPath(
        functionIdentity(current, includeLexicalScopes),
        lexicalBlockPath,
      );
    }

    if (ts.isClassDeclaration(current)) {
      return withLexicalBlockPath(
        classIdentity(current, includeLexicalScopes),
        lexicalBlockPath,
      );
    }

    if (ts.isModuleDeclaration(current)) {
      return withLexicalBlockPath(
        qualifyIdentity(
          enclosingScopeIdentity(current.parent, includeLexicalScopes),
          `module:${current.name.text}`,
          current.name.text,
        ),
        lexicalBlockPath,
      );
    }

    if (ts.isVariableDeclaration(current)) {
      const initializer = unwrapFunctionExpression(current.initializer);
      if (initializer !== undefined) {
        return withLexicalBlockPath(
          variableFunctionIdentity(current, includeLexicalScopes),
          lexicalBlockPath,
        );
      }
    }

    current = current.parent;
  }
};

type IdentityBearingLexicalScope =
  | ts.Block
  | ts.ClassStaticBlockDeclaration;

const isIdentityBearingLexicalScope = (
  node: ts.Node,
): node is IdentityBearingLexicalScope =>
  ts.isClassStaticBlockDeclaration(node) ||
  (ts.isBlock(node) &&
    !(
      (isFunctionLikeContainer(node.parent) ||
        ts.isClassStaticBlockDeclaration(node.parent)) &&
      node.parent.body === node
    ));

const lexicalScopeIdentitySegment = (
  scope: IdentityBearingLexicalScope,
): string =>
  ts.isClassStaticBlockDeclaration(scope)
    ? `static-block:${classStaticBlockOrdinal(scope)}`
    : `block:${lexicalBlockOrdinal(scope)}`;

const classStaticBlockOrdinal = (
  block: ts.ClassStaticBlockDeclaration,
): number =>
  block.parent.members
    .filter(ts.isClassStaticBlockDeclaration)
    .findIndex((candidate) => candidate === block);

const lexicalBlockOrdinal = (block: ts.Block): number => {
  let container = block.parent;
  while (
    !ts.isBlock(container) &&
    !ts.isModuleBlock(container) &&
    !ts.isSourceFile(container)
  ) {
    container = container.parent;
  }

  let ordinal = 0;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      node !== container &&
      (isFunctionLikeContainer(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isModuleDeclaration(node))
    ) {
      return;
    }
    if (node !== container && ts.isBlock(node)) {
      if (node === block) {
        found = true;
      } else {
        ordinal += 1;
      }
      return;
    }
    node.forEachChild(visit);
  };

  visit(container);
  return ordinal;
};

const withLexicalBlockPath = (
  identity: SubjectIdentity | undefined,
  path: readonly string[],
): SubjectIdentity | undefined => {
  if (identity === undefined || path.length === 0) {
    return identity;
  }

  return {
    key: `${identity.key}/${path.join("/")}`,
    displayName: identity.displayName,
  };
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
    displayName:
      parent.displayName.length === 0
        ? displayName
        : `${parent.displayName}.${displayName}`,
  };
};

const unwrapExpression = (
  expression: ts.Expression | undefined,
): ts.Expression | undefined => {
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
  return current;
};

const unwrapFunctionExpression = (
  expression: ts.Expression | undefined,
): ts.FunctionExpression | ts.ArrowFunction | undefined => {
  const unwrapped = unwrapExpression(expression);
  return unwrapped !== undefined && isFunctionExpressionLike(unwrapped)
    ? unwrapped
    : undefined;
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

const isFunctionLikeContainer = (
  node: ts.Node,
): node is ts.FunctionLikeDeclaration =>
  ts.isConstructorDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isArrowFunction(node);

const propertyNameText = (name: ts.PropertyName): string | undefined => {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return undefined;
};

const hasExportModifier = (node: ts.Node): boolean =>
  hasModifier(node, ts.SyntaxKind.ExportKeyword);

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
