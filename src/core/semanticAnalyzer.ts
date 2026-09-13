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

type CommonJsExportPath = readonly string[];

interface ExportIdentity extends SubjectIdentity {
  readonly commonJsPath?: CommonJsExportPath;
}

interface SemanticSource {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
}

interface TypeScriptLibraryFileSystem {
  readonly fileExists: (path: string) => boolean;
  readonly getDefaultLibFilePath: (options: ts.CompilerOptions) => string;
  readonly readFile: (path: string) => string | undefined;
  readonly realpath: (path: string) => string | undefined;
}

const ANALYZER_SOURCE = "typescript-semantic-analyzer";
const DEFAULT_EXPORT_KEY = "default-export";
const DEFAULT_EXPORT_DISPLAY = "default export";
const EXPORT_EQUALS_DISPLAY = "export =";
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
    module: ts.ModuleKind.CommonJS,
    noResolve: true,
    skipLibCheck: true,
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
  let signatureTarget = signatures;
  const commonJsPathsBySignatureKey = new Map<
    string,
    CommonJsExportPath
  >();
  const functionsByName = new Map<
    string,
    readonly ts.FunctionLikeDeclaration[]
  >();
  const classesByName = new Map<string, ts.ClassLikeDeclarationBase>();
  const identifiersByName = new Map<string, ts.Identifier>();
  const variableNames = new Set<string>();

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
    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)
    ) {
      identifiersByName.set(statement.name.text, statement.name);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const identifier of bindingIdentifiers(declaration.name)) {
          identifiersByName.set(identifier.text, identifier);
          variableNames.add(identifier.text);
        }
        if (ts.isIdentifier(declaration.name)) {
          const initializer = unwrapFunctionExpression(declaration.initializer);
          if (initializer !== undefined) {
            functionsByName.set(declaration.name.text, [initializer]);
          }
          const classInitializer = unwrapExpression(declaration.initializer);
          if (
            classInitializer !== undefined &&
            ts.isClassExpression(classInitializer)
          ) {
            classesByName.set(declaration.name.text, classInitializer);
          }
        }
      }
    }
  }

  const appendFunction = (
    identity: ExportIdentity,
    declarations: readonly ts.FunctionLikeDeclaration[],
    rangeNode?: ts.Node,
  ): void => {
    const key = `function:${identity.key}`;
    for (const declaration of declarations) {
      appendSignatureRecord(
        signatureTarget,
        key,
        identity.displayName,
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
    if (identity.commonJsPath !== undefined) {
      commonJsPathsBySignatureKey.set(key, identity.commonJsPath);
    }
  };

  const appendClass = (
    identity: ExportIdentity,
    declaration: ts.ClassLikeDeclarationBase,
    rangeNode?: ts.Node,
  ): void => {
    const constructorKey = `method:${identity.key}#constructor`;
    const constructorRange = rangeForNode(
      sourceFile,
      rangeNode ?? declaration.name ?? declaration,
    );
    const constructorDeclarations = declaration.members.filter(
      ts.isConstructorDeclaration,
    );
    const publicConstructSignatures = classValueType(
      declaration,
      checker,
    )
      .getConstructSignatures()
      .filter((signature) => {
        const signatureDeclaration = signature.getDeclaration();
        return (
          signatureDeclaration === undefined ||
          !hasNonPublicModifier(signatureDeclaration)
        );
      });

    if (publicConstructSignatures.length > 0) {
      for (const signature of publicConstructSignatures) {
        appendSignatureRecord(
          signatureTarget,
          constructorKey,
          `${identity.displayName}#constructor`,
          serializeClassConstructSignature(signature, declaration, checker),
          constructorRange,
        );
      }
    } else if (constructorDeclarations.length === 0) {
      appendSignatureRecord(
        signatureTarget,
        constructorKey,
        `${identity.displayName}#constructor`,
        "class-constructor:new ()",
        constructorRange,
      );
    } else {
      for (const constructorDeclaration of constructorDeclarations) {
        if (hasNonPublicModifier(constructorDeclaration)) {
          continue;
        }
        appendSignatureRecord(
          signatureTarget,
          constructorKey,
          `${identity.displayName}#constructor`,
          serializeClassDeclarationConstructor(
            constructorDeclaration,
            sourceFile,
            checker,
          ),
          constructorRange,
        );
      }
    }
    if (identity.commonJsPath !== undefined) {
      commonJsPathsBySignatureKey.set(
        constructorKey,
        identity.commonJsPath,
      );
    }

    for (const member of declaration.members) {
      if (!isPublicCallableClassMember(member) || hasNonPublicModifier(member)) {
        continue;
      }

      const memberName = propertyNameText(member.name);
      if (memberName === undefined) {
        continue;
      }
      const staticPrefix = hasModifier(member, ts.SyntaxKind.StaticKeyword)
        ? "."
        : "#";
      const separator = staticPrefix;
      const key = `method:${identity.key}${separator}${memberName}`;
      appendSignatureRecord(
        signatureTarget,
        key,
        `${identity.displayName}${separator}${memberName}`,
        serializeFunctionLikeSignature(member, sourceFile, checker),
        rangeForNode(sourceFile, rangeNode ?? member.name ?? member),
      );
      if (identity.commonJsPath !== undefined) {
        commonJsPathsBySignatureKey.set(key, identity.commonJsPath);
      }
    }
  };

  const appendCheckerValue = (
    identity: ExportIdentity,
    location: ts.Node,
    rangeNode?: ts.Node,
  ): boolean => {
    const appendCheckerMember = (
      separator: "#" | ".",
      memberName: string,
      memberSignatures: readonly ts.Signature[],
      memberLocation: ts.Node,
      signatureKind: ts.SignatureKind,
      classDeclaration?: ts.ClassLikeDeclarationBase,
    ): void => {
      const key = `method:${identity.key}${separator}${memberName}`;
      for (const signature of memberSignatures) {
        appendSignatureRecord(
          signatureTarget,
          key,
          `${identity.displayName}${separator}${memberName}`,
          classDeclaration !== undefined &&
            isClassOwnedConstructSignature(signature, classDeclaration)
            ? serializeClassConstructSignature(
                signature,
                memberLocation,
                checker,
              )
            : serializeCheckerSignature(
                signature,
                memberLocation,
                checker,
                signatureKind,
              ),
          rangeForNode(sourceFile, rangeNode ?? memberLocation),
        );
      }
      if (identity.commonJsPath !== undefined) {
        commonJsPathsBySignatureKey.set(key, identity.commonJsPath);
      }
    };
    const appendPublicCallableMembers = (
      type: ts.Type,
      separator: "#" | ".",
    ): void => {
      for (const member of checker.getPropertiesOfType(type)) {
        if (member.name === "prototype") {
          continue;
        }
        const declarations = member.getDeclarations() ?? [];
        if (declarations.some(hasNonPublicModifier)) {
          continue;
        }
        const memberLocation =
          member.valueDeclaration ?? declarations[0] ?? location;
        const memberSignatures = checker
          .getTypeOfSymbolAtLocation(member, memberLocation)
          .getCallSignatures();
        if (memberSignatures.length > 0) {
          appendCheckerMember(
            separator,
            member.name,
            memberSignatures,
            memberLocation,
            ts.SignatureKind.Call,
          );
        }
      }
    };

    const valueType = checker.getTypeAtLocation(location);
    let appended = false;
    const callSignatures = valueType.getCallSignatures();
    if (callSignatures.length > 0) {
      const key = `function:${identity.key}`;
      for (const signature of callSignatures) {
        appendSignatureRecord(
          signatureTarget,
          key,
          identity.displayName,
          serializeCheckerSignature(
            signature,
            location,
            checker,
            ts.SignatureKind.Call,
          ),
          rangeForNode(sourceFile, rangeNode ?? location),
        );
      }
      if (identity.commonJsPath !== undefined) {
        commonJsPathsBySignatureKey.set(key, identity.commonJsPath);
      }
      appended = true;
    }

    const constructSignatures = valueType.getConstructSignatures();
    const classDeclaration = classDeclarationForValueType(valueType);
    const publicConstructSignatures = constructSignatures.filter(
      (signature) => {
        const declaration = signature.getDeclaration();
        return declaration === undefined || !hasNonPublicModifier(declaration);
      },
    );
    appendCheckerMember(
      "#",
      "constructor",
      publicConstructSignatures,
      location,
      ts.SignatureKind.Construct,
      classDeclaration,
    );
    if (publicConstructSignatures.length > 0) {
      appended = true;
    }

    if (
      classDeclaration === undefined &&
      publicConstructSignatures.length > 0
    ) {
      const visitedInstanceTypes = new Set<ts.Type>();
      for (const signature of publicConstructSignatures) {
        const instanceType = signature.getReturnType();
        if (!visitedInstanceTypes.has(instanceType)) {
          visitedInstanceTypes.add(instanceType);
          appendPublicCallableMembers(instanceType, "#");
        }
      }
      appendPublicCallableMembers(valueType, ".");
    } else if (classDeclaration !== undefined) {
      appendClass(identity, classDeclaration, rangeNode);
      appended = true;
    }

    return appended;
  };

  const appendLocalExport = (
    localName: string,
    identity: ExportIdentity,
    rangeNode?: ts.Node,
    isTypeOnly?: boolean,
  ): void => {
    if (isTypeOnly === true) {
      appendSignatureRecord(
        signatureTarget,
        `function:${identity.key}`,
        identity.displayName,
        "local-export:type-only",
        rangeForNode(sourceFile, rangeNode ?? sourceFile),
      );
    }
    const identifier = identifiersByName.get(localName);
    if (identifier !== undefined && variableNames.has(localName)) {
      if (appendCheckerValue(identity, identifier, rangeNode)) {
        return;
      }
    }
    const functions = functionsByName.get(localName);
    if (functions !== undefined) {
      appendFunction(identity, functions, rangeNode);
      return;
    }
    const declaration = classesByName.get(localName);
    if (declaration !== undefined) {
      appendClass(identity, declaration, rangeNode);
      return;
    }
    if (identifier === undefined) {
      return;
    }
    appendCheckerValue(identity, identifier, rangeNode);
  };

  const appendCallableExpression = (
    identity: ExportIdentity,
    expression: ts.Expression,
    rangeNode?: ts.Node,
  ): void => {
    appendCheckerValue(identity, expression, rangeNode);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const externalName = externalDeclarationName(statement);
      if (externalName === undefined) {
        continue;
      }
      appendFunction(exportIdentity(externalName), [statement]);
      continue;
    }

    if (ts.isClassDeclaration(statement) && hasExportModifier(statement)) {
      const externalName = externalDeclarationName(statement);
      if (externalName !== undefined) {
        appendClass(exportIdentity(externalName), statement);
      }
      continue;
    }

    if (
      (ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)) &&
      hasExportModifier(statement)
    ) {
      appendCheckerValue(
        exportIdentity(statement.name.text),
        statement.name,
        statement.name,
      );
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const identifier of bindingIdentifiers(declaration.name)) {
          appendLocalExport(
            identifier.text,
            exportIdentity(identifier.text),
            identifier,
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
          appendLocalExport(
            localName,
            exportIdentity(externalName),
            element.name,
            statement.isTypeOnly || element.isTypeOnly,
          );
        } else if (ts.isStringLiteral(statement.moduleSpecifier)) {
          appendSignatureRecord(
            signatures,
            `re-export:${externalName}`,
            externalName === "default"
              ? DEFAULT_EXPORT_DISPLAY
              : externalName,
            `re-export:${
              statement.isTypeOnly || element.isTypeOnly
                ? "type-only"
                : "value"
            }:${statement.moduleSpecifier.text}:${localName}`,
            rangeForNode(sourceFile, element.name),
          );
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      appendExpressionExport(
        statement.expression,
        statement.isExportEquals
          ? exportEqualsIdentity()
          : exportIdentity("default"),
        statement.expression,
        appendFunction,
        appendClass,
        appendLocalExport,
        appendCallableExpression,
      );
      continue;
    }
  }

  const commonJsSignatures = new Map<string, SignatureRecord>();
  signatureTarget = commonJsSignatures;
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) {
      continue;
    }
    const assignment = commonJsExportAssignment(statement.expression);
    if (assignment === undefined) {
      continue;
    }
    if (assignment.replacesAll) {
      commonJsSignatures.clear();
      commonJsPathsBySignatureKey.clear();
    } else {
      removeCommonJsExportSignatures(
        commonJsSignatures,
        commonJsPathsBySignatureKey,
        assignment.path,
      );
    }
    collectCommonJsExport(
      assignment,
      appendFunction,
      appendClass,
      appendLocalExport,
      appendCallableExpression,
    );
  }
  signatureTarget = signatures;
  for (const record of commonJsSignatures.values()) {
    for (const signature of record.signatures) {
      appendSignatureRecord(
        signatures,
        record.key,
        record.displayName,
        signature,
        record.range,
      );
    }
  }

  return signatures;
};

