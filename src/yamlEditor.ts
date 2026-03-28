import * as fs from "fs";
import * as YAML from "yaml";

type KeyPath = (string | number)[];

/**
 * Update a value at a given key path in a YAML file, preserving formatting and comments.
 */
export function updateYamlValue(
  filePath: string,
  keyPath: KeyPath,
  newValue: any
): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const doc = YAML.parseDocument(content);
  doc.setIn(keyPath, newValue);
  fs.writeFileSync(filePath, doc.toString(), "utf-8");
}

/**
 * Delete an item at a given key path in a YAML file.
 */
export function deleteYamlItem(filePath: string, keyPath: KeyPath): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const doc = YAML.parseDocument(content);
  doc.deleteIn(keyPath);

  // If the parent array is now empty, remove the whole key
  if (keyPath.length >= 2 && typeof keyPath[keyPath.length - 1] === "number") {
    const parentPath = keyPath.slice(0, -1);
    const parent = doc.getIn(parentPath);
    if (YAML.isSeq(parent) && parent.items.length === 0) {
      doc.deleteIn(parentPath);
    }
  }

  fs.writeFileSync(filePath, doc.toString(), "utf-8");
}

/**
 * Add an item to an array at the given key path. Creates the array if it doesn't exist.
 */
export function addYamlArrayItem(
  filePath: string,
  arrayPath: KeyPath,
  value: any
): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const doc = YAML.parseDocument(content);
  const existing = doc.getIn(arrayPath);

  if (YAML.isSeq(existing)) {
    existing.add(doc.createNode(value));
  } else {
    doc.setIn(arrayPath, [value]);
  }

  fs.writeFileSync(filePath, doc.toString(), "utf-8");
}

/**
 * Get the current value at a key path.
 */
export function getYamlValue(filePath: string, keyPath: KeyPath): any {
  const content = fs.readFileSync(filePath, "utf-8");
  const doc = YAML.parseDocument(content);
  return doc.getIn(keyPath);
}

/**
 * Find the 1-based line number for a given key path in a YAML file.
 * Returns 1 if the path cannot be found.
 */
export function findYamlLineNumber(
  filePath: string,
  keyPath: KeyPath
): number {
  const content = fs.readFileSync(filePath, "utf-8");
  const doc = YAML.parseDocument(content);

  let node: any = doc.contents;
  for (const key of keyPath) {
    if (YAML.isMap(node)) {
      const pair = node.items.find(
        (item: any) =>
          (YAML.isScalar(item.key) && item.key.value === key) ||
          item.key === key
      );
      if (pair) {
        node = pair.value ?? pair;
      } else {
        return 1;
      }
    } else if (YAML.isSeq(node)) {
      const idx = typeof key === "number" ? key : parseInt(String(key), 10);
      if (idx >= 0 && idx < node.items.length) {
        node = node.items[idx];
      } else {
        return 1;
      }
    } else {
      return 1;
    }
  }

  if (node && node.range) {
    const offset = node.range[0];
    const lines = content.substring(0, offset).split("\n");
    return lines.length;
  }

  return 1;
}

/**
 * Set a key/value pair within a map at a given key path. Useful for updating
 * a single field within an object inside an array.
 * e.g. setYamlField(file, ["databases", 0], "host", "newhost")
 */
export function setYamlField(
  filePath: string,
  objectPath: KeyPath,
  field: string,
  value: any
): void {
  updateYamlValue(filePath, [...objectPath, field], value);
}
