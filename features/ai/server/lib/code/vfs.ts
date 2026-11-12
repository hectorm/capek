import { Buffer } from "node:buffer";

interface VFSFileNode {
  type: "file";
  content: string;
  readonly: boolean;
}

interface VFSDirNode {
  type: "dir";
  entries: Map<string, VFSNode>;
}

type VFSNode = VFSFileNode | VFSDirNode;

export interface VFSSnapshot {
  version: 1;
  files: Record<string, { content: string; readonly: boolean }>;
}

export const WORKSPACE_DIR = "/workspace";

const FILE_OVERHEAD_BYTES = 512;

const fileBytes = (path: string, content: string): number => {
  return Buffer.byteLength(path) + Buffer.byteLength(content) + FILE_OVERHEAD_BYTES;
};

export interface VFSOptions {
  maxWorkspaceBytes?: number;
}

export class VirtualFileSystem {
  private root: VFSDirNode = VirtualFileSystem.createDir();
  private workspaceBytes = 0;
  private maxWorkspaceBytes: number | undefined;

  public constructor(options: VFSOptions = {}) {
    this.maxWorkspaceBytes = options.maxWorkspaceBytes;
    this.mkdir(WORKSPACE_DIR);
  }

  private static isFile(node: VFSNode): node is VFSFileNode {
    return node.type === "file";
  }

  private static isDir(node: VFSNode): node is VFSDirNode {
    return node.type === "dir";
  }

  private static createDir(): VFSDirNode {
    return { type: "dir", entries: new Map() };
  }

  private static inWorkspace(normalized: string): boolean {
    return normalized.startsWith(`${WORKSPACE_DIR}/`);
  }

  private static workspaceBytesOf(node: VFSNode, path: string): number {
    if (VirtualFileSystem.isFile(node)) {
      return VirtualFileSystem.inWorkspace(path) ? fileBytes(path, node.content) : 0;
    }
    let bytes = 0;
    for (const [name, child] of node.entries) {
      bytes += VirtualFileSystem.workspaceBytesOf(child, `${path}/${name}`);
    }
    return bytes;
  }

  private assertWorkspaceSpace(growth: number): void {
    if (growth > 0 && this.workspaceBytes + growth > (this.maxWorkspaceBytes ?? Infinity)) {
      throw new Error(
        `ENOSPC: no space left, the files in '${WORKSPACE_DIR}' cannot hold more than ${String(this.maxWorkspaceBytes)} bytes`,
      );
    }
  }

  public exists(path: string): boolean {
    return this.getNode(path) !== null;
  }

  public isDirectory(path: string): boolean {
    const node = this.getNode(path);
    return node !== null && VirtualFileSystem.isDir(node);
  }