type AppendFunctionExport = (
  identity: ExportIdentity,
  declarations: readonly ts.FunctionLikeDeclaration[],
  rangeNode?: ts.Node,
) => void;

type AppendClassExport = (
  identity: ExportIdentity,
  declaration: ts.ClassLikeDeclarationBase,
  rangeNode?: ts.Node,
) => void;

type AppendLocalExport = (
  localName: string,
  identity: ExportIdentity,
  rangeNode?: ts.Node,
  isTypeOnly?: boolean,
) => void;

type AppendCallableExpressionExport = (
  identity: ExportIdentity,
  expression: ts.Expression,
  rangeNode?: ts.Node,
) => void;

interface CommonJsExportAssignment {
  readonly expression: ts.BinaryExpression;
  readonly path: CommonJsExportPath;
  readonly replacesAll: boolean;
}

const structuredExportIdentityKey = (
  category: "esm" | "typescript-export-equals" | "commonjs",
  value: string | CommonJsExportPath | null,
): string => JSON.stringify([category, value]);

const exportIdentity = (externalName: string): ExportIdentity => ({
  key: structuredExportIdentityKey("esm", externalName),
  displayName:
    externalName === "default" ? DEFAULT_EXPORT_DISPLAY : externalName,
});

const exportEqualsIdentity = (): ExportIdentity => ({
  key: structuredExportIdentityKey("typescript-export-equals", null),
  displayName: EXPORT_EQUALS_DISPLAY,
});

