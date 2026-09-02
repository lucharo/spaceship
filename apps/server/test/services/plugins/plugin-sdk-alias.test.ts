import { describe, expect, it, vi } from "vitest";
import { pluginSdkAliasFor } from "../../../src/services/plugins/plugin-runtime.js";

describe("pluginSdkAliasFor", () => {
  it("resolves the pre-rename specifier to the same SDK runtime bundle", () => {
    // Plugin server artifacts built before the @bb → @get-bb rename still
    // carry a bare "@bb/plugin-sdk" import; without the legacy alias the
    // loader fails to resolve it and every such install stops loading.
    const alias = pluginSdkAliasFor("/srv/plugin-sdk-runtime.js");

    expect(alias["@get-bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
    expect(alias["@bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
  });

  it("resolves exported SDK subpaths before the bare runtime alias", () => {
    const resolveSpecifier = vi.fn(
      (specifier: string) => `/workspace/sdk/${specifier.split("/").at(-1)}.js`,
    );

    const alias = pluginSdkAliasFor(
      "/srv/plugin-sdk-runtime.js",
      resolveSpecifier,
    );

    expect(alias["@get-bb/plugin-sdk/host"]).toBe("/workspace/sdk/host.js");
    expect(alias["@get-bb/plugin-sdk/provider-bridge/acp"]).toBe(
      "/workspace/sdk/acp.js",
    );
    expect(resolveSpecifier).toHaveBeenCalledWith("@get-bb/plugin-sdk/host");
  });
});
