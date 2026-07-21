import { describe, expect, it } from "vitest";

import {
  decodeTar,
  decodeGzip,
  encodeGzip,
} from "../../src/application/os/linuxArchives.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("binary-safe guest filesystem", (): void => {
  it("round-trips every byte through copy and snapshot persistence", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/data");
    const bytes = Uint8Array.from({ length: 256 }, (_value, index) => index);

    filesystem.writeFileBytes("/data/all.bin", bytes);
    filesystem.copy("/data/all.bin", "/data/copy.bin");

    expect(filesystem.getSize("/data/all.bin")).toBe(256);
    expect([...filesystem.readFileBytes("/data/copy.bin")]).toEqual([...bytes]);
    expect(() => filesystem.readFile("/data/all.bin")).toThrow(
      "non-UTF-8 binary data",
    );

    const restored = new InMemoryFilesystem();
    restored.restore(filesystem.snapshot());
    expect([...restored.readFileBytes("/data/all.bin")]).toEqual([...bytes]);
  });
});

describe("bounded gzip codec", (): void => {
  it("produces and consumes a deterministic RFC 1952 stored stream", (): void => {
    const source = Uint8Array.from(
      { length: 70_000 },
      (_value, index) => index & 0xff,
    );
    const encoded = encodeGzip(source);

    expect([...encoded.slice(0, 3)]).toEqual([0x1f, 0x8b, 8]);
    expect([...decodeGzip(encoded)]).toEqual([...source]);
  });

  it("rejects a corrupt CRC before returning output", (): void => {
    const encoded = encodeGzip(new TextEncoder().encode("hello"));
    encoded[encoded.length - 8] = encoded[encoded.length - 8]! ^ 0xff;

    expect(() => decodeGzip(encoded)).toThrow("CRC32 mismatch");
  });
});

describe("CS-Linux archive commands", (): void => {
  it("creates, lists, and atomically extracts ustar archives", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });
    expect(session.submit("mkdir /tmp/source").exitCode).toBe(0);
    expect(
      session.submit("printf 'hello\\n' > /tmp/source/file.txt").exitCode,
    ).toBe(0);

    expect(session.submit("tar -cf /tmp/source.tar /tmp/source")).toMatchObject(
      {
        exitCode: 0,
        stderr: "",
      },
    );
    expect(filesystem.readFileBytes("/tmp/source.tar")[156]).toBe(53);
    expect(
      decodeTar(filesystem.readFileBytes("/tmp/source.tar")).map(
        ({ kind }) => kind,
      ),
    ).toEqual(["directory", "file"]);
    expect(session.submit("tar -tf /tmp/source.tar").stdout).toBe(
      "source/\nsource/file.txt\n",
    );
    expect(session.submit("mkdir /tmp/out").exitCode).toBe(0);
    expect(session.submit("tar -xf /tmp/source.tar -C /tmp/out")).toMatchObject(
      {
        exitCode: 0,
        stderr: "",
      },
    );
    expect(filesystem.readFile("/tmp/out/source/file.txt")).toBe("hello\n");
  });

  it("round-trips gzip and stored ZIP archives", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });
    expect(session.submit("printf 'payload' > /tmp/value").exitCode).toBe(0);

    expect(session.submit("gzip -k /tmp/value").exitCode).toBe(0);
    expect(session.submit("rm /tmp/value").exitCode).toBe(0);
    expect(session.submit("gunzip -k /tmp/value.gz").exitCode).toBe(0);
    expect(filesystem.readFile("/tmp/value")).toBe("payload");

    expect(session.submit("zip /tmp/value.zip /tmp/value").exitCode).toBe(0);
    expect(session.submit("mkdir /tmp/zipout").exitCode).toBe(0);
    expect(session.submit("unzip /tmp/value.zip -d /tmp/zipout")).toMatchObject(
      {
        exitCode: 0,
        stderr: "",
      },
    );
    expect(filesystem.readFile("/tmp/zipout/value")).toBe("payload");
  });
});