const externalDeclarationName = (
  declaration: ts.FunctionDeclaration | ts.ClassDeclaration,
): string | undefined => {
  if (hasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) {
    return "default";
  }
  return declaration.name?.text;
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

const bindingIdentifiers = (name: ts.BindingName): readonly ts.Identifier[] => {
  if (ts.isIdentifier(name)) {
    return [name];
  }

  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingIdentifiers(element.name),
  );
};

const appendExpressionExport = (
  expression: ts.Expression,
  identity: ExportIdentity,
  rangeNode: ts.Node,
  appendFunction: AppendFunctionExport,
  appendClass: AppendClassExport,
  appendLocalExport: AppendLocalExport,
  appendCallableExpression: AppendCallableExpressionExport,
): void => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped === undefined) {
    return;
  }
  if (isFunctionExpressionLike(unwrapped)) {
    appendFunction(identity, [unwrapped], rangeNode);
    return;
  }
  if (ts.isClassExpression(unwrapped)) {
    appendClass(identity, unwrapped, rangeNode);
    return;
  }
  if (ts.isIdentifier(unwrapped)) {
    appendLocalExport(unwrapped.text, identity, rangeNode);
    return;
  }
  appendCallableExpression(identity, unwrapped, rangeNode);
};

const collectCommonJsExport = (
  assignment: CommonJsExportAssignment,
  appendFunction: AppendFunctionExport,
  appendClass: AppendClassExport,
  appendLocalExport: AppendLocalExport,
  appendCallableExpression: AppendCallableExpressionExport,
): void => {
  collectCommonJsExportValue(
    assignment.expression.right,
    assignment.path,
    assignment.expression.left,
    appendFunction,
    appendClass,
    appendLocalExport,
    appendCallableExpression,
  );
};

