import { describe, expect, it } from "vitest";

import { parseInstalledHostedCArchive } from "../../src/application/os/hostedCLibcImage.js";
import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";

describe("hosted C archive admission", (): void => {
  it("caches only byte-exact generated rootfs archives", (): void => {
    const encoded = linuxFilesystemImage.files.find(
      ({ path }) => path === "/usr/lib/libc.csa",
    )?.contents;
    expect(encoded).toBeDefined();
    const first = parseInstalledHostedCArchive(encoded!);
    expect(first).toBeDefined();
    expect(parseInstalledHostedCArchive(encoded!)).toBe(first);
    expect(parseInstalledHostedCArchive(`${encoded!}x`)).toBeUndefined();
  });
});
