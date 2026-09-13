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

type ExportSurfaceNamespace = "type" | "value";

interface SurfaceSignature {
  readonly kind: "single" | "overload-group";
  readonly members: readonly string[];
}

interface SignatureRecord {
  readonly key: string;
  readonly namespace: ExportSurfaceNamespace;
  readonly displayName: string;
  readonly signatures: readonly SurfaceSignature[];
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

interface ImportedBinding {
  readonly importedName: string;
  readonly moduleSpecifier: string;
  readonly namespace: ExportSurfaceNamespace;
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
const EXTERNAL_SELF_TYPE = "\0external-self";
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
  const emittedTransitions = new Set<string>();

  for (const [key, currentSignature] of currentSignatures.entries()) {
    const previousSignature = previousSignatures.get(key);
    if (
      previousSignature !== undefined &&
      sameOrderedSurfaceSignatures(
        previousSignature.signatures,
        currentSignature.signatures,
      )
    ) {
      continue;
    }
    const transition = publicApiTransitionKey(
      currentSignature,
      previousSignature?.signatures,
      currentSignature.signatures,
    );
    if (emittedTransitions.has(transition)) {
      continue;
    }
    emittedTransitions.add(transition);

    evidence.push({
      id: buildEvidenceId(
        "public-api-change",
        current.sourceFile.fileName,
        transition,
      ),
      kind: "public-api-change",
      severity: "warning",
      title:
        previousSignature === undefined
          ? "Exported API added"
          : "Exported API signature changed",
      detail:
        previousSignature === undefined
          ? `Added the exported ${currentSignature.namespace} signature for ${currentSignature.displayName}.`
          : `Updated the exported ${currentSignature.namespace} signature for ${currentSignature.displayName}.`,
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
    const transition = publicApiTransitionKey(
      previousSignature,
      previousSignature.signatures,
    );
    if (emittedTransitions.has(transition)) {
      continue;
    }
    emittedTransitions.add(transition);

    evidence.push({
      id: buildEvidenceId(
        "public-api-change",
        current.sourceFile.fileName,
        transition,
      ),
      kind: "public-api-change",
      severity: "warning",
      title: "Exported API removed",
      detail: `Removed the exported ${previousSignature.namespace} signature for ${previousSignature.displayName}.`,
      source: ANALYZER_SOURCE,
      confidence: 0.94,
      range: zeroWidthRangeAtSourceStart(current.sourceFile),
      references: [previousSignature.displayName],
    });
  }

  return evidence;
};

const publicApiTransitionKey = (
  record: Pick<SignatureRecord, "key" | "namespace">,
  previousSignatures: readonly SurfaceSignature[] | undefined,
  currentSignatures?: readonly SurfaceSignature[],
): string =>
  JSON.stringify([
    record.namespace,
    record.key,
    previousSignatures?.map(serializeSurfaceSignature) ?? null,
    currentSignatures?.map(serializeSurfaceSignature) ?? null,
  ]);

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
  const enumsByName = new Map<string, ts.EnumDeclaration>();
  const modulesByName = new Map<string, readonly ts.ModuleDeclaration[]>();
  const importedBindingsByName = new Map<string, ImportedBinding>();
  const identifiersByName = new Map<string, ts.Identifier>();
  const variableNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause !== undefined
    ) {
      const namespace = statement.importClause.isTypeOnly ? "type" : "value";
      if (statement.importClause.name !== undefined) {
        importedBindingsByName.set(statement.importClause.name.text, {
          importedName: "default",
          moduleSpecifier: statement.moduleSpecifier.text,
          namespace,
        });
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamespaceImport(bindings)) {
          importedBindingsByName.set(bindings.name.text, {
            importedName: "*",
            moduleSpecifier: statement.moduleSpecifier.text,
            namespace,
          });
        } else {
          for (const element of bindings.elements) {
            importedBindingsByName.set(element.name.text, {
              importedName: element.propertyName?.text ?? element.name.text,
              moduleSpecifier: statement.moduleSpecifier.text,
              namespace: element.isTypeOnly ? "type" : namespace,
            });
          }
        }
      }
      continue;
    }
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
      ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name)
    ) {
      identifiersByName.set(statement.name.text, statement.name);
      const existing = modulesByName.get(statement.name.text) ?? [];
      modulesByName.set(statement.name.text, [...existing, statement]);
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      identifiersByName.set(statement.name.text, statement.name);
      enumsByName.set(statement.name.text, statement);
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
    enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): void => {
    const key = `value-function:${identity.key}`;
    const overloadDeclarations = declarations.filter(
      (declaration) => declaration.body === undefined,
    );
    const publicDeclarations =
      overloadDeclarations.length > 0 ? overloadDeclarations : declarations;
    const declaration = publicDeclarations[0];
    if (declaration !== undefined) {
      const namedDeclaration = publicDeclarations.find(
        (candidate) =>
          "name" in candidate &&
          candidate.name !== undefined &&
          ts.isIdentifier(candidate.name),
      );
      const symbol =
        namedDeclaration !== undefined &&
        "name" in namedDeclaration &&
        namedDeclaration.name !== undefined
          ? checker.getSymbolAtLocation(namedDeclaration.name)
          : undefined;
      const checkerSignatures =
        symbol === undefined
          ? []
          : checker
              .getTypeOfSymbolAtLocation(symbol, declaration)
              .getCallSignatures();
      const hasJSDocOverload = declarations.some((candidate) =>
        ts.getJSDocTags(candidate).some(ts.isJSDocOverloadTag),
      );
      const signatureSources =
        hasJSDocOverload ||
        checkerSignatures.length > publicDeclarations.length
          ? checkerSignatures.map((signature) => ({
              declaration,
              signature,
            }))
          : publicDeclarations.map((candidate) => ({
              declaration: candidate,
              signature: undefined,
            }));
      appendSignatureRecord(
        signatureTarget,
        "value",
        key,
        identity.displayName,
        overloadGroupSurfaceSignature(
          signatureSources.map(({ declaration: candidate, signature }) =>
            serializeFunctionLikeSignature(
              candidate,
              sourceFile,
              checker,
              signature,
              enclosingSelfTypeSymbols,
            ),
          ),
        ),
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
    const namedDeclaration = publicDeclarations.find(
      (candidate) =>
        "name" in candidate &&
        candidate.name !== undefined &&
        ts.isIdentifier(candidate.name),
    );
    if (
      namedDeclaration !== undefined &&
      "name" in namedDeclaration &&
      namedDeclaration.name !== undefined
    ) {
      const symbol = checker.getSymbolAtLocation(namedDeclaration.name);
      if (symbol !== undefined) {
        appendCheckerSurface(
          identity,
          checker.getTypeOfSymbolAtLocation(symbol, namedDeclaration),
          namedDeclaration,
          "value",
          rangeNode,
          undefined,
          false,
          true,
          enclosingSelfTypeSymbols,
        );
      }
    }
  };

  const appendCheckerSurface = (
    identity: ExportIdentity,
    valueType: ts.Type,
    location: ts.Node,
    namespace: ExportSurfaceNamespace,
    rangeNode?: ts.Node,
    knownClassDeclaration?: ts.ClassLikeDeclarationBase,
    includeValueRoot = false,
    ownMembersOnly = false,
    enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): boolean => {
    const selfTypeSymbols = new Set([
      ...enclosingSelfTypeSymbols,
      ...exportedSelfTypeSymbols(
        valueType,
        location,
        knownClassDeclaration,
        checker,
        namespace,
      ),
    ]);
    const keyFor = (category: string, suffix = ""): string =>
      `${namespace}-${category}:${identity.key}${suffix}`;
    const rememberCommonJsPath = (
      key: string,
      suffix: CommonJsExportPath = [],
    ): void => {
      if (identity.commonJsPath !== undefined) {
        commonJsPathsBySignatureKey.set(key, [
          ...identity.commonJsPath,
          ...suffix,
        ]);
      }
    };
    const appendMemberSignature = (
      separator: "#" | ".",
      memberKey: string,
      memberDisplayName: string,
      category: "method" | "property",
      signature: SurfaceSignature,
      memberLocation: ts.Node,
    ): void => {
      const key = keyFor(category, `${separator}${memberKey}`);
      appendSignatureRecord(
        signatureTarget,
        namespace,
        key,
        `${identity.displayName}${separator}${memberDisplayName}`,
        signature,
        rangeForNode(sourceFile, rangeNode ?? memberLocation),
      );
      rememberCommonJsPath(
        key,
        namespace === "value" && separator === "."
          ? [memberDisplayName]
          : [],
      );
    };
    const appendPublicMembers = (
      type: ts.Type,
      separator: "#" | ".",
      memberSelfTypeSymbols: ReadonlySet<ts.Symbol> = selfTypeSymbols,
    ): boolean => {
      let appendedMember = false;
      const checkerReadonlyMembers = readonlyPropertyNamesForType(
        type,
        location,
        checker,
      );
      const members = [...checker.getPropertiesOfType(type)].sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
      for (const member of members) {
        if (member.name === "prototype") {
          continue;
        }
        const declarations = member.getDeclarations() ?? [];
        const publicDeclarations = declarations.filter(
          (declaration) =>
            declaration.getSourceFile() === sourceFile &&
            !isNonPublicDeclaration(declaration),
        );
        if (declarations.length > 0 && publicDeclarations.length === 0) {
          continue;
        }
        if (
          publicDeclarations.some(
            (declaration) =>
              ts.isFunctionDeclaration(declaration) ||
              ts.isClassDeclaration(declaration) ||
              ts.isEnumDeclaration(declaration) ||
              ts.isModuleDeclaration(declaration),
          )
        ) {
          continue;
        }
        const memberIdentity = surfaceMemberIdentity(
          member,
          publicDeclarations,
          checker,
          sourceFile,
        );
        const memberLocation =
          (member.valueDeclaration !== undefined &&
          !isNonPublicDeclaration(member.valueDeclaration)
            ? member.valueDeclaration
            : undefined) ??
          publicDeclarations[0] ??
          location;
        const declarationMarkers = [
          (member.flags & ts.SymbolFlags.Optional) !== 0 ? "optional" : "",
          publicDeclarations.some((declaration) =>
            hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword),
          ) ||
          publicDeclarations.some(isConstVariableDeclaration) ||
          checkerReadonlyMembers.has(member.name)
            ? "readonly"
            : "",
          publicDeclarations.some((declaration) =>
            hasModifier(declaration, ts.SyntaxKind.AbstractKeyword),
          )
            ? "abstract"
            : "",
          ...publicDeclarations
            .filter(ts.isEnumMember)
            .map((declaration) => checker.getConstantValue(declaration))
            .filter(
              (value): value is string | number => value !== undefined,
            )
            .map((value) => `enum-value:${JSON.stringify(value)}`),
        ]
          .filter((marker) => marker.length > 0)
          .join("|");
        const getter = publicDeclarations.find(ts.isGetAccessorDeclaration);
        const setter = publicDeclarations.find(ts.isSetAccessorDeclaration);
        if (getter !== undefined || setter !== undefined) {
          const accessorTypes: string[] = [];
          if (getter !== undefined) {
            const signature = checker.getSignatureFromDeclaration(getter);
            const getterType =
              signature === undefined
                ? checker.getTypeAtLocation(getter.type ?? getter)
                : checker.getReturnTypeOfSignature(signature);
            accessorTypes.push(
              `getter:${serializeCheckerType(
                getterType,
                getter,
                checker,
                memberSelfTypeSymbols,
              )}`,
            );
          }
          if (setter !== undefined) {
            const parameter = setter.parameters[0];
            const setterTypeNode =
              parameter?.type ??
              (parameter === undefined
                ? undefined
                : ts.getJSDocType(parameter));
            accessorTypes.push(
              setterTypeNode === undefined
                ? "setter:implicit"
                : `setter:${serializeCheckerType(
                    checker.getTypeAtLocation(setterTypeNode),
                    setter,
                    checker,
                    memberSelfTypeSymbols,
                  )}`,
            );
          }
          appendMemberSignature(
            separator,
            memberIdentity.key,
            memberIdentity.displayName,
            "property",
            singleSurfaceSignature(
              [declarationMarkers, ...accessorTypes]
                .filter((marker) => marker.length > 0)
                .join("|"),
            ),
            memberLocation,
          );
          appendedMember = true;
          continue;
        }

        const memberType = checker.getTypeOfSymbolAtLocation(
          member,
          memberLocation,
        );
        const memberCallSignatures = memberType.getCallSignatures();
        const memberConstructSignatures = memberType.getConstructSignatures();
        if (memberCallSignatures.length > 0) {
          const memberSignatureGroups = callSignatureGroupsForType(memberType)
            .filter((group) => group.signatures.length > 0)
            .map((group) =>
              overloadGroupSurfaceSignature(
                group.signatures.map(
                  (signature) =>
                    `${declarationMarkers}:${serializeCheckerSignature(
                      signature,
                      memberLocation,
                      checker,
                      ts.SignatureKind.Call,
                      new Set([
                        ...memberSelfTypeSymbols,
                        ...exportedSelfTypeSymbols(
                          group.type,
                          memberLocation,
                          undefined,
                          checker,
                          namespace,
                        ),
                      ]),
                    )}`,
                ),
              ),
            );
          if (memberType.isIntersection()) {
            memberSignatureGroups.sort((left, right) =>
              serializeSurfaceSignature(left).localeCompare(
                serializeSurfaceSignature(right),
              ),
            );
          }
          for (const signatureGroup of memberSignatureGroups) {
            appendMemberSignature(
              separator,
              memberIdentity.key,
              memberIdentity.displayName,
              "method",
              signatureGroup,
              memberLocation,
            );
          }
        }
        if (memberConstructSignatures.length > 0) {
          const memberSignatureGroups =
            constructSignatureGroupsForType(memberType)
              .map((group) => ({
                type: group.type,
                signatures: group.signatures.filter((signature) => {
                  const declaration = signature.getDeclaration();
                  return (
                    declaration === undefined ||
                    !hasNonPublicModifier(declaration)
                  );
                }),
              }))
              .filter((group) => group.signatures.length > 0)
              .map((group) =>
                overloadGroupSurfaceSignature(
                  group.signatures.map(
                    (signature) =>
                      `${declarationMarkers}:construct:${serializeStructuralConstructSignature(
                        signature,
                        memberLocation,
                        checker,
                        new Set([
                          ...memberSelfTypeSymbols,
                          ...exportedSelfTypeSymbols(
                            group.type,
                            memberLocation,
                            undefined,
                            checker,
                            namespace,
                          ),
                        ]),
                      )}`,
                  ),
                ),
              );
          if (memberType.isIntersection()) {
            memberSignatureGroups.sort((left, right) =>
              serializeSurfaceSignature(left).localeCompare(
                serializeSurfaceSignature(right),
              ),
            );
          }
          for (const signatureGroup of memberSignatureGroups) {
            appendMemberSignature(
              separator,
              memberIdentity.key,
              memberIdentity.displayName,
              "method",
              signatureGroup,
              memberLocation,
            );
          }
        }
        if (
          memberCallSignatures.length > 0 ||
          memberConstructSignatures.length > 0
        ) {
          const readonlyMembers = readonlyPropertyNamesForType(
            memberType,
            memberLocation,
            checker,
          );
          const attachedProperties = checker
            .getPropertiesOfType(memberType)
            .flatMap((attachedMember) => {
              if (attachedMember.name === "prototype") {
                return [];
              }
              const attachedDeclarations =
                attachedMember.getDeclarations() ?? [];
              const publicAttachedDeclarations =
                attachedDeclarations.filter(
                  (declaration) =>
                    declaration.getSourceFile() === sourceFile &&
                    !isNonPublicDeclaration(declaration),
                );
              if (
                attachedDeclarations.length > 0 &&
                publicAttachedDeclarations.length === 0
              ) {
                return [];
              }
              const attachedLocation =
                publicAttachedDeclarations[0] ?? memberLocation;
              const attachedIdentity = surfaceMemberIdentity(
                attachedMember,
                publicAttachedDeclarations,
                checker,
                sourceFile,
              );
              const attachedType = checker.getTypeOfSymbolAtLocation(
                attachedMember,
                attachedLocation,
              );
              return [
                JSON.stringify([
                  attachedIdentity.key,
                  (attachedMember.flags & ts.SymbolFlags.Optional) !== 0,
                  publicAttachedDeclarations.some((declaration) =>
                    hasModifier(
                      declaration,
                      ts.SyntaxKind.ReadonlyKeyword,
                    ),
                  ) ||
                    publicAttachedDeclarations.some(
                      isConstVariableDeclaration,
                    ) ||
                    readonlyMembers.has(attachedMember.name),
                    serializeExportedTypeRoot(
                      attachedType,
                      attachedLocation,
                      checker,
                      memberSelfTypeSymbols,
                      sourceFile,
                    ),
                ]),
              ];
            })
            .sort();
          if (attachedProperties.length > 0) {
            appendMemberSignature(
              separator,
              memberIdentity.key,
              memberIdentity.displayName,
              "method",
              singleSurfaceSignature(
                JSON.stringify(["properties", attachedProperties]),
              ),
              memberLocation,
            );
          }
        }
        if (
          memberCallSignatures.length === 0 &&
          memberConstructSignatures.length === 0
        ) {
          appendMemberSignature(
            separator,
            memberIdentity.key,
            memberIdentity.displayName,
            "property",
            singleSurfaceSignature(
              `${declarationMarkers}:${serializeCheckerType(
                memberType,
                memberLocation,
                checker,
                memberSelfTypeSymbols,
              )}`,
            ),
            memberLocation,
          );
        }
        appendedMember = true;
      }
      return appendedMember;
    };

    const callSignatures = valueType.getCallSignatures();
    const constructSignatures = valueType.getConstructSignatures();
    const classDeclarations =
      knownClassDeclaration === undefined
        ? classDeclarationsForValueType(valueType)
        : [knownClassDeclaration];
    const nonCallableValue =
      namespace === "value" &&
      callSignatures.length === 0 &&
      constructSignatures.length === 0 &&
      classDeclarations.length === 0;
    let appended = false;
    if (
      !ownMembersOnly &&
      (namespace === "type" || includeValueRoot || nonCallableValue)
    ) {
      const key = keyFor("surface");
      appendSignatureRecord(
        signatureTarget,
        namespace,
        key,
        identity.displayName,
        singleSurfaceSignature(
          serializeExportedTypeRoot(
            valueType,
            location,
            checker,
            selfTypeSymbols,
            sourceFile,
          ),
        ),
        rangeForNode(sourceFile, rangeNode ?? location),
      );
      rememberCommonJsPath(key);
      appended = true;
    }

    if (!ownMembersOnly && callSignatures.length > 0) {
      const key = keyFor("function");
      const serializedCallSignatureGroups = callSignatureGroupsForType(
        valueType,
      )
        .filter((group) => group.signatures.length > 0)
        .map((group) =>
          overloadGroupSurfaceSignature(
            group.signatures.map((signature) =>
              serializeCheckerSignature(
                signature,
                location,
                checker,
                ts.SignatureKind.Call,
                new Set([
                  ...selfTypeSymbols,
                  ...exportedSelfTypeSymbols(
                    group.type,
                    location,
                    undefined,
                    checker,
                    namespace,
                  ),
                ]),
              ),
            ),
          ),
        );
      if (valueType.isIntersection()) {
        serializedCallSignatureGroups.sort((left, right) =>
          serializeSurfaceSignature(left).localeCompare(
            serializeSurfaceSignature(right),
          ),
        );
      }
      for (const signatureGroup of serializedCallSignatureGroups) {
        appendSignatureRecord(
          signatureTarget,
          namespace,
          key,
          identity.displayName,
          signatureGroup,
          rangeForNode(sourceFile, rangeNode ?? location),
        );
      }
      rememberCommonJsPath(key);
      appended = true;
    }

    if (
      !ownMembersOnly &&
      namespace === "value" &&
      classDeclarations.length > 0
    ) {
      const classKey = keyFor("class");
      appendSignatureRecord(
        signatureTarget,
        namespace,
        classKey,
        identity.displayName,
        singleSurfaceSignature(
          classDeclarations
            .map((declaration) =>
              hasModifier(declaration, ts.SyntaxKind.AbstractKeyword)
                ? "abstract-class"
                : "concrete-class",
            )
            .sort()
            .join("&"),
        ),
        rangeForNode(sourceFile, rangeNode ?? location),
      );
      rememberCommonJsPath(classKey);
      appended = true;
    }
    const publicConstructSignatureGroups =
      constructSignatureGroupsForType(valueType)
        .map((group) => ({
          type: group.type,
          signatures: group.signatures.filter((signature) => {
            const declaration = signature.getDeclaration();
            return (
              declaration === undefined ||
              !hasNonPublicModifier(declaration)
            );
          }),
        }))
        .filter((group) => group.signatures.length > 0);
    const publicConstructSignatures =
      publicConstructSignatureGroups.flatMap((group) => group.signatures);
    const constructorKey = keyFor("method", "#constructor");
    const nominalClassDeclaration =
      classDeclarations.length === 1 ? classDeclarations[0] : undefined;
    const serializedConstructSignatureGroups =
      publicConstructSignatureGroups.map((group) =>
        overloadGroupSurfaceSignature(
          group.signatures.map((signature) => {
            const nominalClassSignature =
              nominalClassDeclaration !== undefined &&
              isNominalClassConstructSignature(
                signature,
                nominalClassDeclaration,
                checker,
              );
            const constituentSelfTypeSymbols = new Set([
              ...selfTypeSymbols,
              ...exportedSelfTypeSymbols(
                group.type,
                location,
                undefined,
                checker,
                namespace,
              ),
            ]);
            return nominalClassSignature
              ? serializeClassConstructSignature(
                  signature,
                  location,
                  checker,
                  constituentSelfTypeSymbols,
                )
              : serializeStructuralConstructSignature(
                  signature,
                  location,
                  checker,
                  constituentSelfTypeSymbols,
                );
          }),
        ),
      );
    if (valueType.isIntersection()) {
      serializedConstructSignatureGroups.sort((left, right) =>
        serializeSurfaceSignature(left).localeCompare(
          serializeSurfaceSignature(right),
        ),
      );
    }
    if (!ownMembersOnly) {
      for (const serializedSignature of serializedConstructSignatureGroups) {
        appendSignatureRecord(
          signatureTarget,
          namespace,
          constructorKey,
          `${identity.displayName}#constructor`,
          serializedSignature,
          rangeForNode(sourceFile, rangeNode ?? location),
        );
      }
    }
    if (!ownMembersOnly && publicConstructSignatures.length > 0) {
      rememberCommonJsPath(constructorKey);
      appended = true;
    }

    const exposesObjectMembers =
      ownMembersOnly ||
      namespace === "type" ||
      callSignatures.length > 0 ||
      constructSignatures.length > 0 ||
      classDeclarations.length > 0 ||
      (valueType.flags &
        (ts.TypeFlags.Object |
          ts.TypeFlags.Intersection |
          ts.TypeFlags.Union)) !==
        0;
    if (exposesObjectMembers) {
      const ownMemberSeparator =
        namespace === "type" &&
        callSignatures.length === 0 &&
        constructSignatures.length === 0
          ? "#"
          : ".";
      if (appendPublicMembers(valueType, ownMemberSeparator)) {
        appended = true;
      }

      if (!ownMembersOnly) {
        const visitedInstanceTypes = new Set<ts.Type>();
        for (const group of constructSignatureGroupsForType(valueType)) {
          const constituentSelfTypeSymbols = new Set([
            ...selfTypeSymbols,
            ...exportedSelfTypeSymbols(
              group.type,
              location,
              undefined,
              checker,
              namespace,
            ),
          ]);
          for (const signature of group.signatures) {
            const instanceType = signature.getReturnType();
            if (visitedInstanceTypes.has(instanceType)) {
              continue;
            }
            visitedInstanceTypes.add(instanceType);
            if (
              appendPublicMembers(
                instanceType,
                "#",
                constituentSelfTypeSymbols,
              )
            ) {
              appended = true;
            }
          }
        }
      }
    }

    return appended;
  };

  const appendCheckerValue = (
    identity: ExportIdentity,
    location: ts.Node,
    rangeNode?: ts.Node,
    exportedType: ts.Type = checker.getTypeAtLocation(location),
    includeRoot = false,
    enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): boolean => {
    const appended = appendCheckerSurface(
      identity,
      exportedType,
      location,
      "value",
      rangeNode,
      undefined,
      includeRoot,
      false,
      enclosingSelfTypeSymbols,
    );
    for (const declaration of classDeclarationsForValueType(exportedType)) {
      appendCheckerSurface(
        identity,
        classInstanceType(declaration, checker),
        location,
        "type",
        rangeNode,
        declaration,
        false,
        false,
        enclosingSelfTypeSymbols,
      );
    }
    return appended;
  };

  const appendCheckerType = (
    identity: ExportIdentity,
    location: ts.Node,
    rangeNode?: ts.Node,
    exportedType: ts.Type = checker.getTypeAtLocation(location),
    enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): void => {
    appendCheckerSurface(
      identity,
      exportedType,
      location,
      "type",
      rangeNode,
      undefined,
      false,
      false,
      enclosingSelfTypeSymbols,
    );
  };

  const appendClass = (
    identity: ExportIdentity,
    declaration: ts.ClassLikeDeclarationBase,
    rangeNode?: ts.Node,
    enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): void => {
    const valueType = classValueType(declaration, checker);
    appendCheckerSurface(
      identity,
      valueType,
      declaration,
      "value",
      rangeNode,
      declaration,
      false,
      false,
      enclosingSelfTypeSymbols,
    );
    appendCheckerSurface(
      identity,
      classInstanceType(declaration, checker),
      declaration,
      "type",
      rangeNode,
      declaration,
      false,
      false,
      enclosingSelfTypeSymbols,
    );
  };

  const appendEnum = (
    identity: ExportIdentity,
    declaration: ts.EnumDeclaration,
    rangeNode?: ts.Node,
    enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): void => {
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (symbol === undefined) {
      return;
    }
    const enumKey = `value-enum:${identity.key}`;
    appendSignatureRecord(
      signatureTarget,
      "value",
      enumKey,
      identity.displayName,
      singleSurfaceSignature(
        hasModifier(declaration, ts.SyntaxKind.ConstKeyword)
          ? "const-enum"
          : "runtime-enum",
      ),
      rangeForNode(sourceFile, rangeNode ?? declaration.name),
    );
    if (identity.commonJsPath !== undefined) {
      commonJsPathsBySignatureKey.set(enumKey, identity.commonJsPath);
    }
    appendCheckerSurface(
      identity,
      checker.getTypeOfSymbolAtLocation(symbol, declaration.name),
      declaration.name,
      "value",
      rangeNode,
      undefined,
      false,
      false,
      enclosingSelfTypeSymbols,
    );
    appendCheckerSurface(
      identity,
      checker.getDeclaredTypeOfSymbol(symbol),
      declaration.name,
      "type",
      rangeNode,
      undefined,
      false,
      false,
      enclosingSelfTypeSymbols,
    );
  };

  const appendExternalReExport = (
    identity: ExportIdentity,
    namespace: ExportSurfaceNamespace,
    moduleSpecifier: string,
    importedName: string,
    rangeNode: ts.Node,
  ): void => {
    const key = `${namespace}-re-export:${identity.key}`;
    appendSignatureRecord(
      signatureTarget,
      namespace,
      key,
      identity.displayName,
      singleSurfaceSignature(
        `re-export:${
          namespace === "type" ? "type-only" : "value"
        }:${moduleSpecifier}:${importedName}`,
      ),
      rangeForNode(sourceFile, rangeNode),
    );
    if (identity.commonJsPath !== undefined) {
      commonJsPathsBySignatureKey.set(key, identity.commonJsPath);
    }
  };

  const appendNamespace = (
    identity: ExportIdentity,
    declarations: readonly ts.ModuleDeclaration[],
    rangeNode?: ts.Node,
    mergedWithRuntimeDeclaration = false,
    ancestors: ReadonlySet<ts.Symbol> = new Set(),
    enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): void => {
    const declaration = declarations[0];
    if (declaration === undefined) {
      return;
    }
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (symbol === undefined) {
      return;
    }
    const namespaceSymbol = canonicalCheckerSymbol(symbol, checker);
    if (ancestors.has(namespaceSymbol)) {
      return;
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(namespaceSymbol);
    const namespaceSelfTypeSymbols = new Set([
      ...enclosingSelfTypeSymbols,
      namespaceSymbol,
    ]);

    appendCheckerSurface(
      identity,
      checker.getTypeOfSymbolAtLocation(symbol, declaration.name),
      declaration.name,
      "value",
      rangeNode,
      undefined,
      false,
      mergedWithRuntimeDeclaration,
      namespaceSelfTypeSymbols,
    );

    for (const exportedSymbol of checker
      .getExportsOfModule(namespaceSymbol)
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const targetSymbol = canonicalCheckerSymbol(exportedSymbol, checker);
      const exportedDeclarations = (
        targetSymbol.getDeclarations() ?? []
      ).filter((candidate) => candidate.getSourceFile() === sourceFile);
      const memberDeclaration = exportedDeclarations[0];
      if (memberDeclaration === undefined) {
        continue;
      }
      const memberIdentity: ExportIdentity = {
        key: `${identity.key}/namespace-member:${JSON.stringify(
          exportedSymbol.name,
        )}`,
        displayName: `${identity.displayName}.${exportedSymbol.name}`,
        ...(identity.commonJsPath === undefined
          ? {}
          : {
              commonJsPath: [
                ...identity.commonJsPath,
                exportedSymbol.name,
              ],
            }),
      };
      const classDeclaration = exportedDeclarations.find(
        (candidate): candidate is ts.ClassDeclaration =>
          ts.isClassDeclaration(candidate),
      );
      if (classDeclaration !== undefined) {
        appendClass(
          memberIdentity,
          classDeclaration,
          rangeNode,
          namespaceSelfTypeSymbols,
        );
      } else {
        const enumDeclaration = exportedDeclarations.find(ts.isEnumDeclaration);
        if (enumDeclaration !== undefined) {
          appendEnum(
            memberIdentity,
            enumDeclaration,
            rangeNode,
            namespaceSelfTypeSymbols,
          );
        } else {
          const functionDeclarations = exportedDeclarations.filter(
            (candidate): candidate is ts.FunctionDeclaration =>
              ts.isFunctionDeclaration(candidate),
          );
          if (functionDeclarations.length > 0) {
            appendFunction(
              memberIdentity,
              functionDeclarations,
              rangeNode,
              namespaceSelfTypeSymbols,
            );
          }
        }
      }

      const namespaceDeclarations = exportedDeclarations.filter(
        (candidate): candidate is ts.ModuleDeclaration =>
          ts.isModuleDeclaration(candidate),
      );
      if (namespaceDeclarations.length > 0) {
        appendNamespace(
          memberIdentity,
          namespaceDeclarations,
          rangeNode,
          classDeclaration !== undefined ||
            exportedDeclarations.some(ts.isFunctionDeclaration),
          nextAncestors,
          namespaceSelfTypeSymbols,
        );
      }
      if (
        classDeclaration === undefined &&
        !exportedDeclarations.some(ts.isEnumDeclaration) &&
        (targetSymbol.flags & ts.SymbolFlags.EnumMember) === 0 &&
        (targetSymbol.flags & ts.SymbolFlags.Type) !== 0
      ) {
        appendCheckerType(
          memberIdentity,
          memberDeclaration,
          rangeNode,
          checker.getDeclaredTypeOfSymbol(targetSymbol),
          namespaceSelfTypeSymbols,
        );
      }
    }
  };

  const appendLocalExport = (
    localName: string,
    identity: ExportIdentity,
    rangeNode?: ts.Node,
    isTypeOnly?: boolean,
  ): void => {
    const identifier = identifiersByName.get(localName);
    if (identifier === undefined) {
      const importedBinding = importedBindingsByName.get(localName);
      if (importedBinding !== undefined && rangeNode !== undefined) {
        appendExternalReExport(
          identity,
          isTypeOnly === true ? "type" : importedBinding.namespace,
          importedBinding.moduleSpecifier,
          importedBinding.importedName,
          rangeNode,
        );
      }
      return;
    }
    const symbol = checker.getSymbolAtLocation(identifier);
    const hasValueNamespace =
      symbol === undefined || (symbol.flags & ts.SymbolFlags.Value) !== 0;
    const hasTypeNamespace =
      symbol !== undefined && (symbol.flags & ts.SymbolFlags.Type) !== 0;
    const isMergedSymbol = isMergedTypeAndValueSymbol(symbol);
    const exportedValueType =
      symbol === undefined
        ? checker.getTypeAtLocation(identifier)
        : checker.getTypeOfSymbolAtLocation(symbol, identifier);
    if (isTypeOnly === true || !hasValueNamespace) {
      appendCheckerType(
        identity,
        identifier,
        rangeNode,
        symbol === undefined || !hasTypeNamespace
          ? checker.getTypeAtLocation(identifier)
          : checker.getDeclaredTypeOfSymbol(symbol),
      );
      return;
    }
    const enumDeclaration = enumsByName.get(localName);
    if (enumDeclaration !== undefined) {
      appendEnum(identity, enumDeclaration, rangeNode);
      const namespaceDeclarations = modulesByName.get(localName);
      if (namespaceDeclarations !== undefined) {
        appendNamespace(identity, namespaceDeclarations, rangeNode, true);
      }
      return;
    }
    if (variableNames.has(localName)) {
      if (
        appendCheckerValue(
          identity,
          identifier,
          rangeNode,
          exportedValueType,
          isMergedSymbol,
        )
      ) {
        if (isMergedSymbol) {
          appendCheckerType(
            identity,
            identifier,
            rangeNode,
            checker.getDeclaredTypeOfSymbol(symbol),
          );
        }
        return;
      }
    }
    const functions = functionsByName.get(localName);
    if (functions !== undefined) {
      appendFunction(identity, functions, rangeNode);
      const namespaceDeclarations = modulesByName.get(localName);
      if (namespaceDeclarations !== undefined) {
        appendNamespace(identity, namespaceDeclarations, rangeNode, true);
      }
      if (isMergedSymbol) {
        appendCheckerType(
          identity,
          identifier,
          rangeNode,
          checker.getDeclaredTypeOfSymbol(symbol),
        );
      }
      return;
    }
    const declaration = classesByName.get(localName);
    if (declaration !== undefined) {
      appendClass(identity, declaration, rangeNode);
      const namespaceDeclarations = modulesByName.get(localName);
      if (namespaceDeclarations !== undefined) {
        appendNamespace(identity, namespaceDeclarations, rangeNode, true);
      }
      if (isMergedSymbol) {
        appendCheckerType(
          identity,
          identifier,
          rangeNode,
          checker.getDeclaredTypeOfSymbol(symbol),
        );
      }
      return;
    }
    const namespaceDeclarations = modulesByName.get(localName);
    if (namespaceDeclarations !== undefined) {
      appendNamespace(identity, namespaceDeclarations, rangeNode);
      return;
    }
    appendCheckerValue(
      identity,
      identifier,
      rangeNode,
      exportedValueType,
      isMergedSymbol,
    );
    if (isMergedSymbol) {
      appendCheckerType(
        identity,
        identifier,
        rangeNode,
        checker.getDeclaredTypeOfSymbol(symbol),
      );
    }
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
      const declarations =
        statement.name === undefined
          ? [statement]
          : functionsByName.get(statement.name.text) ?? [statement];
      if (declarations[0] !== statement) {
        continue;
      }
      appendFunction(exportIdentity(externalName), declarations);
      continue;
    }

    if (ts.isClassDeclaration(statement) && hasExportModifier(statement)) {
      const externalName = externalDeclarationName(statement);
      if (externalName !== undefined) {
        appendClass(exportIdentity(externalName), statement);
      }
      continue;
    }

    if (ts.isEnumDeclaration(statement) && hasExportModifier(statement)) {
      appendEnum(exportIdentity(statement.name.text), statement);
      continue;
    }

    if (
      ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name) &&
      hasExportModifier(statement)
    ) {
      appendNamespace(
        exportIdentity(statement.name.text),
        modulesByName.get(statement.name.text) ?? [statement],
        undefined,
        functionsByName.has(statement.name.text) ||
          classesByName.has(statement.name.text) ||
          enumsByName.has(statement.name.text),
      );
      continue;
    }

    if (
      (ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)) &&
      hasExportModifier(statement)
    ) {
      appendCheckerType(
        exportIdentity(
          hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
            ? "default"
            : statement.name.text,
        ),
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
        statement.exportClause !== undefined &&
        ts.isNamespaceExport(statement.exportClause) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        appendExternalReExport(
          exportIdentity(statement.exportClause.name.text),
          statement.isTypeOnly ? "type" : "value",
          statement.moduleSpecifier.text,
          "*",
          statement.exportClause.name,
        );
        continue;
      }
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
          const namespace =
            statement.isTypeOnly || element.isTypeOnly ? "type" : "value";
          appendExternalReExport(
            exportIdentity(externalName),
            namespace,
            statement.moduleSpecifier.text,
            localName,
            element.name,
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
  let exportsAliasAttached = true;
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) {
      continue;
    }
    const assignmentChain = commonJsAssignmentChain(statement.expression);
    if (
      assignmentChain !== undefined &&
      (assignmentChain.targets.length > 1 ||
        assignmentChain.targets.some(
          (target) =>
            ts.isIdentifier(target) && target.text === "exports",
        ))
    ) {
      const assignsExportsBinding = assignmentChain.targets.some(
        (target) =>
          ts.isIdentifier(target) && target.text === "exports",
      );
      const assignsModuleRoot = assignmentChain.targets.some(
        (target) => isModuleExports(target),
      );
      const reattachesExports =
        assignsExportsBinding && assignsModuleRoot;
      const moduleRootIndex =
        assignmentChain.targets.findIndex(isModuleExports);
      for (const { target, index } of assignmentChain.targets
        .map((target, index) => ({ target, index }))
        .reverse()) {
        if (moduleRootIndex >= 0 && index < moduleRootIndex) {
          continue;
        }
        const path = commonJsExportPath(target);
        if (
          path === undefined ||
          (commonJsPathUsesExportsAlias(target) &&
            !exportsAliasAttached &&
            !reattachesExports)
        ) {
          continue;
        }
        if (path.length === 0) {
          commonJsSignatures.clear();
          commonJsPathsBySignatureKey.clear();
        } else {
          removeCommonJsExportSignatures(
            commonJsSignatures,
            commonJsPathsBySignatureKey,
            path,
          );
        }
        collectCommonJsExportValue(
          assignmentChain.value,
          path,
          target,
          checker,
          appendFunction,
          appendClass,
          appendLocalExport,
          appendCallableExpression,
          (replacedPath) =>
            removeCommonJsExportSignatures(
              commonJsSignatures,
              commonJsPathsBySignatureKey,
              replacedPath,
            ),
        );
      }
      if (assignsModuleRoot) {
        const value = unwrapExpression(assignmentChain.value);
        exportsAliasAttached =
          reattachesExports ||
          (value !== undefined &&
            ts.isIdentifier(value) &&
            value.text === "exports");
      } else if (assignsExportsBinding) {
        const value = unwrapExpression(assignmentChain.value);
        exportsAliasAttached =
          value !== undefined && isModuleExports(value);
      }
      continue;
    }
    const assignment = commonJsExportAssignment(statement.expression);
    if (assignment === undefined) {
      continue;
    }
    if (
      commonJsPathUsesExportsAlias(assignment.expression.left) &&
      !exportsAliasAttached
    ) {
      continue;
    }
    const assignmentRight = unwrapExpression(assignment.expression.right);
    if (
      exportsAliasAttached &&
      assignment.replacesAll &&
      assignmentRight !== undefined &&
      ts.isIdentifier(assignmentRight) &&
      assignmentRight.text === "exports"
    ) {
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
      checker,
      appendFunction,
      appendClass,
      appendLocalExport,
      appendCallableExpression,
      (replacedPath) =>
        removeCommonJsExportSignatures(
          commonJsSignatures,
          commonJsPathsBySignatureKey,
          replacedPath,
        ),
    );
    if (
      assignment.replacesAll &&
      isModuleExports(assignment.expression.left)
    ) {
      const right = unwrapExpression(assignment.expression.right);
      exportsAliasAttached =
        right !== undefined &&
        ts.isIdentifier(right) &&
        right.text === "exports";
    }
  }
  signatureTarget = signatures;
  for (const record of commonJsSignatures.values()) {
    for (const signature of record.signatures) {
      appendSignatureRecord(
        signatures,
        record.namespace,
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

const isMergedTypeAndValueSymbol = (
  symbol: ts.Symbol | undefined,
): symbol is ts.Symbol =>
  symbol !== undefined &&
  (symbol.flags & ts.SymbolFlags.Value) !== 0 &&
  (symbol.flags & ts.SymbolFlags.Type) !== 0 &&
  (symbol.getDeclarations()?.length ?? 0) > 1;

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
  checker: ts.TypeChecker,
  appendFunction: AppendFunctionExport,
  appendClass: AppendClassExport,
  appendLocalExport: AppendLocalExport,
  appendCallableExpression: AppendCallableExpressionExport,
  removeExportPath: (path: CommonJsExportPath) => void,
): void => {
  collectCommonJsExportValue(
    assignment.expression.right,
    assignment.path,
    assignment.expression.left,
    checker,
    appendFunction,
    appendClass,
    appendLocalExport,
    appendCallableExpression,
    removeExportPath,
  );
};

const collectCommonJsExportValue = (
  expression: ts.Expression,
  path: CommonJsExportPath,
  rangeNode: ts.Node,
  checker: ts.TypeChecker,
  appendFunction: AppendFunctionExport,
  appendClass: AppendClassExport,
  appendLocalExport: AppendLocalExport,
  appendCallableExpression: AppendCallableExpressionExport,
  removeExportPath: (path: CommonJsExportPath) => void,
): void => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped !== undefined && ts.isObjectLiteralExpression(unwrapped)) {
    const accessorDeclarations = new Map<
      string,
      {
        readonly getter: ts.GetAccessorDeclaration | undefined;
        readonly setter: ts.SetAccessorDeclaration | undefined;
      }
    >();
    const overwriteProperty = (propertyName: string): void => {
      removeExportPath([...path, propertyName]);
      accessorDeclarations.delete(propertyName);
    };
    for (const property of unwrapped.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        overwriteProperty(property.name.text);
        appendLocalExport(
          property.name.text,
          commonJsExportIdentity([...path, property.name.text]),
          property.name,
        );
      } else if (ts.isPropertyAssignment(property)) {
        const propertyName = propertyNameText(property.name);
        if (propertyName !== undefined) {
          overwriteProperty(propertyName);
          collectCommonJsExportValue(
            property.initializer,
            [...path, propertyName],
            property.name,
            checker,
            appendFunction,
            appendClass,
            appendLocalExport,
            appendCallableExpression,
            removeExportPath,
          );
        }
      } else if (ts.isSpreadAssignment(property)) {
        const spreadProperties = commonJsSpreadProperties(
          property.expression,
          checker,
        );
        if (spreadProperties.hasUnknownKeys) {
          removeExportPath(path);
          accessorDeclarations.clear();
        } else {
          for (const propertyName of spreadProperties.keys) {
            overwriteProperty(propertyName);
          }
        }
        collectCommonJsExportValue(
          property.expression,
          path,
          property,
          checker,
          appendFunction,
          appendClass,
          appendLocalExport,
          appendCallableExpression,
          removeExportPath,
        );
      } else if (ts.isMethodDeclaration(property)) {
        const propertyName = propertyNameText(property.name);
        if (
          propertyName !== undefined &&
          !isNonPublicDeclaration(property)
        ) {
          overwriteProperty(propertyName);
          appendFunction(
            commonJsExportIdentity([...path, propertyName]),
            [property],
            property.name,
          );
        }
      } else if (
        (ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property)) &&
        !isNonPublicDeclaration(property)
      ) {
        const propertyName = propertyNameText(property.name);
        if (propertyName !== undefined) {
          const existing = accessorDeclarations.get(propertyName);
          const combined = ts.isGetAccessorDeclaration(property)
            ? { getter: property, setter: existing?.setter }
            : { getter: existing?.getter, setter: property };
          removeExportPath([...path, propertyName]);
          accessorDeclarations.set(propertyName, combined);
          appendFunction(
            commonJsExportIdentity([...path, propertyName]),
            [combined.getter, combined.setter].filter(
              (
                declaration,
              ): declaration is
                | ts.GetAccessorDeclaration
                | ts.SetAccessorDeclaration => declaration !== undefined,
            ),
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

interface CommonJsSpreadProperties {
  readonly keys: readonly string[];
  readonly hasUnknownKeys: boolean;
}

const commonJsSpreadProperties = (
  expression: ts.Expression,
  checker: ts.TypeChecker,
): CommonJsSpreadProperties => {
  const keys = new Set<string>();
  let hasUnknownKeys = false;
  const visited = new Set<ts.Type>();
  const visit = (type: ts.Type): void => {
    if (visited.has(type)) {
      return;
    }
    visited.add(type);
    if (type.isUnionOrIntersection()) {
      type.types.forEach(visit);
      return;
    }
    for (const property of checker.getPropertiesOfType(type)) {
      if (property.name !== "prototype") {
        keys.add(property.name);
      }
    }
    if (
      (type.flags &
        (ts.TypeFlags.Any |
          ts.TypeFlags.Unknown |
          ts.TypeFlags.TypeParameter |
          ts.TypeFlags.NonPrimitive)) !==
        0 ||
      checker.getIndexInfosOfType(type).length > 0
    ) {
      hasUnknownKeys = true;
    }
  };
  visit(checker.getTypeAtLocation(expression));
  return { keys: [...keys].sort(), hasUnknownKeys };
};

interface CommonJsAssignmentChain {
  readonly targets: readonly ts.Expression[];
  readonly value: ts.Expression;
}

const commonJsAssignmentChain = (
  expression: ts.Expression,
): CommonJsAssignmentChain | undefined => {
  const targets: ts.Expression[] = [];
  let current = unwrapExpression(expression);
  while (
    current !== undefined &&
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    targets.push(current.left);
    current = unwrapExpression(current.right);
  }
  return targets.length === 0 || current === undefined
    ? undefined
    : { targets, value: current };
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

const commonJsPathUsesExportsAlias = (
  expression: ts.Expression,
): boolean => {
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    if (
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "exports"
    ) {
      return true;
    }
    return commonJsPathUsesExportsAlias(expression.expression);
  }
  return false;
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
  namespace: ExportSurfaceNamespace,
  key: string,
  displayName: string,
  signature: SurfaceSignature,
  range: PairRange,
): void => {
  const existing = signatures.get(key);
  if (existing === undefined) {
    signatures.set(key, {
      key,
      namespace,
      displayName,
      signatures: [signature],
      range,
    });
    return;
  }
  if (
    existing.signatures.some((candidate) =>
      sameSurfaceSignature(candidate, signature),
    )
  ) {
    return;
  }

  signatures.set(key, {
    key,
    namespace: existing.namespace,
    displayName: existing.displayName,
    signatures: [...existing.signatures, signature].sort((left, right) =>
      serializeSurfaceSignature(left).localeCompare(
        serializeSurfaceSignature(right),
      ),
    ),
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

const singleSurfaceSignature = (signature: string): SurfaceSignature => ({
  kind: "single",
  members: [signature],
});

const overloadGroupSurfaceSignature = (
  signatures: readonly string[],
): SurfaceSignature => ({
  kind: "overload-group",
  members: [...new Set(signatures)],
});

const serializeSurfaceSignature = (signature: SurfaceSignature): string =>
  JSON.stringify([signature.kind, signature.members]);

const sameSurfaceSignature = (
  left: SurfaceSignature,
  right: SurfaceSignature,
): boolean =>
  serializeSurfaceSignature(left) === serializeSurfaceSignature(right);

const sameOrderedSurfaceSignatures = (
  left: readonly SurfaceSignature[],
  right: readonly SurfaceSignature[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) =>
    sameSurfaceSignature(value, right[index] as SurfaceSignature),
  );

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

const classInstanceType = (
  declaration: ts.ClassLikeDeclarationBase,
  checker: ts.TypeChecker,
): ts.Type => {
  const valueType = classValueType(declaration, checker);
  const classSymbol =
    declaration.name === undefined
      ? valueType.getSymbol()
      : checker.getSymbolAtLocation(declaration.name);
  if (
    classSymbol !== undefined &&
    (classSymbol.flags & ts.SymbolFlags.Type) !== 0
  ) {
    return checker.getDeclaredTypeOfSymbol(classSymbol);
  }

  return valueType.getConstructSignatures()[0]?.getReturnType() ?? valueType;
};

const classDeclarationsForValueType = (
  type: ts.Type,
): readonly ts.ClassLikeDeclarationBase[] => {
  if (type.isIntersection()) {
    return [
      ...new Set(
        type.types.flatMap((constituent) =>
          classDeclarationsForValueType(constituent),
        ),
      ),
    ];
  }
  if (type.getConstructSignatures().length === 0) {
    return [];
  }

  const declarations =
    type
    .getSymbol()
    ?.getDeclarations()
    ?.filter(
      (candidate): candidate is ts.ClassLikeDeclarationBase =>
        ts.isClassDeclaration(candidate) || ts.isClassExpression(candidate),
    ) ?? [];

  return [...new Set(declarations)];
};

interface CheckerSignatureGroup {
  readonly type: ts.Type;
  readonly signatures: readonly ts.Signature[];
}

const constructSignatureGroupsForType = (
  type: ts.Type,
): readonly CheckerSignatureGroup[] => {
  if (!type.isIntersection()) {
    return [{ type, signatures: type.getConstructSignatures() }];
  }

  return type.types.flatMap((constituent) =>
    constructSignatureGroupsForType(constituent),
  );
};

const callSignatureGroupsForType = (
  type: ts.Type,
): readonly CheckerSignatureGroup[] => {
  if (!type.isIntersection()) {
    return [{ type, signatures: type.getCallSignatures() }];
  }

  return type.types.flatMap((constituent) =>
    callSignatureGroupsForType(constituent),
  );
};

const isNominalClassConstructSignature = (
  signature: ts.Signature,
  declaration: ts.ClassLikeDeclarationBase,
  checker: ts.TypeChecker,
): boolean => {
  const signatureDeclaration = signature.getDeclaration();
  if (
    signatureDeclaration !== undefined &&
    !ts.isConstructorDeclaration(signatureDeclaration)
  ) {
    return false;
  }
  if (
    signatureDeclaration !== undefined &&
    signatureDeclaration.parent === declaration
  ) {
    return true;
  }

  const classSymbol =
    declaration.name === undefined
      ? checker.getTypeAtLocation(declaration).getSymbol()
      : checker.getSymbolAtLocation(declaration.name);
  return (
    classSymbol !== undefined &&
    signature.getReturnType().getSymbol() === classSymbol
  );
};

const exportedSelfTypeSymbols = (
  type: ts.Type,
  location: ts.Node,
  classDeclaration: ts.ClassLikeDeclarationBase | undefined,
  checker: ts.TypeChecker,
  namespace: ExportSurfaceNamespace,
): ReadonlySet<ts.Symbol> => {
  const symbols = new Set<ts.Symbol>();
  const sourceFile = location.getSourceFile();
  const isDocumentSymbol = (symbol: ts.Symbol): boolean =>
    (symbol.getDeclarations() ?? []).some(
      (declaration) => declaration.getSourceFile() === sourceFile,
    );
  const addSymbol = (symbol: ts.Symbol | undefined): void => {
    if (symbol !== undefined) {
      symbols.add(canonicalCheckerSymbol(symbol, checker));
    }
  };
  const visitedTypes = new Set<ts.Type>();
  const visitedSymbols = new Set<ts.Symbol>();
  const recursiveSymbols = new Map<ts.Symbol, boolean>();
  const isRecursiveSymbol = (symbol: ts.Symbol): boolean => {
    const canonicalSymbol = canonicalCheckerSymbol(symbol, checker);
    const cached = recursiveSymbols.get(canonicalSymbol);
    if (cached !== undefined) {
      return cached;
    }
    recursiveSymbols.set(canonicalSymbol, false);
    let recursive = false;
    const visit = (node: ts.Node): void => {
      if (recursive) {
        return;
      }
      const reference =
        ts.isTypeReferenceNode(node)
          ? node.typeName
          : ts.isTypeQueryNode(node)
            ? node.exprName
            : ts.isExpressionWithTypeArguments(node)
              ? node.expression
              : undefined;
      const referenceSymbol =
        reference === undefined
          ? undefined
          : referencedSymbol(reference, checker);
      if (
        referenceSymbol !== undefined &&
        canonicalCheckerSymbol(referenceSymbol, checker) === canonicalSymbol
      ) {
        recursive = true;
        return;
      }
      node.forEachChild(visit);
    };
    for (const declaration of symbol.getDeclarations() ?? []) {
      declaration.forEachChild(visit);
    }
    recursiveSymbols.set(canonicalSymbol, recursive);
    return recursive;
  };
  const addDocumentType = (
    candidate: ts.Type,
    includeRootSymbol: boolean,
  ): void => {
    if (visitedTypes.has(candidate)) {
      return;
    }
    visitedTypes.add(candidate);

    for (const symbol of [candidate.aliasSymbol, candidate.getSymbol()]) {
      if (
        symbol === undefined ||
        !isDocumentSymbol(symbol) ||
        (symbol.flags & ts.SymbolFlags.TypeParameter) !== 0 ||
        visitedSymbols.has(symbol)
      ) {
        continue;
      }
      if (!includeRootSymbol && !isRecursiveSymbol(symbol)) {
        continue;
      }
      visitedSymbols.add(symbol);
      addSymbol(symbol);
      if ((symbol.flags & ts.SymbolFlags.TypeAlias) !== 0) {
        for (const declaration of symbol.getDeclarations() ?? []) {
          if (ts.isTypeAliasDeclaration(declaration)) {
            addDocumentType(
              checker.getTypeAtLocation(declaration.type),
              true,
            );
          }
        }
      }
    }
    if (namespace === "type" && candidate.isUnionOrIntersection()) {
      candidate.types.forEach((constituent) =>
        addDocumentType(constituent, false),
      );
    }
    for (const typeArgument of candidate.aliasTypeArguments ?? []) {
      addDocumentType(typeArgument, false);
    }
    if (
      (candidate.flags & ts.TypeFlags.Object) !== 0 &&
      ((candidate as ts.ObjectType).objectFlags &
        ts.ObjectFlags.Reference) !==
        0
    ) {
      for (const typeArgument of checker.getTypeArguments(
        candidate as ts.TypeReference,
      )) {
        addDocumentType(typeArgument, false);
      }
    }
  };

  const locationSymbol = checker.getSymbolAtLocation(location);
  addSymbol(locationSymbol);
  addSymbol(checker.getSymbolAtLocation(classDeclaration?.name ?? location));
  if ((locationSymbol?.flags ?? 0) & ts.SymbolFlags.TypeAlias) {
    for (const declaration of locationSymbol?.getDeclarations() ?? []) {
      if (ts.isTypeAliasDeclaration(declaration)) {
        addDocumentType(
          checker.getTypeAtLocation(declaration.type),
          true,
        );
      }
    }
  }
  addDocumentType(type, true);
  return symbols;
};

const canonicalCheckerSymbol = (
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Symbol => {
  let current = symbol;
  const visited = new Set<ts.Symbol>();
  while (
    (current.flags & ts.SymbolFlags.Alias) !== 0 &&
    !visited.has(current)
  ) {
    visited.add(current);
    const target = checker.getAliasedSymbol(current);
    if (target === current) {
      break;
    }
    current = target;
  }
  return checker.getExportSymbolOfSymbol(current);
};

interface TypeFingerprintCacheEntry {
  readonly ancestors: ReadonlySet<ts.Symbol>;
  readonly fingerprint: string;
}

type TypeFingerprintCache = Map<
  ts.Type,
  readonly TypeFingerprintCacheEntry[]
>;

interface TypeFingerprintBudget {
  remaining: number;
}

const documentTypeFingerprint = (
  type: ts.Type,
  location: ts.Node,
  checker: ts.TypeChecker,
  selfTypeSymbols: ReadonlySet<ts.Symbol>,
  ancestors: ReadonlySet<ts.Symbol> = new Set(),
  cache: TypeFingerprintCache = new Map(),
  budget: TypeFingerprintBudget = { remaining: 512 },
): string => {
  if (budget.remaining <= 0) {
    return JSON.stringify([
      "bounded-type",
      checker.typeToString(
        type,
        location,
        ts.TypeFormatFlags.NoTruncation |
          ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      ),
    ]);
  }
  budget.remaining -= 1;
  const cached = cache.get(type)?.find(
    (entry) =>
      entry.ancestors.size === ancestors.size &&
      [...entry.ancestors].every((symbol) => ancestors.has(symbol)),
  )?.fingerprint;
  if (cached !== undefined) {
    return cached;
  }
  const finish = (fingerprint: string): string => {
    const entries = cache.get(type) ?? [];
    cache.set(type, [
      ...entries,
      { ancestors: new Set(ancestors), fingerprint },
    ]);
    return fingerprint;
  };
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const importProvenance =
    symbol === undefined ? undefined : importedBindingProvenance(symbol);
  if (importProvenance !== undefined) {
    return finish(
      JSON.stringify(["imported-type", importProvenance]),
    );
  }
  const canonicalSymbol =
    symbol === undefined ? undefined : canonicalCheckerSymbol(symbol, checker);
  if (
    canonicalSymbol !== undefined &&
    selfTypeSymbols.has(canonicalSymbol)
  ) {
    return finish("self");
  }
  if (
    canonicalSymbol !== undefined &&
    (canonicalSymbol.flags & ts.SymbolFlags.TypeParameter) !== 0
  ) {
    const declaration = canonicalSymbol.getDeclarations()?.find(
      ts.isTypeParameterDeclaration,
    );
    const typeParameters =
      declaration === undefined
        ? undefined
        : (
            declaration.parent as ts.Node & {
              readonly typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>;
            }
          ).typeParameters;
    return finish(
      `type-parameter:${
        declaration === undefined ? -1 : typeParameters?.indexOf(declaration)
      }`,
    );
  }
  const localEnumDeclarations =
    [
      ...new Set(
        (canonicalSymbol?.getDeclarations() ?? []).flatMap((declaration) => {
          const enumDeclaration = ts.isEnumDeclaration(declaration)
            ? declaration
            : ts.isEnumMember(declaration)
              ? declaration.parent
              : undefined;
          return enumDeclaration !== undefined &&
            enumDeclaration.getSourceFile() === location.getSourceFile()
            ? [enumDeclaration]
            : [];
        }),
      ),
    ];
  if (localEnumDeclarations.length > 0) {
    return finish(
      JSON.stringify(
        localEnumDeclarations.map((declaration) => [
          hasModifier(declaration, ts.SyntaxKind.ConstKeyword),
          declaration.members.map((member) => [
            propertyNameText(member.name) ?? "",
            checker.getConstantValue(member) ?? null,
          ]),
        ]),
      ),
    );
  }
  if (type.isUnionOrIntersection()) {
    return finish(
      JSON.stringify([
        type.isUnion() ? "union" : "intersection",
        type.types
          .map((constituent) =>
            hashSurfaceFingerprint(
              documentTypeFingerprint(
                constituent,
                location,
                checker,
                selfTypeSymbols,
                ancestors,
                cache,
                budget,
              ),
            ),
          )
          .sort(),
      ]),
    );
  }

  const sourceFile = location.getSourceFile();
  const documentDeclarations =
    canonicalSymbol?.getDeclarations()?.filter(
      (declaration) => declaration.getSourceFile() === sourceFile,
    ) ?? [];
  if (canonicalSymbol !== undefined && documentDeclarations.length > 0) {
    if (ancestors.has(canonicalSymbol)) {
      return "recursive-local-type";
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(canonicalSymbol);
    const propertyWorklist = checker
      .getPropertiesOfType(type)
      .flatMap((member) => {
        const declarations = (member.getDeclarations() ?? []).filter(
          (declaration) =>
            declaration.getSourceFile() === sourceFile &&
            !isNonPublicDeclaration(declaration),
        );
        const declaration = declarations[0];
        if (declaration === undefined) {
          return [];
        }
        return [
          {
            declaration,
            declarations,
            identity: surfaceMemberIdentity(
              member,
              declarations,
              checker,
              sourceFile,
            ),
            member,
          },
        ];
      })
      .sort((left, right) =>
        left.identity.key.localeCompare(right.identity.key),
      );
    const properties = propertyWorklist.map(
      ({ declaration, declarations, identity, member }) => {
        const getter = declarations.find(ts.isGetAccessorDeclaration);
        const setter = declarations.find(ts.isSetAccessorDeclaration);
        const memberFingerprint =
          getter === undefined && setter === undefined
            ? documentTypeFingerprint(
                checker.getTypeOfSymbolAtLocation(member, declaration),
                declaration,
                checker,
                selfTypeSymbols,
                nextAncestors,
                cache,
                budget,
              )
            : JSON.stringify([
                "accessor",
                getter === undefined
                  ? null
                  : documentTypeFingerprint(
                      checker.getSignatureFromDeclaration(getter) === undefined
                        ? checker.getTypeAtLocation(getter.type ?? getter)
                        : checker.getReturnTypeOfSignature(
                            checker.getSignatureFromDeclaration(
                              getter,
                            ) as ts.Signature,
                          ),
                      getter,
                      checker,
                      selfTypeSymbols,
                      nextAncestors,
                      cache,
                      budget,
                    ),
                (() => {
                  if (setter === undefined) {
                    return null;
                  }
                  const parameter = setter.parameters[0];
                  const typeNode =
                    parameter?.type ??
                    (parameter === undefined
                      ? undefined
                      : ts.getJSDocType(parameter));
                  return typeNode === undefined
                    ? "implicit"
                    : documentTypeFingerprint(
                        checker.getTypeAtLocation(typeNode),
                        typeNode,
                        checker,
                        selfTypeSymbols,
                        nextAncestors,
                        cache,
                        budget,
                      );
                })(),
              ]);
        return JSON.stringify([
          identity.key,
          (member.flags & ts.SymbolFlags.Optional) !== 0,
          declarations.some((candidate) =>
            hasModifier(candidate, ts.SyntaxKind.ReadonlyKeyword),
          ) || declarations.some(isConstVariableDeclaration),
          memberFingerprint,
        ]);
      },
    );
    const signatures = [
      ...type.getCallSignatures(),
      ...type.getConstructSignatures(),
    ].map((signature) => {
      const declaration = signature.getDeclaration() ?? location;
      return JSON.stringify([
        signature.getParameters().map((parameter) =>
          JSON.stringify([
            (parameter.flags & ts.SymbolFlags.Optional) !== 0,
            parameter
              .getDeclarations()
              ?.some(
                (parameterDeclaration) =>
                  ts.isParameter(parameterDeclaration) &&
                  parameterDeclaration.dotDotDotToken !== undefined,
              ) ?? false,
            documentTypeFingerprint(
              checker.getTypeOfSymbolAtLocation(parameter, declaration),
              declaration,
              checker,
              selfTypeSymbols,
              nextAncestors,
              cache,
              budget,
            ),
          ]),
        ),
        (signature.typeParameters ?? []).map((typeParameter) =>
          JSON.stringify([
            checker.getBaseConstraintOfType(typeParameter) === undefined
              ? null
              : documentTypeFingerprint(
                  checker.getBaseConstraintOfType(
                    typeParameter,
                  ) as ts.Type,
                  declaration,
                  checker,
                  selfTypeSymbols,
                  nextAncestors,
                  cache,
                  budget,
                ),
            checker.getDefaultFromTypeParameter(typeParameter) === undefined
              ? null
              : documentTypeFingerprint(
                  checker.getDefaultFromTypeParameter(
                    typeParameter,
                  ) as ts.Type,
                  declaration,
                  checker,
                  selfTypeSymbols,
                  nextAncestors,
                  cache,
                  budget,
                ),
          ]),
        ),
        documentTypeFingerprint(
          checker.getReturnTypeOfSignature(signature),
          declaration,
          checker,
          selfTypeSymbols,
          nextAncestors,
          cache,
          budget,
        ),
      ]);
    });
    const indexes = checker.getIndexInfosOfType(type).map((indexInfo) =>
      JSON.stringify([
        indexInfo.isReadonly,
        documentTypeFingerprint(
          indexInfo.keyType,
          indexInfo.declaration ?? location,
          checker,
          selfTypeSymbols,
          nextAncestors,
          cache,
          budget,
        ),
        documentTypeFingerprint(
          indexInfo.type,
          indexInfo.declaration ?? location,
          checker,
          selfTypeSymbols,
          nextAncestors,
          cache,
          budget,
        ),
      ]),
    );
    const aliases = documentDeclarations
      .filter(ts.isTypeAliasDeclaration)
      .map((declaration) =>
        documentTypeFingerprint(
          checker.getTypeAtLocation(declaration.type),
          declaration.type,
          checker,
          selfTypeSymbols,
          nextAncestors,
          cache,
          budget,
        ),
      );
    const enums = documentDeclarations
      .filter(ts.isEnumDeclaration)
      .map((declaration) =>
        JSON.stringify([
          hasModifier(declaration, ts.SyntaxKind.ConstKeyword),
          declaration.members.map((member) => [
            propertyNameText(member.name) ?? "",
            checker.getConstantValue(member) ?? null,
          ]),
        ]),
      );
    return finish(
      JSON.stringify([
        "document-type",
        properties.map(hashSurfaceFingerprint),
        signatures.map(hashSurfaceFingerprint),
        indexes.map(hashSurfaceFingerprint),
        aliases.map(hashSurfaceFingerprint),
        enums.map(hashSurfaceFingerprint),
      ]),
    );
  }

  const typeArguments = [
    ...(type.aliasTypeArguments ?? []),
    ...((type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
      ? checker.getTypeArguments(type as ts.TypeReference)
      : []),
  ].map((typeArgument) =>
    documentTypeFingerprint(
      typeArgument,
      location,
      checker,
      selfTypeSymbols,
      ancestors,
      cache,
      budget,
    ),
  );
  return finish(
    JSON.stringify([
      "external-type",
      checker.typeToString(
        type,
        location,
        ts.TypeFormatFlags.NoTruncation |
          ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      ),
      typeArguments.map(hashSurfaceFingerprint),
    ]),
  );
};

const hashSurfaceFingerprint = (fingerprint: string): string =>
  createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);

type SymbolBearingNode = ts.Node & {
  readonly symbol?: ts.Symbol;
};

const referencedSymbol = (
  node: ts.EntityName | ts.Expression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined => {
  let terminal: ts.Node = node;
  while (ts.isQualifiedName(terminal)) {
    terminal = terminal.right;
  }
  while (ts.isPropertyAccessExpression(terminal)) {
    terminal = terminal.name;
  }
  return (
    checker.getSymbolAtLocation(terminal) ??
    (terminal as SymbolBearingNode).symbol
  );
};

const importedBindingProvenance = (
  symbol: ts.Symbol,
): string | undefined => {
  for (const declaration of symbol.getDeclarations() ?? []) {
    let importDeclaration: ts.Node | undefined = declaration;
    while (
      importDeclaration !== undefined &&
      !ts.isImportDeclaration(importDeclaration)
    ) {
      importDeclaration = importDeclaration.parent;
    }
    if (
      importDeclaration === undefined ||
      !ts.isImportDeclaration(importDeclaration) ||
      !ts.isStringLiteral(importDeclaration.moduleSpecifier)
    ) {
      continue;
    }
    const importedName = ts.isImportSpecifier(declaration)
      ? declaration.propertyName?.text ?? declaration.name.text
      : ts.isNamespaceImport(declaration)
        ? "*"
        : ts.isImportClause(declaration)
          ? "default"
          : undefined;
    if (importedName === undefined) {
      continue;
    }
    return JSON.stringify([
      importDeclaration.moduleSpecifier.text,
      importedName,
      importDeclaration.importClause?.isTypeOnly === true ||
        (ts.isImportSpecifier(declaration) && declaration.isTypeOnly)
        ? "type"
        : "value",
    ]);
  }
  return undefined;
};

const importedReferenceProvenance = (
  node: ts.EntityName | ts.Expression,
  checker: ts.TypeChecker,
): string | undefined => {
  const suffix: string[] = [];
  let root: ts.Node = node;
  while (ts.isQualifiedName(root)) {
    suffix.unshift(root.right.text);
    root = root.left;
  }
  while (ts.isPropertyAccessExpression(root)) {
    suffix.unshift(root.name.text);
    root = root.expression;
  }
  if (!ts.isIdentifier(root)) {
    return undefined;
  }
  const symbol =
    checker.getSymbolAtLocation(root) ??
    (root as SymbolBearingNode).symbol;
  const provenance =
    symbol === undefined ? undefined : importedBindingProvenance(symbol);
  return provenance === undefined
    ? undefined
    : JSON.stringify([provenance, suffix]);
};

const importedProvenancesInNode = (
  node: ts.Node | undefined,
  checker: ts.TypeChecker,
): readonly string[] => {
  if (node === undefined) {
    return [];
  }
  const provenances = new Set<string>();
  const visit = (candidate: ts.Node): void => {
    const reference =
      ts.isTypeReferenceNode(candidate)
        ? candidate.typeName
        : ts.isTypeQueryNode(candidate)
          ? candidate.exprName
          : ts.isExpressionWithTypeArguments(candidate)
            ? candidate.expression
            : undefined;
    if (reference !== undefined) {
      const provenance = importedReferenceProvenance(reference, checker);
      if (provenance !== undefined) {
        provenances.add(provenance);
      }
    }
    candidate.forEachChild(visit);
  };
  visit(node);
  return [...provenances].sort();
};

const printCanonicalSurfaceNode = (
  node: ts.Node,
  location: ts.Node,
  checker: ts.TypeChecker,
  selfTypeSymbols: ReadonlySet<ts.Symbol>,
  symbolSubstitutions: ReadonlyMap<ts.Symbol, string> = new Map(),
): string => {
  let selfReferenceCount = 0;
  const stableSelfSymbols = new Set<ts.Symbol>();
  const addStableSymbol = (symbol: ts.Symbol | undefined): void => {
    if (symbol !== undefined) {
      const canonicalSymbol = canonicalCheckerSymbol(symbol, checker);
      if (selfTypeSymbols.has(canonicalSymbol)) {
        stableSelfSymbols.add(canonicalSymbol);
      }
    }
  };
  addStableSymbol(checker.getSymbolAtLocation(location));
  const locationName = (location as ts.NamedDeclaration).name;
  if (locationName !== undefined && ts.isIdentifier(locationName)) {
    addStableSymbol(checker.getSymbolAtLocation(locationName));
  }
  const locationType = checker.getTypeAtLocation(location);
  addStableSymbol(locationType.aliasSymbol);
  addStableSymbol(locationType.getSymbol());
  let enclosing: ts.Node | undefined = location.parent;
  while (enclosing !== undefined) {
    if (
      ts.isModuleDeclaration(enclosing) ||
      ts.isClassDeclaration(enclosing) ||
      ts.isClassExpression(enclosing)
    ) {
      addStableSymbol(
        checker.getSymbolAtLocation(enclosing.name ?? enclosing),
      );
    }
    enclosing = enclosing.parent;
  }
  const selfReferenceTokens = new Map<ts.Symbol, string>();
  const selfReferenceToken = (symbol: ts.Symbol): string => {
    if (stableSelfSymbols.has(symbol)) {
      return EXTERNAL_SELF_TYPE;
    }
    const existing = selfReferenceTokens.get(symbol);
    if (existing !== undefined) {
      return existing;
    }
    const declaration =
      symbol.valueDeclaration ?? symbol.getDeclarations()?.[0] ?? location;
    const type =
      (symbol.flags & ts.SymbolFlags.Type) !== 0
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const token = `${EXTERNAL_SELF_TYPE}:${hashSurfaceFingerprint(
      documentTypeFingerprint(
        type,
        declaration,
        checker,
        new Set(),
      ),
    )}`;
    selfReferenceTokens.set(symbol, token);
    return token;
  };
  const replacementFor = (
    reference: ts.EntityName | ts.Expression,
  ): string | undefined => {
    const importedReference = importedReferenceProvenance(
      reference,
      checker,
    );
    if (importedReference !== undefined) {
      return `\0import:${hashSurfaceFingerprint(importedReference)}`;
    }
    const symbol = referencedSymbol(reference, checker);
    if (symbol === undefined) {
      return undefined;
    }
    const importProvenance = importedBindingProvenance(symbol);
    if (importProvenance !== undefined) {
      return `\0import:${hashSurfaceFingerprint(importProvenance)}`;
    }
    const canonicalSymbol = canonicalCheckerSymbol(symbol, checker);
    if (selfTypeSymbols.has(canonicalSymbol)) {
      selfReferenceCount += 1;
      return selfReferenceToken(canonicalSymbol);
    }
    return symbolSubstitutions.get(canonicalSymbol);
  };
  const printer = ts.createPrinter(
    {
      removeComments: true,
      omitTrailingSemicolon: true,
    },
    {
      substituteNode: (_hint, candidate) => {
        if (ts.isTypeReferenceNode(candidate)) {
          const replacement = replacementFor(candidate.typeName);
          if (replacement === undefined) {
            return candidate;
          }
          return ts.factory.updateTypeReferenceNode(
            candidate,
            ts.factory.createIdentifier(replacement),
            candidate.typeArguments,
          );
        }
        if (ts.isTypeQueryNode(candidate)) {
          const replacement = replacementFor(candidate.exprName);
          if (replacement === undefined) {
            return candidate;
          }
          return ts.factory.updateTypeQueryNode(
            candidate,
            ts.factory.createIdentifier(replacement),
            candidate.typeArguments,
          );
        }
        if (ts.isExpressionWithTypeArguments(candidate)) {
          const replacement = replacementFor(candidate.expression);
          if (replacement === undefined) {
            return candidate;
          }
          return ts.factory.updateExpressionWithTypeArguments(
            candidate,
            ts.factory.createIdentifier(replacement),
            candidate.typeArguments,
          );
        }
        return candidate;
      },
    },
  );
  return JSON.stringify([
    "surface-node",
    printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      location.getSourceFile(),
    ),
    selfReferenceCount,
  ]);
};

const serializeCheckerSignature = (
  signature: ts.Signature,
  location: ts.Node,
  checker: ts.TypeChecker,
  signatureKind: ts.SignatureKind,
  selfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
  sourceSignature?: ts.SignatureDeclaration,
): string => {
  const declaration =
    sourceSignature ??
    checker.signatureToSignatureDeclaration(
      signature,
      signatureKind === ts.SignatureKind.Construct
        ? ts.SyntaxKind.ConstructSignature
        : ts.SyntaxKind.CallSignature,
      location,
      ts.NodeBuilderFlags.NoTruncation |
        ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope,
    );
  const serialized = declaration === undefined
    ? checker.signatureToString(
      signature,
      location,
      ts.TypeFormatFlags.NoTruncation |
        ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      signatureKind,
    )
    : printCanonicalSurfaceNode(
        declaration,
        location,
        checker,
        selfTypeSymbols,
      );
  const signatureDeclaration = signature.getDeclaration() ?? location;
  return JSON.stringify([
    "signature",
    serialized,
    signature.getParameters().map((parameter, index) => {
    const importProvenances = importedProvenancesInNode(
      sourceSignature?.parameters[index]?.type,
      checker,
    );
    return importProvenances.length > 0
      ? JSON.stringify(["imports", importProvenances])
      : documentTypeFingerprint(
          checker.getTypeOfSymbolAtLocation(
            parameter,
            signatureDeclaration,
          ),
          signatureDeclaration,
          checker,
          selfTypeSymbols,
        );
    }),
    (() => {
    const importProvenances = importedProvenancesInNode(
      sourceSignature?.type,
      checker,
    );
    return importProvenances.length > 0
      ? JSON.stringify(["imports", importProvenances])
      : documentTypeFingerprint(
          checker.getReturnTypeOfSignature(signature),
          signatureDeclaration,
          checker,
          selfTypeSymbols,
        );
    })(),
  ]);
};

const serializeCheckerType = (
  type: ts.Type,
  location: ts.Node,
  checker: ts.TypeChecker,
  selfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
): string => {
  const typeNode = checker.typeToTypeNode(
    type,
    location,
    ts.NodeBuilderFlags.InTypeAlias |
      ts.NodeBuilderFlags.NoTruncation |
      ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope,
  );
  const serialized = typeNode === undefined
    ? checker.typeToString(
        type,
        location,
        ts.TypeFormatFlags.InTypeAlias |
          ts.TypeFormatFlags.NoTruncation |
          ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      )
    : printCanonicalSurfaceNode(
        typeNode,
        location,
        checker,
        selfTypeSymbols,
      );
  return JSON.stringify([
    "type",
    serialized,
    documentTypeFingerprint(
      type,
      location,
      checker,
      selfTypeSymbols,
    ),
  ]);
};

const readonlyPropertyNamesForType = (
  type: ts.Type,
  location: ts.Node,
  checker: ts.TypeChecker,
): ReadonlySet<string> => {
  const typeNode = checker.typeToTypeNode(
    type,
    location,
    ts.NodeBuilderFlags.InTypeAlias |
      ts.NodeBuilderFlags.NoTruncation |
      ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope,
  );
  const names = new Set<string>();
  const visitRootType = (node: ts.TypeNode): void => {
    if (ts.isParenthesizedTypeNode(node)) {
      visitRootType(node.type);
      return;
    }
    if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
      node.types.forEach(visitRootType);
      return;
    }
    if (!ts.isTypeLiteralNode(node)) {
      return;
    }
    for (const member of node.members) {
      if (
        ts.isPropertySignature(member) &&
        hasModifier(member, ts.SyntaxKind.ReadonlyKeyword)
      ) {
        const name = propertyNameText(member.name);
        if (name !== undefined) {
          names.add(name);
        }
      }
    }
  };
  if (typeNode !== undefined) {
    visitRootType(typeNode);
  }
  return names;
};

const serializeMappedTypeSurface = (
  declaration: ts.TypeAliasDeclaration,
  checker: ts.TypeChecker,
  selfTypeSymbols: ReadonlySet<ts.Symbol>,
): string => {
  const mappedType = declaration.type;
  if (!ts.isMappedTypeNode(mappedType)) {
    return "";
  }
  const substitutions = new Map<ts.Symbol, string>();
  const addTypeParameter = (
    parameter: ts.TypeParameterDeclaration,
    position: string,
  ): void => {
    const symbol = checker.getSymbolAtLocation(parameter.name);
    if (symbol !== undefined) {
      substitutions.set(
        canonicalCheckerSymbol(symbol, checker),
        `\0type-parameter:${position}`,
      );
    }
  };
  declaration.typeParameters?.forEach((parameter, index) =>
    addTypeParameter(parameter, `outer:${index}`),
  );
  addTypeParameter(mappedType.typeParameter, "mapped:0");
  const serializeNode = (node: ts.Node | undefined): string | null =>
    node === undefined
      ? null
      : printCanonicalSurfaceNode(
          node,
          declaration,
          checker,
          selfTypeSymbols,
          substitutions,
        );

  return JSON.stringify([
    mappedType.readonlyToken?.kind ?? null,
    mappedType.questionToken?.kind ?? null,
    ts.getModifiers(mappedType.typeParameter)
      ?.map((modifier) => modifier.kind)
      .sort((left, right) => left - right) ?? [],
    serializeNode(mappedType.typeParameter.constraint),
    serializeNode(mappedType.nameType),
    serializeNode(mappedType.type),
    (mappedType.members ?? [])
      .map((member) => serializeNode(member))
      .sort(),
  ]);
};

const serializeExportedTypeRoot = (
  type: ts.Type,
  location: ts.Node,
  checker: ts.TypeChecker,
  selfTypeSymbols: ReadonlySet<ts.Symbol>,
  sourceFile: ts.SourceFile,
  ancestors: ReadonlySet<ts.Type> = new Set(),
): string => {
  if (ancestors.has(type)) {
    return "recursive-type";
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(type);

  const ownSurface = type.isIntersection()
    ? JSON.stringify([
        "intersection",
        [
          ...new Set(
            type.types.map((constituent) =>
              serializeExportedTypeRoot(
                constituent,
                location,
                checker,
                selfTypeSymbols,
                sourceFile,
                nextAncestors,
              ),
            ),
          ),
        ].sort(),
      ])
    : undefined;

  const resolvedSymbolDeclarations =
    type.getSymbol()?.getDeclarations() ?? [];
  const symbolDeclarations = [
    ...new Set([
      ...(type.aliasSymbol?.getDeclarations() ?? []),
      ...resolvedSymbolDeclarations,
    ]),
  ];
  const hasDocumentShape =
    resolvedSymbolDeclarations.some(
      (declaration) => declaration.getSourceFile() === sourceFile,
    ) ||
    checker.getPropertiesOfType(type).some(
      (member) =>
        member.name !== "prototype" &&
        (member.getDeclarations() ?? []).some(
          (declaration) =>
            declaration.getSourceFile() === sourceFile &&
            !isNonPublicDeclaration(declaration),
        ),
    );
  const rootSurface =
    ownSurface ??
    ((type.flags & ts.TypeFlags.Object) !== 0 && hasDocumentShape
      ? "structural-type"
      : serializeCheckerType(type, location, checker, selfTypeSymbols));
  const baseTypes = type.isClassOrInterface()
    ? type.getBaseTypes() ?? []
    : [];
  const baseSurfaces = [
    ...new Set(
      baseTypes.map((baseType) =>
        serializeExportedTypeRoot(
          baseType,
          location,
          checker,
          selfTypeSymbols,
          sourceFile,
          nextAncestors,
        ),
      ),
    ),
  ].sort();
  const heritageTypes = symbolDeclarations
    .filter(
      (
        declaration,
      ): declaration is
        | ts.ClassDeclaration
        | ts.ClassExpression
        | ts.InterfaceDeclaration =>
        ts.isClassDeclaration(declaration) ||
        ts.isClassExpression(declaration) ||
        ts.isInterfaceDeclaration(declaration),
    )
    .flatMap((declaration) =>
      (declaration.heritageClauses ?? [])
        .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        .flatMap((clause) =>
          clause.types.map((heritageType) =>
            printCanonicalSurfaceNode(
              heritageType,
              declaration,
              checker,
              selfTypeSymbols,
            ),
          ),
        ),
    );
  const hasUnresolvedHeritage =
    heritageTypes.length > baseTypes.length ||
    baseTypes.some(
      (baseType) =>
        (baseType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0,
    );
  const unresolvedHeritageSurfaces = hasUnresolvedHeritage
    ? [...new Set(heritageTypes)].sort()
    : [];
  const indexSurfaces = checker
    .getIndexInfosOfType(type)
    .map((indexInfo) =>
      JSON.stringify([
        indexInfo.isReadonly ? "readonly" : "mutable",
        serializeCheckerType(
          indexInfo.keyType,
          indexInfo.declaration ?? location,
          checker,
          selfTypeSymbols,
        ),
        serializeCheckerType(
          indexInfo.type,
          indexInfo.declaration ?? location,
          checker,
          selfTypeSymbols,
        ),
      ]),
    )
    .sort();
  const mappedTypeSurfaces = symbolDeclarations
    .filter(
      (
        declaration,
      ): declaration is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(declaration) &&
        ts.isMappedTypeNode(declaration.type),
    )
    .map((declaration) =>
      serializeMappedTypeSurface(
        declaration,
        checker,
        selfTypeSymbols,
      ),
    )
    .sort();
  const typeParameterSurfaces = [
    ...new Set(
      [type.aliasSymbol, type.getSymbol()]
        .flatMap((symbol) => symbol?.getDeclarations() ?? [])
        .filter(
          (declaration) => declaration.getSourceFile() === sourceFile,
        )
        .flatMap((declaration) => {
          const typeParameters = (
            declaration as ts.Declaration & {
              readonly typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>;
            }
          ).typeParameters;
          return (typeParameters ?? []).map((parameter, index) =>
            JSON.stringify([
              index,
              ts.getModifiers(parameter)
                ?.map((modifier) => modifier.kind)
                .sort((left, right) => left - right) ?? [],
              parameter.constraint === undefined
                ? null
                : serializeCheckerType(
                    checker.getTypeAtLocation(parameter.constraint),
                    parameter.constraint,
                    checker,
                    selfTypeSymbols,
                  ),
              parameter.default === undefined
                ? null
                : serializeCheckerType(
                    checker.getTypeAtLocation(parameter.default),
                    parameter.default,
                    checker,
                    selfTypeSymbols,
                  ),
            ]),
          );
        }),
    ),
  ].sort();
  if (
    baseSurfaces.length === 0 &&
    unresolvedHeritageSurfaces.length === 0 &&
    indexSurfaces.length === 0 &&
    mappedTypeSurfaces.length === 0 &&
    typeParameterSurfaces.length === 0
  ) {
    return rootSurface;
  }
  return JSON.stringify([
    "surface",
    rootSurface,
    baseSurfaces,
    unresolvedHeritageSurfaces,
    indexSurfaces,
    mappedTypeSurfaces,
    typeParameterSurfaces,
  ]);
};

const serializeClassConstructSignature = (
  signature: ts.Signature,
  location: ts.Node,
  checker: ts.TypeChecker,
  selfTypeSymbols: ReadonlySet<ts.Symbol>,
): string => {
  const serialized = serializeCheckerSignature(
    signature,
    location,
    checker,
    ts.SignatureKind.Construct,
    selfTypeSymbols,
  );
  return `class-constructor:${serialized}`;
};

const serializeStructuralConstructSignature = (
  signature: ts.Signature,
  location: ts.Node,
  checker: ts.TypeChecker,
  selfTypeSymbols: ReadonlySet<ts.Symbol>,
): string =>
  `${
    isAbstractConstructSignature(signature, location)
      ? "abstract:"
      : ""
  }${serializeCheckerSignature(
    signature,
    location,
    checker,
    ts.SignatureKind.Construct,
    selfTypeSymbols,
  )}`;

const isAbstractConstructSignature = (
  signature: ts.Signature,
  fallback: ts.Node,
): boolean => {
  const declaration = signature.getDeclaration() ?? fallback;
  if (hasModifier(declaration, ts.SyntaxKind.AbstractKeyword)) {
    return true;
  }
  return (
    ts.isConstructorDeclaration(declaration) &&
    (ts.isClassDeclaration(declaration.parent) ||
      ts.isClassExpression(declaration.parent)) &&
    hasModifier(declaration.parent, ts.SyntaxKind.AbstractKeyword)
  );
};

const serializeFunctionLikeSignature = (
  declaration: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  providedSignature?: ts.Signature,
  enclosingSelfTypeSymbols: ReadonlySet<ts.Symbol> = new Set(),
): string => {
  const syntaxMarkers = [
    ts.isGetAccessorDeclaration(declaration) ? "getter" : "",
    ts.isSetAccessorDeclaration(declaration) ? "setter" : "",
    hasModifier(declaration, ts.SyntaxKind.AsyncKeyword) ? "async" : "",
    hasModifier(declaration, ts.SyntaxKind.StaticKeyword) ? "static" : "",
    declaration.asteriskToken === undefined ? "" : "generator",
    declaration.questionToken === undefined ? "" : "optional",
    declaration.exclamationToken === undefined ? "" : "definite",
  ]
    .filter((value) => value.length > 0)
    .join("|");
  const signature =
    providedSignature ?? checker.getSignatureFromDeclaration(declaration);
  const sourceSignature =
    providedSignature === undefined &&
    declaration.type !== undefined &&
    declaration.parameters.every(
      (parameter) => parameter.type !== undefined,
    )
      ? ts.factory.createCallSignature(
          declaration.typeParameters,
          declaration.parameters,
          declaration.type,
        )
      : undefined;
  const selfLocation =
    "name" in declaration && declaration.name !== undefined
      ? declaration.name
      : declaration;
  const selfType = checker.getTypeAtLocation(selfLocation);
  const selfTypeSymbols = new Set([
    ...enclosingSelfTypeSymbols,
    ...exportedSelfTypeSymbols(
      selfType,
      selfLocation,
      undefined,
      checker,
      "value",
    ),
  ]);
  const serializedSignature =
    signature === undefined
      ? fallbackFunctionSignature(declaration, sourceFile)
      : serializeCheckerSignature(
          signature,
          declaration,
          checker,
          ts.SignatureKind.Call,
          selfTypeSymbols,
          sourceSignature,
        );

  return `${syntaxMarkers}:${serializedSignature}`;
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

const surfaceMemberIdentity = (
  member: ts.Symbol,
  declarations: readonly ts.Declaration[],
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): SubjectIdentity => {
  for (const declaration of declarations) {
    if (!("name" in declaration)) {
      continue;
    }
    const name = (declaration as ts.NamedDeclaration).name;
    if (
      name === undefined ||
      !ts.isPropertyName(name) ||
      ts.isPrivateIdentifier(name)
    ) {
      continue;
    }
    const directName = propertyNameText(name);
    if (directName !== undefined) {
      return {
        key: JSON.stringify(["literal", directName]),
        displayName: directName,
      };
    }
    if (!ts.isComputedPropertyName(name)) {
      continue;
    }
    const expression = name.expression;
    if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
      return {
        key: JSON.stringify(["computed-literal", expression.text]),
        displayName: expression.text,
      };
    }
    const expressionType = checker.getTypeAtLocation(expression);
    if (expressionType.isStringLiteral()) {
      return {
        key: JSON.stringify(["computed-literal", expressionType.value]),
        displayName: expressionType.value,
      };
    }
    if (expressionType.isNumberLiteral()) {
      const value = String(expressionType.value);
      return {
        key: JSON.stringify(["computed-literal", value]),
        displayName: value,
      };
    }
    const symbol = referencedSymbol(expression, checker);
    if (symbol === undefined) {
      continue;
    }
    const canonicalSymbol = canonicalCheckerSymbol(symbol, checker);
    const exportedNames = exportedNamesForSymbol(
      canonicalSymbol,
      sourceFile,
      checker,
    );
    if (exportedNames.length > 0) {
      return {
        key: JSON.stringify(["computed-export", exportedNames]),
        displayName: `[${exportedNames[0]}]`,
      };
    }
    const qualifiedName = checker.getFullyQualifiedName(canonicalSymbol);
    const displayName = ts.createPrinter({
      removeComments: true,
      omitTrailingSemicolon: true,
    }).printNode(
      ts.EmitHint.Expression,
      expression,
      expression.getSourceFile(),
    );
    return {
      key: JSON.stringify(["computed", qualifiedName]),
      displayName: `[${displayName}]`,
    };
  }

  const qualifiedName = checker.getFullyQualifiedName(member);
  return {
    key: JSON.stringify(["checker-member", qualifiedName]),
    displayName: qualifiedName,
  };
};

const exportedNamesForSymbol = (
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): readonly string[] => {
  const moduleSymbol =
    checker.getSymbolAtLocation(sourceFile) ??
    (sourceFile as SymbolBearingNode).symbol;
  if (moduleSymbol === undefined) {
    return [];
  }

  return checker
    .getExportsOfModule(moduleSymbol)
    .filter(
      (exportedSymbol) =>
        canonicalCheckerSymbol(exportedSymbol, checker) === symbol,
    )
    .map((exportedSymbol) => exportedSymbol.name)
    .sort();
};

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

const isNonPublicDeclaration = (node: ts.Declaration): boolean => {
  if (
    hasNonPublicModifier(node) ||
    ts.getJSDocPrivateTag(node) !== undefined ||
    ts.getJSDocProtectedTag(node) !== undefined
  ) {
    return true;
  }
  if (!("name" in node)) {
    return false;
  }

  const name = (node as ts.NamedDeclaration).name;
  return name !== undefined && ts.isPrivateIdentifier(name);
};

const isConstVariableDeclaration = (node: ts.Declaration): boolean =>
  ts.isVariableDeclaration(node) &&
  (node.parent.flags & ts.NodeFlags.Const) !== 0;

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