const collectCommonJsExportValue = (
  expression: ts.Expression,
  path: CommonJsExportPath,
  rangeNode: ts.Node,
  appendFunction: AppendFunctionExport,
  appendClass: AppendClassExport,
  appendLocalExport: AppendLocalExport,
  appendCallableExpression: AppendCallableExpressionExport,
): void => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped !== undefined && ts.isObjectLiteralExpression(unwrapped)) {
    for (const property of unwrapped.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        appendLocalExport(
          property.name.text,
          commonJsExportIdentity([...path, property.name.text]),
          property.name,
        );
      } else if (ts.isPropertyAssignment(property)) {
        const propertyName = propertyNameText(property.name);
        if (propertyName !== undefined) {
          collectCommonJsExportValue(
            property.initializer,
            [...path, propertyName],
            property.name,
            appendFunction,
            appendClass,
            appendLocalExport,
            appendCallableExpression,
          );
        }
      } else if (ts.isMethodDeclaration(property)) {
        const propertyName = propertyNameText(property.name);
        if (propertyName !== undefined) {
          appendFunction(
            commonJsExportIdentity([...path, propertyName]),
            [property],
            property.name,
          );
        }
      }
    }
    return;
  }

  appendExpressionExport(
    expression,
    commonJsExportIdentity(path),
    rangeNode,
    appendFunction,
    appendClass,
    appendLocalExport,
    appendCallableExpression,
  );
};

