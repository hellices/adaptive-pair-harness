import { isAbsolute, relative, sep } from "node:path";

export const withinRoot = (root: string, target: string): boolean => {
  const relativePath = relative(root, target);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
};
