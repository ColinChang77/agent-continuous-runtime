import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AtomicWriteOptions {
  tempFileName?: string;
  writeImpl?: typeof writeFile;
  renameImpl?: typeof rename;
}

export async function atomicWriteFile(
  targetPath: string,
  content: string,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const writeImpl = options.writeImpl ?? writeFile;
  const renameImpl = options.renameImpl ?? rename;
  const tempFileName =
    options.tempFileName ??
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const tempPath = path.join(path.dirname(targetPath), tempFileName);

  await writeImpl(tempPath, content, "utf8");
  await renameImpl(tempPath, targetPath);
}