const commonJsExportAssignment = (
  expression: ts.Expression,
): CommonJsExportAssignment | undefined => {
  if (
    !ts.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return undefined;
  }
  const path = commonJsExportPath(expression.left);
  return path === undefined
    ? undefined
    : {
        expression,
        path,
        replacesAll: path.length === 0,
      };
};

const removeCommonJsExportSignatures = (
  signatures: Map<string, SignatureRecord>,
  pathsBySignatureKey: Map<string, CommonJsExportPath>,
  replacedPath: CommonJsExportPath,
): void => {
  for (const [key, path] of pathsBySignatureKey) {
    if (isCommonJsPathWithin(path, replacedPath)) {
      signatures.delete(key);
      pathsBySignatureKey.delete(key);
    }
  }
};

const isCommonJsPathWithin = (
  path: CommonJsExportPath,
  ancestor: CommonJsExportPath,
): boolean =>
  path.length >= ancestor.length &&
  ancestor.every((segment, index) => path[index] === segment);

const commonJsExportIdentity = (
  path: CommonJsExportPath,
): ExportIdentity => {
  const externalName = path.length === 0 ? "default" : path.join(".");
  return {
    key: structuredExportIdentityKey("commonjs", path),
    displayName:
      externalName === "default" ? DEFAULT_EXPORT_DISPLAY : externalName,
    commonJsPath: path,
  };
};