  public normalizePath(path: string): string {
    const parts = path.split("/").filter((p) => p !== "" && p !== ".");
    const result: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        result.pop();
      } else {
        result.push(part);
      }
    }
    return "/" + result.join("/");
  }

  public stat(path: string): { isFile: () => boolean; isDirectory: () => boolean; size: number; mode: number } | null {
    const node = this.getNode(path);
    if (!node) return null;

    const fileNode = VirtualFileSystem.isFile(node);
    return {
      isFile: () => fileNode,
      isDirectory: () => !fileNode,
      size: fileNode ? Buffer.byteLength(node.content) : 0,
      mode: fileNode ? 0o644 : 0o755,
    };
  }

  public readFile(path: string): string | null {
    const node = this.getNode(path);
    if (!node || !VirtualFileSystem.isFile(node)) return null;
    return node.content;
  }

  public readdir(path: string): string[] | null {
    const node = this.getNode(path);
    if (!node || !VirtualFileSystem.isDir(node)) return null;

    const result: string[] = [];
    for (const [name, child] of node.entries) {
      result.push(VirtualFileSystem.isDir(child) ? name + "/" : name);
    }
    return result;
  }

  public mkdir(path: string): boolean {
    try {
      this.ensureDirectoryExists(path);
      return true;
    } catch {
      return false;
    }
  }

  public writeFile(path: string, content: string, options?: { readonly?: boolean }): boolean {
    const normalized = this.normalizePath(path);
    const parts = normalized.split("/").filter((p) => p !== "");
    if (parts.length === 0) return false;

    const fileName = parts.pop();
    if (!fileName) return false;
    const dirPath = "/" + parts.join("/");

    const existingNode = this.getNode(normalized);
    if (existingNode && (VirtualFileSystem.isDir(existingNode) || existingNode.readonly)) {
      return false;
    }

    const inWorkspace = VirtualFileSystem.inWorkspace(normalized);
    const growth = fileBytes(normalized, content) - (existingNode ? fileBytes(normalized, existingNode.content) : 0);
    if (inWorkspace) {
      this.assertWorkspaceSpace(growth);
    }

    const dir = this.ensureDirectoryExists(dirPath);
    dir.entries.set(fileName, {
      type: "file",
      content,
      readonly: options?.readonly ?? false,
    });
    if (inWorkspace) {
      this.workspaceBytes += growth;
    }

    return true;
  }

  public appendFile(path: string, content: string): boolean {
    const existing = this.readFile(path);
    return this.writeFile(path, (existing ?? "") + content);
  }

  public copyFile(src: string, dest: string): boolean {
    const content = this.readFile(src);
    if (content === null) return false;
    return this.writeFile(dest, content);
  }

  public unlink(path: string): boolean {
    const normalized = this.normalizePath(path);
    const info = this.getParent(normalized);
    if (!info) return false;

    const node = info.parent.entries.get(info.name);
    if (!node || !VirtualFileSystem.isFile(node) || node.readonly) return false;

    info.parent.entries.delete(info.name);
    if (VirtualFileSystem.inWorkspace(normalized)) {
      this.workspaceBytes -= fileBytes(normalized, node.content);
    }
    return true;
  }

  public rmdir(path: string): boolean {
    const normalized = this.normalizePath(path);
    if (normalized === "/") return false;

    const info = this.getParent(normalized);
    if (!info) return false;

    const node = info.parent.entries.get(info.name);
    if (!node || !VirtualFileSystem.isDir(node) || node.entries.size > 0) return false;

    info.parent.entries.delete(info.name);
    return true;
  }

  public rm(path: string, options?: { recursive?: boolean; force?: boolean }): boolean {
    const normalized = this.normalizePath(path);
    if (normalized === "/") return false;

    const node = this.getNode(normalized);
    if (!node) return options?.force === true;

    if (VirtualFileSystem.isFile(node)) {
      return node.readonly ? false : this.unlink(normalized);
    }

    if (node.entries.size > 0) {
      if (!options?.recursive) return false;
      for (const [name, child] of node.entries) {
        const childPath = normalized + "/" + name;
        if (VirtualFileSystem.isFile(child)) {
          if (child.readonly) return false;
          this.unlink(childPath);
        } else {
          if (!this.rm(childPath, options)) return false;
        }
      }
    }

    return this.rmdir(normalized);
  }

  public rename(oldPath: string, newPath: string): boolean {
    const oldNorm = this.normalizePath(oldPath);
    const newNorm = this.normalizePath(newPath);
    if (newNorm.startsWith(`${oldNorm}/`)) return false;

    const oldInfo = this.getParent(oldNorm);
    if (!oldInfo) return false;

    const node = oldInfo.parent.entries.get(oldInfo.name);
    if (!node || (VirtualFileSystem.isFile(node) && node.readonly)) return false;

    const newParts = newNorm.split("/").filter((p) => p !== "");
    const newName = newParts.at(-1);
    if (!newName) return false;
    newParts.pop();

    const newParent = this.ensureDirectoryExists("/" + newParts.join("/"));
    if (newParent.entries.has(newName)) return false;

    const growth =
      VirtualFileSystem.workspaceBytesOf(node, newNorm) - VirtualFileSystem.workspaceBytesOf(node, oldNorm);
    this.assertWorkspaceSpace(growth);

    oldInfo.parent.entries.delete(oldInfo.name);
    newParent.entries.set(newName, node);
    this.workspaceBytes += growth;
    return true;
  }

  public glob(pattern: string): string[] {
    const normalized = this.normalizePath(pattern);
    const regex = this.globToRegex(normalized);
    return this.getAllPaths().filter((path) => regex.test(path));
  }

  static fromJSON(snapshot: VFSSnapshot, options: VFSOptions = {}): VirtualFileSystem {
    const vfs = new VirtualFileSystem();
    for (const [path, file] of Object.entries(snapshot.files)) {
      vfs.writeFile(path, file.content, { readonly: file.readonly });
    }
    vfs.maxWorkspaceBytes = options.maxWorkspaceBytes;
    return vfs;
  }

  public setWorkspaceFiles(snapshot: VFSSnapshot): void {
    this.root.entries.delete(WORKSPACE_DIR.slice(1));
    this.workspaceBytes = 0;
    this.mkdir(WORKSPACE_DIR);
    for (const [path, file] of Object.entries(snapshot.files)) {
      if (VirtualFileSystem.inWorkspace(this.normalizePath(path))) {
        this.writeFile(path, file.content, { readonly: file.readonly });
      }
    }
  }

  public toJSON(): VFSSnapshot {
    const files: Record<string, { content: string; readonly: boolean }> = {};
    const traverse = (node: VFSNode, path: string): void => {
      if (VirtualFileSystem.isFile(node)) {
        files[path] = { content: node.content, readonly: node.readonly };
      } else {
        for (const [name, child] of node.entries) {
          traverse(child, path + "/" + name);
        }
      }
    };
    traverse(this.root, "");
    return { version: 1, files };
  }

  public getWorkspaceFiles(): VFSSnapshot {
    const files: Record<string, { content: string; readonly: boolean }> = {};
    const traverse = (node: VFSNode, path: string): void => {
      if (VirtualFileSystem.isFile(node)) {
        if (VirtualFileSystem.inWorkspace(path)) {
          files[path] = { content: node.content, readonly: node.readonly };
        }
      } else {
        for (const [name, child] of node.entries) {
          traverse(child, path + "/" + name);
        }
      }
    };
    traverse(this.root, "");
    return { version: 1, files };
  }

  private getNode(path: string): VFSNode | null {
    const normalized = this.normalizePath(path);
    if (normalized === "/") return this.root;

    const parts = normalized.split("/").filter((p) => p !== "");
    let current: VFSNode = this.root;

    for (const part of parts) {
      if (!VirtualFileSystem.isDir(current)) return null;
      const child = current.entries.get(part);
      if (!child) return null;
      current = child;
    }

    return current;
  }

  private getParent(normalized: string): { parent: VFSDirNode; name: string } | null {
    const parts = normalized.split("/").filter((p) => p !== "");
    const name = parts.at(-1);
    if (!name) return null;

    parts.pop();
    const parentPath = "/" + parts.join("/");
    const parent = this.getNode(parentPath);

    if (!parent || !VirtualFileSystem.isDir(parent)) return null;
    return { parent, name };
  }

  private ensureDirectoryExists(path: string): VFSDirNode {
    const normalized = this.normalizePath(path);
    const parts = normalized.split("/").filter((p) => p !== "");
    let current: VFSDirNode = this.root;

    for (const part of parts) {
      let child = current.entries.get(part);
      if (!child) {
        child = VirtualFileSystem.createDir();
        current.entries.set(part, child);
      }
      if (VirtualFileSystem.isFile(child)) {
        throw new Error(`Path conflict: ${part} is a file`);
      }
      current = child;
    }

    return current;
  }

  private getAllPaths(): string[] {
    const paths: string[] = [];
    const traverse = (node: VFSNode, path: string): void => {
      if (VirtualFileSystem.isFile(node)) {
        paths.push(path);
      } else {
        paths.push(path + "/");
        for (const [name, child] of node.entries) {
          traverse(child, path + "/" + name);
        }
      }
    };
    for (const [name, child] of this.root.entries) {
      traverse(child, "/" + name);
    }
    return paths;
  }

  private globToRegex(pattern: string): RegExp {
    let regex = "";
    let i = 0;
    while (i < pattern.length) {
      const char = pattern.charAt(i);
      if (char === "*") {
        if (pattern[i + 1] === "*") {
          regex += ".*";
          i += 2;
          if (pattern[i] === "/") i++;
        } else {
          regex += "[^/]*";
          i++;
        }
      } else if (char === "?") {
        regex += "[^/]";
        i++;
      } else if (char === ".") {
        regex += "\\.";
        i++;
      } else if (char === "/") {
        regex += "/";
        i++;
      } else {
        regex += char.replace(/[\\^$+{}|[\]()]/g, "\\$&");
        i++;
      }
    }
    return new RegExp("^" + regex + "$");
  }
}
