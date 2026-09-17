import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { posix, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { parseJsonObject, stringArrayField, stringField } from "./json.mjs";

export interface ArchitectureProject {
  readonly name: string;
  readonly root: string;
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
  readonly references: readonly string[];
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

export interface ArchitectureFinding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const product = (name: string): string => `@adaptive-pair/${name}`;
const allowedDependencies: Readonly<Record<string, readonly string[]>> = {
  [product("protocol")]: [],
  [product("session-core")]: ["protocol"].map(product),
  [product("presence")]: ["protocol"].map(product),
  [product("modes")]: ["protocol"].map(product),
  [product("restraint")]: ["protocol"].map(product),
  [product("evidence")]: ["protocol"].map(product),
  [product("profile")]: ["protocol"].map(product),
  [product("evaluation")]: ["protocol"].map(product),
  [product("testkit")]: ["protocol"].map(product),
  [product("harness")]: ["protocol", "session-core", "modes", "restraint"].map(product),
  [product("runtime")]: ["protocol", "session-core", "modes", "restraint", "harness"].map(product),
  "adaptive-pair": ["protocol", "presence", "modes", "restraint", "evidence", "profile", "evaluation", "harness", "runtime"].map(product),
};

const referenceFinding = (
  project: ArchitectureProject,
  reference: string,
  target: ArchitectureProject | undefined,
): ArchitectureFinding | undefined => {
  const issue = (rule: string, message: string): ArchitectureFinding => ({
    rule, file: `${project.root}/tsconfig.json`, line: 1, message,
  });
  if (target === undefined) {
    return issue("unknown-reference", `Reference ${reference} is outside the reviewed workspace graph.`);
  }
  const production = project.dependencies.includes(target.name);
  const test = project.devDependencies.includes(target.name);
  if (!production && !test) {
    return issue("undeclared-reference", `Declare referenced project ${target.name} as a direct dependency.`);
  }
  const inward = allowedDependencies[project.name]?.includes(target.name) ?? false;
  const permittedTestkit = target.name === product("testkit") &&
    project.name !== product("protocol") && project.name !== product("testkit");
  if (!inward && (production || !permittedTestkit)) {
    return issue("forbidden-reference", `${project.name} cannot reference ${target.name} as a ${production ? "production" : "test"} dependency.`);
  }
  return undefined;
};

const within = (file: string, root: string): boolean => file === root || file.startsWith(`${root}/`);
const packageName = (specifier: string): string =>
  specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

const importsIn = (file: ArchitectureProject["files"][number]) => {
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const imports: { readonly specifier: string; readonly line: number }[] = [];
  const visit = (node: ts.Node): void => {
    let specifier: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifier = node.moduleReference.expression;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      specifier = node.arguments[0];
    }
    if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
      imports.push({ specifier: specifier.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
};

export const checkArchitecture = (projects: readonly ArchitectureProject[]): readonly ArchitectureFinding[] => {
  const findings: ArchitectureFinding[] = [];
  const byName = new Map(projects.map(project => [project.name, project]));
  const graph = new Map(projects.map(project => [project.name, new Set<string>()]));
  const report = (rule: string, file: string, line: number, message: string): void => {
    findings.push({ rule, file, line, message });
  };

  for (const project of projects) {
    const allowed = allowedDependencies[project.name];
    const manifest = `${project.root}/package.json`;
    if (allowed === undefined) {
      report("unreviewed-package", manifest, 1, `Define dependency policy for ${project.name}.`);
    }
    for (const dependency of project.dependencies) {
      if (byName.has(dependency)) {
        graph.get(project.name)?.add(dependency);
        if (!allowed?.includes(dependency)) {
          report("forbidden-dependency", manifest, 1, `${project.name} cannot depend on ${dependency}.`);
        }
      }
    }
    for (const reference of project.references) {
      const target = projects.find(candidate => candidate.root === reference);
      const finding = referenceFinding(project, reference, target);
      if (finding !== undefined) {
        findings.push(finding);
      }
      if (target !== undefined) {
        graph.get(project.name)?.add(target.name);
      }
    }

    for (const file of project.files) {
      const production = within(file.path, `${project.root}/src`);
      for (const imported of importsIn(file)) {
        const { specifier, line } = imported;
        if (specifier.startsWith(".")) {
          const target = posix.normalize(posix.join(posix.dirname(file.path), specifier));
          if (!within(target, project.root) || (production && !within(target, `${project.root}/src`))) {
            report("nonpublic-import", file.path, line, `Import ${specifier} escapes its package source boundary.`);
          }
          continue;
        }
        const name = packageName(specifier);
        const target = byName.get(name);
        const declared = project.dependencies.includes(name) || (!production && project.devDependencies.includes(name));
        if (target !== undefined) {
          if (specifier !== name) {
            report("nonpublic-import", file.path, line, `Use the public entry point of ${name}.`);
          }
          if (!declared) {
            report("undeclared-dependency", file.path, line, `Declare ${name} as a direct ${production ? "production" : "test"} dependency.`);
          }
          if (!project.references.includes(target.root)) {
            report("missing-reference", file.path, line, `Add a TypeScript project reference to ${target.root}.`);
          }
          if (production) {
            graph.get(project.name)?.add(name);
            if (!allowed?.includes(name)) {
              report("forbidden-dependency", file.path, line, `${project.name} cannot import ${name}.`);
            }
          }
        } else if (name.startsWith("@adaptive-pair/")) {
          report("unknown-package", file.path, line, `Unknown workspace import ${name}.`);
        } else if (production) {
          const pure = project.root.startsWith("packages/");
          if (pure && !(project.name === product("protocol") && name === "ajv")) {
            report("external-dependency", file.path, line, `Pure package ${project.name} cannot import ${specifier}.`);
          }
          if (!declared && !isBuiltin(specifier) && specifier !== "vscode") {
            report("undeclared-dependency", file.path, line, `Declare external dependency ${name}.`);
          }
        }
      }
    }
  }

  const visited = new Set<string>();
  const visiting: string[] = [];
  const visit = (name: string): void => {
    const cycleStart = visiting.indexOf(name);
    if (cycleStart >= 0) {
      report("dependency-cycle", `${byName.get(name)?.root ?? name}/package.json`, 1, [...visiting.slice(cycleStart), name].join(" -> "));
      return;
    }
    if (visited.has(name)) {
      return;
    }
    visiting.push(name);
    for (const target of [...(graph.get(name) ?? [])].sort()) {
      visit(target);
    }
    visiting.pop();
    visited.add(name);
  };
  for (const name of [...graph.keys()].sort()) {
    visit(name);
  }
  return findings.sort((left, right) =>
    `${left.file}:${left.line}:${left.rule}`.localeCompare(`${right.file}:${right.line}:${right.rule}`),
  );
};

const dependencyKeys = (value: unknown): readonly string[] => {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid dependency metadata.");
  }
  return Object.keys(value);
};

export const readArchitectureProjects = (root: string): readonly ArchitectureProject[] => {
  const jsonAt = (file: string) => parseJsonObject(readFileSync(resolve(root, file), "utf8"), file);
  const manifest = jsonAt("package.json");
  const projects: ArchitectureProject[] = [];
  const toRelative = (file: string): string => relative(root, file).split(sep).join("/");
  for (const pattern of stringArrayField(manifest, "workspaces")) {
    if (!/^[\w/-]+\/\*$/u.test(pattern)) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    const parent = pattern.slice(0, -2);
    for (const directory of readdirSync(resolve(root, parent), { withFileTypes: true })) {
      if (!directory.isDirectory()) {
        continue;
      }
      const projectRoot = `${parent}/${directory.name}`;
      if (!existsSync(resolve(root, projectRoot, "package.json"))) {
        continue;
      }
      const projectManifest = jsonAt(`${projectRoot}/package.json`);
      const name = stringField(projectManifest, "name");
      if (name === undefined) {
        throw new Error(`Missing package name: ${projectRoot}`);
      }
      const config = jsonAt(`${projectRoot}/tsconfig.json`);
      const references = config.references;
      if (references !== undefined && !Array.isArray(references)) {
        throw new Error(`Invalid project references: ${projectRoot}`);
      }
      const files: ArchitectureProject["files"][number][] = [];
      const scan = (directoryPath: string): void => {
        if (!existsSync(resolve(root, directoryPath))) {
          return;
        }
        for (const entry of readdirSync(resolve(root, directoryPath), { withFileTypes: true })) {
          const entryPath = `${directoryPath}/${entry.name}`;
          if (entry.isDirectory() && !["node_modules", "dist", ".host-test"].includes(entry.name) && entryPath !== `${projectRoot}/test/host/fixture`) {
            scan(entryPath);
          } else if (entry.isFile() && /\.(?:[cm]?ts|tsx)$/u.test(entry.name)) {
            files.push({ path: entryPath, content: readFileSync(resolve(root, entryPath), "utf8") });
          }
        }
      };
      scan(`${projectRoot}/src`);
      scan(`${projectRoot}/test`);
      projects.push({
        name,
        root: projectRoot,
        dependencies: dependencyKeys(projectManifest.dependencies),
        devDependencies: dependencyKeys(projectManifest.devDependencies),
        references: ((references ?? []) as unknown[]).map(reference => {
          if (typeof reference !== "object" || reference === null || !("path" in reference) || typeof reference.path !== "string") {
            throw new Error(`Invalid project reference: ${projectRoot}`);
          }
          return toRelative(resolve(root, projectRoot, reference.path)).replace(/\/tsconfig\.json$/u, "");
        }),
        files,
      });
    }
  }
  return projects.sort((left, right) => left.name.localeCompare(right.name));
};