const commonJsExportPath = (
  expression: ts.Expression,
): CommonJsExportPath | undefined => {
  if (isModuleExports(expression)) {
    return [];
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "exports"
  ) {
    return [expression.name.text];
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = commonJsExportPath(expression.expression);
    return parent === undefined
      ? undefined
      : [...parent, expression.name.text];
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
    const parent =
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "exports"
        ? []
        : commonJsExportPath(expression.expression);
    return parent === undefined ? undefined : [...parent, name];
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
  | ts.SetAccessorDeclaration =>
  ts.isMethodDeclaration(member) ||
  ts.isGetAccessorDeclaration(member) ||
  ts.isSetAccessorDeclaration(member);

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
      const initializer = unwrapFunctionExpression(node.initializer);
      const identity = variableFunctionIdentity(node);
      if (
        initializer !== undefined &&
        identity !== undefined
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
  if (existing.signatures.includes(signature)) {
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

const accessorIdentity = (
  node: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
): SubjectIdentity | undefined => {
  const classDeclaration = node.parent;
  if (!ts.isClassDeclaration(classDeclaration)) {
    return undefined;
  }

  const ownerIdentity = classIdentity(classDeclaration);
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

const variableFunctionIdentity = (node: ts.VariableDeclaration): SubjectIdentity | undefined => {
  if (!ts.isIdentifier(node.name)) {
    return undefined;
  }

  return qualifyIdentity(enclosingScopeIdentity(node.parent), node.name.text, node.name.text);
};

const enclosingScopeIdentity = (node: ts.Node | undefined): SubjectIdentity | undefined => {
  let current = node;
  const lexicalBlockPath: string[] = [];

  while (current !== undefined) {
    if (isIdentityBearingLexicalScope(current)) {
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
      const identity = accessorIdentity(current);
      if (identity !== undefined) {
        return withLexicalBlockPath(identity, lexicalBlockPath);
      }
    }

    if (ts.isMethodDeclaration(current)) {
      return withLexicalBlockPath(methodIdentity(current), lexicalBlockPath);
    }

    if (ts.isFunctionDeclaration(current)) {
      return withLexicalBlockPath(functionIdentity(current), lexicalBlockPath);
    }

    if (ts.isClassDeclaration(current)) {
      return withLexicalBlockPath(classIdentity(current), lexicalBlockPath);
    }

    if (ts.isModuleDeclaration(current)) {
      return withLexicalBlockPath(
        qualifyIdentity(
          enclosingScopeIdentity(current.parent),
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
          variableFunctionIdentity(current),
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

const sameOrderedValues = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

const classValueType = (
  declaration: ts.ClassLikeDeclarationBase,
  checker: ts.TypeChecker,
): ts.Type => {
  const declarationType = checker.getTypeAtLocation(declaration);
  if (declarationType.getConstructSignatures().length > 0) {
    return declarationType;
  }

  const classSymbol = declarationType.getSymbol();
  return classSymbol === undefined
    ? declarationType
    : checker.getTypeOfSymbolAtLocation(classSymbol, declaration);
};

const classDeclarationForValueType = (
  type: ts.Type,
): ts.ClassLikeDeclarationBase | undefined => {
  const declaration = type
    .getSymbol()
    ?.getDeclarations()
    ?.find(
      (candidate): candidate is ts.ClassLikeDeclarationBase =>
        ts.isClassDeclaration(candidate) || ts.isClassExpression(candidate),
    );
  if (declaration !== undefined) {
    return declaration;
  }

  if (type.isIntersection()) {
    for (const constituent of type.types) {
      const constituentDeclaration =
        classDeclarationForValueType(constituent);
      if (constituentDeclaration !== undefined) {
        return constituentDeclaration;
      }
    }
  }

  return undefined;
};

const isClassOwnedConstructSignature = (
  signature: ts.Signature,
  declaration: ts.ClassLikeDeclarationBase,
): boolean => {
  const signatureDeclaration = signature.getDeclaration();
  return (
    signatureDeclaration === undefined ||
    (ts.isConstructorDeclaration(signatureDeclaration) &&
      signatureDeclaration.parent === declaration)
  );
};

const serializeCheckerSignature = (
  signature: ts.Signature,
  location: ts.Node,
  checker: ts.TypeChecker,
  signatureKind: ts.SignatureKind,
): string =>
  checker.signatureToString(
    signature,
    location,
    ts.TypeFormatFlags.NoTruncation |
      ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    signatureKind,
  );

const serializeClassConstructSignature = (
  signature: ts.Signature,
  location: ts.Node,
  checker: ts.TypeChecker,
): string => {
  const serialized = serializeCheckerSignature(
    signature,
    location,
    checker,
    ts.SignatureKind.Construct,
  );
  const returnTypeDelimiter = serialized.lastIndexOf("): ");
  const constructorShape =
    returnTypeDelimiter < 0
      ? serialized
      : serialized.slice(0, returnTypeDelimiter + 1);
  return `class-constructor:${constructorShape}`;
};

const serializeClassDeclarationConstructor = (
  declaration: ts.ConstructorDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): string => {
  const signature = checker.getSignatureFromDeclaration(declaration);
  return signature === undefined
    ? `class-constructor:${fallbackFunctionSignature(declaration, sourceFile)}`
    : serializeClassConstructSignature(signature, declaration, checker);
};

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
